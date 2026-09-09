import { supabase } from "./supabase";

/**
 * Two-step sign-in with an authenticator app.
 *
 * A password is one secret, and a church directory is a list of where every
 * family in the congregation lives. Anyone who reaches the sign-in page can
 * try a password; the second step is a six-digit code that changes every
 * thirty seconds and never leaves the phone it is generated on, so knowing the
 * password stops being enough.
 *
 * Supabase does the cryptography. This is the thin layer over it that the two
 * screens using it share: what the app calls a factor, what it says when a
 * code is wrong, and the one enrolment rule Supabase leaves to the caller -
 * that an enrolment abandoned halfway leaves a factor behind, and the next
 * attempt has to clear it rather than trip over it.
 *
 * Turning it on is per account, not per directory: one editor can protect
 * their own sign-in without every volunteer needing a smartphone. What is not
 * optional is what happens once it is on - the database refuses to return a
 * single row to a session that has only got past the password (see migration
 * 0006), so this cannot be walked around by talking to the API directly.
 */

/** What is showing in the authenticator app, for a code that is being typed. */
export const CODE_LENGTH = 6;

/** One enrolled authenticator, as the settings screen lists it. */
export interface TotpFactor {
  id: string;
  name: string;
  addedAt: string;
}

/** Everything the enrolment screen needs to show while a code is being set up. */
export interface Enrolment {
  factorId: string;
  /** An <img> source: the QR code, ready to be photographed. */
  qr: string;
  /** The same secret in letters, for a device that cannot photograph a screen. */
  secret: string;
}

/**
 * Supabase's own wording is written for whoever wrote the app, not for
 * whoever is standing at the sign-in screen with a phone in their hand.
 */
function readable(message: string): string {
  if (/invalid.*(totp|code)|invalid_code|verification failed/i.test(message)) {
    return "That code was not accepted. Check the app again — each code lasts about thirty seconds.";
  }
  if (/aal2|assurance/i.test(message)) {
    return "Finish signing in with your authenticator app before changing this.";
  }
  if (/mfa|factor/i.test(message) && /not enabled|unsupported|disabled/i.test(message)) {
    return "This Supabase project does not have multi-factor authentication switched on.";
  }
  return message;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(readable(result.error.message));
  return result.data as T;
}

/**
 * The authenticators on this account that are actually finished.
 *
 * Unverified factors are deliberately left out. One is created the moment a QR
 * code is drawn, and it means nothing until a code from it has been typed
 * back - listing it would tell somebody they were protected by a code they
 * never scanned.
 */
export async function listAuthenticators(): Promise<TotpFactor[]> {
  const data = unwrap(await supabase.auth.mfa.listFactors());
  return data.totp.map((factor) => ({
    id: factor.id,
    name: factor.friendly_name || "Authenticator app",
    addedAt: factor.created_at,
  }));
}

/**
 * Where this session has got to.
 *
 * `next` above `current` is the whole question: it means this account has an
 * authenticator and this session has not been through it yet. Reading it costs
 * nothing - the answer is inside the token the browser is already holding -
 * so it is safe to ask on every load and on every token refresh, which is what
 * eventually moves a session left open on another device onto the code screen.
 */
export async function needsSecondStep(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

/**
 * Starts an enrolment, and clears any half-finished one first.
 *
 * Somebody who opens this screen, gets as far as the QR code and then closes
 * the tab leaves an unverified factor on their account. Supabase refuses a
 * second enrolment under a name already in use, so without this the second
 * attempt fails with a message about friendly names - for a mistake nobody
 * made and cannot see.
 */
export async function beginEnrolment(name: string): Promise<Enrolment> {
  const existing = unwrap(await supabase.auth.mfa.listFactors());
  for (const factor of existing.all) {
    if (factor.status !== "unverified") continue;
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const data = unwrap(
    await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: name,
      issuer: "Church Directory",
    }),
  );

  return {
    factorId: data.id,
    // Supabase hands back the QR as SVG source rather than as a URL. It is
    // percent-encoded on the way into the data: URI rather than pasted in
    // raw - the artwork carries #000000 in it, and a bare # ends a URL and
    // starts a fragment, which renders as a broken image and nothing else.
    qr: `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`,
    secret: data.totp.secret,
  };
}

/**
 * Finishes an enrolment with the first code the new authenticator shows.
 *
 * Typing one back is the only proof that the phone really did scan the code
 * and that its clock agrees with the server's. Supabase returns a session at
 * the higher level on success, so the browser that just set this up is not
 * immediately asked for a second code.
 */
export async function confirmEnrolment(factorId: string, code: string): Promise<void> {
  unwrap(await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() }));
}

/** The same call, used at sign-in rather than at enrolment. */
export async function completeSecondStep(code: string): Promise<void> {
  const factors = await listAuthenticators();
  const factor = factors[0];
  if (!factor) throw new Error("This account has no authenticator app set up.");
  unwrap(await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() }));
}

/**
 * Takes an authenticator off the account.
 *
 * Supabase will only do this for a session that has already been through the
 * second step, which is the point: a stolen password cannot be used to remove
 * the thing standing in its way.
 */
export async function removeAuthenticator(factorId: string): Promise<void> {
  unwrap(await supabase.auth.mfa.unenroll({ factorId }));
}
