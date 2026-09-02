import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { Avatar, EmptyState, LoadingScreen, Notice, TagPill } from "@/components/ui";
import { addressLines, alphaBucket, firstName, formatPhone, sortKey } from "@/lib/format";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function FamiliesPage() {
  const { households, tags, membersOf, tagsOfHousehold, loading, error } = useDirectory();
  const { canEdit } = useAuth();
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string | null>(null);

  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const filtered = useMemo(() => {
    const needle = sortKey(query);
    return households.filter((household) => {
      if (letter && alphaBucket(sortKey(household.sort_name)) !== letter) return false;
      if (!needle) return true;
      const haystack = sortKey(
        household.display_name,
        household.sort_name,
        household.city,
        household.address_line1,
        ...membersOf(household.id).map((member) => `${member.first_name} ${member.last_name}`),
      );
      return haystack.includes(needle);
    });
  }, [households, letter, query, membersOf]);

  const usedLetters = useMemo(
    () => new Set(households.map((household) => alphaBucket(sortKey(household.sort_name)))),
    [households],
  );

  if (loading && !households.length) return <LoadingScreen label="Loading families…" />;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Families</h1>
          <div className="sub">
            Each family prints as one record, with everyone who lives there listed on the card.
          </div>
        </div>
        {canEdit ? (
          <Link className="btn primary" to="/families/new">
            Add a family
          </Link>
        ) : null}
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search families, members, streets…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="muted small">
          {filtered.length === households.length
            ? `${households.length} families`
            : `${filtered.length} of ${households.length}`}
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
          <table>
            <thead>
              <tr>
                <th style={{ width: 56 }}></th>
                <th>Family</th>
                <th>Members</th>
                <th>Address</th>
                <th>Phone</th>
                <th>Groups</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((household) => {
                const members = membersOf(household.id);
                const address = addressLines(household);
                return (
                  <tr key={household.id}>
                    <td>
                      <Avatar path={household.photo_path} initials={household.sort_name} />
                    </td>
                    <td>
                      <Link className="list-link" to={`/families/${household.id}`}>
                        {household.display_name}
                      </Link>
                      {!household.is_active ? (
                        <span className="pill" style={{ marginLeft: 6 }}>
                          Archived
                        </span>
                      ) : null}
                    </td>
                    <td className="small muted">
                      {members.length
                        ? members.map((member) => firstName(member)).join(", ")
                        : "No members yet"}
                    </td>
                    <td className="small muted">{address[0] ?? "—"}</td>
                    <td className="small muted nowrap">{formatPhone(household.phone) || "—"}</td>
                    <td>
                      <span className="row tight">
                        {tagsOfHousehold(household.id).map((tagId) => {
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
            title={households.length ? "Nothing matches" : "No families yet"}
            action={
              canEdit && !households.length ? (
                <Link className="btn primary" to="/families/new">
                  Add a family
                </Link>
              ) : null
            }
          >
            {households.length
              ? "Try a different search, or clear the letter filter."
              : "A family groups everyone at one address onto a single card in the printed book."}
          </EmptyState>
        )}
      </div>
    </div>
  );
}
