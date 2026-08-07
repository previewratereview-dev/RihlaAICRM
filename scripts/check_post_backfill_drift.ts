import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://djnscrvzsnttkfwsvrln.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_ue2uDJPS6vKiKNRaQRy6Zg_j8SlQc14';

const adminClient = createClient(supabaseUrl, serviceRoleKey);

async function checkPostBackfillDrift() {
  console.log('======================================================================');
  console.log('CHECKING POST-BACKFILL DRIFT ON PRODUCTION DATABASE');
  console.log('Target:', supabaseUrl);
  console.log('======================================================================\n');

  const { data: leads } = await adminClient.from('leads').select('*');
  const { data: inqs } = await adminClient.from('inquiries').select('*');
  const { data: bks } = await adminClient.from('bookings').select('*');
  const { data: travs } = await adminClient.from('traveler_profiles').select('*');

  console.log(`Current Database Entity Counts:`);
  console.log(`- leads:             ${leads?.length || 0}`);
  console.log(`- inquiries:         ${inqs?.length || 0}`);
  console.log(`- bookings:          ${bks?.length || 0}`);
  console.log(`- traveler_profiles: ${travs?.length || 0}`);

  let unmappedLeadsCount = 0;
  let unmappedBookingsCount = 0;
  let fieldMismatchesCount = 0;

  const mismatches: any[] = [];

  (leads || []).forEach(lead => {
    const inq = (inqs || []).find(i => i.tenant_id === lead.tenant_id && i.legacy_lead_id === lead.id);
    const bk = (bks || []).find(b => b.tenant_id === lead.tenant_id && b.legacy_lead_id === lead.id);

    if (!inq) {
      unmappedLeadsCount++;
      mismatches.push({ type: 'MISSING_INQUIRY', leadId: lead.id, status: lead.status });
      return;
    }

    if ((lead.status === 'booking_confirmed' || lead.status === 'closed_won') && !bk) {
      unmappedBookingsCount++;
      mismatches.push({ type: 'MISSING_BOOKING', leadId: lead.id, status: lead.status });
    }

    // Check stage mapping
    const expectedStage = ({
      new: 'inquiry_received',
      inquiry_received: 'inquiry_received',
      contacted: 'initial_contact',
      initial_contact: 'initial_contact',
      interested: 'options_shared',
      options_shared: 'options_shared',
      demo_scheduled: 'consultation_booked',
      consultation_booked: 'consultation_booked',
      proposal_sent: 'itinerary_sent',
      itinerary_sent: 'itinerary_sent',
      follow_up: 'follow_up',
      negotiation: 'customizing_package',
      customizing_package: 'customizing_package',
      closed_won: 'booking_confirmed',
      booking_confirmed: 'booking_confirmed',
      closed_lost: 'booking_lost',
      booking_lost: 'booking_lost',
    } as Record<string, string>)[lead.status] || 'inquiry_received';

    if (inq.pipeline_stage !== expectedStage) {
      fieldMismatchesCount++;
      mismatches.push({ type: 'STAGE_MISMATCH', leadId: lead.id, expectedStage, actualStage: inq.pipeline_stage });
    }

    const normDest = lead.destination ? lead.destination.trim() : null;
    if (inq.destination !== normDest) {
      fieldMismatchesCount++;
      mismatches.push({ type: 'DESTINATION_MISMATCH', leadId: lead.id, expected: normDest, actual: inq.destination });
    }

    const expectedPriority = ['urgent','high','medium','low'].includes(lead.priority) ? lead.priority : 'medium';
    if (inq.priority !== expectedPriority) {
      fieldMismatchesCount++;
      mismatches.push({ type: 'PRIORITY_MISMATCH', leadId: lead.id, expected: expectedPriority, actual: inq.priority });
    }

    const expectedVal = lead.deal_value >= 0 ? lead.deal_value : null;
    if (inq.expected_value !== expectedVal) {
      fieldMismatchesCount++;
      mismatches.push({ type: 'VALUE_MISMATCH', leadId: lead.id, expected: expectedVal, actual: inq.expected_value });
    }

    if ((lead.assigned_to || null) !== (inq.assigned_agent_id || null)) {
      fieldMismatchesCount++;
      mismatches.push({ type: 'AGENT_MISMATCH', leadId: lead.id, expected: lead.assigned_to, actual: inq.assigned_agent_id });
    }
  });

  const totalDriftCount = unmappedLeadsCount + unmappedBookingsCount + fieldMismatchesCount;

  console.log(`\nDrift Analysis Summary:`);
  console.log(`- Leads Without Matching Inquiries:  ${unmappedLeadsCount}`);
  console.log(`- Confirmed Leads Without Bookings:  ${unmappedBookingsCount}`);
  console.log(`- Field Mismatches Count:           ${fieldMismatchesCount}`);
  console.log(`- TOTAL POST-BACKFILL DRIFT COUNT:   ${totalDriftCount}`);

  if (totalDriftCount > 0) {
    console.log('\nDiscovered Mismatches Detail:');
    console.log(JSON.stringify(mismatches, null, 2));
  } else {
    console.log('✓ ZERO POST-BACKFILL DRIFT DISCOVERED! Production database is 100% synchronized with backfill snapshot.');
  }

  console.log('\n======================================================================');
}

checkPostBackfillDrift().catch(console.error);
