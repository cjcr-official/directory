import { supabase } from "./supabase";
import { message } from "./format";
import { MAILCHIMP_BATCH_LIMIT, chunk, tagChanges, type Recipient } from "./mailchimp";

/**
 * The browser's side of the Mailchimp conversation.
 *
 * Every call goes to this app's own /api, never to Mailchimp - see worker/,
 * which is the only thing holding the key. What arrives here is already
 * filtered down to what the screen needs to say.
 */

export interface Settings {
  ready: boolean;
  /** Names of the Worker settings that have not been filled in. */
  missing: string[];
}

export interface Audience {
  id: string;
  name: string;
  members: number;
}

export interface BatchProgress {
  id: string;
  status: string;
  total: number;
  finished: number;
  errored: number;
}

interface Upserted {
  created: number;
  updated: number;
  rejected: { email: string; reason: string }[];
}

async function ask<T>(route: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You are signed out. Sign in again and try once more.");

  const response = await fetch(`/api/mailchimp/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // A deploy without the Worker - the Pages Git integration serves the assets
  // and nothing else - answers every /api path with index.html and a cheerful
  // 200. Caught here, because "Unexpected token '<'" is a terrible way to be
  // told that the thing you are talking to is not there.
  const kind = response.headers.get("Content-Type") ?? "";
  if (!kind.includes("json")) {
    throw new Error(
      "This deploy has no Mailchimp API behind it. It needs to be deployed as a Worker — " +
        "see the Mailchimp section of the README.",
    );
  }

  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `The request failed (${response.status}).`);
  return payload;
}

export function settings(): Promise<Settings> {
  return ask<Settings>("status");
}

export async function audiences(): Promise<Audience[]> {
  const { audiences: list } = await ask<{ audiences: Audience[] }>("audiences");
  return list;
}

export interface SyncOutcome {
  /** How many contacts the group's tag now sits on. */
  tagged: number;
  added: number;
  removed: number;
  created: number;
  updated: number;
  rejected: { email: string; reason: string }[];
  /**
   * Null when Mailchimp finished the tagging while we watched, and the last
   * status when it did not - the work carries on at their end either way.
   */
  stillRunning: BatchProgress | null;
  /**
   * Set when who-already-has-this-tag could not be read, so nobody was
   * untagged this time.
   *
   * Adding is the job; removing is the tidy-up. Losing the tidy-up is worth a
   * line of small print, and is not worth refusing to add anybody over - which
   * is what failing the whole sync here amounted to.
   */
  removalsSkipped: string | null;
}

export type SyncStep = (note: string) => void;

/** How long to keep asking whether Mailchimp has finished the tag batch. */
const WATCH_MS = 90_000;
const WATCH_EVERY_MS = 2_000;

/**
 * Puts one group into one audience, and takes the group's tag off anybody who
 * has left it.
 *
 * Chunked from here rather than inside the Worker on purpose. A Worker on
 * Cloudflare's free plan may make fifty outbound requests per invocation, so a
 * congregation sent as one call would fail at the sixth hundred person; sent
 * as one call per five hundred contacts, each invocation makes one. The
 * progress notes are the happy side effect - a sync of a large congregation
 * says where it has got to instead of sitting still.
 */
export async function syncGroup(
  audienceId: string,
  tag: string,
  recipients: Recipient[],
  step: SyncStep,
): Promise<SyncOutcome> {
  step("Looking up who already has this tag…");
  let emails: string[] = [];
  let removalsSkipped: string | null = null;
  try {
    ({ emails } = await ask<{ emails: string[] }>("tagged", { listId: audienceId, tag }));
  } catch (cause) {
    // Not fatal. Without this list nobody can be untagged, but everybody in
    // the group can still be added - and a sync that adds is most of the point.
    removalsSkipped = message(cause);
  }
  const changes = tagChanges(recipients, emails);

  const runs = chunk(recipients, MAILCHIMP_BATCH_LIMIT);
  let created = 0;
  let updated = 0;
  const rejected: { email: string; reason: string }[] = [];

  for (const [index, run] of runs.entries()) {
    step(
      runs.length === 1
        ? `Adding ${run.length} ${run.length === 1 ? "person" : "people"} to the audience…`
        : `Adding people to the audience — ${index + 1} of ${runs.length}…`,
    );
    const result = await ask<Upserted>("contacts", {
      listId: audienceId,
      contacts: run.map((recipient) => ({
        email: recipient.email,
        firstName: recipient.firstName,
        lastName: recipient.lastName,
      })),
    });
    created += result.created;
    updated += result.updated;
    rejected.push(...result.rejected);
  }

  const added = changes.active.filter((email) => !emails.includes(email)).length;

  step(`Applying the “${tag}” tag…`);
  let progress = await ask<BatchProgress>("tags", {
    listId: audienceId,
    tag,
    active: changes.active,
    inactive: changes.inactive,
  });

  // Tagging is asynchronous at Mailchimp's end, so it is watched rather than
  // waited for. It finishes whether or not this page is still open; staying
  // here only means the screen can say so.
  const until = Date.now() + WATCH_MS;
  while (progress.status !== "finished" && Date.now() < until) {
    step(
      progress.total
        ? `Mailchimp is working through ${progress.finished} of ${progress.total} changes…`
        : "Mailchimp is working through the changes…",
    );
    await new Promise((resolve) => setTimeout(resolve, WATCH_EVERY_MS));
    progress = await ask<BatchProgress>(`batch?id=${encodeURIComponent(progress.id)}`);
  }

  return {
    tagged: changes.active.length,
    added,
    removed: changes.inactive.length,
    created,
    updated,
    rejected,
    stillRunning: progress.status === "finished" ? null : progress,
    removalsSkipped,
  };
}

// ---------------------------------------------------------------------------
// Writing and sending
// ---------------------------------------------------------------------------

export interface Draft {
  /** Mailchimp's id for the campaign, which test and send both name. */
  id: string;
  /** The number in Mailchimp's own URL for it, so the office can go and look. */
  webId: number;
}

export interface DraftFields {
  tag: string;
  subject: string;
  fromName: string;
  replyTo: string;
  html: string;
  text: string;
}

/**
 * Writes the campaign into Mailchimp without sending it.
 *
 * Kept separate from sending on purpose. A draft can be made, looked at, sent
 * to yourself, thought better of and abandoned, and none of that reaches the
 * congregation - the draft simply sits in the church's Mailchimp account like
 * any other.
 */
export function draft(audienceId: string, fields: DraftFields): Promise<Draft> {
  return ask<Draft>("draft", { listId: audienceId, ...fields });
}

/** One copy to whoever is about to decide, before anybody else gets it. */
export function sendTestTo(audienceId: string, campaignId: string, to: string): Promise<void> {
  return ask<void>("draft-test", { listId: audienceId, campaignId, to: [to] });
}

/** Sends it to the group. There is no unsending it. */
export function send(audienceId: string, campaignId: string): Promise<void> {
  return ask<void>("draft-send", { listId: audienceId, campaignId });
}
