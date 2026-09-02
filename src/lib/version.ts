/** Baked in at build time by the version-stamp plugin in vite.config.ts. */
export const APP_VERSION: string = __APP_VERSION__;

type VersionFile = { version: string; builtAt?: string };

function looksLikeVersionFile(value: unknown): value is VersionFile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as VersionFile).version === "string" &&
    (value as VersionFile).version.length > 0
  );
}

/**
 * What the server is serving right now, or null if we could not find out.
 *
 * Null covers a lot of ordinary situations - offline, a flaky connection, the
 * few seconds mid-deploy when the file is being replaced - so it must never be
 * read as "there is a new version". Only a well-formed answer that disagrees
 * with APP_VERSION counts.
 */
export async function fetchDeployedVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    // The query string defeats any intermediary that ignores no-store, and
    // costs nothing: the file is well under a hundred bytes.
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;

    // Unknown paths fall back to index.html, so a missing version.json arrives
    // as a 200 full of HTML. Parsing it would throw; checking the type first
    // says plainly what happened.
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("json")) return null;

    const body: unknown = await response.json();
    return looksLikeVersionFile(body) ? body.version : null;
  } catch {
    return null;
  }
}
