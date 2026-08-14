import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminClient = createClient(supabaseUrl, serviceRoleKey);

export async function runCompatibilityDriftAudit() {
  console.log('======================================================================');
  console.log('STAGE C0 CONTINUOUS COMPATIBILITY DRIFT AUDITOR');
  console.log('Target:', supabaseUrl);
  console.log('======================================================================\n');

  const { data: leads } = await adminClient.from('leads').select('*');
  const { data: inqs } = await adminClient.from('inquiries').select('*');
  const { data: bks } = await adminClient.from('bookings').select('*');
  const { data: travs } = await adminClient.from('traveler_profiles').select('*');
  const { data: tasks } = await adminClient.from('tasks').select('*');
  const { data: acts } = await adminClient.from('activities').select('*');
  const { data: convs } = await adminClient.from('conversations').select('*');

  const inquiriesList = inqs || [];
  const bookingsList = bks || [];
  const travelersList = travs || [];

  console.log(`Active Entities Overview:`);
  console.log(`- public.leads:             ${leads?.length || 0}`);
  console.log(`- public.inquiries:         ${inquiriesList.length}`);
  console.log(`- public.bookings:          ${bookingsList.length}`);
  console.log(`- public.traveler_profiles: ${travelersList.length}`);
  console.log(`- public.tasks:             ${tasks?.length || 0}`);
  console.log(`- public.activities:        ${acts?.length || 0}`);
  console.log(`- public.conversations:     ${convs?.length || 0}`);

  let driftCount = 0;
  const auditDetails: any[] = [];

  // Audit 1: Lead without Inquiry
  (leads || []).forEach((l: any) => {
    if (l.archived_at) return;
    const inq = inquiriesList.find((i: any) => i.tenant_id === l.tenant_id && i.legacy_lead_id === l.id);
    if (!inq) {
      driftCount++;
      auditDetails.push({ category: 'LEAD_WITHOUT_INQUIRY', leadId: l.id, status: l.status });
    }
  });

  // Audit 2: Confirmed Lead without Booking
  (leads || []).forEach((l: any) => {
    if (l.archived_at) return;
    if (l.status === 'booking_confirmed' || l.status === 'closed_won') {
      const bk = bookingsList.find((b: any) => b.tenant_id === l.tenant_id && b.legacy_lead_id === l.id);
      if (!bk) {
        driftCount++;
        auditDetails.push({ category: 'CONFIRMED_LEAD_WITHOUT_BOOKING', leadId: l.id });
      }
    }
  });

  // Audit 3: Field Level Stage & Value Reconciliations
  (leads || []).forEach((l: any) => {
    if (l.archived_at) return;
    const inq = inquiriesList.find((i: any) => i.tenant_id === l.tenant_id && i.legacy_lead_id === l.id);
    if (!inq) return;

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
    } as Record<string, string>)[l.status] || 'inquiry_received';

    if (inq.pipeline_stage !== expectedStage) {
      driftCount++;
      auditDetails.push({ category: 'STAGE_MISMATCH', leadId: l.id, expected: expectedStage, actual: inq.pipeline_stage });
    }
  });

  // Audit 4: Tenant Integrity Violations
  inquiriesList.forEach((i: any) => {
    const trav = travelersList.find((t: any) => t.id === i.traveler_id);
    if (trav && trav.tenant_id !== i.tenant_id) {
      driftCount++;
      auditDetails.push({ category: 'TENANT_VIOLATION', inquiryId: i.id, travelerId: i.traveler_id });
    }
  });

  console.log(`\nAudit Results Summary:`);
  console.log(`- TOTAL UNEXPLAINED COMPATIBILITY DRIFT: ${driftCount}`);
  if (driftCount > 0) {
    console.log('Drift Audit Details:', JSON.stringify(auditDetails, null, 2));
  } else {
    console.log('✓ ZERO UNEXPLAINED DRIFT DISCOVERED! Compatibility layer is 100% synchronized.');
  }

  console.log('======================================================================\n');
  return { driftCount, auditDetails };
}

if (require.main === module) {
  runCompatibilityDriftAudit().catch(console.error);
}
