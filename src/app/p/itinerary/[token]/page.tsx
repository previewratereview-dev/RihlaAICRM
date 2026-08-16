/**
 * Phase AI-5B.3: Public Itinerary Share Portal Page
 *
 * /p/itinerary/[token]
 *
 * Server-side rendered, read-only customer itinerary view.
 * Resolves the share token server-side and renders the customer-safe DTO.
 * No authentication required.
 *
 * Security headers are set via metadata exports.
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Client } from 'pg';
import {
  hashShareToken,
  shapeCustomerItineraryDTO,
  SHARE_TOKEN_REGEX,
} from '@/lib/quotes-itineraries/sharing';
import type { CustomerItineraryDTO } from '@/lib/quotes-itineraries/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Travel Itinerary',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

async function resolveItinerary(token: string): Promise<{
  itinerary: CustomerItineraryDTO;
  agencyName: string;
  expiresAt: string;
} | null> {
  if (!token || !SHARE_TOKEN_REGEX.test(token)) return null;

  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) return null;

  let client: Client | null = null;
  try {
    client = new Client({ connectionString });
    await client.connect();

    const tokenHash = hashShareToken(token);
    const result = await client.query(
      `SELECT public.resolve_itinerary_share_token($1) as result`,
      [tokenHash]
    );

    const data = result.rows[0]?.result;
    if (!data) return null;

    const itinerary = shapeCustomerItineraryDTO({
      title: data.title,
      destination_summary: data.destination_summary,
      start_date: data.start_date,
      end_date: data.end_date,
      duration_days: data.duration_days,
      passenger_count: data.passenger_count,
      days: data.days,
      inclusions: data.inclusions,
      exclusions: data.exclusions,
    });

    return {
      itinerary,
      agencyName: data.agency_name,
      expiresAt: data.expires_at,
    };
  } catch {
    return null;
  } finally {
    if (client) {
      try { await client.end(); } catch { /* ignore */ }
    }
  }
}

export default async function PublicItineraryPage({ params }: PageProps) {
  const { token } = await params;
  const resolved = await resolveItinerary(token);

  if (!resolved) {
    notFound();
  }

  const { itinerary, agencyName } = resolved;

  return (
    <main
      style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '2rem 1.5rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#1a1a2e',
      }}
    >
      {/* Agency Header */}
      <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <p style={{ fontSize: '0.875rem', color: '#6b7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Prepared by {agencyName}
        </p>
      </header>

      {/* Itinerary Title */}
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem', lineHeight: 1.3 }}>
        {itinerary.title}
      </h1>

      {itinerary.destinationSummary && (
        <p style={{ fontSize: '1rem', color: '#4b5563', marginBottom: '1.5rem' }}>
          {itinerary.destinationSummary}
        </p>
      )}

      {/* Trip Details */}
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '2rem', fontSize: '0.875rem', color: '#6b7280' }}>
        {itinerary.startDate && <span>📅 {itinerary.startDate}{itinerary.endDate ? ` → ${itinerary.endDate}` : ''}</span>}
        {itinerary.durationDays && <span>🕐 {itinerary.durationDays} days</span>}
        {itinerary.passengerCount && <span>👥 {itinerary.passengerCount} travelers</span>}
      </div>

      {/* Day-by-Day Plan */}
      {itinerary.days.map((day) => (
        <section key={day.dayNumber} style={{ marginBottom: '2rem', borderLeft: '3px solid #e5e7eb', paddingLeft: '1.25rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>
            Day {day.dayNumber}: {day.title}
          </h2>
          {day.date && <p style={{ fontSize: '0.8125rem', color: '#9ca3af', marginBottom: '0.5rem' }}>{day.date}</p>}
          {day.summary && <p style={{ fontSize: '0.9375rem', color: '#374151', marginBottom: '0.75rem' }}>{day.summary}</p>}

          {day.items.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {day.items.map((item, idx) => (
                <li key={idx} style={{ padding: '0.5rem 0', borderBottom: idx < day.items.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase' }}>{item.itemType}</span>
                    <span style={{ fontWeight: 500 }}>{item.title}</span>
                    {item.startTime && <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>{item.startTime}{item.endTime ? `–${item.endTime}` : ''}</span>}
                  </div>
                  {item.description && <p style={{ fontSize: '0.875rem', color: '#4b5563', marginTop: '0.25rem' }}>{item.description}</p>}
                  {item.location && <p style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.125rem' }}>📍 {item.location}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {/* Inclusions & Exclusions */}
      {itinerary.inclusions.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Included</h3>
          <ul style={{ paddingLeft: '1.25rem', color: '#374151', fontSize: '0.875rem' }}>
            {itinerary.inclusions.map((inc, i) => <li key={i}>{inc}</li>)}
          </ul>
        </section>
      )}

      {itinerary.exclusions.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Not Included</h3>
          <ul style={{ paddingLeft: '1.25rem', color: '#6b7280', fontSize: '0.875rem' }}>
            {itinerary.exclusions.map((exc, i) => <li key={i}>{exc}</li>)}
          </ul>
        </section>
      )}

      {/* Footer */}
      <footer style={{ marginTop: '3rem', paddingTop: '1rem', borderTop: '1px solid #e5e7eb', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center' }}>
        <p>This itinerary was shared with you by {agencyName}.</p>
        <p>This link is private and view-only.</p>
      </footer>
    </main>
  );
}
