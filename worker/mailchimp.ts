import { subscriberHash } from "./md5";

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

async function call<T>(
  key: string,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`https://${datacenter(key)}.api.mailchimp.com/3.0${path}`, {
    method,
    headers: {
      // Any username, the key as the password - Mailchimp's documented scheme.
      Authorization: `Basic ${btoa(`church-directory:${key}`)}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 400);
    try {
      const problem = JSON.parse(text) as Partial<MailchimpError>;
      // Mailchimp's own words are better than anything invented here: "API Key
      // Invalid", "Resource Not Found", "Invalid Resource" with the field named.
      detail = [problem.title, problem.detail].filter(Boolean).join(" — ") || detail;
    } catch {
      // A gateway error page rather than JSON. The first 400 characters of it
      // are more use than "request failed".
    }
    throw new MailchimpFailure(response.status, detail || `Mailchimp returned ${response.status}.`);
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
 * A tag is a static segment underneath, which is the only reason this is
 * answerable at all - there is no "list members with tag X" endpoint, but
 * there is "list the members of segment X", and the segment is named after the
 * tag. A tag nobody has yet simply has no segment, which is not an error: it
 * is a group that has never been synced, and the answer is nobody.
 */
export async function taggedAddresses(
  key: string,
  listId: string,
  tag: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const list = encodeURIComponent(listId);
  const segments = await call<{ segments?: { id: number; name: string }[] }>(
    key,
    "GET",
    `/lists/${list}/segments?type=static&count=${PAGE}&fields=segments.id,segments.name`,
    undefined,
    signal,
  );

  const wanted = tag.trim().toLowerCase();
  const segment = (segments.segments ?? []).find((row) => row.name.trim().toLowerCase() === wanted);
  if (!segment) return [];

  const members = await call<{ members?: { email_address?: string }[] }>(
    key,
    "GET",
    `/lists/${list}/segments/${segment.id}/members?count=${PAGE}&fields=members.email_address`,
    undefined,
    signal,
  );
  return (members.members ?? [])
    .map((row) => (row.email_address ?? "").trim().toLowerCase())
    .filter(Boolean);
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
