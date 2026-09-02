import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { EmptyState, LoadingScreen, Notice } from "@/components/ui";
import { fetchProjects } from "@/lib/queries";
import type { ProjectRow } from "@/lib/database.types";
import { normalizeSettings, recordsPerSheet } from "@/lib/layout/settings";

export function ProjectsPage() {
  const { entries } = useDirectory();
  const { canEdit } = useAuth();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects()
      .then(setProjects)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const summary = useMemo(() => {
    const settings = normalizeSettings({});
    const sheets = Math.ceil(entries.length / recordsPerSheet(settings));
    return { sheets, perSheet: recordsPerSheet(settings) };
  }, [entries.length]);

  if (!projects && !error) return <LoadingScreen label="Loading directories…" />;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Directories</h1>
          <div className="sub">
            Each one is a saved recipe for a printable book — who is in it, and how it looks. The
            data stays live, so reprinting next year is one click.
          </div>
        </div>
        {canEdit ? (
          <Link className="btn primary" to="/projects/new">
            New directory
          </Link>
        ) : null}
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      {projects?.length ? (
        <div className="grid two">
          {projects.map((project) => {
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
                    {settings.rows} per half-page · {recordsPerSheet(settings)} records to a sheet ·{" "}
                    {settings.pageSize === "a4"
                      ? "A4"
                      : settings.pageSize === "legal"
                        ? "Legal"
                        : "Letter"}{" "}
                    landscape
                    {settings.bookletOrder ? " · booklet order" : ""}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            title="No directories yet"
            action={
              canEdit ? (
                <Link className="btn primary" to="/projects/new">
                  Create the main directory
                </Link>
              ) : null
            }
          >
            You have {entries.length} records, which is about {summary.sheets} sheet
            {summary.sheets === 1 ? "" : "s"} of paper at {summary.perSheet} to a sheet.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
