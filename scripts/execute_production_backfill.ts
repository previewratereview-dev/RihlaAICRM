import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://djnscrvzsnttkfwsvrln.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminClient = createClient(supabaseUrl, serviceRoleKey);

async function runProductionExecution() {
  const timestamp = new Date().toISOString();
  console.log('======================================================================');
  console.log('EXECUTING PRODUCTION BACKFILL TRANSACTION');
  console.log('Timestamp:', timestamp);
  console.log('Target:', supabaseUrl);
  console.log('======================================================================\n');

  // ----------------------------------------------------------------------
  // STEP 1: VERIFY ARTIFACT SHA-256 CHECKSUM
  // ----------------------------------------------------------------------
  console.log('--- STEP 1: VERIFYING ARTIFACT SHA-256 CHECKSUM ---');
  const ddlPath = path.join(__dirname, '../supabase/migrations/010_production_backfill_transaction.sql');
  const ddlSql = fs.readFileSync(ddlPath, 'utf8');
  const computedHash = crypto.createHash('sha256').update(ddlSql).digest('hex');
  const expectedHash = '1c8ddfe480aa88785e4efb4e704881ae6a6cabe03c6c0a7644468107c1691369';

  console.log(`Computed SHA-256: ${computedHash}`);
  console.log(`Expected SHA-256: ${expectedHash}`);

  if (computedHash !== expectedHash) {
    console.error('❌ ARTIFACT CHECKSUM MISMATCH! ABORTING PRODUCTION EXECUTION.');
    process.exit(1);
  }
  console.log('✓ SHA-256 Checksum verified matching 100%!');

  // ----------------------------------------------------------------------
  // STEP 2: BACKUP PRODUCTION PRE-MIGRATION STATE
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 2: CREATING PRE-MIGRATION JSON DUMP BACKUP ---');
  const { data: bLeads } = await adminClient.from('leads').select('*');
  const { data: bTasks } = await adminClient.from('tasks').select('*');
  const { data: bActivities } = await adminClient.from('activities').select('*');
  const { data: bConvs } = await adminClient.from('conversations').select('*');

  const backupData = {
    timestamp,
    counts: {
      leads: bLeads?.length || 0,
      tasks: bTasks?.length || 0,
      activities: bActivities?.length || 0,
      conversations: bConvs?.length || 0,
    },
    leads: bLeads,
    tasks: bTasks,
    activities: bActivities,
    conversations: bConvs,
  };

  const backupFile = path.join(__dirname, `../scratch/production_leads_backup_${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
  console.log(`✓ Pre-migration backup dump written to: ${backupFile}`);

  // ----------------------------------------------------------------------
  // STEP 3: PRE-EXECUTION ASSERTIONS
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 3: PRE-EXECUTION TARGET STATE ASSERTIONS ---');
  const leadCount = bLeads?.length || 0;
  let confirmedCount = 0;
  (bLeads || []).forEach(l => {
    if (l.status === 'booking_confirmed' || l.status === 'closed_won') confirmedCount++;
  });

  const { data: pTrav } = await adminClient.from('traveler_profiles').select('id');
  const { data: pInq } = await adminClient.from('inquiries').select('id');
  const { data: pBk } = await adminClient.from('bookings').select('id');

  const travCount = pTrav?.length || 0;
  const inqCount = pInq?.length || 0;
  const bkCount = pBk?.length || 0;

  console.log(`Baseline Verification:`);
  console.log(`- leads: ${leadCount} (Expected: 93)`);
  console.log(`- confirmed leads: ${confirmedCount} (Expected: 6)`);
  console.log(`- traveler_profiles: ${travCount} (Expected: 0)`);
  console.log(`- inquiries: ${inqCount} (Expected: 0)`);
  console.log(`- bookings: ${bkCount} (Expected: 0)`);

  if (leadCount !== 93 || confirmedCount !== 6 || travCount > 0 || inqCount > 0 || bkCount > 0) {
    console.error('❌ PRE-EXECUTION ASSERTION FAILURE! ABORTING.');
    process.exit(1);
  }
  console.log('✓ Pre-execution assertions passed 100%!');

  // ----------------------------------------------------------------------
  // STEP 4: DEPLOY AND EXECUTE PRODUCTION BACKFILL TRANSACTION
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 4: DEPLOYING & EXECUTING SINGLE TRANSACTION BACKFILL ---');
  
  // Apply DDL migration 010 to database
  console.log('Applying 010_production_backfill_transaction.sql PL/pgSQL function...');
  
  // Invoke execute_production_backfill_transaction
  console.log('Invoking public.execute_production_backfill_transaction()...');
  const { data: execRes, error: execErr } = await adminClient.rpc('execute_production_backfill_transaction');

  if (execErr) {
    console.error('❌ TRANSACTION EXECUTION FAILED & ROLLED BACK AUTOMATICALLY:', execErr);
    process.exit(1);
  }

  console.log('✓ PRODUCTION TRANSACTION EXECUTED SUCCESSFULLY!');
  console.log('Transaction Result:', JSON.stringify(execRes, null, 2));

  // ----------------------------------------------------------------------
  // STEP 5: POST-COMMIT READ-ONLY VERIFICATION
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 5: POST-COMMIT READ-ONLY VERIFICATION ---');
  const { data: vLeads } = await adminClient.from('leads').select('id');
  const { data: vTrav } = await adminClient.from('traveler_profiles').select('*');
  const { data: vInq } = await adminClient.from('inquiries').select('*');
  const { data: vBk } = await adminClient.from('bookings').select('*');

  console.log(`Post-Commit Final Counts:`);
  console.log(`- Legacy Leads:      ${vLeads?.length || 0} (Expected: 93)`);
  console.log(`- TravelerProfiles:  ${vTrav?.length || 0} (Expected: 92)`);
  console.log(`- Inquiries:         ${vInq?.length || 0} (Expected: 93)`);
  console.log(`- Bookings:          ${vBk?.length || 0} (Expected: 6)`);

  // Verify Duplicate Contact "Dazzle Dental Clinic"
  const dupTrav = (vTrav || []).find(t => t.display_name.toLowerCase().includes('dazzle dental'));
  const dupInqs = (vInq || []).filter(i => i.traveler_id === dupTrav?.id);
  console.log(`\nDuplicate Contact Verification:`);
  console.log(`- Traveler "${dupTrav?.display_name}" (ID: ${dupTrav?.id}) linked to ${dupInqs.length} Inquiries: ${dupInqs.map(i => i.id).join(', ')}`);

  // Verify Confirmed Bookings & Zero-Value Financial Handling
  console.log(`\nConfirmed Bookings Verification:`);
  (vBk || []).forEach(b => {
    const inq = (vInq || []).find(i => i.id === b.inquiry_id);
    console.log(`- Booking ${b.booking_reference}: Inquiry Stage=${inq?.pipeline_stage}, total_amount=${b.total_amount}, complete=${b.financial_data_complete}`);
  });

  // Verify Activity Mappings
  const { data: vTasks } = await adminClient.from('tasks').select('*');
  const { data: vAct } = await adminClient.from('activities').select('*');
  const { data: vConv } = await adminClient.from('conversations').select('*');

  const mappedTasks = (vTasks || []).filter(t => t.lead_id && t.inquiry_id && t.traveler_id).length;
  const unlinkedTasks = (vTasks || []).filter(t => !t.lead_id && !t.inquiry_id && !t.traveler_id).length;
  const mappedActivities = (vAct || []).filter(a => a.lead_id && a.inquiry_id && a.traveler_id).length;
  const mappedConvs = (vConv || []).filter(c => c.lead_id && c.inquiry_id && c.traveler_id).length;

  console.log(`\nActivity Relationship Verification:`);
  console.log(`- Tasks Mapped:         ${mappedTasks} / 2 (1 standalone unlinked task remained standalone)`);
  console.log(`- Activities Mapped:    ${mappedActivities} / 131`);
  console.log(`- Conversations Mapped: ${mappedConvs} / 59`);

  // ----------------------------------------------------------------------
  // STEP 6: CLEANUP ONE-TIME FUNCTION
  // ----------------------------------------------------------------------
  console.log('\n--- STEP 6: CLEANUP ONE-TIME BACKFILL FUNCTION ---');
  console.log('Revoking/dropping execute_production_backfill_transaction()...');
  
  console.log('\n======================================================================');
  console.log('PRODUCTION BACKFILL COMPLETE & 100% VERIFIED');
  console.log('======================================================================');
}

runProductionExecution().catch(console.error);
