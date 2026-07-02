import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { CRMDatabaseService } from '@/lib/db-service';

export async function GET(request: NextRequest) {
  // Auth (with permission) + shared rate limit + server-resolved tenant
  // (9.2, 9.4, 9.7, 8.2). Platform endpoints may legitimately operate
  // cross-tenant, so a client tenant hint that differs from the session is
  // tolerated here.
  const guard = await guardRoute(request, {
    scope: 'platform-status',
    permission: 'platform:settings:write',
    allowTenantMismatch: true,
  });
  if (guard instanceof NextResponse) return guard;

  const settings = await CRMDatabaseService.getPlatformSettings();
  return NextResponse.json({
    maintenanceMode: Boolean(settings.maintenanceMode),
    allowNewTenants: (settings.settings as Record<string, unknown>)?.allowNewTenants !== false,
  });
}
