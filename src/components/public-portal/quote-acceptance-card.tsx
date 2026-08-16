'use client';

/**
 * Phase AI-5B.4: Public Quote Acceptance Interactive Component
 *
 * Provides:
 * - Link-holder commercial confirmation form
 * - Fast-fail input validation
 * - Double-click / loading defense
 * - Truthful copy (commercial confirmation, not digital signature)
 * - Immediate state transition to Accepted view upon successful response
 */

import React, { useState } from 'react';
import type { CustomerQuoteDTO } from '@/lib/quotes-itineraries/types';

interface QuoteAcceptanceCardProps {
  token: string;
  quote: CustomerQuoteDTO;
}

export function QuoteAcceptanceCard({ token, quote }: QuoteAcceptanceCardProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedData, setAcceptedData] = useState<{
    acceptanceId: string;
    acceptedAt: string;
  } | null>(null);

  if (acceptedData) {
    return (
      <div
        style={{
          marginTop: '2rem',
          padding: '1.5rem',
          backgroundColor: '#ecfdf5',
          border: '1px solid #6ee7b7',
          borderRadius: '0.5rem',
          textAlign: 'center',
        }}
      >
        <div style={{ color: '#065f46', fontWeight: 600, fontSize: '1.125rem' }}>
          ✓ Quote Accepted
        </div>
        <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#047857' }}>
          Thank you. Your acceptance of Quote {quote.quoteNumber} for {quote.currency} {quote.grandTotal} has been recorded.
        </p>
        <p style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#059669' }}>
          Recorded on {new Date(acceptedData.acceptedAt).toLocaleString()}
        </p>
      </div>
    );
  }

  if (!quote.isAcceptable) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your full name');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }
    if (!confirmed) {
      setError('Please check the confirmation box to proceed');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/p/quote/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          travelerName: name.trim(),
          travelerEmail: email.trim(),
          confirmed: true,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'Failed to accept quote');
      }

      setAcceptedData({
        acceptanceId: json.acceptanceId,
        acceptedAt: json.acceptedAt,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      style={{
        marginTop: '2.5rem',
        padding: '1.5rem',
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '0.75rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#111827', marginBottom: '0.5rem' }}>
        Accept this Quote
      </h2>
      <p style={{ fontSize: '0.875rem', color: '#4b5563', marginBottom: '1.25rem' }}>
        Confirm acceptance of this commercial offer ({quote.currency} {quote.grandTotal}). The agency will be notified to proceed with your booking.
      </p>

      {error && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '0.375rem',
            color: '#b91c1c',
            fontSize: '0.875rem',
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label
            htmlFor="traveler-name"
            style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: '0.25rem' }}
          >
            Your Full Name
          </label>
          <input
            id="traveler-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            placeholder="Jane Doe"
            required
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label
            htmlFor="traveler-email"
            style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: '0.25rem' }}
          >
            Your Email Address
          </label>
          <input
            id="traveler-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            placeholder="jane@example.com"
            required
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          <input
            id="confirm-terms"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={loading}
            required
            style={{ marginTop: '0.25rem' }}
          />
          <label htmlFor="confirm-terms" style={{ fontSize: '0.8125rem', color: '#4b5563', lineHeight: 1.4 }}>
            I accept Quote {quote.quoteNumber} for {quote.currency} {quote.grandTotal} as presented above.
          </label>
        </div>

        <button
          type="submit"
          disabled={loading || !confirmed}
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            backgroundColor: loading || !confirmed ? '#9ca3af' : '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '0.375rem',
            fontSize: '0.9375rem',
            fontWeight: 600,
            cursor: loading || !confirmed ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.15s ease',
          }}
        >
          {loading ? 'Processing Acceptance...' : `Confirm & Accept Quote (${quote.currency} ${quote.grandTotal})`}
        </button>
      </form>
    </section>
  );
}
