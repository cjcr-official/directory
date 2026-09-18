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
  /**
   * Where the copy goes.
   *
   * Defaults to whoever is signed in, because that is nearly always the
   * answer - but it is a field rather than a fact, because the question this
   * needs to settle is usually "does this reach Gmail?", and the person
   * pressing the button is on Hotmail. A test that can only reach the sender
   * cannot answer the only question worth asking before a real send.
   */
  const [testTo, setTestTo] = useState(profile?.email ?? "");

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
          That group is gone. <Link to="/mailchimp">Back</Link>.
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
  const canTest = ready && isEmailish(testTo);

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
      const to = testTo.trim().toLowerCase();
      await sendTestTo(audienceId, id, to);
      setNote(`Copy sent to ${to}. Check junk as well as the inbox.`);
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
              “{subject}” — {count} {count === 1 ? "person" : "people"} in {tag.name}
            </div>
          </div>
        </div>
        <Notice kind="ok">It is in your Mailchimp campaign list, with who opened it.</Notice>
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
            {count === 0 ? "No addresses yet" : `${count} ${count === 1 ? "person" : "people"}`} ·{" "}
            <Link to="/mailchimp">Groups</Link>
          </div>
        </div>
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}
      {note ? <Notice kind="ok">{note}</Notice> : null}

      {!audienceId ? (
        <Notice kind="warn">
          Pick an audience on the <Link to="/mailchimp">Mailchimp</Link> screen first.
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
            <Field label="From" htmlFor="from_name">
              <input
                id="from_name"
                type="text"
                value={fromName}
                placeholder="The Alliance Church Office"
                onChange={(event) => setFromName(event.target.value)}
              />
            </Field>

            <Field label="Reply to" htmlFor="reply_to">
              <input
                id="reply_to"
                type="email"
                value={replyTo}
                onChange={(event) => setReplyTo(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Message" htmlFor="body" hint="Blank line starts a paragraph.">
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
              <strong>{replyTo.slice(replyTo.lastIndexOf("@") + 1)} will cost you delivery.</strong>{" "}
              Mailchimp sends from its own servers, so mail claiming to be from a mailbox it cannot
              authenticate fails the check Gmail runs on every message. Gmail may refuse it outright
              rather than put it in junk, which is why a send can look successful and reach nobody.
              The fix is an address on a domain the church owns, authenticated in Mailchimp — not
              anything in this app.
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
              A copy goes to one address. The group gets nothing until you send.
            </p>
            <Field label="Copy to" htmlFor="test_to" hint="Try a Gmail address too.">
              <input
                id="test_to"
                type="email"
                value={testTo}
                onChange={(event) => setTestTo(event.target.value)}
              />
            </Field>

            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={!canTest || Boolean(busy)}
                onClick={() => void testIt()}
              >
                {busy === "Sending you a copy…" ? "Sending…" : "Send a copy"}
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
