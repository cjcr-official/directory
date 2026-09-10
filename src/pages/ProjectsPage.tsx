import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Output } from "@/lib/layout/settings";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { EmptyState, LoadingScreen, Notice } from "@/components/ui";
import { fetchProjects } from "@/lib/queries";
import type { ProjectRow } from "@/lib/database.types";
import { TAG_SIZES, normalizeSettings, recordsPerSheet } from "@/lib/layout/settings";
import { tagsPerSheet } from "@/lib/layout/tags";
import { message } from "@/lib/format";

const WORDS = {
  book: {
    title: "Directories",
    sub: "Each one is a saved recipe for a printable book — who is in it, and how it looks. The data stays live, so reprinting next year is one click.",
    add: "New directory",
    empty: "No directories yet",
    first: "Create the main directory",
    loading: "Loading directories…",
  },
  tags: {
    title: "Name tags",
    sub: "A sheet of tags off the same list of people a directory prints from, cut apart for the holders. Saved the same way, so next Sunday is one click.",
    add: "New name tags",
    empty: "No name tags yet",
    first: "Set up name tags",
    loading: "Loading name tags…",
  },
} as const;

export function ProjectsPage({ output = "book" }: { output?: Output }) {
  const { entries } = useDirectory();
  const { canEdit } = useAuth();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const words = WORDS[output];
  // The two lists are the same rows told apart by a setting, so one fetch and
  // one component do both.
  const shown = projects?.filter(
    (project) => normalizeSettings(project.settings).output === output,
  );
  const newHref = output === "tags" ? "/projects/new?output=tags" : "/projects/new";

  useEffect(() => {
    fetchProjects()
      .then(setProjects)
      .catch((cause) => setError(message(cause)));
  }, []);

  const summary = useMemo(() => {
    const settings = normalizeSettings({});
    const sheets = Math.ceil(entries.length / recordsPerSheet(settings));
    return { sheets, perSheet: recordsPerSheet(settings) };
  }, [entries.length]);

  if (!projects && !error) return <LoadingScreen label={words.loading} />;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{words.title}</h1>
          <div className="sub">{words.sub}</div>
        </div>
        {canEdit ? (
          <Link className="btn primary" to={newHref}>
            {words.add}
          </Link>
        ) : null}
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      {shown?.length ? (
        <div className="grid two">
          {shown.map((project) => {
            const settings = normalizeSettings(project.settings);
            return (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="card"
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <div className="card-body">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <h2 style={{ flex: 1 }}>{project.name}</h2>
                    <span className="pill">{project.kind === "event" ? "Event" : "Main"}</span>
                  </div>
                  {project.description ? (
                    <p className="muted small">{project.description}</p>
                  ) : null}
                  <p className="muted small" style={{ marginTop: 8 }}>
                    {settings.output === "tags" ? (
                      <>
                        {TAG_SIZES[settings.tagSize].label} · {tagsPerSheet(settings)} to a sheet of{" "}
                        {settings.pageSize === "a4"
                          ? "A4"
                          : settings.pageSize === "legal"
                            ? "Legal"
                            : "Letter"}{" "}
                        portrait
                      </>
                    ) : (
                      <>
                        {settings.rows} per half-page · {recordsPerSheet(settings)} records to a
                        sheet ·{" "}
                        {settings.pageSize === "a4"
                          ? "A4"
                          : settings.pageSize === "legal"
                            ? "Legal"
                            : "Letter"}{" "}
                        landscape
                        {settings.bookletOrder ? " · booklet order" : ""}
                      </>
                    )}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            title={words.empty}
            action={
              canEdit ? (
                <Link className="btn primary" to={newHref}>
                  {words.first}
                </Link>
              ) : null
            }
          >
            {output === "tags" ? (
              <>
                One tag per person, off whichever people you choose — a family gets one each rather
                than one between them.
              </>
            ) : (
              <>
                You have {entries.length} records, which is about {summary.sheets} sheet
                {summary.sheets === 1 ? "" : "s"} of paper at {summary.perSheet} to a sheet.
              </>
            )}
          </EmptyState>
        </div>
      )}
    </div>
  );
}
