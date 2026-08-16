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
import { headers } from 'next/headers';
import { QuoteAcceptanceCard } from '@/components/public-portal/quote-acceptance-card';
import {
  resolvePublicQuoteCapability,
} from '@/lib/quotes-itineraries/sharing';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

export default async function PublicQuotePage({ params }: PageProps) {
  const { token } = await params;
  const headerList = await headers();
  const clientIp =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    '127.0.0.1';

  const result = await resolvePublicQuoteCapability(token, clientIp);

  if (result.status === 'rate_limited') {
    return (
      <main style={{ maxWidth: '600px', margin: '4rem auto', padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#e53e3e' }}>Too Many Requests</h1>
        <p style={{ marginTop: '1rem', color: '#4a5568' }}>
          You have exceeded the rate limit. Please wait {result.retryAfter ?? 60} seconds before trying again.
        </p>
      </main>
    );
  }

  if (result.status !== 'ok' || !result.data) {
    notFound();
  }

  const { quote, agencyName } = result.data;

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

      {/* Commercial Acceptance */}
      <QuoteAcceptanceCard token={token} quote={quote} />

      {/* Footer */}
      <footer style={{ marginTop: '3rem', paddingTop: '1rem', borderTop: '1px solid #e5e7eb', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center' }}>
        <p>This quote was shared with you by {agencyName}.</p>
        <p>This link is private and view-only.</p>
      </footer>
    </main>
  );
}
