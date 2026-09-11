/**
 * When a person's background check was done, and when the next one is due.
 *
 * Anyone who works with children or handles money gets one, and a check has a
 * shelf life: churches renew every two or three years, and the day somebody
 * notices a lapse is usually the day something has already gone wrong. The
 * directory already knows who everybody is, so the reminder belongs here
 * rather than on a spreadsheet beside it that nobody opens.
 *
 * Everything below is a question about two dates on a record and today's date,
 * with no clock beyond the day and no database at all - which is what lets the
 * whole of it be put to `npm run checks`.
 *
 * Dates, not instants. A check was done on a day and is due on a day, and both
 * are stored as bare YYYY-MM-DD, so every comparison here is in whole days and
 * the person reading the screen is in the timezone that decides which day it
 * is. Parsing those strings through `new Date()` would put them at UTC
 * midnight and quietly move them a day west of Greenwich - which for a
 * boundary this file exists to draw is the difference between "due today" and
 * "overdue".
 */

import { formatFullDate, parseDateParts } from "./format";

/**
 * How long a check is treated as good for, where the app suggests a date.
 *
 * Only ever a suggestion, and only on the form. What a check is actually worth
 * depends on the state, the agency, and sometimes the role - a church can want
 * the nursery renewed yearly - so the due date is stored rather than worked
 * out, and this is the number the form starts it at.
 */
export const RENEWAL_YEARS = 3;

/**
 * How far ahead "due soon" looks.
 *
 * Two months, because that is roughly how long a renewal takes to actually
 * happen: the person has to be asked, the form has to be filled in, and an
 * agency has to answer. A week's warning would be a notice that a check is
 * about to lapse rather than one that it can still be renewed in time.
 */
export const DUE_SOON_DAYS = 60;

/**
 * The part of a person this file reasons about.
 *
 * Narrower than PersonRow on purpose, exactly as notifications.ts is: what
 * follows is about two dates, so a test can put two dates to it rather than
 * inventing a congregation. Both optional, because a database that has not run
 * migration 0009 returns rows without the columns at all, and a record with no
 * dates on it is the ordinary case here rather than an error.
 */
export interface Checked {
  background_check_on?: string | null;
  background_check_due?: string | null;
}

/**
 * Where a person stands.
 *
 * "untracked" is the one worth spelling out: it is not a person who is clear
 * and not a person who is overdue, it is a person nobody has ever recorded a
 * check for - which is most of a congregation, since a directory is not a
 * staff register. Treating those as overdue would put four hundred names
 * behind the bell on the first afternoon and teach the office to ignore it.
 */
export type CheckState = "untracked" | "clear" | "due-soon" | "overdue";

const MS_PER_DAY = 86_400_000;

/**
 * A bare date as a day number, or null for anything that is not one.
 *
 * Counted in UTC, which is not a claim about anybody's timezone: it is the one
 * calendar with no daylight saving in it, so subtracting two of these gives
 * whole days rather than a day and an hour twice a year.
 */
function dayNumber(iso: string | null | undefined): number | null {
  const parts = parseDateParts(iso);
  if (!parts) return null;
  const ms = Date.UTC(parts.year, parts.month - 1, parts.day);
  return Number.isNaN(ms) ? null : Math.round(ms / MS_PER_DAY);
}

/**
 * Today, on the same scale.
 *
 * Read off the local calendar fields rather than off the timestamp, so "today"
 * is the day it is in the room where somebody is looking at the screen. A
 * church in Ohio opening the app at nine in the evening is still on today's
 * date, and a check due tomorrow should not already be reading as due today
 * because Greenwich has turned over.
 */
function todayNumber(now: Date): number {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY);
}

/**
 * Days from today until a due date: negative once it has passed, zero on the
 * day itself, and null where there is no readable date to count to.
 */
export function daysUntilDue(person: Checked, now = new Date()): number | null {
  const due = dayNumber(person.background_check_due);
  return due === null ? null : due - todayNumber(now);
}

export function checkState(person: Checked, now = new Date()): CheckState {
  const days = daysUntilDue(person, now);
  if (days === null) return "untracked";
  if (days < 0) return "overdue";
  return days <= DUE_SOON_DAYS ? "due-soon" : "clear";
}

/** Whether this is a person the app should be saying something about. */
export function wantsAttention(person: Checked, now = new Date()): boolean {
  const state = checkState(person, now);
  return state === "overdue" || state === "due-soon";
}

/**
 * A stretch of days as an office would say it: one unit, and never "0 days".
 *
 * Days, then weeks, then months, then years, each taking over where the one
 * before it stops being a number anybody converts. The last step matters more
 * than it looks: a check nobody has renewed since the last minister is three
 * years overdue, and "36 months" is that same fact said in a way that has to
 * be worked out before it lands. Years only from two, so no count is ever
 * rounded into overstating how long something has been left.
 */
function countWords(days: number): string {
  if (days < 14) return days === 1 ? "1 day" : `${days} days`;
  if (days < 70) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? "1 week" : `${weeks} weeks`;
  }
  if (days < 730) {
    const months = Math.round(days / 30.44);
    return months === 1 ? "1 month" : `${months} months`;
  }
  const years = Math.round(days / 365.25);
  return `${years} years`;
}

/**
 * The one line that says where a check stands.
 *
 * Overdue is counted rather than dated - "Overdue by 5 months" is the sentence
 * that gets a renewal booked, where "was due on 3 March" leaves the reader
 * doing the subtraction. Coming up is counted too, while it is close enough
 * for the number to mean anything; further out than that the date itself is
 * the useful fact, since nobody is doing anything about it this month.
 *
 * Empty for a person with no due date, which is not a status to report but the
 * absence of one - the caller says "not recorded" in its own words, or says
 * nothing at all.
 */
export function describeDue(person: Checked, now = new Date()): string {
  const days = daysUntilDue(person, now);
  if (days === null) return "";
  if (days < 0) return `Overdue by ${countWords(-days)}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= DUE_SOON_DAYS) return `Due in ${countWords(days)}`;
  return `Due ${formatFullDate(person.background_check_due)}`;
}

/**
 * Everyone whose check is due or has lapsed, the most overdue first.
 *
 * Sorted by the due date rather than by name: this is a list to work down, and
 * the top of it is the one that has been waiting longest. A record with no
 * readable due date is left out rather than sorted to one end, where it would
 * either sit permanently at the top or be counted for ever - the same
 * treatment an undateable arrival gets in notifications.ts.
 *
 * Who is *in* the list is the caller's business. This says nothing about
 * archived records, because whether a record set aside from the book should
 * still be nagged about is a decision for the screen doing the nagging.
 */
export function needingAttention<T extends Checked>(people: readonly T[], now = new Date()): T[] {
  return people
    .map((person) => ({ person, days: daysUntilDue(person, now) }))
    .filter(
      (dated): dated is { person: T; days: number } =>
        dated.days !== null && dated.days <= DUE_SOON_DAYS,
    )
    .sort((a, b) => a.days - b.days)
    .map((dated) => dated.person);
}

/**
 * Three years on from the day a check was done, as a date to suggest.
 *
 * A check done on 29 February has no anniversary in three years' time, so it
 * lands on the 28th rather than rolling forward into March: a renewal date
 * inside the month it was expected in is what somebody would have written.
 * Null in, null out - there is nothing to count from.
 */
export function suggestDue(
  doneOn: string | null | undefined,
  years = RENEWAL_YEARS,
): string | null {
  const parts = parseDateParts(doneOn);
  if (!parts) return null;

  const year = parts.year + years;
  const lastOfMonth = new Date(Date.UTC(year, parts.month, 0)).getUTCDate();
  const day = Math.min(parts.day, lastOfMonth);

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(parts.month)}-${pad(day)}`;
}
