import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { EmptyState, LoadingScreen, Notice } from "@/components/ui";
import { fetchProjects } from "@/lib/queries";
import type { ProjectRow } from "@/lib/database.types";
import { TAG_SIZES, normalizeSettings, paperName, recordsPerSheet } from "@/lib/layout/settings";
import { tagsPerSheet } from "@/lib/layout/tags";
import { message } from "@/lib/format";
import { KIND_NAMES, directoryKinds } from "@/lib/directoryKind";

/**
 * The saved directories, as books (Directories) or as name tags (Name tags).
 * The same list either way; only what a card says and where it leads differ.
 */
export function ProjectsPage({ tags = false }: { tags?: boolean }) {
  const { entries } = useDirectory();
  const { canEdit } = useAuth();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchProjects()
      .then((rows) => active && setProjects(rows))
      .catch((cause) => active && setError(message(cause)));
    return () => {
      active = false;
    };
  }, []);

  // Worked out over the whole list, because which one is the main directory
  // is a question about all of them.
  const kinds = useMemo(() => directoryKinds(projects ?? []), [projects]);

  if (!projects && !error) return <LoadingScreen label="Loading directories…" />;

  const perSheet = recordsPerSheet(normalizeSettings({}));
  const sheets = Math.ceil(entries.length / perSheet);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{tags ? "Name tags" : "Directories"}</h1>
          <div className="sub">
            {tags
              ? "A tag each for the people in a directory. Change who is in the directory and the tags follow."
              : "A saved book: who is in it, and how it prints. The records stay live, so next year is one click."}
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
        <div className="grid project-grid">
          {projects.map((project) => {
            const settings = normalizeSettings(project.settings);
            const kind = kinds.get(project.id) ?? "group";
            return (
              <Link
                key={project.id}
                to={tags ? `/tags/${project.id}` : `/projects/${project.id}`}
                className="card project-card"
              >
                <div className="card-body">
                  <div className="project-card-head">
                    <h2>{project.name}</h2>
                    <span className={`pill${kind === "main" ? " tone-owner" : ""}`}>
                      {KIND_NAMES[kind]}
                    </span>
                  </div>
                  {project.description ? (
                    <p className="muted small">{project.description}</p>
                  ) : null}
                  <p className="muted small project-card-facts">
                    {tags
                      ? `${TAG_SIZES[settings.tagSize].label} · ${tagsPerSheet(settings)} to a sheet · ${paperName(settings.pageSize)} portrait`
                      : `${paperName(settings.pageSize)} landscape · ${recordsPerSheet(settings)} to a sheet`}
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
            {tags
              ? "One tag per person, off whichever people you choose — a family gets one each rather than one between them."
              : `You have ${entries.length} records, which is about ${sheets} sheet${sheets === 1 ? "" : "s"} of paper at ${perSheet} to a sheet.`}
          </EmptyState>
        </div>
      )}
    </div>
  );
}
