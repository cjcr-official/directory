import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "./AuthProvider";

/**
 * Shown when sign-in worked but there is no profile row behind it.
 *
 * This used to be an endless spinner, which told nobody anything. There are
 * only two real causes and each has a one-line fix, so the screen names which
 * one it is and gets out of the way.
 */
export function AccountNotReady() {
  const { profileError, refreshProfile, signOut, session } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const [retried, setRetried] = useState(false);

  // The sign-up trigger writes the row a moment after the session appears, so
  // one automatic retry covers the genuine race before blaming the setup.
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshProfile().finally(() => setRetried(true));
    }, 1500);
    return () => clearTimeout(timer);
  }, [refreshProfile]);

  const schemaMissing =
    !!profileError && /does not exist|find the table|schema cache|relation/i.test(profileError);

  async function retry() {
    setRetrying(true);
    try {
      await refreshProfile();
    } finally {
      setRetrying(false);
    }
  }

  if (!retried) {
    return (
      <main className="auth-screen">
        <div className="auth-inner" style={{ textAlign: "center" }}>
          <Logo className="auth-logo" />
          <span className="spinner" style={{ margin: "0 auto" }} aria-hidden />
          <p className="auth-foot">Signing you in…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <div className="auth-inner">
        <Logo className="auth-logo" />

        <div className="auth-card">
          <h1 className="auth-title">Almost there</h1>
          <p className="auth-sub">
            You signed in as <strong>{session?.user.email}</strong>, but the database has no profile
            for that account yet.
          </p>

          {schemaMissing ? (
            <div className="notice warn">
              <strong>The database tables have not been created.</strong> In Supabase, open the SQL
              Editor and run{" "}
              <span className="mono">supabase/migrations/0001_initial_schema.sql</span>, then{" "}
              <span className="mono">0002_storage.sql</span>.
            </div>
          ) : (
            <div className="notice warn">
              <strong>
                This usually means the account was created before the database setup finished.
              </strong>{" "}
              Re-run <span className="mono">supabase/migrations/0001_initial_schema.sql</span> in
              the Supabase SQL Editor — it repairs accounts in exactly this state, and is safe to
              run twice. Then come back and press Try again.
            </div>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn primary"
              disabled={retrying}
              onClick={() => void retry()}
            >
              {retrying ? "Checking…" : "Try again"}
            </button>
            <button type="button" className="btn ghost" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>

          {profileError ? (
            <details style={{ marginTop: 16 }}>
              <summary className="muted small" style={{ cursor: "pointer" }}>
                What the database said
              </summary>
              <p className="mono small" style={{ marginTop: 8, color: "var(--ink-3)" }}>
                {profileError}
              </p>
            </details>
          ) : null}
        </div>

        <p className="auth-foot">
          Nothing is lost — your sign-in is fine, only the profile is missing.
        </p>
      </div>
    </main>
  );
}
