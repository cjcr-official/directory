import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmButton, LoadingScreen, Notice } from "@/components/ui";
import { deleteAccount, fetchProfiles, updateProfile } from "@/lib/queries";
import type { AppRole, ProfileRow } from "@/lib/database.types";

const ROLES: { value: AppRole; label: string; blurb: string }[] = [
  { value: "owner", label: "Owner", blurb: "Everything, including managing administrators." },
  { value: "editor", label: "Editor", blurb: "Add and edit records and directories." },
  { value: "viewer", label: "Viewer", blurb: "Browse and print. No changes." },
];

/**
 * "No access" is not a role. The database knows three - owner, editor, viewer -
 * and takes access away with is_active, so this is the one menu entry that does
 * not name one. Somebody sent back here keeps the role they had: it is what the
 * roster still shows them as, and what they come back as if you let them in
 * again.
 */
const NO_ACCESS = "none";

/** One menu on each row for the whole ladder, ending at nothing. */
const LEVELS: { value: string; label: string }[] = [
  ...ROLES.map(({ value, label }) => ({ value, label })),
  { value: NO_ACCESS, label: "No access" },
];

function levelPatch(value: string): Partial<ProfileRow> {
  return value === NO_ACCESS ? { is_active: false } : { role: value as AppRole, is_active: true };
}

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

  /**
   * Thrown rather than caught, unlike every other failure on this page: the
   * button that asked for it shows the reason where the finger already is,
   * which for a refusal from the database - the last owner, somebody else's
   * turn - is where it is actually read.
   */
  async function remove(id: string) {
    setError(null);
    await deleteAccount(id);
    await load();
  }

  if (!profiles && !error) return <LoadingScreen label="Loading administrators…" />;

  const owners = profiles?.filter((row) => row.role === "owner" && row.is_active).length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Administrators</h1>
          <div className="sub">
            People who can sign in. A new account can see nothing at all until you turn it on here.
          </div>
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <Notice>
        To add someone, send them the address of this app and ask them to create an account on the
        sign-in screen. They arrive here with <strong>no access</strong> — they cannot see a single
        name or address until you pick a role for them. Choosing <strong>No access</strong> again
        takes it back. Anyone can reach the sign-up form, so this is what keeps the congregation's
        details private.
      </Notice>

      {isOwner ? (
        <div style={{ marginTop: 12 }}>
          <Notice kind="warn">
            <strong>No access</strong> is the everyday answer, and the reversible one — the name
            stays on this list and the role comes back when they return. <strong>Delete</strong> is
            for the account that should not exist at all: a stranger who signed themselves up, a
            misspelt address, or somebody locked out of their own two-step sign-in who needs to
            start again. It removes the sign-in itself and cannot be undone. Nothing they entered
            goes with it — the families, people and directories they typed are the congregation's
            records and stay exactly where they are.
          </Notice>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <table className="admins-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Access</th>
              {isOwner ? <th>Remove</th> : null}
            </tr>
          </thead>
          <tbody>
            {profiles?.map((row) => {
              const isMe = row.id === me?.id;
              // Never let the last owner lock themselves out of their own directory.
              // Only the row actually holding that last active ownership is frozen.
              // An owner with no access is holding nothing - counting them here
              // froze their row too, so the one person who could grant them access
              // was shown a plain "No access" label and no way to change it.
              const lastOwner = row.role === "owner" && row.is_active && owners <= 1;
              return (
                <tr key={row.id}>
                  <td>
                    {row.full_name || <span className="muted">—</span>}
                    {isMe ? (
                      <span className="pill" style={{ marginLeft: 6 }}>
                        You
                      </span>
                    ) : null}
                  </td>
                  <td className="small muted">{row.email}</td>
                  <td>
                    {isOwner && !lastOwner ? (
                      <select
                        value={row.is_active ? row.role : NO_ACCESS}
                        disabled={busy === row.id}
                        style={{ width: "auto" }}
                        onChange={(event) => void change(row.id, levelPatch(event.target.value))}
                      >
                        {LEVELS.map((level) => (
                          <option key={level.value} value={level.value}>
                            {level.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="pill role">{row.role}</span>
                    )}
                  </td>
                  <td>
                    <span className="muted small">{row.is_active ? "Active" : "No access"}</span>
                  </td>
                  {isOwner ? (
                    <td>
                      {/* Never on your own row. An owner deleting themselves is
                          how a directory ends up with nobody who can grant a
                          role, and it is the one deletion the database refuses
                          outright - so the button is not offered either. */}
                      {isMe ? (
                        <span className="muted small">—</span>
                      ) : (
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Delete this account"
                          subtle
                          disabled={busy === row.id}
                          onConfirm={() => remove(row.id)}
                        />
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>

        {owners <= 1 ? (
          <div
            className="card-body tight small muted"
            style={{ borderTop: "1px solid var(--line)" }}
          >
            Your own role and access are fixed while you are the only owner with access, so that
            somebody is always left who can manage administrators. Make somebody else an owner and
            your own row can be changed again.
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h3>What each role can do</h3>
        </div>
        <div className="card-body">
          <dl className="role-key">
            {ROLES.map((role) => (
              <div key={role.value} className="role-key-item">
                <dt>{role.label}</dt>
                <dd className="muted small">{role.blurb}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
