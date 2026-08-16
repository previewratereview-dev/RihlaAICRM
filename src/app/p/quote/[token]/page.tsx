/**
 * Phase AI-5B.3: Public Quote Share Portal Page (READ-ONLY)
 *
 * /p/quote/[token]
 *
 * Server-side rendered, read-only customer quote view.
 * Resolves the share token server-side and renders the customer-safe DTO.
 * No authentication required.
 *
 * Invariant: VIEW != ACCEPTANCE. This page is READ-ONLY in AI-5B.3.
 * The isAcceptable flag is rendered as informational status only.
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Client } from 'pg';
import {
  hashShareToken,
  shapeCustomerQuoteDTO,
} from '@/lib/quotes-itineraries/sharing';
import type { CustomerQuoteDTO } from '@/lib/quotes-itineraries/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TOKEN_REGEX = /^[a-f0-9]{64}$/;

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Travel Quote',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

async function resolveQuote(token: string): Promise<{
  quote: CustomerQuoteDTO;
  agencyName: string;
  expiresAt: string;
} | null> {
  if (!TOKEN_REGEX.test(token)) return null;

  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) return null;

  let client: Client | null = null;
  try {
    client = new Client({ connectionString });
    await client.connect();

    const tokenHash = hashShareToken(token);
    const result = await client.query(
      `SELECT public.resolve_quote_share_token($1) as result`,
      [tokenHash]
    );

    const data = result.rows[0]?.result;
    if (!data) return null;

    const quote = shapeCustomerQuoteDTO({
      quote_number: data.quote_number,
      version_number: data.version_number,
      currency: data.currency,
      line_items: data.line_items,
      subtotal: data.subtotal,
      discount_amount: data.discount_amount,
      tax_amount: data.tax_amount,
      grand_total: data.grand_total,
      valid_until: data.valid_until,
      terms_and_conditions: data.terms_and_conditions,
      customer_notes: data.customer_notes,
      is_acceptable: data.is_acceptable,
      itinerary: data.itinerary,
    });

    return {
      quote,
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

export default async function PublicQuotePage({ params }: PageProps) {
  const { token } = await params;
  const resolved = await resolveQuote(token);

  if (!resolved) {
    notFound();
  }

  const { quote, agencyName } = resolved;

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

      {/* Quote Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          Quote {quote.quoteNumber}
        </h1>
        <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
          Version {quote.versionNumber} · {quote.currency}
        </p>
        {quote.validUntil && (
          <p style={{ fontSize: '0.8125rem', color: '#9ca3af', marginTop: '0.25rem' }}>
            Valid until {quote.validUntil}
          </p>
        )}
      </div>

      {/* Status Badge */}
      {quote.isAcceptable ? (
        <div style={{
          display: 'inline-block',
          padding: '0.375rem 0.75rem',
          backgroundColor: '#ecfdf5',
          color: '#065f46',
          borderRadius: '0.375rem',
          fontSize: '0.8125rem',
          fontWeight: 500,
          marginBottom: '1.5rem',
        }}>
          Open for acceptance
        </div>
      ) : (
        <div style={{
          display: 'inline-block',
          padding: '0.375rem 0.75rem',
          backgroundColor: '#fef3c7',
          color: '#92400e',
          borderRadius: '0.375rem',
          fontSize: '0.8125rem',
          fontWeight: 500,
          marginBottom: '1.5rem',
        }}>
          View only
        </div>
      )}

      {/* Customer Notes */}
      {quote.customerNotes && (
        <div style={{ padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem', marginBottom: '1.5rem', fontSize: '0.9375rem', color: '#374151' }}>
          {quote.customerNotes}
        </div>
      )}

      {/* Line Items Table */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>Items</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Item</th>
                <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Category</th>
                <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, textAlign: 'right' }}>Qty</th>
                <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, textAlign: 'right' }}>Unit Price</th>
                <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.lineItems.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <div style={{ fontWeight: 500 }}>{item.title}</div>
                    {item.description && <div style={{ fontSize: '0.8125rem', color: '#6b7280' }}>{item.description}</div>}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: '#6b7280', textTransform: 'capitalize' }}>{item.category}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>{item.quantity}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>{item.unitPrice}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 500 }}>{item.totalPrice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing Summary */}
      <section style={{ marginBottom: '2rem', borderTop: '2px solid #e5e7eb', paddingTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9375rem' }}>
          <span>Subtotal</span>
          <span>{quote.currency} {quote.subtotal}</span>
        </div>
        {quote.discountAmount !== '0.00' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9375rem', color: '#059669' }}>
            <span>Discount</span>
            <span>−{quote.currency} {quote.discountAmount}</span>
          </div>
        )}
        {quote.taxAmount !== '0.00' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9375rem' }}>
            <span>Tax</span>
            <span>{quote.currency} {quote.taxAmount}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.25rem', fontWeight: 700, marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #e5e7eb' }}>
          <span>Grand Total</span>
          <span>{quote.currency} {quote.grandTotal}</span>
        </div>
      </section>

      {/* Linked Itinerary */}
      {quote.itinerary && quote.itinerary.title && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>Travel Itinerary</h2>

          <div style={{ padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>{quote.itinerary.title}</h3>
            {quote.itinerary.destinationSummary && (
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem' }}>{quote.itinerary.destinationSummary}</p>
            )}

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8125rem', color: '#6b7280', marginBottom: '1rem' }}>
              {quote.itinerary.startDate && <span>📅 {quote.itinerary.startDate}{quote.itinerary.endDate ? ` → ${quote.itinerary.endDate}` : ''}</span>}
              {quote.itinerary.durationDays && <span>🕐 {quote.itinerary.durationDays} days</span>}
              {quote.itinerary.passengerCount && <span>👥 {quote.itinerary.passengerCount} travelers</span>}
            </div>

            {quote.itinerary.days.map((day) => (
              <div key={day.dayNumber} style={{ marginBottom: '0.75rem', paddingLeft: '0.75rem', borderLeft: '2px solid #e5e7eb' }}>
                <p style={{ fontWeight: 500, fontSize: '0.875rem' }}>Day {day.dayNumber}: {day.title}</p>
                {day.summary && <p style={{ fontSize: '0.8125rem', color: '#6b7280' }}>{day.summary}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Terms */}
      {quote.termsAndConditions && (
        <section style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Terms & Conditions</h3>
          <div style={{ fontSize: '0.8125rem', color: '#6b7280', whiteSpace: 'pre-wrap' }}>
            {quote.termsAndConditions}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer style={{ marginTop: '3rem', paddingTop: '1rem', borderTop: '1px solid #e5e7eb', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center' }}>
        <p>This quote was shared with you by {agencyName}.</p>
        <p>This link is private and view-only.</p>
      </footer>
    </main>
  );
}
