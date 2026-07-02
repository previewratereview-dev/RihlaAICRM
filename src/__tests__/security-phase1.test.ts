/**
 * Security regression tests for Phase 1 Critical Security Fixes.
 *
 * These tests verify that the identified vulnerabilities are actually fixed
 * and prevent regression. Each test targets a specific finding from the audit.
 */

import { describe, it, expect } from 'vitest';

// ===========================================================================
// Fix #3: Hardcoded seed credentials removed from client bundle
// ===========================================================================
describe('Fix #3 — No hardcoded seed credentials in client bundle', () => {
  it('use-auth.ts should not contain any hardcoded email addresses', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/hooks/use-auth.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Should not contain hardcoded email addresses that were seed credentials
    const hardcodedEmails = [
      'rayees@stateai.in',
      'user@stateai.com',
      'admin@stateai.com',
      'rahees@stateai.com',
      'setter@stateai.com',
    ];

    for (const email of hardcodedEmails) {
      expect(content).not.toContain(email);
    }
  });

  it('use-auth.ts should not contain hardcoded tenant IDs for seed accounts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/hooks/use-auth.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Should not contain the seed account IDs
    expect(content).not.toContain('user-0');
    expect(content).not.toContain('user-1');
    expect(content).not.toContain('user-2');
    expect(content).not.toContain('user-7');
  });
});

// ===========================================================================
// Fix #4: Password removed from User type
// ===========================================================================
describe('Fix #4 — Password removed from User type', () => {
  it('User interface should not have a password field', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/types/common.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    // The User interface should not contain a password field
    expect(content).not.toMatch(/interface User[\s\S]*?password\?/);
  });
});

// ===========================================================================
// Fix #7: OTP uses crypto.randomInt(), not Math.random()
// ===========================================================================
describe('Fix #7 — OTP generation uses CSPRNG', () => {
  it('resend-otp route should not use Math.random()', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/app/api/auth/resend-otp/route.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).not.toContain('Math.random()');
    expect(content).toContain('randomInt');
  });

  it('registration service should not use Math.random()', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/lib/registration/service.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).not.toContain('Math.random()');
    expect(content).toContain('randomInt');
  });
});

// ===========================================================================
// Fix #8: CSP tightened
// ===========================================================================
describe('Fix #8 — CSP tightened', () => {
  it('next.config.ts should not contain unsafe-inline in script-src', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'next.config.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).not.toContain("script-src 'self' 'unsafe-eval' 'unsafe-inline'");
  });

  it('next.config.ts should include HSTS header', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'next.config.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('Strict-Transport-Security');
  });

  it('next.config.ts should include base-uri and form-action directives', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'next.config.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain("base-uri 'self'");
    expect(content).toContain("form-action 'self'");
  });

  it('next.config.ts should include api.anthropic.com in connect-src', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'next.config.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('https://api.anthropic.com');
  });
});

// ===========================================================================
// Fix #9: Payment idempotency
// ===========================================================================
describe('Fix #9 — Payment idempotency', () => {
  it('verify-payment should validate plan against allowed values', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/app/api/billing/verify-payment/route.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('VerifyPaymentSchema');
    expect(content).toContain('validateRequest');
  });

  it('verify-payment should check for existing payment_id', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/app/api/billing/verify-payment/route.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('existing');
    expect(content).toContain('razorpay_payment_id');
  });
});

// ===========================================================================
// Fix #10: Audit logs append-only
// ===========================================================================
describe('Fix #10 — Audit logs are append-only', () => {
  it('supabase_schema.sql should not have FOR ALL on audit_logs', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'supabase_schema.sql');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Find the audit_logs section and verify it doesn't have FOR ALL
    const auditSection = content.substring(content.indexOf('audit_logs'));
    expect(auditSection).not.toMatch(/for all.*audit_logs/i);
  });

  it('supabase_schema.sql should have separate INSERT policy for audit_logs', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'supabase_schema.sql');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('Authenticated users can insert audit_logs');
  });
});

// ===========================================================================
// Fix #12: Branding endpoint does not expose API keys
// ===========================================================================
describe('Fix #12 — Branding endpoint does not expose secrets', () => {
  it('branding route should not select * from settings', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/app/api/tenant/branding/route.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    // The tenants table can use select('*'), but the settings table should not
    // because it contains API keys. Find the settings query and verify it
    // explicitly lists fields.
    const settingsQuery = content.match(/from\('settings'\)[\s\S]*?\.maybeSingle/);
    expect(settingsQuery).not.toBeNull();
    expect(settingsQuery![0]).not.toContain("select('*')");
    expect(settingsQuery![0]).toContain('agency_name');
  });

  it('branding route should not return systemPrompt', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/app/api/tenant/branding/route.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).not.toContain('systemPrompt');
  });
});

// ===========================================================================
// Fix #13: platform_settings PK mismatch fixed
// ===========================================================================
describe('Fix #13 — platform_settings uses correct PK', () => {
  it('service.ts should query platform_settings by "platform" not 1', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/lib/data/service.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Should not query with integer 1
    expect(content).not.toMatch(/eq\('id',\s*1\)/);
    // Should query with string 'platform'
    expect(content).toContain("eq('id', 'platform')");
  });

  it('registration service should query platform_settings by "platform" not 1', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/lib/registration/service.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).not.toMatch(/eq\('id',\s*1\)/);
    expect(content).toContain("eq('id', 'platform')");
  });

  it('AI runtime should query platform_settings by "platform" not 1', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/lib/ai/runtime.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).not.toMatch(/eq\('id',\s*1\)/);
    expect(content).toContain("eq('id', 'platform')");
  });
});

// ===========================================================================
// Fix #14: API keys encrypted at rest
// ===========================================================================
describe('Fix #14 — API keys encrypted at rest', () => {
  it('service.ts updateSettings should encrypt sensitive fields', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/lib/data/service.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('encryptBeforeStore');
  });

  it('service.ts should have getDecryptedApiKey method', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/lib/data/service.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('getDecryptedApiKey');
    expect(content).toContain('decryptAfterLoad');
  });
});

// ===========================================================================
// Fix #5: WhatsApp webhook parameterized
// ===========================================================================
describe('Fix #5 — WhatsApp webhook uses parameterized queries', () => {
  it('whatsapp route should validate phone format', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/app/api/webhooks/whatsapp/route.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('.test(phone)');
    expect(content).toContain('Invalid phone format');
  });

  it('whatsapp route should not use .or() for query building', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/app/api/webhooks/whatsapp/route.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Should not have .or( used as a Supabase query method
    // Check that .or( only appears in comments, not in code
    const lines = content.split('\n');
    const codeLines = lines.filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'));
    const orInCode = codeLines.some(line => line.includes('.or('));
    expect(orInCode).toBe(false);
  });
});

// ===========================================================================
// Fix #1: get_user_role reads from profiles, not raw_user_meta_data
// ===========================================================================
describe('Fix #1 — get_user_role reads from profiles.role', () => {
  it('supabase_schema.sql get_user_role should query profiles, not auth.users metadata', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'supabase_schema.sql');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Find the get_user_role function definition
    const funcMatch = content.match(/create or replace function public\.get_user_role\(\)[\s\S]*?\$\$[\s\S]*?\$\$/);
    expect(funcMatch).not.toBeNull();

    const funcBody = funcMatch![0];
    // Should read from profiles.role
    expect(funcBody).toContain('from public.profiles');
    expect(funcBody).toContain('role');
    // Should NOT read from raw_user_meta_data
    expect(funcBody).not.toContain('raw_user_meta_data');
  });
});

// ===========================================================================
// Fix #2: Profiles RLS tenant-scoped
// ===========================================================================
describe('Fix #2 — Profiles RLS is tenant-scoped', () => {
  it('supabase_schema.sql profiles read policy should use tenant_id comparison', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'supabase_schema.sql');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Find the profiles read policy
    expect(content).toContain('Tenant scoped profile read');
    expect(content).toContain('tenant_id = public.get_user_tenant_id()');
    // Should not have USING (true) for profiles
    const profilesSection = content.substring(
      content.indexOf('Profiles Policies'),
      content.indexOf('Leads Policies'),
    );
    expect(profilesSection).not.toContain('for select using (true)');
  });
});

// ===========================================================================
// Fix #6: Rate limiting on OTP endpoints
// ===========================================================================
describe('Fix #6 — Rate limiting on OTP endpoints', () => {
  it('verify-otp should import and use rate limiting', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/app/api/auth/verify-otp/route.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('checkRateLimit');
    expect(content).toContain('buildRateLimitKey');
    expect(content).toContain("scope: 'verify-otp'");
  });

  it('resend-otp should import and use rate limiting', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/app/api/auth/resend-otp/route.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('checkRateLimit');
    expect(content).toContain('buildRateLimitKey');
    expect(content).toContain("scope: 'resend-otp'");
  });
});
