import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY environment variables');
}

// Browser client singleton — safe to cache in module scope for client components.
// In server components, always create a fresh client per request.
let client: SupabaseClient | undefined;

export const createClient = (): SupabaseClient => {
  if (client) return client;
  client = createBrowserClient(supabaseUrl, supabaseKey);
  return client;
};
