/* eslint-disable @typescript-eslint/no-require-imports */
const { Client } = require('pg');

const LOCAL_HOST = '127.0.0.1';
if (LOCAL_HOST !== '127.0.0.1' && LOCAL_HOST !== 'localhost') {
  console.error('UNSAFE DATABASE TARGET — STOPPED');
  process.exit(1);
}

async function checkState() {
  const client = new Client({
    host: LOCAL_HOST,
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'rihla_local_test_db'
  });
  await client.connect();

  const inq = await client.query("SELECT pipeline_stage, assigned_agent_id, next_follow_up_at FROM public.inquiries WHERE id = '11111111-1111-1111-1111-111111111111'");
  const lead = await client.query("SELECT status, assigned_to, next_follow_up FROM public.leads WHERE id = 'lead-test-a'");
  const receipts = await client.query("SELECT count(*)::int as total, json_agg(proposal_id) as ids FROM public.copilot_action_executions");
  const activities = await client.query("SELECT count(*)::int as total, json_agg(title) as titles FROM public.activities");

  console.log('Inquiry State:', inq.rows[0]);
  console.log('Lead State:', lead.rows[0]);
  console.log('Receipt Count & IDs:', receipts.rows[0]);
  console.log('Activity Count & Titles:', activities.rows[0]);

  await client.end();
}

checkState().catch(console.error);
