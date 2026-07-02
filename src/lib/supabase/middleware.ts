import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Holds the evolving middleware response. The Supabase client rewrites this
 * whenever it refreshes auth cookies, so callers must read `holder.response`
 * AFTER awaiting any Supabase call rather than capturing it eagerly.
 */
export interface MiddlewareSupabase {
  supabase: SupabaseClient;
  holder: { response: NextResponse };
}

/**
 * Create a Supabase client bound to the incoming middleware request.
 *
 * Follows the @supabase/ssr middleware contract: request cookies are mirrored
 * onto a fresh `NextResponse.next()` whenever Supabase rotates the session, so
 * the refreshed auth cookies are propagated back to the browser. The returned
 * client is used to server-validate authentication (`auth.getUser`) before any
 * protected route handler runs (Requirements 9.2, 9.3).
 */
export function createMiddlewareClient(request: NextRequest): MiddlewareSupabase {
  const holder = { response: NextResponse.next({ request }) };

  const supabase = createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        holder.response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          holder.response.cookies.set(name, value, options),
        );
      },
    },
  });

  return { supabase, holder };
}

/** Copy every cookie set on `from` onto `to`, preserving Supabase auth cookies. */
export function copyResponseCookies(from: NextResponse, to: NextResponse): void {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
}
