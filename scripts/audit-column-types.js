/* eslint-disable @typescript-eslint/no-require-imports */
const { Client } = require('pg');

const LOCAL_HOST = '127.0.0.1';
if (LOCAL_HOST !== '127.0.0.1' && LOCAL_HOST !== 'localhost') {
  console.error('UNSAFE DATABASE TARGET — STOPPED');
  process.exit(1);
}

async function queryTypes() {
  const client = new Client({
    host: LOCAL_HOST,
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'rihla_local_test_db'
  });
  await client.connect();

  const cols = [
    ['profiles', 'id'],
    ['profiles', 'tenant_id'],
    ['inquiries', 'id'],
    ['inquiries', 'tenant_id'],
    ['inquiries', 'assigned_agent_id'],
    ['inquiries', 'legacy_lead_id'],
    ['leads', 'id'],
    ['leads', 'tenant_id'],
    ['leads', 'assigned_to'],
    ['activities', 'id'],
    ['activities', 'lead_id'],
    ['activities', 'user_id'],
    ['activities', 'tenant_id'],
    ['copilot_action_executions', 'proposal_id'],
    ['copilot_action_executions', 'tenant_id'],
    ['copilot_action_executions', 'actor_user_id'],
    ['copilot_action_executions', 'entity_id']
  ];

  console.log('REAL POSTGRESQL SCHEMA COLUMN TYPES:');
  console.log('---------------------------------------------------------');
  for (const [table, col] of cols) {
    const res = await client.query(`
      SELECT table_schema, table_name, column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2;
    `, [table, col]);
    if (res.rows.length === 0) {
      console.log(`public.${table}.${col.padEnd(20)} -> NOT FOUND`);
    } else {
      console.log(`public.${table}.${col.padEnd(20)} -> data_type: ${res.rows[0].data_type}, udt: ${res.rows[0].udt_name}`);
    }
  }
  await client.end();
}

queryTypes().catch((err) => {
  console.error(err);
  process.exit(1);
});
