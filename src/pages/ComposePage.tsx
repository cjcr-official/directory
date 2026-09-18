import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDirectory } from "@/data/DirectoryContext";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmButton, Field, LoadingScreen, Notice } from "@/components/ui";
import { composeEmail, isEmailish, isPublicMailbox, rosterFor } from "@/lib/mailchimp";
import { draft as makeDraft, send, sendTestTo } from "@/lib/mailchimpClient";
import { message } from "@/lib/format";

const AUDIENCE_KEY = "church-directory:mailchimp-audience";
/** The name and address to reply to, which are the same every time. */
const SENDER_KEY = "church-directory:mailchimp-sender";

function held(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function heldSender(): { fromName: string; replyTo: string } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SENDER_KEY) ?? "{}");
    const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return {
      fromName: typeof row.fromName === "string" ? row.fromName : "",
      replyTo: typeof row.replyTo === "string" ? row.replyTo : "",
    };
  } catch {
    return { fromName: "", replyTo: "" };
  }
}

/**
 * Writing one email to one group.
 *
 * The rest of this app hands the writing to Mailchimp, which is fair - it is
 * better at templates and it is the one keeping the record. But a church
 * office sending three paragraphs to the choir does not want a template, and
 * going to Mailchimp to type them means signing in somewhere else, finding the
 * audience, finding the tag, and remembering which tag went with which group.
 * So the short note is written here, and everything Mailchimp is actually
 * needed for - the unsubscribe link, the postal address, the record of what
 * went out - still happens there.
 *
 * Sending is the one thing in this whole app that reaches people who never
 * asked it for anything, and the one thing that cannot be undone by doing the
 * opposite. So it is three deliberate steps - write it, send it to yourself,
 * then confirm - rather than a button that means it.
 */
export function ComposePage() {
  const { tagId } = useParams();
  const { tags, entries, loading } = useDirectory();
  const { canEdit, profile } = useAuth();
  const navigate = useNavigate();

  const tag = tags.find((one) => one.id === tagId);
  const roster = useMemo(() => (tag ? rosterFor(entries, tag.id) : null), [entries, tag]);

  const remembered = heldSender();
  const [subject, setSubject] = useState("");
  const [fromName, setFromName] = useState(remembered.fromName);
  const [replyTo, setReplyTo] = useState(remembered.replyTo || (profile?.email ?? ""));
  const [body, setBody] = useState("");

  /** The draft in Mailchimp for exactly what is on screen, if there is one. */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const audienceId = held(AUDIENCE_KEY);

  // Any edit makes the draft in Mailchimp no longer the email on screen, so it
  // is thrown away rather than sent. Without this, editing after a test sends
  // the version that was tested, not the one being looked at.
  useEffect(() => {
    setDraftId(null);
    setNote(null);
  }, [subject, fromName, replyTo, body]);

  useEffect(() => {
    try {
      localStorage.setItem(SENDER_KEY, JSON.stringify({ fromName, replyTo }));
    } catch {
      // Remembering the sender is a convenience.
    }
  }, [fromName, replyTo]);

  if (loading && !tags.length) return <LoadingScreen label="Loading the group…" />;

  if (!tag) {
    return (
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>Write an email</h1>
          </div>
        </div>
        <Notice kind="warn">
          That group is no longer here. <Link to="/mailchimp">Back to Mailchimp</Link>.
        </Notice>
      </div>
    );
  }

  const count = roster?.recipients.length ?? 0;
  const ready =
    Boolean(audienceId) &&
    subject.trim().length > 0 &&
    fromName.trim().length > 0 &&
    isEmailish(replyTo) &&
    body.trim().length > 0 &&
    count > 0;

  /** Makes the draft if what is on screen has not been drafted yet. */
  async function draftNow(): Promise<string> {
    if (draftId) return draftId;
    const { html, text } = composeEmail(body, tag!.name);
    const made = await makeDraft(audienceId, {
      tag: tag!.name,
      subject: subject.trim(),
      fromName: fromName.trim(),
      replyTo: replyTo.trim().toLowerCase(),
      html,
      text,
    });
    setDraftId(made.id);
    return made.id;
  }

  async function testIt() {
    setBusy("Sending you a copy…");
    setError(null);
    setNote(null);
    try {
      const id = await draftNow();
      await sendTestTo(audienceId, id, profile?.email ?? replyTo.trim().toLowerCase());
      setNote(
        `A copy is on its way to ${profile?.email ?? replyTo}. Read it before you send it to ${
          count === 1 ? "anybody else" : "everybody else"
        }.`,
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  }

  async function sendIt() {
    setBusy("Sending…");
    setError(null);
    setNote(null);
    try {
      const id = await draftNow();
      await send(audienceId, id);
      setSent(true);
    } catch (cause) {
      setError(message(cause));
      throw cause;
    } finally {
      setBusy(null);
    }
  }

  if (sent) {
    return (
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1>Sent</h1>
            <div className="sub">
              “{subject}” has gone to {count} {count === 1 ? "person" : "people"} in {tag.name}.
            </div>
          </div>
        </div>
        <Notice kind="ok">
          Mailchimp has it from here — it is in your campaign list with who opened it, and the
          unsubscribe link is on every copy.
        </Notice>
        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => void navigate("/mailchimp")}>
            Back to groups
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Write to {tag.name}</h1>
          <div className="sub">
            {count === 0
              ? "Nobody in this group has an email address yet."
              : `${count} ${count === 1 ? "person" : "people"} will get this.`}{" "}
            <Link to="/mailchimp">Back to groups</Link>
          </div>
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}
      {note ? <Notice kind="ok">{note}</Notice> : null}

      {!audienceId ? (
        <Notice kind="warn">
          No audience is chosen yet. Open <Link to="/mailchimp">Mailchimp</Link> and pick one first.
        </Notice>
      ) : null}

      <div className="card">
        <div className="card-body">
          <Field label="Subject" htmlFor="subject">
            <input
              id="subject"
              type="text"
              value={subject}
              placeholder="Choir practice moved to Thursday"
              onChange={(event) => setSubject(event.target.value)}
            />
          </Field>

          <div className="grid two">
            <Field label="From" htmlFor="from_name" hint="The name it appears to come from.">
              <input
                id="from_name"
                type="text"
                value={fromName}
                placeholder="The Alliance Church Office"
                onChange={(event) => setFromName(event.target.value)}
              />
            </Field>

            <Field
              label="Reply to"
              htmlFor="reply_to"
              hint={
                isPublicMailbox(replyTo)
                  ? "Mailchimp cannot authenticate a free mailbox — see the note below."
                  : "Where a reply goes."
              }
            >
              <input
                id="reply_to"
                type="email"
                value={replyTo}
                onChange={(event) => setReplyTo(event.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Message"
            htmlFor="body"
            hint="A blank line starts a new paragraph. The unsubscribe link and your church's address are added by Mailchimp."
          >
            <textarea
              id="body"
              rows={10}
              value={body}
              placeholder={
                "Dear friends,\n\nPractice has moved to Thursday at 7pm.\n\nThank you,\nThe Office"
              }
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>

          {isPublicMailbox(replyTo) ? (
            <Notice kind="warn">
              {replyTo.slice(replyTo.lastIndexOf("@") + 1)} is a public mailbox, and Mailchimp
              cannot authenticate one. It will still send, but Gmail and Yahoo are more likely to
              treat it as suspicious. An address on the church’s own domain is worth the change
              before a big send.
            </Notice>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <div className="card">
          <div className="card-head">
            <h2>Send it</h2>
          </div>
          <div className="card-body">
            <p className="hint" style={{ marginTop: 0 }}>
              Send yourself a copy first. It is the only way to see what the congregation will see,
              and there is no unsending the real one.
            </p>
            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={!ready || Boolean(busy)}
                onClick={() => void testIt()}
              >
                {busy === "Sending you a copy…" ? "Sending…" : "Send me a copy"}
              </button>

              <ConfirmButton
                label={count === 1 ? "Send to 1 person" : `Send to ${count} people`}
                confirmLabel={`Really send to ${tag.name}`}
                disabled={!ready || Boolean(busy)}
                onConfirm={sendIt}
              />
            </div>
            {busy ? <p className="hint">{busy}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
