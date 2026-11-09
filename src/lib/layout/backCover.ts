/**
 * The back cover: the church's name, when the office is open, who works
 * there and how to reach them, the mark, a line the church is known by, and a
 * QR code for its website.
 *
 * Stored with the rest of the directory's settings, like the leadership page,
 * and filled the same way: a staff entry is a role and the people in it,
 * picked from the directory - so a name changed on somebody's record is
 * changed here too - followed by whatever lines go under them, an email
 * address, a phone number, the days they are in.
 */
import {
  currentLeadership,
  normalizeLeaders,
  type Leader,
  type LeaderGroup,
  type NamedPerson,
} from "./leadership";
import { formatPhone } from "../format";

/** One person, or several sharing a role, and how to reach them. */
export interface StaffEntry {
  id: string;
  /** "Senior Pastor", "Office Assistants". */
  role: string;
  people: Leader[];
  /** Printed one under another beneath the name: email, phone. */
  lines: string;
  /**
   * When they are in - "Monday – Thursday" - printed under the lines above.
   * Its own box so that filling the lines from somebody's record, which
   * replaces them, leaves the days alone.
   */
  hours: string;
}

/** Far more staff than a back cover has room for. */
export const STAFF_MAX = 12;
const TEXT_MAX = 120;
const LINES_MAX = 400;
/** The largest QR code there is is 177 modules square. */
const QR_MAX = 177;

export function newStaffId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Whatever was stored, as staff entries the composer and the editor can trust. */
export function normalizeStaff(raw: unknown): StaffEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const staff: StaffEntry[] = [];
  for (const item of raw.slice(0, STAFF_MAX)) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    let id = typeof source.id === "string" && source.id ? source.id.slice(0, 40) : newStaffId();
    while (seen.has(id)) id = newStaffId();
    seen.add(id);
    staff.push({
      id,
      role: typeof source.role === "string" ? source.role.slice(0, TEXT_MAX) : "",
      people: normalizeLeaders(source.people),
      lines: typeof source.lines === "string" ? source.lines.slice(0, LINES_MAX) : "",
      hours: typeof source.hours === "string" ? source.hours.slice(0, TEXT_MAX) : "",
    });
  }
  return staff;
}

/**
 * A QR code as stored: rows of "1" and "0", every row as long as there are
 * rows. Anything else is no QR code at all rather than a wrong one - a code
 * that scans to the wrong place is worse than none.
 */
export function normalizeQr(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length < 21 || raw.length > QR_MAX) return [];
  const size = raw.length;
  for (const row of raw) {
    if (typeof row !== "string" || row.length !== size || !/^[01]+$/.test(row)) return [];
  }
  return raw as string[];
}

/** The staff with every picked person's and group's name as the directory has it now. */
export function currentStaff(
  staff: StaffEntry[],
  personById: ReadonlyMap<string, NamedPerson>,
  groups: ReadonlyMap<string, LeaderGroup>,
): StaffEntry[] {
  const asSections = staff.map((entry) => ({
    id: entry.id,
    title: "",
    groupId: null,
    groupName: "",
    people: entry.people,
  }));
  const fresh = currentLeadership(asSections, personById, groups);
  if (fresh === asSections) return staff;
  return staff.map((entry, i) =>
    fresh[i] === asSections[i] ? entry : { ...entry, people: fresh[i].people },
  );
}

/**
 * How one entry prints: the name line and the lines under it.
 *
 * One person and a role read as one line, "Jason Siebert, Senior Pastor".
 * Two or more share the role on a line of its own beneath them - "Anne
 * Siebert & Melissa Bishop", then "Office Assistants" - because a role
 * tacked onto the end of two names reads as belonging to the second.
 */
export function staffLines(entry: StaffEntry): { strong: string[]; plain: string[] } {
  const names = entry.people.map((leader) => leader.name.trim()).filter(Boolean);
  const role = entry.role.trim();
  const joined =
    names.length < 2
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  const strong =
    names.length === 0
      ? role
        ? [role]
        : []
      : names.length === 1
        ? [role ? `${joined}, ${role}` : joined]
        : role
          ? [joined, role]
          : [joined];
  const plain = `${entry.lines}\n${entry.hours}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { strong, plain };
}

/**
 * What goes under a member of staff's name when they are picked: their email
 * and their phone number, as the directory has them.
 *
 * Their own where they have one, and the family's where they have not - the
 * same fall-back the directory's cards make, since the house number is very
 * often only typed against the house. Written into the box rather than kept
 * live, because a church's office address is usually not the one on the
 * pastor's own record, and what is typed over it has to stay typed.
 */
export function contactLines(
  person: { email: string | null; phone: string | null },
  household?: { email: string | null; phone: string | null } | null,
): string {
  const email = person.email?.trim() || household?.email?.trim() || "";
  const phone = formatPhone(person.phone?.trim() || household?.phone?.trim() || "");
  return [email, phone].filter(Boolean).join("\n");
}
