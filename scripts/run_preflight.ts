import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://djnscrvzsnttkfwsvrln.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function runPreflight() {
  console.log('======================================================================');
  console.log('PREFLIGHT DATABASE INSPECTION & ANOMALY RUNNER');
  console.log('Target Supabase URL:', supabaseUrl);
  console.log('======================================================================\n');

  // 1. LEGACY STATUS DISTRIBUTION
  console.log('--- 1. LEGACY STATUS DISTRIBUTION ---');
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('*');

  if (leadsErr) {
    console.error('Error fetching leads:', leadsErr);
  } else {
    console.log(`Total leads in public.leads table: ${leads.length}`);
    const statusCounts: Record<string, { count: number; tenants: Set<string> }> = {};

    leads.forEach((l: any) => {
      const st = l.status || 'NULL';
      if (!statusCounts[st]) {
        statusCounts[st] = { count: 0, tenants: new Set() };
      }
      statusCounts[st].count++;
      if (l.tenant_id) statusCounts[st].tenants.add(l.tenant_id);
    });

    console.log(JSON.stringify(
      Object.entries(statusCounts).map(([status, val]) => ({
        status,
        total_count: val.count,
        tenants_affected: val.tenants.size,
      })), null, 2
    ));
  }

  // 2. ASSIGNMENT INTEGRITY
  console.log('\n--- 2. ASSIGNMENT INTEGRITY PREFLIGHT ---');
  const { data: profiles } = await supabase.from('profiles').select('*');
  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  const { data: tenants } = await supabase.from('tenants').select('*');
  const tenantSet = new Set((tenants || []).map((t: any) => t.id));

  const orphanAssigned: any[] = [];
  const crossTenantAssigned: any[] = [];
  const invalidTenants: any[] = [];
  const assignedProfilesMissingTenant: any[] = [];

  (leads || []).forEach((l: any) => {
    if (l.assigned_to) {
      const p = profileMap.get(l.assigned_to);
      if (!p) {
        orphanAssigned.push({ leadId: l.id, tenantId: l.tenant_id, assignedTo: l.assigned_to });
      } else if (p.tenant_id !== l.tenant_id) {
        crossTenantAssigned.push({ leadId: l.id, leadTenant: l.tenant_id, agentTenant: p.tenant_id, assignedTo: l.assigned_to });
      }
    }
    if (!l.tenant_id || !tenantSet.has(l.tenant_id)) {
      invalidTenants.push({ leadId: l.id, tenantId: l.tenant_id });
    }
  });

  (profiles || []).forEach((p: any) => {
    if (!p.tenant_id || p.tenant_id === '') {
      assignedProfilesMissingTenant.push({ profileId: p.id, email: p.email });
    }
  });

  console.log(`Orphan assigned_to records: ${orphanAssigned.length}`, JSON.stringify(orphanAssigned));
  console.log(`Cross-tenant assigned agents: ${crossTenantAssigned.length}`, JSON.stringify(crossTenantAssigned));
  console.log(`Leads referencing nonexistent/invalid tenants: ${invalidTenants.length}`, JSON.stringify(invalidTenants));
  console.log(`Assigned profiles missing tenant_id: ${assignedProfilesMissingTenant.length}`, JSON.stringify(assignedProfilesMissingTenant));

  // 3. TRAVELER IDENTITY PREFLIGHT (Tenant-Scoped)
  console.log('\n--- 3. TRAVELER IDENTITY PREFLIGHT (Tenant-Scoped) ---');
  const phoneToEmails: Record<string, Map<string, Set<string>>> = {};
  const phoneToNames: Record<string, Map<string, Set<string>>> = {};
  const emailToNames: Record<string, Map<string, Set<string>>> = {};
  const comboToLeads: Record<string, Map<string, string[]>> = {};
  const missingIdentityLeads: any[] = [];

  (leads || []).forEach((l: any) => {
    const tenant = l.tenant_id || 'unknown';
    const normEmail = l.email ? l.email.toLowerCase().trim() : '';
    const normPhone = l.phone ? l.phone.replace(/\D/g, '') : '';
    const normName = l.full_name ? l.full_name.toLowerCase().trim().replace(/\s+/g, ' ') : '';

    if (!normName && !normEmail && !normPhone) {
      missingIdentityLeads.push({ leadId: l.id, tenantId: tenant });
    }

    if (normPhone) {
      if (!phoneToEmails[tenant]) phoneToEmails[tenant] = new Map();
      if (!phoneToEmails[tenant].has(normPhone)) phoneToEmails[tenant].set(normPhone, new Set());
      if (normEmail) phoneToEmails[tenant].get(normPhone)!.add(normEmail);

      if (!phoneToNames[tenant]) phoneToNames[tenant] = new Map();
      if (!phoneToNames[tenant].has(normPhone)) phoneToNames[tenant].set(normPhone, new Set());
      if (normName) phoneToNames[tenant].get(normPhone)!.add(normName);
    }

    if (normEmail) {
      if (!emailToNames[tenant]) emailToNames[tenant] = new Map();
      if (!emailToNames[tenant].has(normEmail)) emailToNames[tenant].set(normEmail, new Set());
      if (normName) emailToNames[tenant].get(normEmail)!.add(normName);
    }

    if (normEmail && normPhone) {
      const combo = `${normEmail}|${normPhone}`;
      if (!comboToLeads[tenant]) comboToLeads[tenant] = new Map();
      if (!comboToLeads[tenant].has(combo)) comboToLeads[tenant].set(combo, []);
      comboToLeads[tenant].get(combo)!.push(l.id);
    }
  });

  let samePhoneMultiEmailsCount = 0;
  Object.entries(phoneToEmails).forEach(([tenant, map]) => {
    map.forEach((emails, phone) => {
      if (emails.size > 1) samePhoneMultiEmailsCount++;
    });
  });

  let samePhoneMultiNamesCount = 0;
  Object.entries(phoneToNames).forEach(([tenant, map]) => {
    map.forEach((names, phone) => {
      if (names.size > 1) samePhoneMultiNamesCount++;
    });
  });

  let sameEmailMultiNamesCount = 0;
  Object.entries(emailToNames).forEach(([tenant, map]) => {
    map.forEach((names, email) => {
      if (names.size > 1) sameEmailMultiNamesCount++;
    });
  });

  let duplicateCombosCount = 0;
  Object.entries(comboToLeads).forEach(([tenant, map]) => {
    map.forEach((ids, combo) => {
      if (ids.length > 1) duplicateCombosCount++;
    });
  });

  console.log(`Same normalized phone + multiple emails (tenant-scoped): ${samePhoneMultiEmailsCount}`);
  console.log(`Same normalized phone + different names (tenant-scoped): ${samePhoneMultiNamesCount}`);
  console.log(`Same normalized email + different names (tenant-scoped): ${sameEmailMultiNamesCount}`);
  console.log(`Duplicate normalized email + phone combinations: ${duplicateCombosCount}`);
  console.log(`Leads with no usable name, email, or phone: ${missingIdentityLeads.length}`, JSON.stringify(missingIdentityLeads));

  // 4. FINANCIAL PREFLIGHT
  console.log('\n--- 4. FINANCIAL PREFLIGHT ---');
  let negativeDealValues = 0;
  let zeroDealValues = 0;
  let nullDealValues = 0;
  let confirmedNullDealValues = 0;
  let confirmedZeroDealValues = 0;

  (leads || []).forEach((l: any) => {
    const val = l.deal_value;
    const isConfirmed = l.status === 'closed_won' || l.status === 'booking_confirmed';

    if (val === null || val === undefined) {
      nullDealValues++;
      if (isConfirmed) confirmedNullDealValues++;
    } else if (val < 0) {
      negativeDealValues++;
    } else if (val === 0) {
      zeroDealValues++;
      if (isConfirmed) confirmedZeroDealValues++;
    }
  });

  console.log(`Negative deal values: ${negativeDealValues}`);
  console.log(`Zero deal values: ${zeroDealValues}`);
  console.log(`Null deal values: ${nullDealValues}`);
  console.log(`Confirmed/won leads with NULL deal_value: ${confirmedNullDealValues}`);
  console.log(`Confirmed/won leads with zero deal_value: ${confirmedZeroDealValues}`);

  const hasCurrencyCol = (leads || []).some((l: any) => 'currency' in l);
  if (hasCurrencyCol) {
    const currCounts: Record<string, number> = {};
    (leads || []).forEach((l: any) => {
      const c = l.currency || 'NULL';
      currCounts[c] = (currCounts[c] || 0) + 1;
    });
    console.log('Currency field distribution:', JSON.stringify(currCounts));
  } else {
    console.log('No legacy currency field exists in public.leads schema.');
  }

  // 5. TIMESTAMP PREFLIGHT
  console.log('\n--- 5. TIMESTAMP PREFLIGHT ---');
  let malformedLastContacted = 0;
  let malformedNextFollowUp = 0;
  const malformedTsLeads: any[] = [];

  (leads || []).forEach((l: any) => {
    if (l.last_contacted && typeof l.last_contacted === 'string' && l.last_contacted.trim() !== '') {
      const d = new Date(l.last_contacted);
      if (isNaN(d.getTime())) {
        malformedLastContacted++;
        malformedTsLeads.push({ id: l.id, field: 'last_contacted', value: l.last_contacted });
      }
    }
    if (l.next_follow_up && typeof l.next_follow_up === 'string' && l.next_follow_up.trim() !== '') {
      const d = new Date(l.next_follow_up);
      if (isNaN(d.getTime())) {
        malformedNextFollowUp++;
        malformedTsLeads.push({ id: l.id, field: 'next_follow_up', value: l.next_follow_up });
      }
    }
  });

  console.log(`Malformed last_contacted timestamps: ${malformedLastContacted}`);
  console.log(`Malformed next_follow_up timestamps: ${malformedNextFollowUp}`);
  if (malformedTsLeads.length > 0) {
    console.log('Malformed timestamp records:', JSON.stringify(malformedTsLeads));
  }

  console.log('\n======================================================================');
  console.log('PREFLIGHT EXECUTION COMPLETE');
  console.log('======================================================================');
}

runPreflight().catch(console.error);
