import type { HouseholdRow, PersonRow, TagRow } from "./database.types";
import { suggestHouseholdName } from "./format";

/**
 * A believable congregation.
 *
 * Used by the in-app sample directory, by `npm run sample:pdf`, and by
 * `npm run seed`. It exists so the print format can be shown to a committee -
 * or checked after a layout change - before a single real address is typed in.
 *
 * Every name, address, phone number and email here is invented.
 */

const SURNAMES = [
  "Abernathy", "Alvarez", "Bennett", "Boateng", "Caldwell", "Chen", "Delgado",
  "Ellison", "Fitzgerald", "Gallagher", "Haddad", "Ibarra", "Johansson",
  "Kowalski", "Lindqvist", "Mahoney", "Nakamura", "Okonkwo", "Pemberton",
  "Quintero", "Ramirez", "Sandoval", "Thibodeaux", "Underwood", "Vasquez",
  "Whitaker", "Yamamoto", "Zielinski", "Ashford", "Brennan", "Castellanos",
  "Donnelly", "Eriksson", "Faulkner",
];

const MEN = [
  "Samuel", "Marcus", "Theodore", "Elias", "Jonah", "Desmond", "Nathaniel",
  "Isaac", "Gabriel", "Julian", "Everett", "Simon", "Adrian", "Malachi",
];
const WOMEN = [
  "Miriam", "Delphine", "Rosalind", "Naomi", "Priscilla", "Adaeze", "Genevieve",
  "Yuki", "Clara", "Imani", "Beatriz", "Susannah", "Lydia", "Antonia",
];
const CHILDREN = [
  "Ezra", "Ruby", "Silas", "Wren", "Amos", "Juniper", "Levi", "Hazel", "Rosie",
  "Micah", "Ivy", "Caleb", "Nora", "Tobias", "Freya", "Jonas",
];

const STREETS = [
  "Chapel Hill Road", "Sycamore Lane", "Orchard Street", "Meeting House Way",
  "Birchwood Drive", "Lantern Court", "Wheatfield Road", "Stonebridge Avenue",
  "Cedar Hollow Lane", "Harvest Ridge Road", "Bellamy Street", "Quarry Lane",
];

const CITIES: [string, string, string][] = [
  ["Fairhaven", "OH", "44092"],
  ["Millbrook", "OH", "44094"],
  ["Ashgrove", "OH", "44117"],
  ["Northfield", "OH", "44067"],
];

/** Deterministic pseudo-random so the demo book looks the same every run. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const TAG_NAMES: [string, string][] = [
  ["Choir", "#7c5cbf"],
  ["Youth Group", "#c2643a"],
  ["Deacons", "#2f6d63"],
  ["Sunday School", "#3f7cac"],
  ["Prayer Chain", "#a34f6f"],
];

export interface DemoData {
  households: HouseholdRow[];
  people: PersonRow[];
  tags: TagRow[];
  householdTags: { household_id: string; tag_id: string }[];
  personTags: { person_id: string; tag_id: string }[];
}

export function buildDemoData(householdCount = 34, individualCount = 9, seed = 20260401): DemoData {
  const random = makeRandom(seed);
  const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)];
  const chance = (probability: number) => random() < probability;
  const stamp = "2026-01-15T12:00:00.000Z";

  const tags: TagRow[] = TAG_NAMES.map(([name, color], i) => ({
    id: `tag-${i + 1}`,
    name,
    color,
    description: null,
    created_at: stamp,
  }));

  const households: HouseholdRow[] = [];
  const people: PersonRow[] = [];
  const householdTags: { household_id: string; tag_id: string }[] = [];
  const personTags: { person_id: string; tag_id: string }[] = [];

  const digits = () => String(Math.floor(random() * 9000) + 1000);
  const phone = () => `(216) 555-${digits().slice(0, 4)}`;
  const birthYear = (min: number, max: number) => min + Math.floor(random() * (max - min));
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = (year: number) =>
    `${year}-${pad(1 + Math.floor(random() * 12))}-${pad(1 + Math.floor(random() * 28))}`;

  let personId = 0;
  const nextPersonId = () => `person-${++personId}`;

  for (let i = 0; i < householdCount; i += 1) {
    const surname = SURNAMES[i % SURNAMES.length];
    const [city, state, postal] = pick(CITIES);
    const householdId = `household-${i + 1}`;
    const anniversaryYear = birthYear(1975, 2020);

    households.push({
      id: householdId,
      display_name: suggestHouseholdName(surname),
      sort_name: surname,
      address_line1: `${Math.floor(random() * 900) + 100} ${pick(STREETS)}`,
      address_line2: chance(0.12) ? `Apt ${Math.floor(random() * 30) + 1}` : null,
      city,
      state,
      postal_code: postal,
      country: null,
      phone: chance(0.85) ? phone() : null,
      email: chance(0.6) ? `${surname.toLowerCase()}.family@example.com` : null,
      anniversary: chance(0.75) ? date(anniversaryYear) : null,
      photo_path: `demo/${householdId}.png`,
      notes: null,
      is_active: true,
      created_at: stamp,
      updated_at: stamp,
    });

    if (chance(0.45)) {
      householdTags.push({ household_id: householdId, tag_id: pick(tags).id });
    }

    const head: PersonRow = blankPerson(nextPersonId(), stamp);
    head.household_id = householdId;
    head.household_role = "head";
    head.first_name = pick(chance(0.5) ? MEN : WOMEN);
    head.last_name = surname;
    head.email = chance(0.7) ? `${head.first_name.toLowerCase()}@example.com` : null;
    head.phone = chance(0.7) ? phone() : null;
    head.date_of_birth = date(birthYear(1948, 1992));
    head.sort_order = 0;
    people.push(head);

    const hasSpouse = chance(0.78);
    if (hasSpouse) {
      const spouse: PersonRow = blankPerson(nextPersonId(), stamp);
      spouse.household_id = householdId;
      spouse.household_role = "spouse";
      spouse.first_name = pick(MEN.includes(head.first_name) ? WOMEN : MEN);
      // A few households keep two surnames, which the card should show.
      spouse.last_name = chance(0.12) ? pick(SURNAMES) : surname;
      spouse.email = chance(0.55) ? `${spouse.first_name.toLowerCase()}@example.com` : null;
      spouse.phone = chance(0.5) ? phone() : null;
      spouse.date_of_birth = date(birthYear(1950, 1994));
      spouse.anniversary = households[i].anniversary;
      spouse.sort_order = 1;
      people.push(spouse);
    }

    const childCount = chance(0.55) ? 1 + Math.floor(random() * 3) : 0;
    const used = new Set<string>();
    for (let c = 0; c < childCount; c += 1) {
      let name = pick(CHILDREN);
      let guard = 0;
      while (used.has(name) && guard++ < 20) name = pick(CHILDREN);
      used.add(name);

      const child: PersonRow = blankPerson(nextPersonId(), stamp);
      child.household_id = householdId;
      child.household_role = "child";
      child.first_name = name;
      child.last_name = surname;
      child.date_of_birth = date(birthYear(2007, 2023));
      child.sort_order = 2 + c;
      people.push(child);

      if (chance(0.25)) {
        personTags.push({ person_id: child.id, tag_id: tags[1].id });
      }
    }
  }

  for (let i = 0; i < individualCount; i += 1) {
    const surname = SURNAMES[(householdCount + i) % SURNAMES.length];
    const [city, state, postal] = pick(CITIES);
    const person: PersonRow = blankPerson(nextPersonId(), stamp);
    person.first_name = pick(chance(0.5) ? WOMEN : MEN);
    person.last_name = surname;
    person.email = `${person.first_name.toLowerCase()}.${surname.toLowerCase()}@example.com`;
    person.phone = phone();
    person.date_of_birth = date(birthYear(1940, 2000));
    person.use_household_address = false;
    person.address_line1 = `${Math.floor(random() * 900) + 100} ${pick(STREETS)}`;
    person.city = city;
    person.state = state;
    person.postal_code = postal;
    person.photo_path = `demo/${person.id}.png`;
    people.push(person);

    if (chance(0.5)) personTags.push({ person_id: person.id, tag_id: pick(tags).id });
  }

  return { households, people, tags, householdTags, personTags };
}

function blankPerson(id: string, stamp: string): PersonRow {
  return {
    id,
    household_id: null,
    household_role: null,
    first_name: "",
    last_name: "",
    preferred_name: null,
    email: null,
    phone: null,
    date_of_birth: null,
    anniversary: null,
    use_household_address: true,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
    photo_path: null,
    notes: null,
    sort_order: 0,
    is_active: true,
    created_at: stamp,
    updated_at: stamp,
  };
}
