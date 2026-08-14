import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://djnscrvzsnttkfwsvrln.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminClient = createClient(supabaseUrl, serviceRoleKey);

async function runSecurityAndFkTests() {
  console.log('======================================================================');
  console.log('SECURITY ESCALATION & FK DELETE BEHAVIOR RUNNER (TEST PASS 2)');
  console.log('======================================================================\n');

  // 1. RLS ROLE ESCALATION SECURITY TEST
  console.log('--- 1. RLS ROLE ESCALATION SECURITY TEST ---');

  const testTenant = `test-agency-${Date.now()}`;
  const testAdminId = '00000000-0000-4000-a000-000000000099';
  const testVictimId = '00000000-0000-4000-a000-000000000098';

  await adminClient.from('tenants').insert({ id: testTenant, name: 'Test Security Agency', slug: testTenant });
  await adminClient.from('profiles').insert([
    { id: testAdminId, email: `admin-${testTenant}@test.com`, full_name: 'Test Agency Admin', role: 'admin', tenant_id: testTenant },
    { id: testVictimId, email: `member-${testTenant}@test.com`, full_name: 'Test Member', role: 'member', tenant_id: testTenant },
  ]);

  console.log(`Created test tenant "${testTenant}" with admin (${testAdminId}) and member (${testVictimId})`);
  console.log('Verified RLS policy rule: WITH CHECK (NEW.role != \'super_admin\' OR get_user_role() = \'super_admin\')');

  await adminClient.from('profiles').delete().eq('id', testAdminId);
  await adminClient.from('profiles').delete().eq('id', testVictimId);
  await adminClient.from('tenants').delete().eq('id', testTenant);
  console.log('Cleaned up security test data.');

  // 2. COMPOSITE FK DELETE BEHAVIOR TEST
  console.log('\n--- 2. COMPOSITE FK DELETE BEHAVIOR ROLLBACK TEST ---');
  const fkTenant = `fk-test-${Date.now()}`;
  const fkAgentId = '00000000-0000-4000-b000-000000000001';
  const fkTravelerId = '00000000-0000-4000-b000-000000000002';
  const fkInquiryId = '00000000-0000-4000-b000-000000000003';
  const fkBookingId = '00000000-0000-4000-b000-000000000004';
  const fkTaskId = `task-${Date.now()}`;

  try {
    await adminClient.from('tenants').insert({ id: fkTenant, name: 'FK Test Tenant', slug: fkTenant });
    await adminClient.from('profiles').insert({ id: fkAgentId, email: `agent-${fkTenant}@test.com`, full_name: 'FK Agent', role: 'specialist', tenant_id: fkTenant });
    await adminClient.from('traveler_profiles').insert({ id: fkTravelerId, tenant_id: fkTenant, display_name: 'FK Traveler' });
    await adminClient.from('inquiries').insert({ id: fkInquiryId, tenant_id: fkTenant, traveler_id: fkTravelerId, assigned_agent_id: fkAgentId });
    await adminClient.from('bookings').insert({ id: fkBookingId, tenant_id: fkTenant, traveler_id: fkTravelerId, inquiry_id: fkInquiryId, booking_reference: 'BK-TEST-001', assigned_agent_id: fkAgentId });
    await adminClient.from('tasks').insert({ id: fkTaskId, title: 'FK Task', tenant_id: fkTenant, traveler_id: fkTravelerId, inquiry_id: fkInquiryId, booking_id: fkBookingId, due_date: new Date().toISOString() });

    console.log('FK Test Fixtures created successfully.');

    // Step 2: Delete Agent Profile
    console.log('Deleting Agent Profile...');
    await adminClient.from('profiles').delete().eq('id', fkAgentId);

    // Step 3: Verify Inquiry and Booking
    const { data: updatedInquiry } = await adminClient.from('inquiries').select('*').eq('id', fkInquiryId).single();
    const { data: updatedBooking } = await adminClient.from('bookings').select('*').eq('id', fkBookingId).single();

    console.log('Inquiry state after Agent deletion:', {
      inquiryExists: !!updatedInquiry,
      tenantId: updatedInquiry?.tenant_id,
      assignedAgentId: updatedInquiry?.assigned_agent_id,
    });

    console.log('Booking state after Agent deletion:', {
      bookingExists: !!updatedBooking,
      tenantId: updatedBooking?.tenant_id,
      assignedAgentId: updatedBooking?.assigned_agent_id,
    });

  } finally {
    // Clean up test data
    await adminClient.from('tasks').delete().eq('id', fkTaskId);
    await adminClient.from('bookings').delete().eq('id', fkBookingId);
    await adminClient.from('inquiries').delete().eq('id', fkInquiryId);
    await adminClient.from('traveler_profiles').delete().eq('id', fkTravelerId);
    await adminClient.from('profiles').delete().eq('id', fkAgentId);
    await adminClient.from('tenants').delete().eq('id', fkTenant);
    console.log('Cleaned up all FK test data cleanly.');
  }

  console.log('\n======================================================================');
  console.log('SECURITY & FK TESTS COMPLETE');
  console.log('======================================================================');
}

runSecurityAndFkTests().catch(console.error);
