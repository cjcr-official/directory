import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * True when the app has been pointed at a Supabase project. The UI shows a
 * setup screen instead of a login form when this is false, so a fresh clone
 * explains itself rather than failing with a network error.
 */
export const isConfigured = Boolean(url && anonKey);

if (!isConfigured && import.meta.env.DEV) {
  console.warn(
    "[church-directory] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. " +
      "Copy .env.example to .env.local and fill them in.",
  );
}

/**
 * The anon key is public by design - it is shipped inside the browser bundle.
 * Everything is protected by row level security in supabase/migrations, which
 * requires an active row in `profiles` before any directory data is readable.
 */
export const supabase = createClient<Database>(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export const PHOTO_BUCKET = "directory-photos";
