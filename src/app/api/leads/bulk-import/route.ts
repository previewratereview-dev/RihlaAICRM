import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/auth/route-guard';
import { createClient } from '@supabase/supabase-js';
import { mapLeadToDb } from '@/lib/data/mappers';
import type { Lead } from '@/types';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

function getServiceClient() {
  if (!serviceKey || !supabaseUrl) return null;
  return createClient(supabaseUrl, serviceKey);
}

export async function POST(request: NextRequest) {
  try {
    const guard = await guardRoute(request, { scope: 'leads-import' });
    if (guard instanceof NextResponse) return guard;

    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.leads)) {
      return NextResponse.json({ error: 'Invalid payload: expected leads array.' }, { status: 400 });
    }

    const { leads } = body as { leads: Partial<Lead>[] };
    if (leads.length === 0 || leads.length > 5000) {
      return NextResponse.json({ error: 'Batch import size must be between 1 and 5000 records.' }, { status: 400 });
    }

    const supabase = getServiceClient();
    if (!supabase) {
      return NextResponse.json({ error: 'Database service unavailable.' }, { status: 503 });
    }

    const now = new Date().toISOString();
    const dbRows = leads.map((item) => {
      const row = mapLeadToDb(item);
      return {
        ...row,
        tenant_id: guard.tenantId,
        created_at: row.created_at || now,
        updated_at: row.updated_at || now,
      };
    });

    // Chunk array into batches of 500 rows for safe database transactions
    const chunkSize = 500;
    let insertedCount = 0;

    for (let i = 0; i < dbRows.length; i += chunkSize) {
      const chunk = dbRows.slice(i, i + chunkSize);
      const { error } = await supabase.from('leads').upsert(chunk);
      if (error) {
        return NextResponse.json({ error: `Batch insert failed at row ${i}: ${error.message}` }, { status: 500 });
      }
      insertedCount += chunk.length;
    }

    return NextResponse.json({ success: true, count: insertedCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error during bulk import';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
