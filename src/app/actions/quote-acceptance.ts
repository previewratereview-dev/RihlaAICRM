'use server';

/**
 * Phase AI-5B.4: Governed Staff Actions for Quote Acceptance & Booking Conversion
 *
 * Enforces:
 * - Next.js authenticated server boundary (auth.getUser() -> profile / tenant / role)
 * - Zero authoritative client injection of tenantId, actorUserId, role, amounts, currency, or provenance
 * - Explicit role-based permissions:
 *     quotes:acceptance:record -> Admin, Manager, Consultant, Specialist
 *     quotes:acceptance:void   -> Admin, Manager
 *     bookings:convert         -> Admin, Manager
 * - Execution via privileged service-role DB client
 */

import { cookies } from 'next/headers';
import { Client } from 'pg';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import {
  recordStaffQuoteAcceptance,
  voidQuoteAcceptance,
  StaffAcceptanceOptions,
  AcceptanceResult,
  VoidAcceptanceResult,
} from '@/lib/quotes-itineraries/acceptance';
import {
  convertAcceptedQuoteToBooking,
  BookingConversionResult,
} from '@/lib/quotes-itineraries/conversion';

interface AuthenticatedStaffContext {
  userId: string;
  tenantId: string;
  role: string;
}

async function getAuthenticatedStaffContext(): Promise<AuthenticatedStaffContext> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('UNAUTHORIZED: Authentication required');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('UNAUTHORIZED: User profile not found');
  }

  if (profile.role === 'super_admin') {
    throw new Error('FORBIDDEN: Super Admin cannot perform direct agency operational actions');
  }

  return {
    userId: user.id,
    tenantId: profile.tenant_id,
    role: profile.role,
  };
}

async function withPgClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error('INTERNAL_ERROR: DATABASE_URL is not configured');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Governed staff action to record a manual quote acceptance.
 */
export async function recordManualQuoteAcceptanceAction(
  quoteVersionId: string,
  options: StaffAcceptanceOptions
): Promise<AcceptanceResult> {
  const ctx = await getAuthenticatedStaffContext();

  if (!can(ctx.role, 'quotes:acceptance:record')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks quotes:acceptance:record permission`);
  }

  if (!quoteVersionId || typeof quoteVersionId !== 'string') {
    throw new Error('VALIDATION_ERROR: quoteVersionId is required');
  }

  return withPgClient(async (client) => {
    return recordStaffQuoteAcceptance(
      {
        query: async (sql, params) => {
          const res = await client.query(sql, params as unknown[]);
          return { rows: res.rows };
        },
      },
      ctx.tenantId,
      ctx.userId,
      quoteVersionId,
      options
    );
  });
}

/**
 * Governed staff action to void an active quote acceptance.
 */
export async function voidQuoteAcceptanceAction(
  acceptanceId: string,
  voidReason: string
): Promise<VoidAcceptanceResult> {
  const ctx = await getAuthenticatedStaffContext();

  if (!can(ctx.role, 'quotes:acceptance:void')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks quotes:acceptance:void permission`);
  }

  if (!acceptanceId || typeof acceptanceId !== 'string') {
    throw new Error('VALIDATION_ERROR: acceptanceId is required');
  }

  return withPgClient(async (client) => {
    return voidQuoteAcceptance(
      {
        query: async (sql, params) => {
          const res = await client.query(sql, params as unknown[]);
          return { rows: res.rows };
        },
      },
      ctx.tenantId,
      ctx.userId,
      acceptanceId,
      voidReason
    );
  });
}

/**
 * Governed staff action to convert an accepted quote to a confirmed booking.
 */
export async function convertAcceptedQuoteToBookingAction(
  acceptanceId: string,
  assignedAgentId?: string
): Promise<BookingConversionResult> {
  const ctx = await getAuthenticatedStaffContext();

  if (!can(ctx.role, 'bookings:convert')) {
    throw new Error(`FORBIDDEN: Role ${ctx.role} lacks bookings:convert permission`);
  }

  if (!acceptanceId || typeof acceptanceId !== 'string') {
    throw new Error('VALIDATION_ERROR: acceptanceId is required');
  }

  return withPgClient(async (client) => {
    return convertAcceptedQuoteToBooking(
      {
        query: async (sql, params) => {
          const res = await client.query(sql, params as unknown[]);
          return { rows: res.rows };
        },
      },
      ctx.tenantId,
      ctx.userId,
      acceptanceId,
      assignedAgentId || null
    );
  });
}
