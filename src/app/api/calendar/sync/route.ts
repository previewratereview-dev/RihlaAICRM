import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';

/** Google Calendar OAuth stub — returns auth URL for manual connect flow. */
export async function GET(request: NextRequest) {
  // Auth + shared rate limit + server-resolved tenant (9.2, 9.4, 9.7, 8.2).
  const guard = await guardRoute(request, { scope: 'calendar-sync' });
  if (guard instanceof NextResponse) return guard;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/google/callback`;

  if (!clientId) {
    return NextResponse.json({
      configured: false,
      message: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable calendar sync.',
      manualSync: true,
    });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline',
    prompt: 'consent',
  });

  return NextResponse.json({
    configured: true,
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
}

export async function POST(request: NextRequest) {
  // Auth + shared rate limit + server-resolved tenant (9.2, 9.4, 9.7, 8.2).
  const guard = await guardRoute(request, { scope: 'calendar-sync' });
  if (guard instanceof NextResponse) return guard;

  return NextResponse.json({
    synced: true,
    message: 'Manual calendar sync stub — connect Google OAuth to enable automatic sync.',
  });
}
