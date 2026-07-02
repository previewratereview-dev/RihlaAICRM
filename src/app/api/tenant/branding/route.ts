import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { defaultTenantSettings } from '@/lib/tenant/config';

export async function GET(request: NextRequest) {
  // Auth (with permission) + shared rate limit + server-resolved tenant
  // (9.2, 9.4, 9.7, 8.2).
  const guard = await guardRoute(request, {
    scope: 'tenant-branding',
    permission: 'settings:agency:read',
  });
  if (guard instanceof NextResponse) return guard;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', guard.tenantId)
    .maybeSingle();

  // Select only branding-relevant fields — never return API keys, system_prompt,
  // or other sensitive settings in this endpoint.
  const { data: settingsRow } = await supabase
    .from('settings')
    .select('agency_name, logo_text, accent_color, email_automation, whatsapp_automation, sms_automation, ai_budgets')
    .eq('tenant_id', guard.tenantId)
    .maybeSingle();

  const branding = {
    logoUrl: tenant?.logo_url || defaultTenantSettings.branding.logoUrl,
    primaryColor: tenant?.primary_color || settingsRow?.accent_color || '#FF6B35',
    secondaryColor: tenant?.secondary_color,
    agencyName: settingsRow?.agency_name || tenant?.name || 'WanderBot AI',
  };

  const aiBudgets = (settingsRow?.ai_budgets as Record<string, unknown>) || {};

  return NextResponse.json({
    tenantId: guard.tenantId,
    branding,
    settings: {
      ...defaultTenantSettings,
      branding,
      ai: {
        ...defaultTenantSettings.ai,
        budgets: aiBudgets,
      },
      features: defaultTenantSettings.features,
      integrations: {
        email: settingsRow?.email_automation ?? true,
        whatsapp: settingsRow?.whatsapp_automation ?? true,
        sms: settingsRow?.sms_automation ?? false,
      },
    },
  });
}
