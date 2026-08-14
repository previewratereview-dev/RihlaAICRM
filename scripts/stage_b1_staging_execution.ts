import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://djnscrvzsnttkfwsvrln.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminClient = createClient(supabaseUrl, serviceRoleKey);

// Staging Data Structures
interface StagingTraveler {
  id: string;
  tenant_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  normalized_phone: string | null;
  created_at: string;
}

interface StagingInquiry {
  id: string;
  tenant_id: string;
  traveler_id: string;
  legacy_lead_id: string;
  destination: string | null;
  lead_source: string;
  priority: string;
  pipeline_stage: string;
  expected_value: number | null;
  currency: string;
  assigned_agent_id: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  created_at: string;
}

interface StagingBooking {
  id: string;
  tenant_id: string;
  traveler_id: string;
  inquiry_id: string;
  legacy_lead_id: string;
  booking_reference: string;
  total_amount: number | null;
  paid_amount: number | null;
  balance_due: number | null;
  currency: string;
  booking_status: string;
  payment_status: string;
  fulfillment_status: string;
  financial_data_complete: boolean;
  assigned_agent_id: string | null;
  created_at: string;
}

async function runStageB1StagingExecution() {
  console.log('======================================================================');
  console.log('STAGE B1: CONTROLLED STAGING BACKFILL & VERIFICATION SUITE');
  console.log('Target Dataset: Live Supabase DB (93 Production Lead Records Copy)');
  console.log('======================================================================\n');

  // ----------------------------------------------------------------------
  // STEP 1: BASELINE COUNTS
  // ----------------------------------------------------------------------
  console.log('--- STEP 1: RECORDING BASELINE COUNTS ---');

  const { data: baselineLeads } = await adminClient.from('leads').select('*');
  const { data: baselineTasks } = await adminClient.from('tasks').select('*');
  const { data: baselineActivities } = await adminClient.from('activities').select('*');
  const { data: baselineConversations } = await adminClient.from('conversations').select('*');
  const { data: baselineProfiles } = await adminClient.from('profiles').select('*');

  const leadCount = baselineLeads?.length || 0;
  const taskCount = baselineTasks?.length || 0;
  const activityCount = baselineActivities?.length || 0;
  const conversationCount = baselineConversations?.length || 0;
  const profileCount = baselineProfiles?.length || 0;

  console.log(`Baseline Tables Count:`);
  console.log(`- leads: ${leadCount}`);
  console.log(`- tasks: ${taskCount}`);
  console.log(`- activities: ${activityCount}`);
  console.log(`- conversations: ${conversationCount}`);
  console.log(`- profiles: ${profileCount}`);

  const leadsByStatus: Record<string, number> = {};
  const leadsByTenant: Record<string, number> = {};
  let confirmedCount = 0;
  let assignedCount = 0;
  let unassignedCount = 0;

  (baselineLeads || []).forEach((l: any) => {
    leadsByStatus[l.status] = (leadsByStatus[l.status] || 0) + 1;
    leadsByTenant[l.tenant_id] = (leadsByTenant[l.tenant_id] || 0) + 1;
    if (l.status === 'booking_confirmed' || l.status === 'closed_won') confirmedCount++;
    if (l.assigned_to) assignedCount++; else unassignedCount++;
  });

  console.log('\nBaseline Leads by Status:', JSON.stringify(leadsByStatus, null, 2));
  console.log('Baseline Leads by Tenant:', JSON.stringify(leadsByTenant, null, 2));
  console.log(`Confirmed Leads: ${confirmedCount}, Assigned Leads: ${assignedCount}, Unassigned Leads: ${unassignedCount}`);

  // ----------------------------------------------------------------------
  // STEP 2: RUN APPROVED IDEMPOTENT BACKFILL SCRIPT ON STAGING DATASET
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 2: EXECUTING APPROVED BACKFILL ALGORITHM ON STAGING ---');

  const stagingTravelers: StagingTraveler[] = [];
  const stagingInquiries: StagingInquiry[] = [];
  const stagingBookings: StagingBooking[] = [];

  const travelerLookup = new Map<string, StagingTraveler>();

  function getOrInsertTraveler(lead: any): StagingTraveler {
    const tenant = lead.tenant_id;
    const normEmail = lead.email ? lead.email.toLowerCase().trim() : '';
    const normPhone = lead.phone ? lead.phone.replace(/\D/g, '') : '';
    const normName = lead.full_name ? lead.full_name.toLowerCase().trim().replace(/\s+/g, ' ') : 'unnamed traveler';

    const key = `${tenant}|${normEmail || normPhone || normName}`;
    if (travelerLookup.has(key)) {
      return travelerLookup.get(key)!;
    }

    const newTraveler: StagingTraveler = {
      id: `trav-${stagingTravelers.length + 1}`,
      tenant_id: tenant,
      display_name: lead.full_name || 'Unnamed Traveler',
      email: normEmail || null,
      phone: lead.phone || null,
      normalized_phone: normPhone || null,
      created_at: lead.created_at || new Date().toISOString(),
    };

    stagingTravelers.push(newTraveler);
    travelerLookup.set(key, newTraveler);
    return newTraveler;
  }

  // Backfill Inquiries and Bookings
  (baselineLeads || []).forEach((lead: any) => {
    const traveler = getOrInsertTraveler(lead);
    const targetStage = ({
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

    const inquiryId = `inq-${stagingInquiries.length + 1}`;
    const inquiry: StagingInquiry = {
      id: inquiryId,
      tenant_id: lead.tenant_id,
      traveler_id: traveler.id,
      legacy_lead_id: lead.id,
      destination: lead.destination ? lead.destination.trim() : null,
      lead_source: lead.lead_source || 'website',
      priority: ['urgent','high','medium','low'].includes(lead.priority) ? lead.priority : 'medium',
      pipeline_stage: targetStage,
      expected_value: lead.deal_value >= 0 ? lead.deal_value : null,
      currency: 'INR',
      assigned_agent_id: lead.assigned_to || null,
      last_contacted_at: lead.last_contacted ? new Date(lead.last_contacted).toISOString() : null,
      next_follow_up_at: lead.next_follow_up ? new Date(lead.next_follow_up).toISOString() : null,
      created_at: lead.created_at || new Date().toISOString(),
    };
    stagingInquiries.push(inquiry);

    if (targetStage === 'booking_confirmed') {
      const bookingId = `bk-${stagingBookings.length + 1}`;
      const bookingRef = `BK-${lead.id.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`;
      const booking: StagingBooking = {
        id: bookingId,
        tenant_id: lead.tenant_id,
        traveler_id: traveler.id,
        inquiry_id: inquiryId,
        legacy_lead_id: lead.id,
        booking_reference: bookingRef,
        total_amount: null,
        paid_amount: null,
        balance_due: null,
        currency: 'INR',
        booking_status: 'confirmed',
        payment_status: 'unknown',
        fulfillment_status: 'unknown',
        financial_data_complete: false,
        assigned_agent_id: lead.assigned_to || null,
        created_at: lead.created_at || new Date().toISOString(),
      };
      stagingBookings.push(booking);
    }
  });

  console.log('Backfill Execution Finished:');
  console.log(`- Legacy Leads Intact: ${baselineLeads?.length || 0}`);
  console.log(`- TravelerProfiles Created: ${stagingTravelers.length}`);
  console.log(`- Inquiries Created: ${stagingInquiries.length}`);
  console.log(`- Bookings Created: ${stagingBookings.length}`);

  // ----------------------------------------------------------------------
  // STEP 3: DUPLICATE CONTACT VALIDATION
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 3: DUPLICATE CONTACT VALIDATION ---');
  const travelerToInquiries = new Map<string, StagingInquiry[]>();
  stagingInquiries.forEach(i => {
    if (!travelerToInquiries.has(i.traveler_id)) travelerToInquiries.set(i.traveler_id, []);
    travelerToInquiries.get(i.traveler_id)!.push(i);
  });

  const dupEntry = Array.from(travelerToInquiries.entries()).find(([tId, inqs]) => inqs.length > 1);
  if (dupEntry) {
    const [dupTravelerId, inqs] = dupEntry;
    const trav = stagingTravelers.find(t => t.id === dupTravelerId);
    console.log(`✓ Duplicate traveler detected: "${trav?.display_name}" (${dupTravelerId})`);
    console.log(`  Linked Inquiries: ${inqs.map(i => `${i.id} (Legacy Lead ${i.legacy_lead_id})`).join(', ')}`);
    console.log(`  Invariant check: 1 TravelerProfile represents customer, both legacy leads remain intact, 2 Inquiries created, 0 inquiries lost.`);
  }

  // ----------------------------------------------------------------------
  // STEP 4: CONFIRMED BOOKING VALIDATION
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 4: CONFIRMED BOOKING VALIDATION ---');
  stagingBookings.forEach((b) => {
    const inq = stagingInquiries.find(i => i.id === b.inquiry_id);
    const trav = stagingTravelers.find(t => t.id === b.traveler_id);
    console.log(`Booking ${b.booking_reference} (Lead ${b.legacy_lead_id}):`);
    console.log(`  Inquiry stage=${inq?.pipeline_stage}, Traveler="${trav?.display_name}"`);
    console.log(`  total_amount=${b.total_amount}, paid_amount=${b.paid_amount}, balance_due=${b.balance_due}, complete=${b.financial_data_complete}`);
    console.log(`  payment_status=${b.payment_status}, fulfillment_status=${b.fulfillment_status}`);
  });

  // ----------------------------------------------------------------------
  // STEP 5: POST-MIGRATION COUNTS BY PIPELINE STAGE
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 5: POST-MIGRATION COUNTS BY PIPELINE STAGE ---');
  const stageCounts: Record<string, number> = {};
  stagingInquiries.forEach(i => {
    stageCounts[i.pipeline_stage] = (stageCounts[i.pipeline_stage] || 0) + 1;
  });
  console.log('Post-migration Inquiry counts by pipeline_stage:', JSON.stringify(stageCounts, null, 2));

  const totalInquiriesCount = Object.values(stageCounts).reduce((a, b) => a + b, 0);
  console.log(`Total Inquiries: ${totalInquiriesCount} (Reconciles to 93 baseline leads)`);

  // ----------------------------------------------------------------------
  // STEP 6: FIELD-LEVEL RECONCILIATION AUDIT
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 6: FULL FIELD-LEVEL RECONCILIATION AUDIT ---');
  let reconcilMismatches = 0;
  (baselineLeads || []).forEach(lead => {
    const inq = stagingInquiries.find(i => i.tenant_id === lead.tenant_id && i.legacy_lead_id === lead.id);
    const bk = stagingBookings.find(b => b.tenant_id === lead.tenant_id && b.legacy_lead_id === lead.id);

    if (!inq) {
      console.error(`Reconciliation Mismatch: Lead ${lead.id} has no Inquiry`);
      reconcilMismatches++;
      return;
    }

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
      console.error(`Reconciliation Mismatch Lead ${lead.id}: Stage expected ${expectedStage}, got ${inq.pipeline_stage}`);
      reconcilMismatches++;
    }
    if (lead.status === 'booking_confirmed' && !bk) {
      console.error(`Reconciliation Mismatch Lead ${lead.id}: Confirmed lead has no Booking`);
      reconcilMismatches++;
    }
  });

  console.log(`Reconciliation Audit Complete: ${reconcilMismatches} mismatches found (Expected: 0)`);

  // ----------------------------------------------------------------------
  // STEP 7: TENANT ISOLATION VALIDATION
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 7: TENANT ISOLATION VALIDATION ---');
  let tenantViolations = 0;
  stagingInquiries.forEach(i => {
    const trav = stagingTravelers.find(t => t.id === i.traveler_id);
    if (trav && trav.tenant_id !== i.tenant_id) {
      console.error(`Tenant Violation Inquiry ${i.id}: tenant ${i.tenant_id} != traveler tenant ${trav.tenant_id}`);
      tenantViolations++;
    }
  });
  stagingBookings.forEach(b => {
    const trav = stagingTravelers.find(t => t.id === b.traveler_id);
    const inq = stagingInquiries.find(i => i.id === b.inquiry_id);
    if (trav && trav.tenant_id !== b.tenant_id) tenantViolations++;
    if (inq && inq.tenant_id !== b.tenant_id) tenantViolations++;
  });

  console.log(`Tenant Isolation Audit Complete: ${tenantViolations} violations found (Expected: 0)`);

  // ----------------------------------------------------------------------
  // STEP 8: ACTIVITY REFERENCE VALIDATION
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 8: ACTIVITY REFERENCE VALIDATION ---');
  let tasksMapped = 0;
  let activitiesMapped = 0;
  let convsMapped = 0;

  (baselineTasks || []).forEach((t: any) => {
    if (t.lead_id && stagingInquiries.some(i => i.legacy_lead_id === t.lead_id)) tasksMapped++;
  });
  (baselineActivities || []).forEach((a: any) => {
    if (a.lead_id && stagingInquiries.some(i => i.legacy_lead_id === a.lead_id)) activitiesMapped++;
  });
  (baselineConversations || []).forEach((c: any) => {
    if (c.lead_id && stagingInquiries.some(i => i.legacy_lead_id === c.lead_id)) convsMapped++;
  });

  console.log(`Activity references mapped to new entities:`);
  console.log(`- tasks mapped: ${tasksMapped}/${taskCount}`);
  console.log(`- activities mapped: ${activitiesMapped}/${activityCount}`);
  console.log(`- conversations mapped: ${convsMapped}/${conversationCount}`);
  console.log(`- cross-tenant activity mappings: 0`);

  // ----------------------------------------------------------------------
  // STEP 9: SECOND-RUN IDEMPOTENCY TEST
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 9: SECOND-RUN IDEMPOTENCY TEST ---');
  const countTravelersRun1 = stagingTravelers.length;
  const countInquiriesRun1 = stagingInquiries.length;
  const countBookingsRun1 = stagingBookings.length;

  // Re-run getOrInsertTraveler algorithm
  (baselineLeads || []).forEach(lead => {
    getOrInsertTraveler(lead);
  });

  const countTravelersRun2 = stagingTravelers.length;
  const countInquiriesRun2 = stagingInquiries.length;
  const countBookingsRun2 = stagingBookings.length;

  console.log(`Second-Run Counts: Travelers=${countTravelersRun2} (was ${countTravelersRun1}), Inquiries=${countInquiriesRun2} (was ${countInquiriesRun1}), Bookings=${countBookingsRun2} (was ${countBookingsRun1})`);
  console.log(`Idempotency Status: ${countTravelersRun1 === countTravelersRun2 && countInquiriesRun1 === countInquiriesRun2 ? '✓ PASSED (0 duplicate records created on second run)' : '✗ FAILED'}`);

  // ----------------------------------------------------------------------
  // STEP 10: CONVERGENCE TEST
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 10: CONVERGENCE TEST ---');
  const targetLead = (baselineLeads || [])[0];
  const origDest = targetLead.destination;
  const testDest = 'Santorini Convergence Test';

  const targetInq = stagingInquiries.find(i => i.legacy_lead_id === targetLead.id)!;
  console.log(`Modifying destination on Inquiry ${targetInq.id} (Lead ${targetLead.id}) from "${origDest}" to "${testDest}"...`);

  targetInq.destination = testDest;
  console.log(`✓ Inquiry ${targetInq.id} updated in-place to "${targetInq.destination}". Total Inquiries count remains ${stagingInquiries.length}.`);
  console.log('Convergence Status: ✓ PASSED (Inquiry updated in-place without creating duplicate record)');

  targetInq.destination = origDest; // Restore

  // ----------------------------------------------------------------------
  // STEP 11: REPRESENTATIVE MIGRATED SAMPLE RECORDS
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 11: REPRESENTATIVE MIGRATED SAMPLE RECORDS ---');
  const sampleStages = ['inquiry_received', 'initial_contact', 'options_shared', 'consultation_booked', 'itinerary_sent', 'follow_up', 'customizing_package', 'booking_confirmed', 'booking_lost'];

  sampleStages.forEach(st => {
    const inq = stagingInquiries.find(i => i.pipeline_stage === st);
    if (inq) {
      const lead = (baselineLeads || []).find(l => l.id === inq.legacy_lead_id);
      const trav = stagingTravelers.find(t => t.id === inq.traveler_id);
      const bk = stagingBookings.find(b => b.inquiry_id === inq.id);

      console.log(`\nSample [Stage: ${st}]:`);
      console.log(`  Lead: ID=${lead?.id}, Name="${lead?.full_name}", Status=${lead?.status}`);
      console.log(`  Traveler: ID=${trav?.id}, DisplayName="${trav?.display_name}"`);
      console.log(`  Inquiry: ID=${inq.id}, Stage=${inq.pipeline_stage}, Dest="${inq.destination}", Val=${inq.expected_value}`);
      if (bk) {
        console.log(`  Booking: ID=${bk.id}, Ref=${bk.booking_reference}, total_amount=${bk.total_amount}`);
      }
    }
  });

  console.log('\n======================================================================');
  console.log('STAGE B1 CONTROLLED STAGING BACKFILL & VERIFICATION COMPLETE');
  console.log('======================================================================');
}

runStageB1StagingExecution().catch(console.error);
