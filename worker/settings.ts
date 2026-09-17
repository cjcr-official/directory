/**
 * The three deploy settings, as they are actually usable.
 *
 * Trimmed, and the Supabase URL stripped of trailing slashes, because these are
 * pasted by hand into a dashboard - on a phone, more often than not, where the
 * selection picks up a leading space about half the time.
 *
 * Neither mistake announces itself. A space on the front of the API key
 * survives the datacenter check in mailchimp.ts, because the "-us14" on the end
 * still parses; it is then sent to Mailchimp as part of the key, which answers
 * "API Key Invalid — Your API key may be invalid, or you've attempted to access
 * the wrong datacenter" and sends whoever pasted it off to regenerate a key
 * that was never wrong. A slash on the end of the Supabase URL builds
 * //rest/v1/rpc/is_editor and fails the editor check for a reason nobody could
 * be expected to guess from the outside.
 *
 * Neither is the church office's mistake to make, so neither is theirs to
 * diagnose. Stripped here, once, and no route has to think about it again.
 */

export interface RawSettings {
  MAILCHIMP_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export interface Settings {
  key: string;
  supabaseUrl: string;
  anonKey: string;
}

export function settingsOf(env: RawSettings): Settings {
  return {
    key: (env.MAILCHIMP_API_KEY ?? "").trim(),
    // Every trailing slash, not just one: a paste that ended up with two is no
    // more the person's fault than a paste that ended up with one.
    supabaseUrl: (env.SUPABASE_URL ?? "").trim().replace(/\/+$/, ""),
    anonKey: (env.SUPABASE_ANON_KEY ?? "").trim(),
  };
}

/** Which of them the deploy is missing, named so the screen can say so. */
export function missingSettings(env: RawSettings): string[] {
  const { key, supabaseUrl, anonKey } = settingsOf(env);
  const missing: string[] = [];
  if (!key) missing.push("MAILCHIMP_API_KEY");
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY");
  return missing;
}
