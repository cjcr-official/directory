import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { Avatar, EmptyState, LoadingScreen, Notice, TagPill } from "@/components/ui";
import {
  alphaBucket,
  fileAsName,
  formatPhone,
  formatShortDate,
  personPhotoPath,
  sortKey,
} from "@/lib/format";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function PeoplePage() {
  const { people, tags, householdById, tagsOfPerson, loading, error } = useDirectory();
  const { canEdit } = useAuth();
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "unattached">("all");

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
          <table className="list-table">
            <thead>
              <tr>
                <th style={{ width: 56 }}></th>
                <th>Name</th>
                <th>Family</th>
                <th className="hide-sm">Phone</th>
                <th className="hide-sm">Email</th>
                <th className="hide-sm">Birthday</th>
                <th className="hide-sm">Groups</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((person) => {
                const household = person.household_id
                  ? householdById.get(person.household_id)
                  : null;
                return (
                  <tr key={person.id}>
                    <td>
                      <Avatar
                        path={personPhotoPath(person, household)}
                        initials={`${person.first_name[0] ?? ""}${person.last_name[0] ?? ""}`}
                      />
                    </td>
                    <td>
                      <Link className="list-link row-link" to={`/people/${person.id}`}>
                        {fileAsName(person)}
                      </Link>
                      {!person.is_active ? (
                        <span className="pill" style={{ marginLeft: 6 }}>
                          Archived
                        </span>
                      ) : null}
                    </td>
                    <td className="small">
                      {household ? (
                        <Link className="list-link" to={`/families/${household.id}`}>
                          {household.display_name}
                        </Link>
                      ) : (
                        <span className="muted">On their own</span>
                      )}
                    </td>
                    <td className="small muted nowrap hide-sm">
                      {formatPhone(person.phone) || "—"}
                    </td>
                    <td className="small muted hide-sm">{person.email || "—"}</td>
                    <td className="small muted nowrap hide-sm">
                      {formatShortDate(person.date_of_birth) || "—"}
                    </td>
                    <td className="hide-sm">
                      <span className="row tight">
                        {tagsOfPerson(person.id).map((tagId) => {
                          const tag = tagsById.get(tagId);
                          return tag ? (
                            <TagPill key={tag.id} name={tag.name} color={tag.color} />
                          ) : null;
                        })}
                      </span>
                    </td>
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
