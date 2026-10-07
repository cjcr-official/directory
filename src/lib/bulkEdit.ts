/**
 * Changing many people at once.
 *
 * The office does the same edit to a dozen records more often than it does a
 * different edit to one: the choir is put in a group, the people who moved
 * away are left out of the book, everyone checked at the same training
 * evening gets the same two dates. One form at a time, that is a dozen trips
 * through a dozen screens to type the same thing.
 *
 * Every field here starts at "leave as they are", and only the ones somebody
 * changes are written. A bulk edit says "make these people's gender Female";
 * it never says "make these people look like this one", so nothing it was not
 * asked to touch can be lost to it.
 *
 * Only the people a change actually changes are written, too. people.updated_at
 * and updated_by are stamped by a trigger on any update at all, so writing a
 * Female onto somebody who already was one would put the editor's name and
 * today's date on a record nobody changed - the same reason the family form
 * only writes the members whose place in the family moved.
 *
 * Nothing in this file talks to the database. It works out what would happen
 * and says so in words; queries.ts does the writing. That split is what lets
 * the whole of it be put to `npm run checks`, and what lets the form show the
 * plan it is about to carry out rather than a description of one.
 */

import type {
  Gender,
  HouseholdRole,
  HouseholdRow,
  PersonRow,
  PhotoFit,
  TagRow,
} from "./database.types";
import { sortMembers } from "./entries";
import {
  addressLines,
  formatFullDate,
  formatPhone,
  hasYear,
  HOUSEHOLD_ROLES,
  labelledHouseholdName,
  monthDayDate,
  parseDateParts,
  type AddressParts,
} from "./format";

/** The columns a bulk edit can write: a person, less what identifies the row. */
export type PersonPatch = Partial<
  Omit<PersonRow, "id" | "created_at" | "updated_at" | "updated_by">
>;

export const NO_ADDRESS: AddressParts = {
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  country: null,
};

/**
 * What to do to everybody chosen, one entry per thing that can be done.
 *
 * Each keeps its value while it is set to "keep", so changing a select back
 * and forth does not throw away what was typed under it.
 */
export interface BulkChanges {
  lastName: { mode: "keep" | "set"; value: string };
  gender: { mode: "keep" | "set"; value: Gender | null };
  phone: { mode: "keep" | "set" | "clear"; value: string };
  email: { mode: "keep" | "set" | "clear"; value: string };
  /** A birthday is each person's own, so it can lose its year or go - not be set. */
  birthday: { mode: "keep" | "drop-year" | "clear" };
  photoFit: { mode: "keep" | "set"; value: PhotoFit | null };
  family: { mode: "keep" | "join" | "leave"; householdId: string };
  role: { mode: "keep" | "set"; value: HouseholdRole };
  address: { mode: "keep" | "family" | "set" | "clear"; value: AddressParts };
  notes: { mode: "keep" | "append" | "set" | "clear"; value: string };
  printed: { mode: "keep" | "set"; value: boolean };
  check: { mode: "keep" | "set" | "clear"; on: string | null; due: string | null };
  addTags: string[];
  removeTags: string[];
}

export const NO_CHANGES: BulkChanges = {
  lastName: { mode: "keep", value: "" },
  gender: { mode: "keep", value: null },
  phone: { mode: "keep", value: "" },
  email: { mode: "keep", value: "" },
  birthday: { mode: "keep" },
  photoFit: { mode: "keep", value: null },
  family: { mode: "keep", householdId: "" },
  role: { mode: "keep", value: "other" },
  address: { mode: "keep", value: NO_ADDRESS },
  notes: { mode: "keep", value: "" },
  printed: { mode: "keep", value: true },
  check: { mode: "keep", on: null, due: null },
  addTags: [],
  removeTags: [],
};

/** What the plan needs to know beyond the people being changed. */
export interface BulkContext {
  householdById: ReadonlyMap<string, HouseholdRow>;
  membersOf(householdId: string): PersonRow[];
  tagsOfPerson(personId: string): string[];
  tags: readonly TagRow[];
}

/** One thing that will happen, and to how many. */
export interface PlanLine {
  text: string;
  /** People it changes. */
  count: number;
  /** People it was asked of who were that way already, and are left alone. */
  already: number;
}

export interface BulkPlan {
  /**
   * Writes whose new values owe nothing to what the row held, grouped so that
   * everybody getting the same patch goes in one request.
   */
  shared: { patch: PersonPatch; ids: string[] }[];
  /**
   * Writes worked out from what the row held - a line added to the notes, a
   * birthday losing its year. Each is guarded on the version it was worked
   * out from, so one cannot land on top of somebody else's edit to the same
   * person and quietly undo it.
   */
  guarded: { id: string; patch: PersonPatch; expectedUpdatedAt: string }[];
  addLinks: { person_id: string; tag_id: string }[];
  removeLinks: { person_id: string; tag_id: string }[];
  /** Everybody something happens to, in the order they were given. */
  touched: string[];
  lines: PlanLine[];
  /** Why it cannot be saved yet, in words. Empty when it can. */
  problems: string[];
}

const GENDER_WORDS: Record<Gender, string> = { female: "Female", male: "Male" };

const FIT_WORDS: Record<PhotoFit, string> = {
  fill: "cropped to fill",
  fit: "as the whole photo",
};

function roleWord(role: HouseholdRole): string {
  return HOUSEHOLD_ROLES.find((option) => option.value === role)?.label ?? role;
}

/** The next free place on a family's card, after everyone already on it. */
function nextSortOrder(members: readonly PersonRow[]): number {
  return members.reduce((last, member) => Math.max(last, member.sort_order + 1), 0);
}

/** What a typed address would come to, or null for nothing typed. */
function typedAddress(value: AddressParts): AddressParts | null {
  const tidy = (text: string | null) => text?.trim() || null;
  const address: AddressParts = {
    address_line1: tidy(value.address_line1),
    address_line2: tidy(value.address_line2),
    city: tidy(value.city),
    state: tidy(value.state),
    postal_code: tidy(value.postal_code),
    // The form has no country, as the person form has none. A new address
    // typed in full is the whole of it, and an old country left standing
    // under it would print beneath a street it has nothing to do with.
    country: null,
  };
  return addressLines(address).length ? address : null;
}

/** The note as it reads with a line added under it. */
function withLine(notes: string | null, line: string): string {
  const before = notes?.trimEnd() ?? "";
  return before ? `${before}\n${line}` : line;
}

/** Whether the notes already end with this line - added by an earlier save of the same edit. */
function endsWithLine(notes: string | null, line: string): boolean {
  const lines = (notes ?? "").trimEnd().split("\n");
  return lines[lines.length - 1]?.trim() === line;
}

/** Why the changes cannot be saved as they stand. */
export function problemsWith(changes: BulkChanges): string[] {
  const problems: string[] = [];
  if (changes.lastName.mode === "set" && !changes.lastName.value.trim())
    problems.push("Type the last name they should all have.");
  if (changes.phone.mode === "set" && !changes.phone.value.trim())
    problems.push("Type the phone number, or choose to remove it.");
  if (changes.email.mode === "set" && !changes.email.value.trim())
    problems.push("Type the email address, or choose to remove it.");
  if (changes.family.mode === "join" && !changes.family.householdId)
    problems.push("Choose the family to put them in.");
  if (changes.address.mode === "set" && !typedAddress(changes.address.value))
    problems.push("Type the address, or choose to remove their own.");
  if (
    (changes.notes.mode === "append" || changes.notes.mode === "set") &&
    !changes.notes.value.trim()
  )
    problems.push("Type the note.");
  if (changes.check.mode === "set" && !changes.check.on && !changes.check.due)
    problems.push("Enter a background check date, or choose to remove them.");
  return problems;
}

/** True when nothing at all has been asked for. */
export function asksNothing(changes: BulkChanges): boolean {
  return (
    changes.lastName.mode === "keep" &&
    changes.gender.mode === "keep" &&
    changes.phone.mode === "keep" &&
    changes.email.mode === "keep" &&
    changes.birthday.mode === "keep" &&
    changes.photoFit.mode === "keep" &&
    changes.family.mode === "keep" &&
    changes.role.mode === "keep" &&
    changes.address.mode === "keep" &&
    changes.notes.mode === "keep" &&
    changes.printed.mode === "keep" &&
    changes.check.mode === "keep" &&
    !changes.addTags.length &&
    !changes.removeTags.length
  );
}

/** Where somebody ends up: their family, their part in it, their place on its card. */
interface Place {
  householdId: string | null;
  role: HouseholdRole | null;
  sortOrder: number;
}

/**
 * Where everybody will be once the family and role changes are made.
 *
 * Worked out for everybody before anybody's patch, because the people joining
 * a family need places on its card in an order that depends on all of them:
 * heads first, then spouses, then children oldest first, as the card reads.
 */
function placesAfter(
  people: readonly PersonRow[],
  changes: BulkChanges,
  context: BulkContext,
): Map<string, Place> {
  const target =
    changes.family.mode === "join"
      ? (context.householdById.get(changes.family.householdId) ?? null)
      : null;

  const places = new Map<string, Place>();
  const joining: PersonRow[] = [];

  for (const person of people) {
    const householdId =
      changes.family.mode === "leave" ? null : target ? target.id : person.household_id;

    let role: HouseholdRole | null = null;
    if (householdId) {
      if (changes.role.mode === "set") role = changes.role.value;
      // Somebody moving family keeps the part they had, as they do on their
      // own form; somebody who had none joins as "other" until told otherwise.
      else if (householdId !== person.household_id) role = person.household_role ?? "other";
      else role = person.household_role;
    }

    const moving = householdId !== person.household_id;
    places.set(person.id, {
      householdId,
      role,
      sortOrder: moving ? 0 : person.sort_order,
    });
    if (moving && householdId) joining.push({ ...person, household_role: role, sort_order: 0 });
  }

  // Everybody arriving goes after everybody already there. Taken from the
  // highest place in use rather than from a count, because a family that has
  // lost a member has a gap, and a count lands its newcomer on top of the last.
  if (target && joining.length) {
    let next = nextSortOrder(context.membersOf(target.id));
    for (const person of sortMembers(joining)) {
      const place = places.get(person.id);
      if (place) place.sortOrder = next++;
    }
  }

  return places;
}

/** Field by field, the people a change reached and the people it was already true of. */
class Tally {
  private readonly counts = new Map<string, { count: number; already: number }>();

  add(key: string, changed: boolean, already: boolean): void {
    const entry = this.counts.get(key) ?? { count: 0, already: 0 };
    if (changed) entry.count += 1;
    else if (already) entry.already += 1;
    this.counts.set(key, entry);
  }

  get(key: string): { count: number; already: number } {
    return this.counts.get(key) ?? { count: 0, already: 0 };
  }

  has(key: string): boolean {
    return this.counts.has(key);
  }
}

/**
 * The plan for one bulk edit: what will be written, to whom, and what it
 * comes to in words.
 *
 * Given the same people and the same changes it always says the same thing,
 * and asking it again after a save that went through says nothing is left to
 * do. That is what makes saving again after a failure safe: whoever was
 * changed the first time is already as asked, and is left alone.
 */
export function planBulkEdit(
  people: readonly PersonRow[],
  changes: BulkChanges,
  context: BulkContext,
): BulkPlan {
  const tally = new Tally();
  const places = placesAfter(people, changes, context);
  const shared = new Map<string, { patch: PersonPatch; ids: string[] }>();
  const guarded: BulkPlan["guarded"] = [];
  const addLinks: BulkPlan["addLinks"] = [];
  const removeLinks: BulkPlan["removeLinks"] = [];
  const touched: string[] = [];

  const surname = changes.lastName.value.trim();
  const phone = changes.phone.value.trim();
  const email = changes.email.value.trim();
  const address = changes.address.mode === "set" ? typedAddress(changes.address.value) : null;
  const note = changes.notes.value.trim();
  const target =
    changes.family.mode === "join"
      ? (context.householdById.get(changes.family.householdId) ?? null)
      : null;

  for (const person of people) {
    const patch: PersonPatch = {};
    let derived = false;

    /**
     * Puts a value in the patch only when it differs from what is there, and
     * says whether it did. Absent and null are the same here: a database that
     * has not run the migration for a column returns rows without the key.
     */
    const put = <K extends keyof PersonPatch>(key: K, value: PersonPatch[K]): boolean => {
      const now = (person as Record<string, unknown>)[key] ?? null;
      if (now === (value ?? null)) return false;
      patch[key] = value;
      return true;
    };
    const putAddress = (next: AddressParts): boolean => {
      let changed = false;
      for (const key of Object.keys(NO_ADDRESS) as (keyof AddressParts)[]) {
        changed = put(key, next[key]) || changed;
      }
      return changed;
    };

    if (changes.lastName.mode === "set" && surname) {
      const changed = put("last_name", surname);
      tally.add("lastName", changed, !changed);
    }

    if (changes.gender.mode === "set") {
      const changed = put("gender", changes.gender.value);
      tally.add("gender", changed, !changed);
    }

    if (changes.phone.mode === "clear" || (changes.phone.mode === "set" && phone)) {
      const changed = put("phone", changes.phone.mode === "set" ? phone : null);
      tally.add("phone", changed, !changed);
    }

    if (changes.email.mode === "clear" || (changes.email.mode === "set" && email)) {
      const changed = put("email", changes.email.mode === "set" ? email : null);
      tally.add("email", changed, !changed);
    }

    if (changes.birthday.mode === "drop-year") {
      const parts = parseDateParts(person.date_of_birth);
      if (parts && hasYear(person.date_of_birth)) {
        derived = put("date_of_birth", monthDayDate(parts.month, parts.day)) || derived;
        tally.add("birthday", true, false);
      } else {
        tally.add("birthday", false, Boolean(parts));
      }
    } else if (changes.birthday.mode === "clear") {
      const changed = put("date_of_birth", null);
      tally.add("birthday", changed, !changed);
    }

    // Only somebody with a photograph of their own: without one their card
    // shows the family's, which is shaped on the family.
    if (changes.photoFit.mode === "set" && person.photo_path) {
      const changed = put("photo_fit", changes.photoFit.value);
      tally.add("photoFit", changed, !changed);
    }

    const place = places.get(person.id) ?? {
      householdId: person.household_id,
      role: person.household_role,
      sortOrder: person.sort_order,
    };
    const leaving = Boolean(person.household_id) && !place.householdId;

    if (changes.family.mode === "leave" || (changes.family.mode === "join" && target)) {
      const moved = put("household_id", place.householdId);
      if (moved) put("sort_order", place.sortOrder);
      tally.add("family", moved, !moved);
    }

    // Asked only when the family or the part in it was asked about. A record
    // that came in from an old import with a role and no family is not this
    // edit's business, and tidying it unasked would stamp it as changed.
    if (changes.family.mode !== "keep" || changes.role.mode !== "keep") {
      const roleChanged = put("household_role", place.role);
      if (changes.role.mode === "set" && place.householdId) {
        tally.add("role", roleChanged, !roleChanged);
      }
    }

    // Somebody leaving a family who printed with its address keeps it: copied
    // down onto their own record, as the family form does, or their card
    // would print with no address at all. Unless they are being given another
    // one, or having theirs taken away, in this same edit - and unless the
    // family had none to give, when there is nothing to copy and they print
    // with none either way.
    const keepsWhereTheyLive = changes.address.mode === "keep" || changes.address.mode === "family";
    if (leaving && keepsWhereTheyLive) {
      const old = person.household_id ? context.householdById.get(person.household_id) : undefined;
      if (person.use_household_address && old && addressLines(old).length) {
        const copied = putAddress({
          address_line1: old.address_line1,
          address_line2: old.address_line2,
          city: old.city,
          state: old.state,
          postal_code: old.postal_code,
          country: old.country,
        });
        const unhooked = put("use_household_address", false);
        tally.add("copied", copied || unhooked, false);
      }
    } else if (changes.address.mode === "family") {
      // Only meaningful in a family. Somebody on their own has no family's
      // address to use, so they are left as they are rather than counted.
      if (place.householdId) {
        const changed = put("use_household_address", true);
        tally.add("address", changed, !changed);
      }
    } else if (changes.address.mode === "set" && address) {
      const moved = putAddress(address);
      const unhooked = put("use_household_address", false);
      tally.add("address", moved || unhooked, !(moved || unhooked));
    } else if (changes.address.mode === "clear") {
      // With their own address gone, somebody in a family prints with the
      // family's - so say so on their record, which is what their form will
      // then show ticked.
      const cleared = putAddress(NO_ADDRESS);
      const hooked = place.householdId ? put("use_household_address", true) : false;
      tally.add("address", cleared || hooked, !(cleared || hooked));
    }

    if (changes.notes.mode === "append" && note) {
      if (endsWithLine(person.notes, note)) {
        tally.add("notes", false, true);
      } else {
        derived = put("notes", withLine(person.notes, note)) || derived;
        tally.add("notes", true, false);
      }
    } else if (changes.notes.mode === "set" && note) {
      const changed = put("notes", note);
      tally.add("notes", changed, !changed);
    } else if (changes.notes.mode === "clear") {
      const changed = put("notes", null);
      tally.add("notes", changed, !changed);
    }

    if (changes.printed.mode === "set") {
      const changed = put("is_active", changes.printed.value);
      tally.add("printed", changed, !changed);
    }

    if (changes.check.mode === "set" && (changes.check.on || changes.check.due)) {
      const done = put("background_check_on", changes.check.on);
      const due = put("background_check_due", changes.check.due);
      tally.add("check", done || due, !(done || due));
    } else if (changes.check.mode === "clear") {
      const done = put("background_check_on", null);
      const due = put("background_check_due", null);
      tally.add("check", done || due, !(done || due));
    }

    // Groups are links rather than columns, so they never touch the row.
    const hasTags = new Set(context.tagsOfPerson(person.id));
    let linked = false;
    for (const tagId of changes.addTags) {
      if (changes.removeTags.includes(tagId)) continue;
      const missing = !hasTags.has(tagId);
      if (missing) {
        addLinks.push({ person_id: person.id, tag_id: tagId });
        linked = true;
      }
      tally.add(`add:${tagId}`, missing, !missing);
    }
    for (const tagId of changes.removeTags) {
      if (changes.addTags.includes(tagId)) continue;
      const present = hasTags.has(tagId);
      if (present) {
        removeLinks.push({ person_id: person.id, tag_id: tagId });
        linked = true;
      }
      tally.add(`remove:${tagId}`, present, false);
    }

    const written = Object.keys(patch).length > 0;
    if (written && derived) {
      guarded.push({ id: person.id, patch, expectedUpdatedAt: person.updated_at });
    } else if (written) {
      // Keyed on the sorted entries, so two patches holding the same values
      // share a request whatever order they were built in.
      const key = JSON.stringify(Object.entries(patch).sort(([a], [b]) => a.localeCompare(b)));
      const group = shared.get(key);
      if (group) group.ids.push(person.id);
      else shared.set(key, { patch, ids: [person.id] });
    }
    if (written || linked) touched.push(person.id);
  }

  return {
    shared: [...shared.values()],
    guarded,
    addLinks,
    removeLinks,
    touched,
    lines: describe(changes, context, tally, target),
    problems: problemsWith(changes),
  };
}

/** The plan, a line per change, in the order the form asks them. */
function describe(
  changes: BulkChanges,
  context: BulkContext,
  tally: Tally,
  target: HouseholdRow | null,
): PlanLine[] {
  const lines: PlanLine[] = [];
  const line = (key: string, text: string) => {
    if (!tally.has(key)) return;
    lines.push({ text, ...tally.get(key) });
  };
  const tagName = (id: string) => context.tags.find((tag) => tag.id === id)?.name ?? "a group";

  line("lastName", `Last name made ${changes.lastName.value.trim()}`);
  line(
    "gender",
    changes.gender.value
      ? `Gender made ${GENDER_WORDS[changes.gender.value]}`
      : "Gender made not said",
  );
  line(
    "phone",
    changes.phone.mode === "clear"
      ? "Phone number removed"
      : `Phone number made ${formatPhone(changes.phone.value)}`,
  );
  line(
    "email",
    changes.email.mode === "clear" ? "Email removed" : `Email made ${changes.email.value.trim()}`,
  );
  line(
    "birthday",
    changes.birthday.mode === "clear" ? "Birthday removed" : "Year left out of their birthday",
  );
  line(
    "photoFit",
    changes.photoFit.value
      ? `Their own photo printed ${FIT_WORDS[changes.photoFit.value]}`
      : "Their own photo printed as the directory says",
  );
  if (changes.family.mode === "leave") line("family", "Taken out of their family");
  else if (target) line("family", `Put in ${labelledHouseholdName(target)}`);
  line("copied", "Given the address they printed with, since they no longer share a family's");
  line("role", `Made ${roleWord(changes.role.value)} in their family`);
  line(
    "address",
    changes.address.mode === "family"
      ? "Printed with their family's address"
      : changes.address.mode === "clear"
        ? "Their own address removed"
        : `Address made ${addressLines(typedAddress(changes.address.value)).join(", ")}`,
  );
  line(
    "notes",
    changes.notes.mode === "append"
      ? "A line added to their notes"
      : changes.notes.mode === "clear"
        ? "Notes removed"
        : "Notes replaced",
  );
  line(
    "printed",
    changes.printed.value ? "Included in printed directories" : "Left out of printed directories",
  );
  // Both dates are written, so a date left empty is a date taken away - and
  // the line says so, rather than only naming the one that was typed.
  const done = formatFullDate(changes.check.on);
  const due = formatFullDate(changes.check.due);
  line(
    "check",
    changes.check.mode === "clear"
      ? "Background check dates removed"
      : done && due
        ? `Background check done ${done}, next due ${due}`
        : done
          ? `Background check done ${done}, with no renewal date`
          : `Background check due ${due}, with none done yet`,
  );
  for (const tagId of changes.addTags) line(`add:${tagId}`, `Added to ${tagName(tagId)}`);
  for (const tagId of changes.removeTags) line(`remove:${tagId}`, `Taken out of ${tagName(tagId)}`);
  return lines;
}

/**
 * "Female 4 · Male 2", dropping anything nobody is - and when everybody is
 * the same, just what they are: "Female" says it, where "Female 12" makes the
 * reader check the twelve against the heading.
 */
function counted(pairs: [string, number][]): string {
  const present = pairs.filter(([, n]) => n > 0);
  if (present.length === 1) return present[0][0];
  return present.map(([label, n]) => `${label} ${n}`).join(" · ");
}

/** "Siebert 3 · Seibert 1 · and 2 more", most common first. */
function distinct(values: string[], limit = 3): string {
  const tally = new Map<string, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  const sorted = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (sorted.length === 1) return `All ${sorted[0][0]}`;
  const shown = counted(sorted.slice(0, limit));
  return sorted.length > limit ? `${shown} · and ${sorted.length - limit} more` : shown;
}

/**
 * How the people chosen stand now, field by field, in a line each.
 *
 * Twelve records cannot be shown in one form, so each field says what they
 * come to between them instead - which is the thing worth knowing before
 * changing it. "Female 4 · Not said 8" is the difference between setting a
 * gender and overwriting four.
 */
export function describeNow(
  people: readonly PersonRow[],
  context: BulkContext,
): Record<
  | "lastName"
  | "gender"
  | "phone"
  | "email"
  | "birthday"
  | "photoFit"
  | "family"
  | "role"
  | "address"
  | "notes"
  | "printed"
  | "check",
  string
> {
  const count = (test: (person: PersonRow) => boolean) => people.filter(test).length;
  const inFamily = people.filter((person) => person.household_id);
  const families = new Set(inFamily.map((person) => person.household_id));
  const onlyFamily =
    families.size === 1 && inFamily.length === people.length
      ? context.householdById.get(inFamily[0].household_id ?? "")
      : undefined;
  const withPhoto = count((person) => Boolean(person.photo_path));

  const has = (key: "phone" | "email", label: string) => {
    const values = people.map((person) => person[key]?.trim() ?? "");
    const set = values.filter(Boolean);
    if (!set.length) return "Nobody has one";
    if (set.length === people.length && new Set(set).size === 1)
      return `All ${key === "phone" ? formatPhone(set[0]) : set[0]}`;
    if (set.length === people.length) return "All have one";
    return counted([
      [label, set.length],
      ["Without", people.length - set.length],
    ]);
  };

  return {
    lastName: distinct(people.map((person) => person.last_name.trim() || "(none)")),
    gender: counted([
      ["Female", count((person) => person.gender === "female")],
      ["Male", count((person) => person.gender === "male")],
      ["Not said", count((person) => !person.gender)],
    ]),
    phone: has("phone", "With a number"),
    email: has("email", "With an email"),
    birthday: counted([
      ["With the year", count((person) => hasYear(person.date_of_birth))],
      [
        "Without the year",
        count((person) => Boolean(person.date_of_birth) && !hasYear(person.date_of_birth)),
      ],
      ["None", count((person) => !person.date_of_birth)],
    ]),
    photoFit: withPhoto
      ? `${withPhoto} of them ${withPhoto === 1 ? "has a photo" : "have photos"} of their own`
      : "None has a photo of their own, so this changes nobody",
    family: onlyFamily
      ? `All in ${labelledHouseholdName(onlyFamily)}`
      : counted([
          ["In a family", inFamily.length],
          ["On their own", people.length - inFamily.length],
        ]),
    role: inFamily.length
      ? counted(
          HOUSEHOLD_ROLES.map((role): [string, number] => [
            role.label,
            inFamily.filter((person) => (person.household_role ?? "other") === role.value).length,
          ]),
        )
      : "None of them is in a family",
    address: counted([
      [
        "The family's",
        count((person) => Boolean(person.household_id) && person.use_household_address),
      ],
      [
        "Their own",
        count(
          (person) =>
            !(person.household_id && person.use_household_address) &&
            addressLines(person).length > 0,
        ),
      ],
      [
        "None",
        count(
          (person) =>
            !(person.household_id && person.use_household_address) &&
            addressLines(person).length === 0,
        ),
      ],
    ]),
    notes: counted([
      ["With notes", count((person) => Boolean(person.notes?.trim()))],
      ["None", count((person) => !person.notes?.trim())],
    ]),
    printed: counted([
      ["Included", count((person) => person.is_active)],
      ["Left out", count((person) => !person.is_active)],
    ]),
    check: counted([
      [
        "Recorded",
        count((person) => Boolean(person.background_check_on || person.background_check_due)),
      ],
      ["None", count((person) => !person.background_check_on && !person.background_check_due)],
    ]),
  };
}
