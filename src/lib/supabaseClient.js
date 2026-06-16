import { createClient } from '@supabase/supabase-js';

/*
 * Supabase connection.
 * The anon key is PUBLIC by design (it ships in the frontend). It only grants
 * what the database's Row-Level Security policies allow — see supabase/schema.sql.
 * The secret "service_role" key is NEVER used here.
 */
export const SUPABASE_URL = 'https://vveydcmdsmucaoqitnch.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2ZXlkY21kc211Y2FvcWl0bmNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTI0NDcsImV4cCI6MjA5NzE2ODQ0N30.eRtjFpMhKJh8VKXqxKrBrEByN4bD4fzM_9BVTGGbQPg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/*
 * Creates an isolated client used ONLY to sign a brand-new account up without
 * disturbing the currently logged-in user's session (persistSession: false means
 * it never writes to localStorage, so the provider/master stays logged in).
 */
export function makeSignupClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sb-signup-temp' },
  });
}
