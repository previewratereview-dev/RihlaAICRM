import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';

/** Lead enrichment stub — domain/email lookup placeholder. */
export async function POST(request: NextRequest) {
  // Auth + shared rate limit + server-resolved tenant (9.2, 9.4, 9.7, 8.2).
  const guard = await guardRoute(request, { scope: 'enrichment-lead' });
  if (guard instanceof NextResponse) return guard;

  const { email, domain } = await request.json();
  const lookupDomain = domain || (email ? String(email).split('@')[1] : '');

  if (!lookupDomain) {
    return NextResponse.json({ error: 'email or domain required' }, { status: 400 });
  }

  const companySlug = lookupDomain.split('.')[0];
  const enriched = {
    domain: lookupDomain,
    companyName: companySlug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    industry: lookupDomain.includes('travel') ? 'Travel & Tourism' : 'Unknown',
    employeeRange: '1-50',
    location: 'Unknown',
    linkedin: `https://linkedin.com/company/${companySlug}`,
    source: 'stub',
    note: 'Connect Clearbit or Apollo API for live enrichment.',
  };

  return NextResponse.json({ enriched });
}
