import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

function getHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

const c0RpcPath = path.join(__dirname, '../supabase/migrations/011_stage_c0_compatibility_rpc.sql');

console.log('Stage C0 Migration SHA-256:', getHash(c0RpcPath));
