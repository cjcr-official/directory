import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { LoadingScreen, Notice } from "@/components/ui";
import { fetchProfiles, updateProfile } from "@/lib/queries";
import type { AppRole, ProfileRow } from "@/lib/database.types";

const ROLES: { value: AppRole; label: string; blurb: string }[] = [
  { value: "owner", label: "Owner", blurb: "Everything, including managing administrators." },
  { value: "editor", label: "Editor", blurb: "Add and edit records and directories." },
  { value: "viewer", label: "Viewer", blurb: "Browse and print. No changes." },
];

export function AdministratorsPage() {
  const { profile: me, isOwner } = useAuth();
  const [profiles, setProfiles] = useState<ProfileRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      setProfiles(await fetchProfiles());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function change(id: string, patch: Partial<ProfileRow>) {
    setBusy(id);
    setError(null);
    try {
      await updateProfile(id, patch);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  if (!profiles && !error) return <LoadingScreen label="Loading administrators…" />;

  const owners = profiles?.filter((row) => row.role === "owner" && row.is_active).length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Administrators</h1>
          <div className="sub">
            People who can sign in. A new account can see nothing at all until you turn it on
            here.
          </div>
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <Notice>
        To add someone, send them the address of this app and ask them to create an account on the
        sign-in screen. They arrive here with <strong>no access</strong> — they cannot see a single
        name or address until you choose <strong>Grant access</strong> and pick a role. Anyone can
        reach the sign-up form, so this is what keeps the congregation's details private.
      </Notice>

      <div className="card" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {profiles?.map((row) => {
              const isMe = row.id === me?.id;
              // Never let the last owner lock themselves out of their own directory.
              const lastOwner = row.role === "owner" && owners <= 1;
              return (
                <tr key={row.id}>
                  <td>
                    {row.full_name || <span className="muted">—</span>}
                    {isMe ? <span className="pill" style={{ marginLeft: 6 }}>You</span> : null}
                  </td>
                  <td className="small muted">{row.email}</td>
                  <td>
                    {isOwner && !lastOwner ? (
                      <select
                        value={row.role}
                        disabled={busy === row.id}
                        style={{ width: "auto" }}
                        onChange={(event) => void change(row.id, { role: event.target.value as AppRole })}
                      >
                        {ROLES.map((role) => (
                          <option key={role.value} value={role.value}>{role.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="pill role">{row.role}</span>
                    )}
                  </td>
                  <td>
                    {isOwner && !lastOwner ? (
                      <button
                        type="button"
                        className="btn small"
                        disabled={busy === row.id}
                        onClick={() => void change(row.id, { is_active: !row.is_active })}
                      >
                        {row.is_active ? "Suspend" : "Grant access"}
                      </button>
                    ) : (
                      <span className="muted small">{row.is_active ? "Active" : "No access"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid three" style={{ marginTop: 16 }}>
        {ROLES.map((role) => (
          <div key={role.value} className="card">
            <div className="card-body">
              <h3 style={{ marginBottom: 4 }}>{role.label}</h3>
              <p className="muted small">{role.blurb}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
