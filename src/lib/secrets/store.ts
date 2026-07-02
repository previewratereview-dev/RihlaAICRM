/**
 * Secret_Store — authenticated encryption for tenant secrets and API keys.
 *
 * Responsibilities (Requirement 6):
 * - Encrypt secrets at rest with AES-256-GCM, providing confidentiality AND
 *   integrity so any tampering with stored ciphertext is detected on decrypt. (6.1)
 * - Expose only a boolean or a masked view (<= last 4 chars) to clients;
 *   plaintext is decrypted server-side only and never returned to a browser. (6.2, 6.3, 6.4)
 * - Updating a secret produces fresh ciphertext and keeps no plaintext copy. (6.5)
 * - Plaintext is excluded from all thrown errors and log entries. (6.8)
 * - The data encryption key is sourced from the environment / secret manager,
 *   which is separate from the database holding the ciphertext. (6.9)
 *
 * This module is server-only. It performs no logging and never embeds secret
 * material in thrown errors.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** A secret encrypted at rest. Persisted as-is in the `secret_store` table. */
export interface SealedSecret {
  /** AES-GCM initialization vector (nonce), base64-encoded. */
  iv: string;
  /** GCM authentication tag used for integrity verification, base64-encoded. */
  authTag: string;
  /** Encrypted secret value, base64-encoded. */
  ciphertext: string;
  /** Version of the data key used, to support key rotation. */
  keyVersion: number;
}

/** Status of a configured secret, shaped per the requested format. */
export interface SecretStatus {
  /** Whether a secret is configured for the reference. */
  configured: boolean;
  /** Masked representation exposing at most the last 4 characters. */
  masked?: string;
}

/** Format a client may request for secret status (Requirement 6.3). */
export type SecretStatusFormat = 'boolean' | 'masked';

/**
 * Resolves a sealed secret for a stable reference (typically the
 * `secret_store.ref` column). Injected so this module stays decoupled from the
 * data-access layer; returns `null` when no secret is configured for the ref.
 */
export type SecretResolver = (
  ref: string,
) => Promise<SealedSecret | null> | SealedSecret | null;

const GCM_ALGORITHM = 'aes-256-gcm';
const AES_256_KEY_BYTES = 32;
const GCM_IV_BYTES = 12; // 96-bit nonce recommended for GCM
const MAX_VISIBLE_CHARS = 4;

/**
 * Error type for the Secret_Store. Messages are guaranteed never to contain
 * secret plaintext or key material (Requirement 6.8).
 */
export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

let injectedResolver: SecretResolver | null = null;

/**
 * Register the resolver used by {@link getStatus} to look up sealed secrets.
 * Wired by the data-access layer; kept injectable for isolated server use.
 */
export function setSecretResolver(resolver: SecretResolver | null): void {
  injectedResolver = resolver;
}

function currentKeyVersion(): number {
  const raw = process.env.SECRET_STORE_KEY_VERSION;
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Look up the raw key string for a key version from the environment / secret
 * manager. The key store is intentionally separate from the secret database so
 * read access to ciphertext alone does not yield the key (Requirement 6.9).
 */
function rawKeyForVersion(version: number): string | undefined {
  const versioned = process.env[`SECRET_STORE_KEY_V${version}`];
  if (versioned) return versioned;
  // Fall back to the unversioned key for v1 deployments.
  if (version === 1 || version === currentKeyVersion()) {
    return process.env.SECRET_STORE_KEY;
  }
  return undefined;
}

/** Decode a configured key (base64 or hex) into a 32-byte AES-256 key. */
function decodeKey(raw: string): Buffer {
  const base64 = Buffer.from(raw, 'base64');
  if (base64.length === AES_256_KEY_BYTES) return base64;

  const hex = Buffer.from(raw, 'hex');
  if (hex.length === AES_256_KEY_BYTES) return hex;

  // Never include the key material in the error.
  throw new SecretStoreError(
    'Encryption key must decode (base64 or hex) to exactly 32 bytes for AES-256-GCM',
  );
}

function resolveKey(version: number): Buffer {
  const raw = rawKeyForVersion(version);
  if (!raw) {
    throw new SecretStoreError(
      `No encryption key configured for key version ${version}`,
    );
  }
  return decodeKey(raw);
}

/**
 * Encrypt a plaintext secret using AES-256-GCM with the current data key.
 * Returns the IV, auth tag, ciphertext, and key version for storage (6.1).
 * A fresh random IV is used per call, so re-sealing the same value yields
 * different ciphertext and retains no plaintext copy (6.5).
 */
export function seal(plaintext: string): SealedSecret {
  if (typeof plaintext !== 'string') {
    throw new SecretStoreError('Secret to seal must be a string');
  }

  const keyVersion = currentKeyVersion();
  const key = resolveKey(keyVersion);
  const iv = randomBytes(GCM_IV_BYTES);

  try {
    const cipher = createCipheriv(GCM_ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      keyVersion,
    };
  } catch {
    // Scrub: never surface the plaintext or underlying crypto detail.
    throw new SecretStoreError('Failed to seal secret');
  }
}

/**
 * Decrypt a sealed secret. Server-side only. Throws if the ciphertext, IV, or
 * auth tag has been tampered with (GCM integrity check), without leaking the
 * plaintext or crypto internals (Requirement 6.1, 6.4, 6.8).
 */
export function open(sealed: SealedSecret): string {
  if (!sealed || typeof sealed !== 'object') {
    throw new SecretStoreError('Invalid sealed secret');
  }

  const key = resolveKey(sealed.keyVersion);

  try {
    const iv = Buffer.from(sealed.iv, 'base64');
    const authTag = Buffer.from(sealed.authTag, 'base64');
    const ciphertext = Buffer.from(sealed.ciphertext, 'base64');

    const decipher = createDecipheriv(GCM_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch {
    // GCM authentication failure or malformed input — do not leak details.
    throw new SecretStoreError(
      'Failed to open sealed secret: integrity check failed or data is corrupt',
    );
  }
}

/**
 * Produce a masked representation of a secret that exposes no more than the
 * last 4 characters (Requirement 6.3). Secrets of length <= 4 are fully masked
 * so the entire value is never revealed.
 */
export function maskedView(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) return '';

  const visibleCount = plaintext.length > MAX_VISIBLE_CHARS ? MAX_VISIBLE_CHARS : 0;
  const hiddenCount = plaintext.length - visibleCount;
  const suffix = visibleCount > 0 ? plaintext.slice(plaintext.length - visibleCount) : '';

  return '•'.repeat(hiddenCount) + suffix;
}

/**
 * Return the status of a configured secret for a reference, in the format the
 * client requested. Never returns plaintext: 'boolean' yields only a
 * configured flag; 'masked' yields a masked view exposing at most the last 4
 * characters (Requirement 6.2, 6.3, 6.4).
 */
export async function getStatus(
  ref: string,
  format: SecretStatusFormat,
): Promise<SecretStatus> {
  if (!injectedResolver) {
    throw new SecretStoreError('No secret resolver configured');
  }

  const sealed = await injectedResolver(ref);
  if (!sealed) {
    return { configured: false };
  }

  if (format === 'boolean') {
    return { configured: true };
  }

  // 'masked' — decrypt server-side only to compute the masked suffix.
  const plaintext = open(sealed);
  return { configured: true, masked: maskedView(plaintext) };
}

/**
 * Reveal the plaintext of a configured secret for a reference. Server-side only
 * (Requirement 6.4): the decrypted value is intended for an outbound provider
 * call or for verifying an inbound webhook signature, and MUST NOT be returned
 * to a browser client. Returns `null` when no secret is configured for the ref.
 *
 * Unlike {@link getStatus}, this returns the raw secret and therefore must only
 * be called from trusted server-side code paths.
 */
export async function revealSecret(ref: string): Promise<string | null> {
  if (!injectedResolver) {
    throw new SecretStoreError('No secret resolver configured');
  }

  if (!ref) return null;

  const sealed = await injectedResolver(ref);
  if (!sealed) return null;

  return open(sealed);
}
