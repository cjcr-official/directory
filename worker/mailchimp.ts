import { md5, subscriberHash } from "./md5";

/**
 * The Mailchimp half of the Worker: everything that needs the API key.
 *
 * None of this can run in the browser, and not for want of trying. Mailchimp
 * does not send CORS headers on the Marketing API - deliberately, and they say
 * why: the key is account-wide, so a key a browser can use is a key anybody
 * reading the page can use. Every request below therefore leaves from
 * Cloudflare, and MAILCHIMP_API_KEY never reaches a bundle.
 */

/** Largest page Mailchimp will return, and what every listing here asks for. */
const PAGE = 1000;

export interface MailchimpError {
  status: number;
  title: string;
  detail: string;
}

export class MailchimpFailure extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The datacenter the account lives in, which is the last dash-separated piece
 * of the key: "...-us14" is reached at us14.api.mailchimp.com. There is no
 * endpoint that tells you this, because you need it to reach any endpoint.
 */
function datacenter(key: string): string {
  const at = key.lastIndexOf("-");
  const suffix = at === -1 ? "" : key.slice(at + 1);
  if (!/^[a-z]{2}\d+$/.test(suffix)) {
    throw new MailchimpFailure(
      500,
      "That does not look like a Mailchimp API key — it should end in a datacenter, like -us14.",
    );
  }
  return suffix;
}

/**
 * What can be said about a key without saying the key.
 *
 * "API Key Invalid — Your API key may be invalid, or you've attempted to access
 * the wrong datacenter" is Mailchimp's whole answer, and it is the same answer
 * whether the key was revoked, half-pasted, or belongs to another account. A
 * church office cannot act on that, and neither can anybody reading it over
 * their shoulder: the key is in a dashboard behind a password, shown once, and
 * cannot be read back to be compared with anything.
 *
 * So the deploy is asked to describe what it is holding. A length and a shape
 * separate the two cases that need different fixes - a key that arrived in one
 * piece and is genuinely refused, and a key that only half arrived - and
 * neither reveals a usable secret. The datacenter is already in the error above
 * it, and is not secret either: it names a region, not an account.
 */
/**
 * A short, one-way mark that changes when the key changes.
 *
 * Kept alongside the opening characters below because the two answer different
 * questions: this one changes whenever the value changes, even between two keys
 * that happen to open the same way.
 *
 * Six hex characters of a salted digest. Twenty-four bits is far too few to walk
 * back to a key, and a key is thirty-two random hex characters in the first
 * place.
 */
export function keyFingerprint(key: string): string {
  return md5(`church-directory fingerprint:${key}`).slice(0, 6);
}

export function describeKey(key: string): string {
  const full = /^[0-9a-f]{32}-[a-z]{2}\d+$/.test(key);
  const at = key.lastIndexOf("-");
  const dc = at === -1 ? "" : key.slice(at + 1);

  if (full) {
    // Mailchimp's own API keys page prints the first four characters of every
    // key beside the date it was made, and strikes through the revoked ones. So
    // four characters is exactly what it already shows its owner, and printing
    // the same four turns "is this the key I pasted" into one glance at a table
    // they have open anyway - which matters most in the case that is otherwise
    // invisible, a rotation where the new key never reached the deploy. The old
    // one is revoked the moment the new one is made, so it fails exactly as a
    // bad key does, because it has become one.
    const opening = key.slice(0, 4);
    return (
      `The key on this deploy starts "${opening}", ends "-${dc}", and is ${key.length} ` +
      `characters — the shape a Mailchimp key has, so it is the key itself being refused rather ` +
      `than the way it was pasted. Open Account & billing → Extras → API keys in Mailchimp: it ` +
      `lists the first four characters of every key. If "${opening}" is not there, or is struck ` +
      `through as revoked, this deploy is holding an old key — paste the current one over ` +
      `MAILCHIMP_API_KEY. If "${opening}" is there and Active, the key is right and Mailchimp is ` +
      `refusing it for another reason; check the address bar on that page begins "${dc}.", since ` +
      `a key made on one account cannot be used on another. (Fingerprint ${keyFingerprint(key)}, ` +
      `which changes whenever the stored value does.)`
    );
  }

  const odd = [...key].some((c) => c.codePointAt(0)! < 33 || c.codePointAt(0)! > 126);
  return (
    `The key on this deploy is ${key.length} characters` +
    (dc ? ` and ends "-${dc}"` : "") +
    `, which is not the shape of a Mailchimp key — those are 32 characters, a dash, then the ` +
    `datacenter, like "-us14"` +
    (odd ? `, and this one carries a character that should not be in a key` : "") +
    `. It looks like only part of it was pasted. Create a fresh key in Mailchimp and replace ` +
    `MAILCHIMP_API_KEY, copying the whole of it — Mailchimp shows a key once and never again.`
  );
}

/** The two schemes Mailchimp documents for the Marketing API. */
type Scheme = "Basic" | "Bearer";

function authorization(key: string, scheme: Scheme): string {
  // Basic takes any username with the key as the password; Bearer takes the key
  // on its own. Mailchimp accepts both, and says so - but only one of them can
  // be the one a given account is actually answering, and which it is is not
  // something this side can know in advance.
  return scheme === "Basic" ? `Basic ${btoa(`church-directory:${key}`)}` : `Bearer ${key}`;
}

function send(
  key: string,
  method: string,
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  scheme: Scheme,
): Promise<Response> {
  return fetch(`https://${datacenter(key)}.api.mailchimp.com/3.0${path}`, {
    method,
    headers: {
      Authorization: authorization(key, scheme),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}

/** Mailchimp's own words out of an error body, or the first of whatever came back. */
function explain(text: string): string {
  try {
    const problem = JSON.parse(text) as Partial<MailchimpError>;
    // "API Key Invalid", "Resource Not Found", "Invalid Resource" with the field
    // named - all better than anything invented here.
    return [problem.title, problem.detail].filter(Boolean).join(" — ") || text.slice(0, 400);
  } catch {
    // A gateway error page rather than JSON. The first 400 characters of it are
    // more use than "request failed".
    return text.slice(0, 400);
  }
}

async function call<T>(
  key: string,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response = await send(key, method, path, body, signal, "Basic");

  /**
   * Basic is what Mailchimp's own quick start uses, so it is what goes first.
   * But a key that is demonstrably the right key - right shape, right
   * datacenter, matching the opening characters of the Active key in the
   * account's own list - has been refused with it, and Mailchimp documents
   * Bearer as an equal alternative rather than a fallback. So a 401 is asked
   * again the other way before it is believed.
   *
   * The body is a string by the time it gets here, not a stream, so sending it
   * twice is free and safe.
   */
  let refusedBoth = false;
  if (response.status === 401) {
    const bearer = await send(key, method, path, body, signal, "Bearer");
    if (bearer.status === 401) refusedBoth = true;
    else response = bearer;
  }

  const text = await response.text();
  if (!response.ok) {
    const detail = explain(text) || `Mailchimp returned ${response.status}.`;
    if (response.status !== 401) throw new MailchimpFailure(response.status, detail);

    /**
     * Both schemes refused. That is worth one more request, to the one endpoint
     * that takes no arguments and touches no data: if /ping is also refused then
     * the account will not answer this key at all, and nothing about the way
     * this app asks for audiences is involved. If /ping answers, the key is
     * fine and the fault is in the call above it - which is this app's to fix,
     * and worth knowing rather than guessing at.
     */
    let ping = "";
    if (refusedBoth) {
      try {
        const probe = await send(key, "GET", "/ping", undefined, signal, "Basic");
        ping =
          probe.status === 200
            ? " Mailchimp's /ping endpoint accepts this key, so the key is good and the fault is " +
              "in this app's request rather than in your Mailchimp account — please report this."
            : ` Mailchimp's /ping endpoint refuses it too (${probe.status}), so the account will ` +
              `not answer this key at all.`;
      } catch {
        // The probe is a courtesy; its failure must not replace the real error.
      }
    }

    const both = refusedBoth
      ? " Both Basic and Bearer authorization were refused, so this is not the authorization scheme."
      : "";
    throw new MailchimpFailure(401, `${detail} ${describeKey(key)}${both}${ping}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

export interface Audience {
  id: string;
  name: string;
  members: number;
}

/** The account's audiences, which is what a campaign is sent to. */
export async function listAudiences(key: string, signal?: AbortSignal): Promise<Audience[]> {
  const data = await call<{
    lists?: { id: string; name: string; stats?: { member_count?: number } }[];
  }>(
    key,
    "GET",
    "/lists?count=100&fields=lists.id,lists.name,lists.stats.member_count",
    undefined,
    signal,
  );
  return (data.lists ?? []).map((list) => ({
    id: list.id,
    name: list.name,
    members: list.stats?.member_count ?? 0,
  }));
}

export interface Contact {
  email: string;
  firstName: string;
  lastName: string;
}

export interface UpsertResult {
  created: number;
  updated: number;
  /** Addresses Mailchimp would not take, with its reason for each. */
  rejected: { email: string; reason: string }[];
}

/**
 * Puts one run of at most 500 contacts into the audience.
 *
 * status_if_new is the whole reason this is safe to press twice. It is applied
 * only when the address is new to the audience; for anybody already there -
 * subscribed, unsubscribed, cleaned, however they got that way - Mailchimp
 * ignores it and leaves their status exactly as it was. So a sync can add the
 * new choristers without quietly resubscribing the one who asked to be taken
 * off the list last spring, which is both the rude outcome and the one that
 * gets a church's account suspended.
 *
 * `status` is deliberately not sent. With update_existing that field is the
 * one that would overwrite them.
 */
export async function upsertContacts(
  key: string,
  listId: string,
  contacts: Contact[],
  signal?: AbortSignal,
): Promise<UpsertResult> {
  const data = await call<{
    total_created?: number;
    total_updated?: number;
    errors?: { email_address?: string; error?: string }[];
  }>(
    key,
    "POST",
    `/lists/${encodeURIComponent(listId)}?fields=total_created,total_updated,errors`,
    {
      update_existing: true,
      members: contacts.map((contact) => ({
        email_address: contact.email,
        status_if_new: "subscribed",
        merge_fields: { FNAME: contact.firstName, LNAME: contact.lastName },
      })),
    },
    signal,
  );

  return {
    created: data.total_created ?? 0,
    updated: data.total_updated ?? 0,
    rejected: (data.errors ?? []).map((row) => ({
      email: row.email_address ?? "",
      reason: row.error ?? "Mailchimp did not say why.",
    })),
  };
}

/**
 * Who currently carries one tag.
 *
 * Read off the contacts themselves rather than out of a segment. A tag is a
 * static segment underneath - Mailchimp's own guide calls that "an
 * implementation detail within the API that can be confusing" - and going
 * through /segments/{id}/members meant a lookup by name followed by a second
 * call into an endpoint that exists for something else. The first sync of a
 * group never exercised it, because the segment does not exist until the tag
 * is first applied; the second sync did, and came back 500.
 *
 * Every member object already carries its own tags, so the plain members
 * listing answers this in one call, on the most heavily used endpoint in the
 * API, with no dependence on what a tag is underneath.
 *
 * Paged, because a congregation can outgrow one page and a half-read answer
 * would quietly untag whoever fell off the end. Bounded, because an unbounded
 * loop inside a Worker is a way to discover its subrequest limit in
 * production; a church that passes twenty thousand contacts can have a better
 * answer than this written for it.
 */
const MAX_PAGES = 20;

export async function taggedAddresses(
  key: string,
  listId: string,
  tag: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const list = encodeURIComponent(listId);
  const wanted = tag.trim().toLowerCase();
  const carrying: string[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await call<{
      members?: { email_address?: string; tags?: { name?: string }[] }[];
      total_items?: number;
    }>(
      key,
      "GET",
      `/lists/${list}/members?count=${PAGE}&offset=${page * PAGE}` +
        `&fields=members.email_address,members.tags,total_items`,
      undefined,
      signal,
    );

    const members = data.members ?? [];
    for (const member of members) {
      const has = (member.tags ?? []).some(
        (each) => (each.name ?? "").trim().toLowerCase() === wanted,
      );
      if (!has) continue;
      const email = (member.email_address ?? "").trim().toLowerCase();
      if (email) carrying.push(email);
    }

    // A short page is the last page, whatever the total claims.
    if (members.length < PAGE) break;
  }

  return carrying;
}

export interface BatchStatus {
  id: string;
  status: string;
  total: number;
  finished: number;
  errored: number;
}

function readBatch(data: {
  id?: string;
  status?: string;
  total_operations?: number;
  finished_operations?: number;
  errored_operations?: number;
}): BatchStatus {
  return {
    id: data.id ?? "",
    status: data.status ?? "pending",
    total: data.total_operations ?? 0,
    finished: data.finished_operations ?? 0,
    errored: data.errored_operations ?? 0,
  };
}

const BATCH_FIELDS = "id,status,total_operations,finished_operations,errored_operations";

/**
 * Puts the tag on everyone in the group and takes it off everyone who has left,
 * as one asynchronous batch.
 *
 * Tagging is per contact - there is no endpoint that takes a list of people and
 * a tag - so a choir of eighty is a hundred and sixty separate calls. Made one
 * at a time from here they would breach the Worker's subrequest budget long
 * before they finished; handed to Mailchimp's batch endpoint they are one
 * request that it works through on its own time, and this returns a ticket to
 * watch rather than a result.
 *
 * Removal has to name the tag explicitly with status "inactive". There is no
 * "remove every tag" call, and an empty array does nothing at all.
 */
export async function submitTagBatch(
  key: string,
  listId: string,
  tag: string,
  active: string[],
  inactive: string[],
  signal?: AbortSignal,
): Promise<BatchStatus> {
  const list = encodeURIComponent(listId);
  const operation = (email: string, status: "active" | "inactive") => ({
    method: "POST",
    path: `/lists/${list}/members/${subscriberHash(email)}/tags`,
    operation_id: `${status}:${email}`,
    // A string, not an object: the batch endpoint takes each operation's body
    // as the JSON it would have been sent as on its own.
    body: JSON.stringify({ tags: [{ name: tag, status }] }),
  });

  const operations = [
    ...active.map((email) => operation(email, "active")),
    ...inactive.map((email) => operation(email, "inactive")),
  ];

  const data = await call<Parameters<typeof readBatch>[0]>(
    key,
    "POST",
    `/batches?fields=${BATCH_FIELDS}`,
    { operations },
    signal,
  );
  return readBatch(data);
}

/** How far along a submitted batch is. */
export async function batchStatus(
  key: string,
  batchId: string,
  signal?: AbortSignal,
): Promise<BatchStatus> {
  return readBatch(
    await call<Parameters<typeof readBatch>[0]>(
      key,
      "GET",
      `/batches/${encodeURIComponent(batchId)}?fields=${BATCH_FIELDS}`,
      undefined,
      signal,
    ),
  );
}
