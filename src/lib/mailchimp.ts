import { resolveEntries } from "./projectEntries";
import { fileAsName, firstName, fullName, labelledHouseholdName } from "./format";
import type { DirectoryEntry } from "./entries";

/**
 * Who a group's email actually goes to.
 *
 * The printed book and the mailing list disagree about what a group means, and
 * the disagreement matters. A choir booklet prints the Alvarez family card
 * because Ana sings in the choir - printing her alone would lose the address
 * the card is for. An email to the choir sent to that same family reaches her
 * husband and both children, none of whom are in it, and does it every week.
 *
 * So the rule here is the one the deacons' booklet already uses - the people
 * the group actually names, not their households - with the single exception
 * that a family somebody deliberately tagged as a family is reached as one, at
 * the address the family gave. resolveEntries answers the first half of that
 * with wholeFamily: false; the rest is working out which address to use.
 */

/** Largest number of contacts Mailchimp will take in one batch-subscribe call. */
export const MAILCHIMP_BATCH_LIMIT = 500;

export interface Recipient {
  /**
   * Lower-cased, because that is both how Mailchimp keys a contact - the
   * subscriber hash is taken over the lower-cased address - and how two
   * spellings of one address are noticed here.
   */
  email: string;
  firstName: string;
  lastName: string;
  /** Whose address this is, so the screen can show its working before sending. */
  via: "person" | "household";
  /** How this recipient is named on screen: "Alvarez, Ana", "The Alvarez Family". */
  label: string;
}

/** A record in the group that carries no address, and where to go and fix it. */
export interface Unreachable {
  id: string;
  type: "person" | "household";
  /** As it would be spoken: "Dee Diaz", "The Diaz Family". */
  name: string;
}

export interface Roster {
  /** Everyone the group would reach, in the order the directory files them. */
  recipients: Recipient[];
  /**
   * Records in the group that carry no address at all, by name.
   *
   * Shown rather than silently dropped: "the choir is 28 people and this sends
   * to 24" is a question the office can answer in five minutes, and one nobody
   * can even ask if the four are simply missing from the count.
   *
   * Named the way they would be spoken - "Dee Diaz", not "Diaz, Dee" - because
   * unlike the list above, these are read as a sentence with commas between
   * them, and filed names turn two people into an unreadable four.
   *
   * Carrying the record's id as well, so the screen can link each name to the
   * form where the missing address is typed. A list of names is a report; a
   * list of links is the next thing to do.
   */
  unreachable: Unreachable[];
}

/**
 * Loose on purpose.
 *
 * Mailchimp does its own validation and refuses what it does not like, so the
 * job here is not to be the authority on what an address is - it is to catch
 * the three things that are actually in a church directory: a blank, a phone
 * number typed into the email box, and "ask Jean" written in it. Anything with
 * an @ and a dotted domain after it goes forward and lets Mailchimp rule.
 */
export function isEmailish(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text || /\s/.test(text)) return false;
  const at = text.indexOf("@");
  if (at <= 0 || at !== text.lastIndexOf("@")) return false;
  const domain = text.slice(at + 1);
  return (
    domain.length > 2 && domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".")
  );
}

/** The address as Mailchimp keys it, or null when there is nothing usable. */
function usable(value: string | null | undefined): string | null {
  return isEmailish(value) ? (value as string).trim().toLowerCase() : null;
}

/**
 * Everyone one group would reach, and everyone in it who cannot be reached.
 *
 * Deduplicated by address, first occurrence winning, because a couple who
 * share one mailbox are two records in the directory and one contact in
 * Mailchimp - and sending the choir letter twice to the same inbox is the
 * complaint that arrives first.
 */
export function rosterFor(entries: DirectoryEntry[], tagId: string | string[]): Roster {
  // One group or several, because an email to the choir and the deacons is one
  // email. Sending it twice reaches whoever is in both groups twice, and the
  // office cannot see the overlap to work around it.
  //
  // Nothing here has to merge anything: resolveEntries filters the directory
  // once, keeping an entry that carries any of the wanted tags, so a person in
  // both groups comes back a single time. The union and its de-duplication are
  // the same operation.
  const tagIds = Array.isArray(tagId) ? tagId : [tagId];
  const inGroup = resolveEntries(entries, {
    mode: "tags",
    tagIds,
    entries: [],
    wholeFamily: false,
  });

  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  const unreachable: Unreachable[] = [];

  const take = (recipient: Recipient): void => {
    if (seen.has(recipient.email)) return;
    seen.add(recipient.email);
    recipients.push(recipient);
  };

  for (const entry of inGroup) {
    if (entry.type === "person") {
      const person = entry.person;
      // Their own address first, the household's behind it - the same order
      // the book uses for an address, and for the same reason: a person who
      // shares the family's front door usually shares its mailbox too.
      const email = usable(person.email) ?? usable(person.household?.email);
      if (!email) {
        unreachable.push({ id: person.id, type: "person", name: fullName(person) });
        continue;
      }
      take({
        email,
        firstName: firstName(person),
        lastName: person.last_name,
        via: usable(person.email) ? "person" : "household",
        label: fileAsName(person),
      });
      continue;
    }

    // A family in the group on its own account - somebody tagged the household,
    // not one of the people in it - so it is written to as a family.
    const household = entry.household;
    const name = labelledHouseholdName(household);
    const shared = usable(household.email);
    if (shared) {
      // Addressed to the head of household where there is one: a merge tag
      // greeting "Ana" reads better than one greeting "The Alvarez Family",
      // and the head is the first member sortMembers puts on the card.
      const head = household.members[0];
      take({
        email: shared,
        firstName: head ? firstName(head) : "",
        lastName: head ? head.last_name : household.sort_name,
        via: "household",
        label: name,
      });
      continue;
    }

    // No address on the family, so it is reached through whoever in it has one.
    let reached = false;
    for (const member of household.members) {
      const email = usable(member.email);
      if (!email) continue;
      reached = true;
      take({
        email,
        firstName: firstName(member),
        lastName: member.last_name,
        via: "person",
        label: fileAsName(member),
      });
    }
    if (!reached) unreachable.push({ id: household.id, type: "household", name });
  }

  return { recipients, unreachable };
}

/** Splits a list into runs of at most `size`, keeping the order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

export interface TagChanges {
  /** Addresses the group's tag should be on. */
  active: string[];
  /** Addresses carrying it that are no longer in the group. */
  inactive: string[];
}

/**
 * What a sync has to say about one tag.
 *
 * The removals are the whole point, and the reason this is a sync rather than
 * an upload. Adding is forgiving - tag somebody twice and nothing happens. But
 * a chorister who leaves the choir and is only ever added keeps every choir
 * email for the rest of their life, and the office finds out when they ask why
 * in a tone. So whoever Mailchimp currently has under this tag and the
 * directory no longer does is named here, to be switched off.
 *
 * Everyone wanted is listed as active every time, including those already
 * tagged. It is one operation either way and it means a tag that was edited by
 * hand in Mailchimp - or half-applied by a sync that failed in the middle -
 * heals on the next run instead of staying wrong until somebody notices.
 */
export function tagChanges(wanted: readonly Recipient[], tagged: readonly string[]): TagChanges {
  const active = wanted.map((recipient) => recipient.email);
  const keep = new Set(active);
  const inactive = [
    ...new Set(
      tagged
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email && !keep.has(email)),
    ),
  ];
  return { active, inactive };
}

// ---------------------------------------------------------------------------
// Writing the email
// ---------------------------------------------------------------------------

export interface Composed {
  html: string;
  text: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Mailchimp refuses to send a campaign whose content has no unsubscribe link,
 * and the law in most places refuses to let you send one without a postal
 * address. Both are merge tags: Mailchimp fills them in per recipient from the
 * audience's own settings, so they are correct without this app knowing
 * anything about the church's address.
 *
 * Written into the content rather than left to the auto_footer setting,
 * because then what is in the email is exactly what is in this string - and a
 * footer that appears twice, or not at all, is not something a church office
 * should have to discover from a sent campaign.
 */
const UNSUBSCRIBE = "*|UNSUB|*";
const POSTAL_ADDRESS = "*|LIST:ADDRESS|*";

/**
 * What somebody typed, as an email.
 *
 * A church office writes an email the way it writes anything: a few paragraphs,
 * typed into a box, on a phone. Not HTML, and not a template with fourteen
 * slots. So a blank line starts a paragraph and a single newline is a line
 * break, which is the rule every messaging app has already taught everybody,
 * and nothing else is interpreted at all.
 *
 * Both forms are built from the same text on purpose: a recipient whose mail
 * client refuses HTML gets the same words in the same order, rather than the
 * "this email cannot be displayed" that a missing plain part produces.
 */
/**
 * A list of group names as a person would say it.
 *
 * "and" for the office, which is choosing them - "Write to Choir and Deacons".
 * "or" for the footer, which is explaining to one reader why the email reached
 * them, and they are in one of the groups rather than all of them.
 */
export function groupList(names: readonly string[], joiner: "and" | "or" = "and"): string {
  const clean = [...new Set(names.map((one) => one.trim()).filter(Boolean))];
  if (clean.length <= 1) return clean[0] ?? "";
  return `${clean.slice(0, -1).join(", ")} ${joiner} ${clean[clean.length - 1]}`;
}

export function composeEmail(body: string, group: string | readonly string[]): Composed {
  const paragraphs = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  // Named in the footer because a reader who does not know why this arrived is
  // a reader who marks it as spam, and one complaint costs the whole audience.
  const names = Array.isArray(group)
    ? [...new Set(group.map((one) => one.trim()).filter(Boolean))]
    : [String(group).trim()];
  const why =
    names.length > 1
      ? `You are receiving this because you are in the ${groupList(names, "or")} groups in our church directory.`
      : `You are receiving this because you are in the ${names[0] ?? ""} group in our church directory.`;

  const html = [
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#222;">',
    ...paragraphs.map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`),
    '<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px;" />',
    `<p style="font-size:12px;color:#777;">${escapeHtml(why)}<br />`,
    `<a href="${UNSUBSCRIBE}">Unsubscribe</a> &middot; ${POSTAL_ADDRESS}</p>`,
    "</div>",
  ].join("\n");

  const text = [...paragraphs, "—", why, `Unsubscribe: ${UNSUBSCRIBE}`, POSTAL_ADDRESS].join(
    "\n\n",
  );

  return { html, text };
}

/** Enough of an address to be worth sending Mailchimp; it rules on the rest. */
export function isSendableFrom(email: string | null | undefined): boolean {
  return isEmailish(email);
}

/**
 * The free-mail domains Mailchimp cannot authenticate.
 *
 * Not a refusal - it is the church's account and their decision - but worth
 * saying once on the screen where the address is typed. Mailchimp's own advice
 * is to send from a domain you own, because a public domain cannot carry the
 * authentication records that stop Gmail and Yahoo treating the message as
 * forged.
 */
const PUBLIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "msn.com",
]);

export function isPublicMailbox(email: string | null | undefined): boolean {
  const at = (email ?? "").lastIndexOf("@");
  if (at === -1) return false;
  return PUBLIC_DOMAINS.has(
    (email as string)
      .slice(at + 1)
      .trim()
      .toLowerCase(),
  );
}
