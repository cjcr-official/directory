import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { Avatar, EmptyState, LoadingScreen, Notice, TagPill } from "@/components/ui";
import { ColumnPicker } from "@/components/ColumnPicker";
import { readColumns, rememberColumns } from "@/lib/columns";
import type { HouseholdRow, PersonRow, TagRow } from "@/lib/database.types";
import {
  alphaBucket,
  fileAsName,
  formatPhone,
  formatShortDate,
  labelledHouseholdName,
  personPhotoPath,
  sortKey,
} from "@/lib/format";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

type ColumnKey = "family" | "phone" | "email" | "birthday" | "groups";

/** What a cell needs beyond the person it is drawn for. */
interface Cells {
  household: HouseholdRow | null;
  /**
   * A function rather than a list: resolving every group on every person is
   * work worth not doing when the column that shows them is switched off.
   */
  tagsOf: () => TagRow[];
}

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
    key: "family",
    label: "Family",
    width: "c-wide",
    cellClass: "small",
    onPhone: true,
    cell: (_person, { household }) =>
      household ? (
        <Link className="list-link" to={`/families/${household.id}`}>
          {labelledHouseholdName(household)}
        </Link>
      ) : (
        <span className="muted">On their own</span>
      ),
  },
  {
    key: "phone",
    label: "Phone",
    width: "c-narrow",
    cellClass: "small muted nowrap",
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
    key: "birthday",
    label: "Birthday",
    width: "c-tiny",
    cellClass: "small muted nowrap",
    cell: (person) => formatShortDate(person.date_of_birth) || "—",
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

export function PeoplePage() {
  const { people, tags, householdById, tagsOfPerson, loading, error } = useDirectory();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "unattached">("all");
  const [shown, setShown] = useState(() => readColumns("people", KEYS));

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

      <div className="card">
        {filtered.length ? (
          <table className="list-table grid-table">
            {/* The column widths live here rather than in the cells, so the
                grid is one thing to read and one thing to change. Whichever
                column ends up last takes the slack, because a fixed table with
                nowhere to put it shares the slack out across every column
                instead - which would quietly make the portrait twice the width
                of a portrait the moment somebody switched the groups off. */}
            <colgroup>
              <col className="c-portrait" />
              <col className={visible.length ? "c-wide" : "c-rest"} />
              {visible.map((column, index) => (
                <col
                  key={column.key}
                  className={index === visible.length - 1 ? "c-rest" : column.width}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: 56 }}></th>
                <th>Name</th>
                {visible.map((column) => (
                  <th key={column.key} className={column.onPhone ? "" : "hide-sm"}>
                    {column.label}
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
