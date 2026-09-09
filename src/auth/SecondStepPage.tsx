import { useState } from "react";
import { Logo } from "@/components/Logo";
import { CODE_LENGTH, completeSecondStep } from "@/lib/mfa";
import { useAuth } from "./AuthProvider";

/**
 * The second half of signing in, for an account with an authenticator app.
 *
 * Drawn as its own screen rather than as a second field on the sign-in form,
 * because it is a second moment: the password has already been accepted and
 * the code being asked for did not exist when it was typed. It is also where a
 * session that has gone stale lands - somebody who set up an authenticator on
 * their phone this morning meets this on the office computer this afternoon,
 * with nothing else on screen to alarm them.
 *
 * There is a way out that is not a code. Somebody who has lost the phone needs
 * to be able to leave without closing the tab - and then to be told the truth
 * about what happens next, which is that nothing in the browser can lift this.
 * Removing an authenticator from somebody else's account needs the service
 * role key, and the whole design of this app is that no browser ever holds
 * one. What an owner can do is delete the account outright, after which the
 * same person signs up again and is given their role back.
 */
export function SecondStepPage() {
  const { profile, signOut } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = code.trim().length === CODE_LENGTH;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await completeSecondStep(code);
      // Nothing to do on success: Supabase issues a session at the higher
      // level, the auth listener picks it up, and the app is behind it.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-inner">
        <Logo className="auth-logo" />

        <div className="auth-card">
          <h1 className="auth-title">One more step</h1>
          <p className="auth-sub">
            {profile?.email ? <>Signed in as {profile.email}. </> : null}
            Open your authenticator app and type the six-digit code it is showing.
          </p>

          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="code">Code</label>
              <input
                id="code"
                className="code-input"
                type="text"
                /* The phone's number pad, the code from a text or an
                   authenticator offered above the keyboard, and none of the
                   corrections a browser applies to prose. */
                inputMode="numeric"
                autoComplete="one-time-code"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                maxLength={CODE_LENGTH}
                placeholder="000000"
                value={code}
                required
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              />
            </div>

            {error ? (
              <div className="notice error" style={{ marginBottom: 14 }}>
                {error}
              </div>
            ) : null}

            <button type="submit" className="btn primary auth-submit" disabled={busy || !ready}>
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>

          <div className="auth-switch">
            Lost the phone with the app on it?{" "}
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>

        <p className="auth-foot">
          Nobody can turn this off for you from inside the app. An owner can delete the account
          under Administrators, and you can then sign up again with the same email address.
        </p>
      </div>
    </main>
  );
}
