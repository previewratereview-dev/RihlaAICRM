import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';

import {
  runLegacyConversion,
  setLegacyConversionStore,
  aiKeyRef,
  MigrationHaltError,
  type LegacyConversionStore,
  type LegacySuperAdmin,
  type LegacyPlaintextKey,
  type ConversionReportEntry,
} from './legacy-conversion';
import { open, type SealedSecret } from '../secrets/store';

/**
 * Legacy conversion migration — unit tests (Task 14.2).
 *
 * Exercises the conversion flow in isolation through an in-memory store and the
 * real Secret_Store sealing (no crypto mocking, so the round-trip and
 * "no plaintext retained" guarantees are genuinely validated). Covers
 * Requirements 11.3 (super_admin → platform identity), 11.6 / 6.6 / 6.7
 * (encrypted key migration, halt + report on failure, no plaintext retained),
 * and 11.8 (idempotence).
 */

// A real 32-byte AES-256 key so seal()/open() perform genuine encryption.
const TEST_KEY = randomBytes(32).toString('base64');

/** In-memory implementation of the conversion store for tests. */
class FakeStore implements LegacyConversionStore {
  superAdmins: LegacySuperAdmin[] = [];
  plaintextKeys: LegacyPlaintextKey[] = [];
  platformAdmins = new Set<string>();
  // Records remaining tenant membership (auth user ids with a profile row).
  profiles = new Set<string>();
  secrets = new Map<string, { tenantId: string; sealed: SealedSecret }>();
  // Mirror of the cleared plaintext columns: settingsId -> {openai?, anthropic?}
  clearedColumns: Array<{ settingsId: string; column: string }> = [];
  report: ConversionReportEntry[] = [];

  // Optional fault injectors keyed by the operation + identifier.
  failOn: ((op: string, id: string) => boolean) | null = null;

  private maybeFail(op: string, id: string) {
    if (this.failOn && this.failOn(op, id)) {
      throw new Error(`injected failure in ${op}`);
    }
  }

  async listLegacySuperAdmins(): Promise<LegacySuperAdmin[]> {
    // Only those still holding a profile (tenant membership) remain "legacy".
    return this.superAdmins.filter((a) => this.profiles.has(a.authUserId));
  }
  async platformAdminExists(authUserId: string): Promise<boolean> {
    return this.platformAdmins.has(authUserId);
  }
  async insertPlatformAdmin(authUserId: string): Promise<void> {
    this.maybeFail('insertPlatformAdmin', authUserId);
    this.platformAdmins.add(authUserId);
  }
  async removeTenantMembership(authUserId: string): Promise<void> {
    this.maybeFail('removeTenantMembership', authUserId);
    this.profiles.delete(authUserId);
  }

  async listPlaintextKeys(): Promise<LegacyPlaintextKey[]> {
    // Only keys not yet cleared remain.
    return this.plaintextKeys.filter(
      (k) =>
        !this.clearedColumns.some(
          (c) => c.settingsId === k.settingsId && c.column === providerColumn(k.provider),
        ),
    );
  }
  async storeSealedSecret(ref: string, tenantId: string, sealed: SealedSecret): Promise<void> {
    this.maybeFail('storeSealedSecret', ref);
    this.secrets.set(ref, { tenantId, sealed });
  }
  async readSealedSecret(ref: string): Promise<SealedSecret | null> {
    this.maybeFail('readSealedSecret', ref);
    return this.secrets.get(ref)?.sealed ?? null;
  }
  async clearPlaintextKey(settingsId: string, column: 'openai_key' | 'anthropic_key'): Promise<void> {
    this.maybeFail('clearPlaintextKey', `${settingsId}:${column}`);
    this.clearedColumns.push({ settingsId, column });
  }

  async recordReport(entry: ConversionReportEntry): Promise<void> {
    this.report.push(entry);
  }
}

function providerColumn(provider: 'openai' | 'anthropic'): string {
  return provider === 'openai' ? 'openai_key' : 'anthropic_key';
}

beforeEach(() => {
  process.env.SECRET_STORE_KEY = TEST_KEY;
  process.env.SECRET_STORE_KEY_VERSION = '1';
});

afterEach(() => {
  setLegacyConversionStore(null);
  vi.restoreAllMocks();
});

describe('runLegacyConversion — super admin conversion (Req 11.3, 2.1)', () => {
  it('converts each legacy super_admin into a platform identity with no tenant membership', async () => {
    const store = new FakeStore();
    store.superAdmins = [
      { authUserId: 'user-1', tenantId: 'legacy-global-agency' },
      { authUserId: 'user-2', tenantId: 'legacy-global-agency' },
    ];
    store.profiles = new Set(['user-1', 'user-2']);
    setLegacyConversionStore(store);

    const result = await runLegacyConversion();

    expect(result.superAdminsConverted).toBe(2);
    // Platform identity created for both.
    expect(store.platformAdmins.has('user-1')).toBe(true);
    expect(store.platformAdmins.has('user-2')).toBe(true);
    // Tenant membership removed for both.
    expect(store.profiles.size).toBe(0);
    // Both conversions reported as converted.
    const converted = store.report.filter(
      (r) => r.step === 'convert_super_admin' && r.status === 'converted',
    );
    expect(converted).toHaveLength(2);
  });

  it('does not create a platform identity again when one already exists (idempotent)', async () => {
    const store = new FakeStore();
    store.superAdmins = [{ authUserId: 'user-1', tenantId: 'legacy-global-agency' }];
    store.profiles = new Set(['user-1']);
    store.platformAdmins = new Set(['user-1']); // identity already present
    const insertSpy = vi.spyOn(store, 'insertPlatformAdmin');
    setLegacyConversionStore(store);

    await runLegacyConversion();

    expect(insertSpy).not.toHaveBeenCalled();
    expect(store.profiles.size).toBe(0);
  });

  it('halts and reports, preserving the source profile, when conversion fails', async () => {
    const store = new FakeStore();
    store.superAdmins = [{ authUserId: 'user-1', tenantId: 'legacy-global-agency' }];
    store.profiles = new Set(['user-1']);
    store.failOn = (op) => op === 'removeTenantMembership';
    setLegacyConversionStore(store);

    await expect(runLegacyConversion()).rejects.toBeInstanceOf(MigrationHaltError);
    // Source profile is preserved (membership not removed).
    expect(store.profiles.has('user-1')).toBe(true);
    // Failure recorded, never silently discarded.
    expect(store.report.some((r) => r.step === 'convert_super_admin' && r.status === 'failed')).toBe(
      true,
    );
  });
});

describe('runLegacyConversion — plaintext key migration (Req 11.6, 6.6, 6.7)', () => {
  it('seals keys into the Secret_Store, round-trips to the original, and retains no plaintext', async () => {
    const store = new FakeStore();
    store.plaintextKeys = [
      { settingsId: 's1', tenantId: 'agency-a', provider: 'openai', value: 'sk-openai-secret-123' },
      { settingsId: 's1', tenantId: 'agency-a', provider: 'anthropic', value: 'sk-ant-secret-456' },
    ];
    setLegacyConversionStore(store);

    const result = await runLegacyConversion();

    expect(result.keysMigrated).toBe(2);

    const openaiRef = aiKeyRef('agency-a', 'openai');
    const anthropicRef = aiKeyRef('agency-a', 'anthropic');

    // Stored ciphertext decrypts back to the original plaintext.
    expect(open(store.secrets.get(openaiRef)!.sealed)).toBe('sk-openai-secret-123');
    expect(open(store.secrets.get(anthropicRef)!.sealed)).toBe('sk-ant-secret-456');

    // No plaintext retained: both columns cleared.
    expect(store.clearedColumns).toEqual(
      expect.arrayContaining([
        { settingsId: 's1', column: 'openai_key' },
        { settingsId: 's1', column: 'anthropic_key' },
      ]),
    );

    // Sealed envelope holds no plaintext.
    const sealed = store.secrets.get(openaiRef)!.sealed;
    expect(sealed.ciphertext).not.toContain('sk-openai-secret-123');
  });

  it('halts and reports the failing credential by ref (never its value) on store failure', async () => {
    const store = new FakeStore();
    const secretValue = 'sk-super-secret-value';
    store.plaintextKeys = [
      { settingsId: 's1', tenantId: 'agency-a', provider: 'openai', value: secretValue },
    ];
    store.failOn = (op) => op === 'storeSealedSecret';
    setLegacyConversionStore(store);

    let thrownMessage = '';
    await expect(
      runLegacyConversion().catch((e: unknown) => {
        thrownMessage = e instanceof Error ? e.message : String(e);
        throw e;
      }),
    ).rejects.toBeInstanceOf(MigrationHaltError);

    // Plaintext not cleared because the migration halted before verification.
    expect(store.clearedColumns).toHaveLength(0);

    const failed = store.report.find((r) => r.step === 'migrate_key' && r.status === 'failed');
    expect(failed).toBeDefined();
    // The report identifies the credential by ref and never leaks the value.
    expect(failed!.target).toBe(aiKeyRef('agency-a', 'openai'));
    expect(JSON.stringify(store.report)).not.toContain(secretValue);
    // The thrown error names the ref, never the secret value.
    expect(thrownMessage).toContain(aiKeyRef('agency-a', 'openai'));
    expect(thrownMessage).not.toContain(secretValue);
  });

  it('halts when the stored secret fails round-trip verification', async () => {
    const store = new FakeStore();
    store.plaintextKeys = [
      { settingsId: 's1', tenantId: 'agency-a', provider: 'openai', value: 'sk-value' },
    ];
    // Corrupt the stored secret after writing so verification fails.
    const origStore = store.storeSealedSecret.bind(store);
    store.storeSealedSecret = async (ref, tenantId, sealed) => {
      await origStore(ref, tenantId, { ...sealed, ciphertext: 'dGFtcGVyZWQ=' });
    };
    setLegacyConversionStore(store);

    await expect(runLegacyConversion()).rejects.toBeInstanceOf(MigrationHaltError);
    // Plaintext preserved (not cleared) when verification fails.
    expect(store.clearedColumns).toHaveLength(0);
  });
});

describe('runLegacyConversion — idempotence (Req 11.8)', () => {
  it('a second run is a no-op and creates no duplicates', async () => {
    const store = new FakeStore();
    store.superAdmins = [{ authUserId: 'user-1', tenantId: 'legacy-global-agency' }];
    store.profiles = new Set(['user-1']);
    store.plaintextKeys = [
      { settingsId: 's1', tenantId: 'agency-a', provider: 'openai', value: 'sk-value' },
    ];
    setLegacyConversionStore(store);

    const first = await runLegacyConversion();
    expect(first.superAdminsConverted).toBe(1);
    expect(first.keysMigrated).toBe(1);

    const reportAfterFirst = store.report.length;

    const second = await runLegacyConversion();
    // Nothing left to do on the second run.
    expect(second.superAdminsConverted).toBe(0);
    expect(second.keysMigrated).toBe(0);
    // No additional report rows, no duplicate secrets.
    expect(store.report.length).toBe(reportAfterFirst);
    expect(store.secrets.size).toBe(1);
    expect(store.platformAdmins.size).toBe(1);
  });
});
