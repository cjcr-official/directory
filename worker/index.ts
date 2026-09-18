import { missingSettings, settingsOf } from "./settings";
import {
  MailchimpFailure,
  draftCampaign,
  sendCampaign,
  sendTest,
  tagSegmentId,
  batchStatus,
  listAudiences,
  submitTagBatch,
  taggedAddresses,
  upsertContacts,
  type Contact,
} from "./mailchimp";

/**
 * The small server-side piece the Mailchimp screen talks to.
 *
 * Everything else in this app is a static bundle and a database, and that was
 * enough right up until something needed a credential a browser must not hold.
 * Mailchimp is that: one account-wide key, no CORS, and a published warning
 * not to put it in client code. So this sits in front of the same assets, on
 * the same domain, and is the only thing that ever sees the key.
 *
 * It is the whole of the server. It holds no state, stores nothing, and every
 * route is a thin pass to Mailchimp with one question asked first.
 */

export interface Env {
  /** From Mailchimp: Account -> Extras -> API keys. Never in the bundle. */
  MAILCHIMP_API_KEY?: string;
  /** The same project the browser signs in to - this is how a caller is checked. */
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** The built site, bound by wrangler.jsonc. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Nothing here is ever worth reusing, and some of it is a congregation's
      // addresses. No CORS headers either: this is same-origin only, so a
      // stolen token cannot be spent from somebody else's page.
      "Cache-Control": "no-store",
    },
  });
}

function problem(status: number, error: string): Response {
  return json({ error }, status);
}

/**
 * Is the caller somebody the database would let write?
 *
 * Asked by calling is_editor() as the caller, which is the same function every
 * row level security policy in supabase/migrations is written in terms of. The
 * point of going through it rather than reading the profiles row directly is
 * migration 0006: an account with an authenticator app has a valid token after
 * the password and before the code, and that token can read its own profile
 * row perfectly well. Only is_editor() knows the second step has not happened.
 *
 * Reading the role directly would therefore have handed the whole congregation
 * to anybody holding a stolen password - the exact hole 0006 exists to close,
 * reopened one layer up. PostgREST verifies the token's signature before the
 * function runs, so a forged or expired one never gets an answer at all.
 */
async function editorOnly(request: Request, env: Env): Promise<Response | null> {
  const { supabaseUrl, anonKey } = settingsOf(env);
  const header = request.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return problem(401, "Sign in again — this request arrived without a session.");

  let allowed: unknown;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/is_editor`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (response.status === 401 || response.status === 403) {
      return problem(401, "Your session has expired. Sign in again.");
    }
    if (!response.ok) {
      return problem(
        502,
        "Could not check your account with Supabase. If this persists, confirm the deploy's " +
          "SUPABASE_URL and SUPABASE_ANON_KEY, and that is_editor() is executable by the " +
          "authenticated role.",
      );
    }
    allowed = await response.json();
  } catch {
    return problem(502, "Could not reach Supabase to check your account.");
  }

  // A scalar-returning function comes back as a bare `true`, but PostgREST has
  // shipped more than one opinion about that over the years and a church is not
  // going to be running the version this was written against. Anything that is
  // not recognisably a yes is a no, so the shapes it might use are read rather
  // than assumed - the alternative is refusing every editor over a pair of
  // brackets.
  const yes =
    allowed === true ||
    (Array.isArray(allowed) && allowed.length === 1 && readsTrue(allowed[0])) ||
    readsTrue(allowed);

  if (!yes) {
    return problem(403, "Only an editor or the owner can send the directory to Mailchimp.");
  }
  return null;
}

/** True for `true`, `{ is_editor: true }`, and nothing else. */
function readsTrue(value: unknown): boolean {
  if (value === true) return true;
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>).is_editor === true;
}

/** Reads a JSON body, or null when it is not an object. */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function addresses(value: unknown, limit: number): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > limit) return null;
  const out: string[] = [];
  for (const item of value) {
    const email = text(item).toLowerCase();
    if (!email) return null;
    out.push(email);
  }
  return out;
}

/** At most one batch-subscribe call's worth, which is Mailchimp's own limit. */
const CONTACTS_PER_CALL = 500;
/** A ceiling on one tag batch, so a bad request cannot queue an unbounded job. */
const TAG_OPERATIONS = 5000;

async function api(request: Request, env: Env, route: string): Promise<Response> {
  // Answered before the caller is checked, on purpose: when these are missing,
  // checking the caller is exactly what cannot work, and a screen that says
  // "this deploy has no Mailchimp key" is more use than one that says the
  // session expired.
  if (route === "status" && request.method === "GET") {
    const missing = missingSettings(env);
    return json({ ready: missing.length === 0, missing });
  }

  const missing = missingSettings(env);
  if (missing.length) {
    return problem(
      503,
      `This deploy is not connected to Mailchimp yet — ${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } not set on the Worker.`,
    );
  }

  const refused = await editorOnly(request, env);
  if (refused) return refused;

  const { key } = settingsOf(env);

  if (route === "audiences" && request.method === "GET") {
    return json({ audiences: await listAudiences(key, request.signal) });
  }

  if (route === "batch" && request.method === "GET") {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return problem(400, "Which batch?");
    return json(await batchStatus(key, id, request.signal));
  }

  if (request.method !== "POST") return problem(405, "That route wants a different method.");

  const body = await readBody(request);
  if (!body) return problem(400, "Expected a JSON object.");
  const listId = text(body.listId);
  if (!listId) return problem(400, "Which audience?");

  if (route === "tagged") {
    const tag = text(body.tag);
    if (!tag) return problem(400, "Which group?");
    return json({ emails: await taggedAddresses(key, listId, tag, request.signal) });
  }

  if (route === "contacts") {
    const raw = body.contacts;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > CONTACTS_PER_CALL) {
      return problem(400, `Send between 1 and ${CONTACTS_PER_CALL} contacts.`);
    }
    const contacts: Contact[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") return problem(400, "A contact was not an object.");
      const row = item as Record<string, unknown>;
      const email = text(row.email).toLowerCase();
      if (!email) return problem(400, "A contact arrived without an address.");
      contacts.push({ email, firstName: text(row.firstName), lastName: text(row.lastName) });
    }
    return json(await upsertContacts(key, listId, contacts, request.signal));
  }

  if (route === "draft") {
    const tag = text(body.tag);
    const subject = text(body.subject);
    const fromName = text(body.fromName);
    const replyTo = text(body.replyTo).toLowerCase();
    const html = typeof body.html === "string" ? body.html : "";
    const plain = typeof body.text === "string" ? body.text : "";
    if (!tag) return problem(400, "Which group?");
    if (!subject) return problem(400, "An email needs a subject line.");
    if (!fromName) return problem(400, "An email needs a name to be from.");
    if (!replyTo.includes("@")) return problem(400, "An email needs a reply-to address.");
    if (!html.trim() || !plain.trim()) return problem(400, "An email needs something in it.");

    const segmentId = await tagSegmentId(key, listId, tag, request.signal);
    if (segmentId === null) {
      return problem(
        409,
        `Mailchimp has no “${tag}” tag yet, so there is nobody for a campaign to go to. ` +
          `Press Sync on that group first, then write the email.`,
      );
    }

    return json(
      await draftCampaign(
        key,
        {
          listId,
          segmentId,
          subject,
          fromName,
          replyTo,
          title: `${tag} — ${subject}`,
          html,
          text: plain,
        },
        request.signal,
      ),
    );
  }

  if (route === "draft-test") {
    const campaignId = text(body.campaignId);
    const to = addresses(body.to, 5);
    if (!campaignId) return problem(400, "Which draft?");
    if (!to || !to.length) return problem(400, "Where should the test go?");
    await sendTest(key, campaignId, to, request.signal);
    return json({ sent: to.length });
  }

  /**
   * The one route here that reaches people who never asked this app for
   * anything, and the one that cannot be undone. It carries no content and no
   * recipients of its own: everything it will send was settled by "draft", and
   * looked at, before anybody pressed anything.
   */
  if (route === "draft-send") {
    const campaignId = text(body.campaignId);
    if (!campaignId) return problem(400, "Which draft?");
    await sendCampaign(key, campaignId, request.signal);
    return json({ sent: true });
  }

  if (route === "tags") {
    const tag = text(body.tag);
    if (!tag) return problem(400, "Which group?");
    const active = addresses(body.active, TAG_OPERATIONS);
    const inactive = addresses(body.inactive, TAG_OPERATIONS);
    if (!active || !inactive) return problem(400, "The addresses to tag were not usable.");
    if (active.length + inactive.length === 0) {
      return problem(400, "Nothing to tag and nobody to untag.");
    }
    if (active.length + inactive.length > TAG_OPERATIONS) {
      return problem(400, `That is more than ${TAG_OPERATIONS} tag changes in one go.`);
    }
    return json(await submitTagBatch(key, listId, tag, active, inactive, request.signal));
  }

  return problem(404, "No such route.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/api/mailchimp/")) {
      const route = pathname.slice("/api/mailchimp/".length);
      try {
        return await api(request, env, route);
      } catch (cause) {
        // Mailchimp's own refusals carry its words and its status, which is
        // what the screen should show: "API Key Invalid" is a thing somebody
        // can act on, "500" is not.
        if (cause instanceof MailchimpFailure) {
          return problem(
            cause.status >= 400 && cause.status < 600 ? cause.status : 502,
            cause.message,
          );
        }
        return problem(500, cause instanceof Error ? cause.message : "Something went wrong.");
      }
    }

    // Anything else under /api is this app's, and is missing - answered as JSON
    // so a mistyped route reads as a 404 rather than as the index page arriving
    // where JSON was expected.
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return problem(404, "No such route.");
    }

    return env.ASSETS.fetch(request);
  },
};
