import { Link } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { EmptyState, LoadingScreen, Notice } from "@/components/ui";
import { firstName, formatMonthDay, fullName, monthDayOrder } from "@/lib/format";
import type { PersonRow } from "@/lib/database.types";

function Stat({ value, label, to }: { value: number | string; label: string; to?: string }) {
  const body = (
    <div className="card stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
  return to ? (
    <Link to={to} style={{ textDecoration: "none", color: "inherit" }}>
      {body}
    </Link>
  ) : (
    body
  );
}

/** The next handful of birthdays, wrapping around the end of the year. */
function upcoming(people: PersonRow[], field: "date_of_birth" | "anniversary", limit = 6) {
  const today = new Date();
  const cursor = (today.getMonth() + 1) * 100 + today.getDate();

  return people
    .filter((person) => person[field])
    .map((person) => ({ person, order: monthDayOrder(person[field]) }))
    .sort((a, b) => {
      const aKey = a.order >= cursor ? a.order : a.order + 10000;
      const bKey = b.order >= cursor ? b.order : b.order + 10000;
      return aKey - bKey;
    })
    .slice(0, limit);
}

export function OverviewPage() {
  const { households, people, tags, entries, loading, error } = useDirectory();
  const { profile, canEdit } = useAuth();

  if (loading && !people.length) return <LoadingScreen label="Loading the directory…" />;

  const individuals = people.filter((person) => !person.household_id);

  // Counted off the entries the book is actually built from, not off the raw
  // tables. households and people here are every row, archived and inactive
  // included, so the old sentence promised families that will not print and
  // missed a member of an archived family who now prints on their own - three
  // numbers that did not add up to each other.
  const printedFamilies = entries.filter((entry) => entry.type === "household").length;
  const printedIndividuals = entries.length - printedFamilies;
  const withoutPhoto = entries.filter((entry) =>
    entry.type === "household" ? !entry.household.photo_path : !entry.person.photo_path,
  ).length;

  const birthdays = upcoming(people, "date_of_birth");

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Good to see you, {profile?.full_name?.split(" ")[0] || "friend"}</h1>
          <div className="sub">
            {entries.length} records will print in the directory — {printedFamilies} families and{" "}
            {printedIndividuals} individuals.
          </div>
        </div>
        {canEdit ? (
          <div className="row tight">
            <Link className="btn" to="/people/new">
              Add a person
            </Link>
            <Link className="btn primary" to="/families/new">
              Add a family
            </Link>
          </div>
        ) : null}
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      {!entries.length ? (
        <div className="card">
          <EmptyState
            title="Nothing in the directory yet"
            action={
              canEdit ? (
                <div className="row tight" style={{ justifyContent: "center" }}>
                  <Link className="btn primary" to="/families/new">
                    Add your first family
                  </Link>
                  <Link className="btn" to="/people/new">
                    Add one person
                  </Link>
                </div>
              ) : null
            }
          >
            Start with a family — you can add everyone who lives at the same address in one go.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid three" style={{ marginBottom: 20 }}>
            <Stat value={entries.length} label="Printable records" to="/projects" />
            <Stat value={people.length} label="People" to="/people" />
            <Stat value={households.length} label="Families" to="/families" />
            <Stat value={tags.length} label="Groups" to="/groups" />
          </div>

          <div className="grid two">
            <div className="card">
              <div className="card-head">
                <h2>Next birthdays</h2>
              </div>
              <div className="card-body tight">
                {birthdays.length ? (
                  <table>
                    <tbody>
                      {birthdays.map(({ person }) => (
                        <tr key={person.id}>
                          <td>
                            <Link className="list-link" to={`/people/${person.id}`}>
                              {fullName(person)}
                            </Link>
                          </td>
                          <td className="num muted nowrap">
                            {formatMonthDay(person.date_of_birth)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted small" style={{ padding: 8 }}>
                    No birthdays recorded yet. They are optional, and they can be printed in the
                    directory or kept just for your own reference.
                  </p>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Worth a look</h2>
              </div>
              <div className="card-body">
                {withoutPhoto > 0 ? (
                  <p className="small">
                    <strong>{withoutPhoto}</strong> of {entries.length} records have no photo yet.
                    They will print with initials in a soft box, which looks perfectly tidy — but a
                    photo day after a service is the usual way to close the gap.
                  </p>
                ) : (
                  <p className="small">Every record has a photo. The book will look great.</p>
                )}

                {people.some((person) => !person.phone && !person.email) ? (
                  <p className="small">
                    Some people have neither a phone number nor an email address. A record with no
                    way to reach anyone still prints, but it is worth a check.
                  </p>
                ) : null}

                <p className="small muted" style={{ marginTop: 10 }}>
                  When you are ready to print, go to <Link to="/projects">Directories</Link> and
                  create one. The main book is six records to a sheet of paper.
                </p>
              </div>
            </div>
          </div>

          {individuals.length ? (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-head">
                <h2>Listed on their own</h2>
                <span className="muted small">
                  These people are not part of a family, so each prints as their own record.
                </span>
              </div>
              <div className="card-body tight">
                <div className="row tight">
                  {individuals.slice(0, 24).map((person) => (
                    <Link key={person.id} className="pill" to={`/people/${person.id}`}>
                      {firstName(person)} {person.last_name}
                    </Link>
                  ))}
                  {individuals.length > 24 ? (
                    <Link className="pill" to="/people">
                      +{individuals.length - 24} more
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
