/**
 * Server-side primary-identifier generation and client-supplied ID rejection.
 *
 * Requirement 10.3: tenant-owned record identifiers are generated server-side using a
 * generation method that guarantees uniqueness across concurrent clients, and the system
 * SHALL NOT accept a client-supplied primary identifier.
 */

/** Thrown when a caller attempts to supply a primary identifier for a new tenant-owned record. */
export class ClientSuppliedIdError extends Error {
  constructor(resource: string) {
    super(
      `Client-supplied identifiers are not permitted for "${resource}"; primary identifiers are generated server-side.`,
    );
    this.name = 'ClientSuppliedIdError';
  }
}

/** Returns a v4 UUID using the platform crypto implementation, with an RFC 4122 fallback. */
function uuidV4(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // Fallback: derive a v4 UUID from cryptographically strong random bytes when available,
  // otherwise from Math.random (last-resort, non-crypto environments only).
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Set version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-` +
    `${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  );
}

/** Generates a fresh server-side primary identifier for a new tenant-owned record. */
export function newRecordId(): string {
  return uuidV4();
}

/**
 * Rejects a record that carries a client-supplied primary identifier.
 *
 * @throws {ClientSuppliedIdError} when `record.id` is present and non-empty.
 */
export function rejectClientId(record: { id?: unknown }, resource: string): void {
  const id = record?.id;
  if (id !== undefined && id !== null && String(id).trim() !== '') {
    throw new ClientSuppliedIdError(resource);
  }
}
