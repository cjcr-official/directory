import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmButton, LoadingScreen, Notice } from "@/components/ui";
import { deleteAccount, fetchProfiles, updateProfile } from "@/lib/queries";
import type { AppRole, ProfileRow } from "@/lib/database.types";
import { message } from "@/lib/format";

/**
 * "No access" is not a role. The database knows three - owner, editor, viewer -
 * and takes access away with is_active, so this is the one level that does not
 * name one. Somebody sent back here keeps the role they had: it is what they
 * come back as if you let them in again.
 */
const NO_ACCESS = "none";

/** The whole ladder, most to least, ending at nothing. */
const LEVELS: { value: string; label: string; blurb: string }[] = [
  { value: "owner", label: "Owner", blurb: "Everything, this page included." },
  { value: "editor", label: "Editor", blurb: "Adds and edits records." },
  { value: "viewer", label: "Viewer", blurb: "Browses and prints." },
  { value: NO_ACCESS, label: "No access", blurb: "Can sign in and see nothing." },
];

function levelPatch(value: string): Partial<ProfileRow> {
  return value === NO_ACCESS ? { is_active: false } : { role: value as AppRole, is_active: true };
}

/** What a row is at the moment: its role, unless access has been taken away. */
function levelOf(row: ProfileRow): string {
  return row.is_active ? row.role : NO_ACCESS;
}

/**
 * Owner is tinted and no access is faded; editor and viewer are the plain
 * bubble.
 *
 * Colour here is for the one thing worth finding at a glance in a list of
 * names - who else can change this list - and for the one row that is on it
 * without being in it. Tinting all four would be four colours to learn for a
 * fact each bubble already states in a word.
 */
function toneOf(value: string): string {
  if (value === "owner") return "tone-owner";
  if (value === NO_ACCESS) return "tone-off";
  return "";
}

function Bubble({ value, label }: { value: string; label: string }) {
  return <span className={`pill ${toneOf(value)}`}>{label}</span>;
}

/**
 * The bubble that changes somebody's role.
 *
 * This was a <select>, and on a page of bubbles it was the one field-shaped
 * thing on screen: a grey box with a caret, once a row, saying the same kind
 * of thing the frozen owner's row says in a pill. A menu is not a field - a
 * field is an empty box waiting to be filled and this is never empty - so it
 * is drawn as what it holds, and opens onto the four bubbles it can hold
 * instead. What each of them means is said once, in the key beside the table,
 * rather than four times in every menu on the page.
 *
 * Everything a select gave away for free is here by hand: the menu closes on
 * Escape, on a press anywhere outside it, and on a choice; the arrow keys walk
 * it; and it opens upwards when the row it belongs to is near the bottom of
 * the window, which on a phone is most of them.
 */
function RoleMenu({
  name,
  value,
  busy,
  onPick,
}: {
  /** Whose role this is, for the label a screen reader announces. */
  name: string;
  value: string;
  busy: boolean;
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /**
   * A disabled button cannot hold focus, and the trigger goes disabled the
   * moment a choice is saving: without this, choosing a role from the keyboard
   * ends with focus back at the top of the document. So a pick remembers that
   * the focus is owed, and the effect below returns it when the button comes
   * back. Never on the first render - only after a save this menu started.
   */
  const owed = useRef(false);

  useEffect(() => {
    if (busy || !owed.current) return;
    owed.current = false;
    trigger.current?.focus();
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      // Not the trigger: its own click toggles, and closing here first would
      // make the second press of it reopen what the first closed.
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const box = trigger.current?.getBoundingClientRect();
    if (box) {
      // Four bubbles and their lines come to about this. Measured against the
      // window rather than the card: what clips a menu is the bottom of the
      // screen, and on a phone the last row of the table is sitting on it.
      const height = 190;
      setUp(window.innerHeight - box.bottom < height && box.top > height);
    }
    // A keyboard arrives in the menu where the answer currently is.
    panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  function walk(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  }

  function pick(next: string) {
    setOpen(false);
    if (next === value) {
      trigger.current?.focus();
      return;
    }
    owed.current = true;
    onPick(next);
  }

  const level = LEVELS.find((item) => item.value === value) ?? LEVELS[0];

  return (
    <span className="role-menu">
      <button
        type="button"
        ref={trigger}
        className={`pill role-trigger ${toneOf(value)}`}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Role for ${name}`}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
        }}
        onClick={() => setOpen((was) => !was)}
      >
        {level.label}
        <span className="role-caret" aria-hidden>
          ⌄
        </span>
      </button>
      {open ? (
        <div
          ref={panel}
          className={up ? "role-panel up" : "role-panel"}
          role="menu"
          aria-label={`Role for ${name}`}
          onKeyDown={walk}
        >
          {LEVELS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={item.value === value}
              className="role-choice"
              onClick={() => pick(item.value)}
            >
              <Bubble value={item.value} label={item.label} />
              <span className="role-tick" aria-hidden>
                {item.value === value ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
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
      setError(message(cause));
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
      setError(message(cause));
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
          <div className="sub">Who can sign in, and what they can do.</div>
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}

      <div className="admins-layout">
        <div className="admins-main">
          {/* Anyone can reach the sign-up form, so the one thing worth saying
              above the list is that reaching it gets you nothing. The rest -
              what each role can do, and what Delete means - is said beside the
              list, where it is read at the moment of choosing rather than
              scrolled past on the way to it. */}
          <Notice>
            Anyone can create an account, and a new one sees nothing at all until you give it a
            role. To add somebody, send them the address of this app.
          </Notice>

          <div className="card admins-roster">
            <table className={isOwner ? "admins-table owner" : "admins-table"}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th className="admins-role-head">Role</th>
                  {/* The bubble ends the ladder at "No access", which is the
                      whole of what an access column had to say - it stood
                      beside a control already saying it, on every row. */}
                  {isOwner ? <th className="admins-remove-head">Remove</th> : null}
                </tr>
              </thead>
              <tbody>
                {profiles?.map((row) => {
                  const isMe = row.id === me?.id;
                  // Never let the last owner lock themselves out of their own
                  // directory. Only the row actually holding that last active
                  // ownership is frozen. An owner with no access is holding
                  // nothing - counting them here froze their row too, so the one
                  // person who could grant them access was shown a plain bubble
                  // and no way to change it.
                  const lastOwner = row.role === "owner" && row.is_active && owners <= 1;
                  const level = levelOf(row);
                  const who = row.full_name || row.email;
                  return (
                    <tr key={row.id}>
                      <td className="admins-who">
                        {row.full_name || <span className="muted">—</span>}
                        {isMe ? <span className="pill admins-you">You</span> : null}
                      </td>
                      <td className="admins-email small muted">{row.email}</td>
                      <td className="admins-role">
                        {isOwner && !lastOwner ? (
                          <RoleMenu
                            name={who}
                            value={level}
                            busy={busy === row.id}
                            onPick={(next) => void change(row.id, levelPatch(next))}
                          />
                        ) : (
                          <Bubble
                            value={level}
                            label={LEVELS.find((item) => item.value === level)?.label ?? row.role}
                          />
                        )}
                      </td>
                      {isOwner ? (
                        <td className="admins-remove">
                          {/* Never on your own row. An owner deleting themselves is
                            how a directory ends up with nobody who can grant a
                            role, and it is the one deletion the database refuses
                            outright - so the button is not offered either. */}
                          {isMe ? (
                            <span className="muted small admins-self">—</span>
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
                Your own row is fixed while you are the only owner with access. Make somebody else
                an owner to change it.
              </div>
            ) : null}
          </div>
        </div>

        {/* The key to the bubbles, in the same bubbles. On a desk it stands
            beside the table rather than under it: this page is four short
            columns and a handful of people, and the rest of a desk monitor is
            better spent explaining them than stretching them. */}
        <aside className="card admins-aside">
          <div className="card-head">
            <h3>Roles</h3>
          </div>
          <div className="card-body">
            <dl className="role-key">
              {LEVELS.map((level) => (
                <div key={level.value} className="role-key-item">
                  <dt>
                    <Bubble value={level.value} label={level.label} />
                  </dt>
                  <dd className="muted small">{level.blurb}</dd>
                </div>
              ))}
            </dl>
          </div>
          {isOwner ? (
            <div
              className="card-body tight small muted"
              style={{ borderTop: "1px solid var(--line)" }}
            >
              <strong>No access</strong> can be undone — the name stays and the role comes back.{" "}
              <strong>Delete</strong> cannot: it removes the sign-in itself. The records they typed
              are the congregation's and stay.
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
