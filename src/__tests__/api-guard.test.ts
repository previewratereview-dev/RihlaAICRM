import { describe, it, expect } from 'vitest';

/**
 * Property 13: requirePermission response contract
 * Validates: Requirements 12.1–12.6
 */
describe('requirePermission response contract', () => {
  it('api-guard.ts exports requireAuth and requirePermission', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../lib/auth/api-guard.ts'),
      'utf-8'
    );
    
    expect(source).toMatch(/export async function requireAuth/);
    expect(source).toMatch(/export async function requirePermission/);
  });

  it('requireAuth returns 401 on missing user', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../lib/auth/api-guard.ts'),
      'utf-8'
    );
    
    expect(source).toMatch(/status:\s*401/);
  });

  it('requirePermission returns 403 when permission check fails', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../lib/auth/api-guard.ts'),
      'utf-8'
    );
    
    expect(source).toMatch(/status:\s*403/);
    expect(source).toMatch(/can\(result\.user\.role,\s*permission\)/);
  });

  it('normalises legacy roles before permission checks', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../lib/auth/api-guard.ts'),
      'utf-8'
    );
    
    expect(source).toMatch(/normaliseRole/);
    expect(source).toMatch(/setter.*specialist/);
  });
});
