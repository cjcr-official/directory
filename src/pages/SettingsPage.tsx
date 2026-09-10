import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { ConfirmButton, Notice } from "@/components/ui";
import { describeWhen, message } from "@/lib/format";
import {
  CODE_LENGTH,
  beginEnrolment,
  confirmEnrolment,
  listAuthenticators,
  removeAuthenticator,
  type Enrolment,
  type TotpFactor,
} from "@/lib/mfa";
import { formatSetupKey } from "@/lib/qr";
import {
  getTheme,
  getThemeChoice,
  setThemeChoice,
  subscribeTheme,
  type ThemeChoice,
} from "@/lib/theme";

const CHOICES: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Dark ink on paper, as the book prints." },
  { value: "dark", label: "Dark", hint: "For a phone in a dim room, or an evening's typing." },
  {
    value: "system",
    label: "Match this device",
    hint: "Follows the phone or computer's own setting.",
  },
];

/**
 * Which theme is on, and which was asked for - two different questions, and
 * the screen shows both. Subscribed rather than copied into state because the
 * answer can change without anybody touching this page: somebody on "match
 * this device" whose phone turns itself dark at sunset should watch the
 * setting follow it rather than find it stale on their next visit.
 */
function useTheme() {
  const choice = useSyncExternalStore(subscribeTheme, getThemeChoice);
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  return { choice, theme };
}

function Appearance() {
  const { choice, theme } = useTheme();

  return (
    <div className="card">
      <div className="card-head column">
        <h2>Appearance</h2>
        <span className="muted small">
          Kept on this device, not on the account: the phone in a pocket and the office computer can
          each have their own answer, and the sign-in screen is drawn before anybody knows who is
          looking.
        </span>
      </div>
      <div className="card-body">
        <fieldset>
          <legend>Theme</legend>
          <div className="choice-row">
            {CHOICES.map((option) => (
              <label
                key={option.value}
                className={`choice${choice === option.value ? " active" : ""}`}
              >
                <span className="choice-top">
                  <input
                    type="radio"
                    name="theme"
                    value={option.value}
                    checked={choice === option.value}
                    onChange={() => setThemeChoice(option.value)}
                  />
                  <span className="choice-label">{option.label}</span>
                </span>
                <span className="choice-hint">{option.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="hint" style={{ marginTop: 14 }}>
          {choice === "system"
            ? `This device is asking for the ${theme} theme at the moment.`
            : `Every screen is in the ${theme} theme, whatever this device is set to.`}{" "}
          The printed book and its preview stay black on white either way — paper does not have a
          dark mode.
        </p>
      </div>
    </div>
  );
}

function TwoStep() {
  const { profile } = useAuth();
  const [factors, setFactors] = useState<TotpFactor[] | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Offered only where it works. A Copy button that silently does nothing is
  // worse than no Copy button, and the clipboard is missing from an insecure
  // context and from some browsers in private mode.
  const canCopy = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.writeText);

  async function load() {
    try {
      setFactors(await listAuthenticators());
    } catch (cause) {
      setError(message(cause));
      setFactors([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setEnrolment(await beginEnrolment(profile?.email || "Authenticator app"));
      setCode("");
      setCopied(false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Copies the key without its spaces. What is on screen is grouped in fours
   * so it can be read across to a second device; what goes to the clipboard is
   * the key itself, because it is going straight into a field that was never
   * asked to be forgiving.
   */
  async function copyKey(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Refused - the key is on screen and selectable, which is all the button
      // was ever a shortcut for.
    }
  }

  async function finish(event: React.FormEvent) {
    event.preventDefault();
    if (!enrolment) return;
    setBusy(true);
    setError(null);
    try {
      await confirmEnrolment(enrolment.factorId, code);
      setEnrolment(null);
      setCode("");
      setNote("Two-step sign-in is on. Keep the app on your phone — you will need it every time.");
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(factorId: string) {
    setError(null);
    setNote(null);
    await removeAuthenticator(factorId);
    setNote("Two-step sign-in is off. Your password is the only thing in the way now.");
    await load();
  }

  const on = (factors?.length ?? 0) > 0;

  return (
    <div className="card">
      <div className="card-head column">
        <h2>Two-step sign-in</h2>
        <span className="muted small">
          A six-digit code from an app on your phone, on top of your password.
        </span>
      </div>
      <div className="card-body">
        <p className="small">
          A directory is every family's address and telephone number in one list, and a password is
          one secret that can be guessed, reused or read over a shoulder. With this on, somebody who
          has the password still cannot get in without the phone in your pocket.
        </p>

        {factors === null ? (
          <span className="row tight">
            <span className="spinner" aria-hidden />
            <span className="muted small">Checking this account…</span>
          </span>
        ) : on ? (
          <>
            <Notice kind="ok">
              <strong>On.</strong> You will be asked for a code each time you sign in.
            </Notice>
            {factors.map((factor) => (
              <div key={factor.id} className="row factor">
                <span>
                  {factor.name}
                  <span className="muted small factor-when">
                    Added {describeWhen(factor.addedAt) || "recently"}
                  </span>
                </span>
                <span className="spacer" />
                <ConfirmButton
                  label="Turn off"
                  confirmLabel="Turn it off"
                  subtle
                  onConfirm={() => remove(factor.id)}
                />
              </div>
            ))}
          </>
        ) : enrolment ? (
          <form onSubmit={finish}>
            <ol className="steps">
              <li>
                <strong>Scan this with an authenticator app.</strong> Google Authenticator,
                Microsoft Authenticator, 1Password and Authy all do this.
                <figure className="qr">
                  <img
                    src={enrolment.qr}
                    alt="A QR code holding the setup key for this account"
                    width={176}
                    height={176}
                  />
                </figure>
              </li>
              <li>
                <strong>Or type the key</strong>, if the phone cannot photograph this screen.
                <div className="setup-key">
                  <code className="mono">{formatSetupKey(enrolment.secret)}</code>
                  {canCopy ? (
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => void copyKey(enrolment.secret)}
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  ) : null}
                </div>
              </li>
              <li>
                <strong>Then type the six-digit code it shows</strong>, to prove it arrived.
                <div className="field code-field">
                  <label htmlFor="enrol-code">Code</label>
                  <input
                    id="enrol-code"
                    className="code-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={CODE_LENGTH}
                    placeholder="000000"
                    value={code}
                    required
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  />
                </div>
              </li>
            </ol>

            <div className="row enrol-actions">
              <button
                type="submit"
                className="btn primary"
                disabled={busy || code.length !== CODE_LENGTH}
              >
                {busy ? "Checking…" : "Turn on"}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setEnrolment(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <Notice>
              <strong>Off.</strong> Your password is the only thing between this directory and
              anyone who learns it.
            </Notice>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void start()}
              style={{ marginTop: 14 }}
            >
              {busy ? "Working…" : "Set up an authenticator app"}
            </button>
          </>
        )}

        {error ? (
          <div style={{ marginTop: 14 }}>
            <Notice kind="error">{error}</Notice>
          </div>
        ) : null}
        {note ? (
          <div style={{ marginTop: 14 }}>
            <Notice kind="ok">{note}</Notice>
          </div>
        ) : null}

        {on ? (
          <p className="hint" style={{ marginTop: 14 }}>
            Signed in somewhere else? That browser will ask for a code the next time it checks in,
            which is within the hour. Lose the phone and nobody can lift this for you from inside
            the app — an owner deletes the account under Administrators and you sign up again with
            the same email address.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The two settings that belong to a person rather than to the congregation:
 * how the app looks on the device in front of them, and what it takes to sign
 * in as them. Backup and Administrators are next door and are about the
 * directory itself.
 */
export function SettingsPage() {
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Settings</h1>
          <div className="sub">How the app looks on this device, and how you sign in to it.</div>
        </div>
      </div>

      <div className="grid two" style={{ alignItems: "start" }}>
        <Appearance />
        <TwoStep />
      </div>
    </div>
  );
}
