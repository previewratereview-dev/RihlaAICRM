import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Property 8: Auth_Hook cookie hygiene
 * Validates: Requirements 5.2, 5.10
 *
 * The auth hook must NOT write cookies directly — cookie management is
 * handled entirely by @supabase/ssr in Supabase mode, and not at all in Local Mode.
 */
describe('Auth_Hook cookie hygiene', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('use-auth.ts source does not contain Cookies.set or document.cookie writes', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../hooks/use-auth.ts');
    const source = fs.readFileSync(filePath, 'utf-8');

    // Must not import js-cookie
    expect(source).not.toMatch(/import.*from\s+['"]js-cookie['"]/);
    // Must not call Cookies.set
    expect(source).not.toMatch(/Cookies\.set\(/);
    // Must not write document.cookie
    expect(source).not.toMatch(/document\.cookie\s*=/);
  });

  it('use-auth.ts source does not reference SESSION_COOKIE_NAME', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../hooks/use-auth.ts');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).not.toMatch(/SESSION_COOKIE_NAME/);
  });
});
