import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { EmptyState, LoadingScreen, Notice } from "@/components/ui";
import { rosterFor } from "@/lib/mailchimp";
import { audiences as fetchAudiences, settings, syncGroup } from "@/lib/mailchimpClient";
import type { Audience, SyncOutcome } from "@/lib/mailchimpClient";
import { describeWhen, message } from "@/lib/format";

/** So the audience is chosen once rather than every time the screen opens. */
const AUDIENCE_KEY = "church-directory:mailchimp-audience";
/**
 * When each group was last pushed across, by group id.
 *
 * Kept in the browser rather than asked of Mailchimp, because Mailchimp knows
 * when a contact was last changed and not when this screen last agreed with
 * it. It is a convenience - "did I do the choir before the newsletter went
 * out?" - not a record, and it says so by being per-browser.
 */
const SYNCED_KEY = "church-directory:mailchimp-synced";

function remembered(): string {
  try {
    return localStorage.getItem(AUDIENCE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberedSyncs(): Record<string, string> {
  try {
    const held: unknown = JSON.parse(localStorage.getItem(SYNCED_KEY) ?? "{}");
    return held && typeof held === "object" && !Array.isArray(held)
      ? (held as Record<string, string>)
      : {};
  } catch {
    // Private browsing, or something else wrote nonsense under this key.
    return {};
  }
}

interface Running {
  tagId: string;
  note: string;
}

/**
 * Groups, as Mailchimp sees them.
 *
 * The directory already knows who is in the choir, and keeping that list a
 * second time inside Mailchimp is how the two drift apart - somebody joins in
 * March, and the April email goes to the list somebody typed in January. So
 * nothing is typed here: each group is pushed across as a Mailchimp tag with
 * exactly the people the directory currently has in it, and anybody who has
 * left the group has the tag taken off.
 *
 * Writing and sending the email stays in Mailchimp, which is the part
 * Mailchimp is actually good at - templates, an unsubscribe link that is
 * legally required and correct, and a record of what was sent. This screen
 * only keeps the "to" line honest.
 */
export function MailchimpPage() {
  const { tags, entries, loading } = useDirectory();
  const { canEdit } = useAuth();

  const [ready, setReady] = useState<boolean | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [list, setList] = useState<Audience[]>([]);
  /**
   * Whether the audiences were actually asked for and answered.
   *
   * Separate from the list being empty, because the two look identical from
   * here and mean opposite things. An account with no audiences should be told
   * to go and make one; an account whose key was refused has already been told
   * why at the top of the screen, and saying "no audiences yet" underneath it
   * is a second, false statement about their Mailchimp account sending them to
   * fix something that is not broken.
   */
  const [asked, setAsked] = useState(false);
  const [audienceId, setAudienceId] = useState(remembered);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [running, setRunning] = useState<Running | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, SyncOutcome>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [syncedAt, setSyncedAt] = useState<Record<string, string>>(rememberedSyncs);

  /** Who each group would actually reach, worked out once for the whole page. */
  const rosters = useMemo(
    () => new Map(tags.map((tag) => [tag.id, rosterFor(entries, tag.id)])),
    [tags, entries],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const state = await settings();
        if (!live) return;
        setReady(state.ready);
        setMissing(state.missing);
        if (!state.ready) return;

        const found = await fetchAudiences();
        if (!live) return;
        setList(found);
        setAsked(true);
        // One audience is the overwhelmingly common case, and picking it saves
        // a decision that has only one answer.
        setAudienceId((current) =>
          current && found.some((one) => one.id === current)
            ? current
            : found.length === 1
              ? found[0].id
              : "",
        );
      } catch (cause) {
        if (live) setError(message(cause));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  /**
   * What the groups add up to.
   *
   * One address counted once however many groups it is in, because that is
   * what it costs in Mailchimp - a contact, not a membership - and "42
   * addresses" that turn out to be nineteen people is the kind of figure that
   * gets a plan bought.
   */
  const coverage = useMemo(() => {
    const addresses = new Set<string>();
    const stranded = new Set<string>();
    let inGroups = 0;
    for (const roster of rosters.values()) {
      inGroups += roster.recipients.length + roster.unreachable.length;
      for (const one of roster.recipients) addresses.add(one.email);
      for (const one of roster.unreachable) stranded.add(`${one.type}:${one.id}`);
    }
    return { inGroups, addresses: addresses.size, stranded: stranded.size };
  }, [rosters]);

  useEffect(() => {
    try {
      if (audienceId) localStorage.setItem(AUDIENCE_KEY, audienceId);
    } catch {
      // Remembering the audience is a nicety, not the feature.
    }
  }, [audienceId]);

  if (loading && !tags.length) return <LoadingScreen label="Loading groups…" />;

  async function sync(tagId: string, name: string) {
    const roster = rosters.get(tagId);
    if (!roster || !audienceId) return;

    setRunning({ tagId, note: "Starting…" });
    setFailures((all) => ({ ...all, [tagId]: "" }));
    // Last time's result is not this time's. Left in place, a success from an
    // earlier press sat underneath the red box from a later one, which reads as
    // one sync that both worked and failed.
    setOutcomes((all) => {
      const { [tagId]: _previous, ...rest } = all;
      return rest;
    });
    try {
      const outcome = await syncGroup(audienceId, name, roster.recipients, (note) =>
        setRunning({ tagId, note }),
      );
      setOutcomes((all) => ({ ...all, [tagId]: outcome }));
      setSyncedAt((all) => {
        const next = { ...all, [tagId]: new Date().toISOString() };
        try {
          localStorage.setItem(SYNCED_KEY, JSON.stringify(next));
        } catch {
          // Remembering is a convenience, not the feature.
        }
        return next;
      });
    } catch (cause) {
      setFailures((all) => ({ ...all, [tagId]: message(cause) }));
    } finally {
      setRunning(null);
    }
  }

  /**
   * Every group with somebody to email, one after another.
   *
   * In turn rather than at once: each group is several calls to Mailchimp, and
   * five groups firing together is how a church on a free plan meets a rate
   * limit for the first time. Groups with nobody in them are skipped rather
   * than failed - there is nothing to send them.
   */
  async function syncEverything() {
    for (const tag of tags) {
      if (!rosters.get(tag.id)?.recipients.length) continue;
      await sync(tag.id, tag.name);
    }
  }

  const syncable = tags.filter((tag) => (rosters.get(tag.id)?.recipients.length ?? 0) > 0);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Mailchimp</h1>
          <div className="sub">Email a group. The list keeps itself right.</div>
        </div>
      </div>

      {/* What the groups add up to, before any of the detail. The same shape
          Backup uses, and for the same reason: the figures that decide whether
          this screen is worth opening are facts about the directory, not about
          any one group. The middle one is a link because it is the only one
          that is ever wrong on purpose - somebody has no address yet - and
          People is where that gets fixed. */}
      {ready && tags.length ? (
        <div className="card stat-strip">
          <div className="stat">
            <span className="value">{coverage.addresses}</span>
            <span className="label">{coverage.addresses === 1 ? "Address" : "Addresses"}</span>
          </div>
          <Link className="stat" to="/people">
            <span className="value">{coverage.stranded}</span>
            <span className="label">Without an address</span>
          </Link>
          <div className="stat">
            <span className="value">{syncable.length}</span>
            <span className="label">
              {syncable.length === 1 ? "Group to send" : "Groups to send"}
            </span>
          </div>
        </div>
      ) : null}

      {error ? <Notice kind="error">{error}</Notice> : null}

      {ready === false ? (
        <Notice kind="warn">
          This deploy is not connected to Mailchimp yet. {missing.join(", ")}{" "}
          {missing.length === 1 ? "is" : "are"} not set on the Worker — the README’s Mailchimp
          section has the three values and where they go. Nothing on this screen will work until
          they are set.
        </Notice>
      ) : null}

      {ready === null && !error ? <LoadingScreen label="Asking Mailchimp…" /> : null}

      {ready ? (
        <>
          <div className="card">
            <div className="card-head">
              <h2>Audience</h2>
            </div>
            <div className="card-body">
              {list.length ? (
                /* No Field wrapper: the card is already headed "Audience", and a
                   second label saying it twice is noise. An empty label would
                   have been worse than noise - it is an unlabelled control to
                   anything reading the page aloud - so the name lives on the
                   select itself. */
                <select
                  aria-label="Audience"
                  id="mailchimp_audience"
                  value={audienceId}
                  onChange={(event) => setAudienceId(event.target.value)}
                >
                  <option value="">Choose an audience…</option>
                  {list.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name} — {one.members} contacts
                    </option>
                  ))}
                </select>
              ) : asked ? (
                <Notice kind="warn">No audiences in Mailchimp yet. Make one there first.</Notice>
              ) : (
                <p className="hint" style={{ margin: 0 }}>
                  Your audiences could not be fetched — see above.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Groups</h2>
              {canEdit && syncable.length > 1 ? (
                <button
                  type="button"
                  className="btn primary small"
                  disabled={!audienceId || Boolean(running)}
                  onClick={() => void syncEverything()}
                  title={
                    audienceId
                      ? `Sync all ${syncable.length} groups that have somebody to email`
                      : "Choose an audience first"
                  }
                >
                  {running ? "Syncing…" : `Sync all ${syncable.length}`}
                </button>
              ) : null}
            </div>
            {tags.length ? (
              <ul className="group-list">
                {tags.map((tag) => {
                  const roster = rosters.get(tag.id);
                  const count = roster?.recipients.length ?? 0;
                  const open = openId === tag.id;
                  const panelId = `mailchimp-group-${tag.id}`;
                  const busy = running?.tagId === tag.id;
                  const when = describeWhen(syncedAt[tag.id]);

                  const outcome = outcomes[tag.id];
                  const failed = failures[tag.id];

                  /**
                   * What the last sync did, in a phrase rather than a panel,
                   * and what went wrong with it, if anything.
                   *
                   * Split because the two deserve different volumes. "1 added,
                   * 1 removed" is a receipt; addresses Mailchimp refused, or a
                   * tidy-up that could not be planned, is something somebody
                   * has to do something about.
                   */
                  // Not "2 tagged": the row two lines up already says "2
                  // addresses", and the footer wrapped to two lines to repeat
                  // it. What a sync tells you that the row cannot is whether
                  // anything actually moved.
                  const said = outcome ? `${outcome.added} added · ${outcome.removed} removed` : "";
                  const trouble =
                    outcome && !busy
                      ? [
                          outcome.rejected.length
                            ? `Mailchimp would not take ${outcome.rejected.length}: ` +
                              outcome.rejected
                                .slice(0, 2)
                                .map((row) => row.email)
                                .join(", ") +
                              (outcome.rejected.length > 2 ? "…" : "")
                            : "",
                          outcome.removalsSkipped
                            ? "Nobody was untagged — the current tags could not be read."
                            : "",
                          outcome.stillRunning ? "Mailchimp is still finishing the tags." : "",
                        ]
                          .filter(Boolean)
                          .join(" ")
                      : "";

                  return (
                    <li key={tag.id} className="group-item">
                      <div className="group-row">
                        <span className="group-dot" style={{ background: tag.color }} />
                        <button
                          type="button"
                          className="group-name-button"
                          aria-expanded={open}
                          aria-controls={panelId}
                          onClick={() => setOpenId(open ? null : tag.id)}
                        >
                          <span className="group-name-label">{tag.name}</span>
                          <span className="group-name-mark" aria-hidden>
                            ⌄
                          </span>
                        </button>

                        <span className="group-count">
                          {count === 0
                            ? "Nobody to email"
                            : count === 1
                              ? "1 address"
                              : `${count} addresses`}
                        </span>

                        {canEdit ? (
                          <span className="group-actions">
                            <button
                              type="button"
                              className="btn"
                              disabled={!audienceId || !count || Boolean(running)}
                              onClick={() => void sync(tag.id, tag.name)}
                            >
                              {busy ? "Syncing…" : "Sync"}
                            </button>
                          </span>
                        ) : null}
                      </div>

                      {busy || failed || open ? (
                        <div className="group-members" id={panelId}>
                          {busy ? <p className="hint">{running?.note}</p> : null}

                          {/* A refusal is worth a box. "Nothing changed" is not:
                              three of those boxes, one per group, were the
                              loudest thing on a dark screen and pushed the
                              names - the only reason to open a group at all -
                              off the bottom of it. What a sync did is a fact
                              about the sync, so it goes in the footer with the
                              other one. */}
                          {failed ? <Notice kind="error">{failed}</Notice> : null}

                          {trouble ? <Notice kind="warn">{trouble}</Notice> : null}

                          {open ? (
                            <>
                              {roster?.recipients.length ? (
                                <ul className="group-member-list">
                                  {roster.recipients.map((recipient) => (
                                    <li key={recipient.email} className="group-member">
                                      <span className="group-member-name">{recipient.label}</span>
                                      <span className="group-member-who">
                                        {recipient.email}
                                        {recipient.via === "household" ? " · family" : ""}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="hint" style={{ margin: 0 }}>
                                  No addresses in this group yet.
                                </p>
                              )}

                              {roster?.unreachable.length ? (
                                <p className="hint">
                                  {roster.unreachable.map((one, at) => (
                                    <span key={`${one.type}:${one.id}`}>
                                      {at > 0 ? ", " : ""}
                                      <Link
                                        className="list-link"
                                        to={
                                          one.type === "person"
                                            ? `/people/${one.id}`
                                            : `/families/${one.id}`
                                        }
                                      >
                                        {one.name}
                                      </Link>
                                    </span>
                                  ))}{" "}
                                  {roster.unreachable.length === 1 ? "has" : "have"} no address.
                                </p>
                              ) : null}

                              {/* The action after the list, because the list is
                                  what decides whether to press it. Not primary:
                                  one accent on a screen is emphasis, three is
                                  wallpaper, and Sync all already has it. */}
                              {!busy && (canEdit || when || said) ? (
                                <div className="panel-foot">
                                  {canEdit && (roster?.recipients.length ?? 0) > 0 ? (
                                    <Link className="btn small" to={`/mailchimp/${tag.id}`}>
                                      Write email
                                    </Link>
                                  ) : null}
                                  <span className="muted small">
                                    {[said, when && `synced ${when}`].filter(Boolean).join(" · ")}
                                  </span>
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No groups yet">
                Make one under <Link to="/groups">Groups</Link>.
              </EmptyState>
            )}
          </div>

          <p className="muted small">Unsubscribes are always respected.</p>
        </>
      ) : null}
    </div>
  );
}
