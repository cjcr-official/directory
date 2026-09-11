import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { Avatar, EmptyState, LoadingScreen, Notice, TagPill } from "@/components/ui";
import { ColumnPicker } from "@/components/ColumnPicker";
import { readColumns, readWidths, rememberColumns, rememberWidths } from "@/lib/columns";
import type { Gender, HouseholdRow, PersonRow, TagRow } from "@/lib/database.types";
import {
  addressLines,
  alphaBucket,
  effectiveAddress,
  fileAsName,
  formatPhone,
  formatShortDate,
  labelledHouseholdName,
  personPhotoPath,
  sortKey,
} from "@/lib/format";
import { checkState, describeDue } from "@/lib/backgroundChecks";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/* Not format.ts's HOUSEHOLD_ROLES: "Head of household" and "Spouse / partner"
   are labels for a form, not for a column eight characters wide. */
const ROLES: Record<string, string> = {
  head: "Head",
  spouse: "Spouse",
  child: "Child",
  other: "Other",
};

const GENDERS: Record<Gender, string> = { female: "Female", male: "Male" };

type ColumnKey =
  | "family"
  | "role"
  | "phone"
  | "email"
  | "address"
  | "birthday"
  | "anniversary"
  | "gender"
  | "check"
  | "notes"
  | "groups";

/** What a cell needs beyond the person it is drawn for. */
interface Cells {
  household: HouseholdRow | null;
  /**
   * A function rather than a list: resolving every group on every person is
   * work worth not doing when the column that shows them is switched off.
   */
  tagsOf: () => TagRow[];
}

/*
 * What each share of the grid comes to in pixels, near enough.
 *
 * Only ever used to work out how narrow the table is allowed to get before it
 * scrolls instead of squeezing. The percentages in the stylesheet still do the
 * dividing up; this is the floor under them, because ten columns sharing 100%
 * of a laptop is ten columns none of which can be read.
 */
const FLOORS: Record<string, number> = {
  "c-portrait": 58,
  "c-wide": 190,
  "c-mid": 150,
  "c-narrow": 105,
  "c-tiny": 78,
  "c-rest": 120,
};

/**
 * The columns somebody can switch off, in the order they read in.
 *
 * The portrait and the name are not among them. A table of people with the
 * people taken out of it is nothing, and the portrait is the column a phone
 * reads the whole list from - so neither is a choice worth offering.
 */
const COLUMNS: {
  key: ColumnKey;
  label: string;
  /** Its share of the fixed grid, unless it lands last - see the colgroup. */
  width: string;
  cellClass: string;
  /** Set on the one column a phone draws too, as the line under the name. */
  onPhone?: true;
  cell: (person: PersonRow, cells: Cells) => ReactNode;
}[] = [
  {
    /*
     * The family a person belongs to, said and not linked.
     *
     * It was a link, and on a phone it is the whole second line of the row -
     * so the largest thing to aim at in a list of people took you to a family.
     * Somebody scrolling for Case Johnston and tapping the name they can see
     * landed on the Johnston family instead, which is the one place on this
     * screen nobody was going.
     *
     * A family is opened from Families, where every row is one. Here it is a
     * fact about the person, like their role or their phone number, and the
     * row belongs to the person whose row it is.
     */
    key: "family",
    label: "Family",
    width: "c-wide",
    cellClass: "small",
    onPhone: true,
    cell: (_person, { household }) =>
      household ? (
        <span>{labelledHouseholdName(household)}</span>
      ) : (
        <span className="muted">On their own</span>
      ),
  },
  {
    key: "role",
    label: "Role",
    width: "c-narrow",
    cellClass: "small muted",
    cell: (person) => ROLES[person.household_role ?? ""] ?? "—",
  },
  {
    key: "phone",
    label: "Phone",
    width: "c-narrow",
    cellClass: "small muted",
    cell: (person) => formatPhone(person.phone) || "—",
  },
  {
    key: "email",
    label: "Email",
    width: "c-mid",
    cellClass: "small muted",
    cell: (person) => person.email || "—",
  },
  {
    // The first line only, as on Families: the rest is a second line the row
    // has no height for, and the whole address is one tap away.
    key: "address",
    label: "Address",
    width: "c-mid",
    cellClass: "small muted",
    cell: (person, { household }) => addressLines(effectiveAddress(person, household))[0] ?? "—",
  },
  {
    key: "birthday",
    label: "Birthday",
    width: "c-tiny",
    cellClass: "small muted",
    cell: (person) => formatShortDate(person.date_of_birth) || "—",
  },
  {
    key: "anniversary",
    label: "Anniversary",
    width: "c-tiny",
    cellClass: "small muted",
    cell: (person) => formatShortDate(person.anniversary) || "—",
  },
  {
    key: "gender",
    label: "Gender",
    width: "c-tiny",
    cellClass: "small muted",
    cell: (person) => (person.gender ? GENDERS[person.gender] : "—"),
  },
  {
    /*
     * The sentence the tray says, in the words the tray says it in - because
     * a table that dates a check and a bell that counts the days from it are
     * the same fact, and reading them differently is how somebody comes to
     * believe neither.
     *
     * A pill and a date read better here and would not fit: together they are
     * two lines in a 150px cell, which made the two rows that matter the two
     * tallest rows in the table. Colour does the flagging instead, and it is
     * never the only thing doing it - "Overdue by 3 weeks" says so in words.
     */
    key: "check",
    label: "Background check",
    width: "c-wide",
    cellClass: "small muted",
    cell: (person) => {
      const state = checkState(person);
      if (state === "untracked") return "—";
      const flag = state === "overdue" ? "due-note late" : state === "due-soon" ? "due-note" : "";
      return <span className={flag}>{describeDue(person)}</span>;
    },
  },
  {
    key: "notes",
    label: "Notes",
    width: "c-mid",
    cellClass: "small muted",
    cell: (person) => person.notes || "—",
  },
  {
    key: "groups",
    label: "Groups",
    width: "c-wide",
    cellClass: "",
    cell: (_person, { tagsOf }) => (
      <span className="row tight">
        {tagsOf().map((tag) => (
          <TagPill key={tag.id} name={tag.name} color={tag.color} />
        ))}
      </span>
    ),
  },
];

const KEYS = COLUMNS.map((column) => column.key);

/** Narrower than this and a column is a sliver nobody can grab hold of again. */
const MIN_WIDTH = 56;

/**
 * The strip down the right-hand edge of a heading that widens its column.
 *
 * Pointer capture rather than listeners on the document: the browser keeps
 * sending the moves here even once the pointer has left the nine pixels this
 * is, so there is nothing to attach, nothing to tear down, and no way to leave
 * a stray handler behind if the table re-renders mid-drag. It is also what
 * makes this work with a finger and a stylus for free.
 *
 * There is none on the last column. That one is auto - it exists to soak up
 * whatever the others leave - so dragging it would be a handle attached to
 * nothing.
 */
function Grip({ onDrag }: { onDrag: (width: number) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);

  return (
    <span
      className="col-grip"
      onPointerDown={(event) => {
        // Or the drag selects the heading text under it instead.
        event.preventDefault();
        const cell = event.currentTarget.parentElement;
        if (!cell) return;
        start.current = { x: event.clientX, width: cell.getBoundingClientRect().width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        onDrag(Math.max(MIN_WIDTH, start.current.width + event.clientX - start.current.x));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
    />
  );
}

export function PeoplePage() {
  const { people, tags, householdById, tagsOfPerson, loading, error } = useDirectory();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "unattached">("all");
  const [shown, setShown] = useState(() => readColumns("people", KEYS));
  const [widths, setWidths] = useState(() => readWidths("people"));

  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const filtered = useMemo(() => {
    const needle = sortKey(query);
    return people.filter((person) => {
      if (scope === "unattached" && person.household_id) return false;
      if (letter && alphaBucket(sortKey(person.last_name)) !== letter) return false;
      if (!needle) return true;
      return sortKey(
        person.first_name,
        person.preferred_name,
        person.last_name,
        person.email,
        person.phone,
      ).includes(needle);
    });
  }, [people, query, letter, scope]);

  const usedLetters = useMemo(
    () => new Set(people.map((person) => alphaBucket(sortKey(person.last_name)))),
    [people],
  );

  const visible = COLUMNS.filter((column) => shown.includes(column.key));

  /*
   * The grid, after the portrait: the name, then whatever is switched on.
   *
   * In pixels, not in the stylesheet's percentages. Ten columns' worth of
   * those add up to a hundred and twenty per cent, and a fixed table given
   * more than it has scales every column down to fit and leaves the last one -
   * the auto one, the one that is meant to take the slack - exactly nothing.
   * Groups simply was not drawn. Pixels here, a floor under the table, and the
   * last column gets what is left over instead of what is left of nothing.
   */
  const grid = [
    { key: "name", width: "c-wide" },
    ...visible.map((column) => ({ key: column.key, width: column.width })),
  ];
  const widthOf = (key: string, share: string) => widths[key] ?? FLOORS[share] ?? 120;

  /* Every column but the last, which is auto and needs a floor of its own. */
  const leastWidth =
    FLOORS["c-portrait"] +
    FLOORS["c-rest"] +
    grid.slice(0, -1).reduce((total, column) => total + widthOf(column.key, column.width), 0);

  const drag = (key: string) => (width: number) => {
    const next = { ...widths, [key]: Math.round(width) };
    setWidths(next);
    rememberWidths("people", next);
  };

  if (loading && !people.length) return <LoadingScreen label="Loading people…" />;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>People</h1>
          <div className="sub">
            Everyone in the database. People who belong to a family print on that family's card.
          </div>
        </div>
        {canEdit ? (
          <Link className="btn primary" to="/people/new">
            Add a person
          </Link>
        ) : null}
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search by name, email or phone…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={scope}
          style={{ width: "auto" }}
          onChange={(event) => setScope(event.target.value as "all" | "unattached")}
        >
          <option value="all">Everyone</option>
          <option value="unattached">Not in a family</option>
        </select>
        <ColumnPicker
          columns={COLUMNS}
          shown={shown}
          onChange={(next) => {
            setShown(next);
            rememberColumns("people", next, KEYS);
          }}
        />
        <span className="muted small">
          {filtered.length === people.length
            ? `${people.length} people`
            : `${filtered.length} of ${people.length}`}
        </span>
      </div>

      <div className="letter-bar">
        <button
          type="button"
          className={letter === null ? "active" : ""}
          onClick={() => setLetter(null)}
        >
          All
        </button>
        {LETTERS.map((value) => (
          <button
            key={value}
            type="button"
            disabled={!usedLetters.has(value)}
            className={letter === value ? "active" : ""}
            onClick={() => setLetter(letter === value ? null : value)}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="card table-scroll">
        {filtered.length ? (
          <table
            className="list-table grid-table"
            /* A property rather than min-width itself, so the phone rules can
               drop it: down there the table is a stack of cards and a floor
               under its width would only give the card something to scroll
               sideways over. */
            style={{ "--least-width": `${leastWidth}px` } as CSSProperties}
          >
            {/* The column widths live here rather than in the cells, so the
                grid is one thing to read and one thing to change. Whichever
                column ends up last takes the slack, because a fixed table with
                nowhere to put it shares the slack out across every column
                instead - which would quietly make the portrait twice the width
                of a portrait the moment somebody switched the groups off. */}
            <colgroup>
              <col className="c-portrait" />
              {grid.map((column, index) =>
                index === grid.length - 1 ? (
                  <col key={column.key} className="c-rest" />
                ) : (
                  <col key={column.key} style={{ width: widthOf(column.key, column.width) }} />
                ),
              )}
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: 56 }}></th>
                <th>
                  Name
                  {visible.length ? <Grip onDrag={drag("name")} /> : null}
                </th>
                {visible.map((column, index) => (
                  <th key={column.key} className={column.onPhone ? "" : "hide-sm"}>
                    {column.label}
                    {index === visible.length - 1 ? null : <Grip onDrag={drag(column.key)} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((person) => {
                const household = person.household_id
                  ? (householdById.get(person.household_id) ?? null)
                  : null;
                const cells: Cells = {
                  household,
                  tagsOf: () => tagsOfPerson(person.id).flatMap((id) => tagsById.get(id) ?? []),
                };
                return (
                  <tr
                    key={person.id}
                    className="row-clickable"
                    onClick={(event) => {
                      // A click that landed on a link or a button is that
                      // control's click, not the row's.
                      if ((event.target as HTMLElement).closest("a, button")) return;
                      void navigate(`/people/${person.id}`);
                    }}
                  >
                    <td>
                      <Avatar
                        path={personPhotoPath(person, household)}
                        initials={`${person.first_name[0] ?? ""}${person.last_name[0] ?? ""}`}
                      />
                    </td>
                    <td>
                      <Link className="list-link" to={`/people/${person.id}`}>
                        {fileAsName(person)}
                      </Link>
                      {!person.is_active ? (
                        <span className="pill" style={{ marginLeft: 6 }}>
                          Archived
                        </span>
                      ) : null}
                    </td>
                    {visible.map((column) => (
                      <td
                        key={column.key}
                        className={`${column.cellClass}${column.onPhone ? "" : " hide-sm"}`}
                      >
                        {column.cell(person, cells)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title={people.length ? "Nothing matches" : "No people yet"}
            action={
              canEdit && !people.length ? (
                <Link className="btn primary" to="/people/new">
                  Add a person
                </Link>
              ) : null
            }
          >
            {people.length
              ? "Try a different search."
              : "Add people one at a time, or add a family and fill in its members."}
          </EmptyState>
        )}
      </div>
    </div>
  );
}
