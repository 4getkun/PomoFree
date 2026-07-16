// Optional Supabase client setup for cross-device account sync.
//
// This follows the same "graceful no-op without credentials" pattern used
// elsewhere in this project family: if PUBLIC_SUPABASE_URL /
// PUBLIC_SUPABASE_ANON_KEY aren't set at build time, `supabase` is simply
// `null` and every consumer must treat that as "sync feature unavailable"
// rather than throwing. Nothing in the app should crash, error to the
// console, or nag the user when these env vars are absent — Pomofree must
// keep working fully offline via localStorage (see storage.ts).
//
// Astro only exposes env vars to client code when they're prefixed
// `PUBLIC_`, so these are read via `import.meta.env` per Astro convention.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

/** True only if both required env vars are set to non-empty strings. */
export const isSupabaseConfigured: boolean = Boolean(supabaseUrl && supabaseUrl.trim() && supabaseAnonKey && supabaseAnonKey.trim());

/**
 * The Supabase client, or `null` when sync isn't configured for this
 * deployment. Every consumer must handle the `null` case gracefully.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null;

/** Shape of the single-row-per-user sync table. See supabase-schema.sql. */
export interface UserDataRow {
  user_id: string;
  settings: unknown;
  tasks: unknown;
  projects: unknown;
  sessions: unknown;
  updated_at: string;
}
