import { useState } from "react";
import { useAuth } from "./AuthProvider";

/**
 * Sign in, or create the very first account.
 *
 * The database gives the first person to sign up the owner role and everybody
 * after them read-only access, so a brand new project can be claimed without
 * anyone touching a service key - and a stranger who finds the URL cannot
 * promote themselves.
 */
export function LoginPage() {
  const { signIn, signUp, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
      } else {
        const { needsConfirmation } = await signUp(email.trim(), password, fullName.trim());
        if (needsConfirmation) {
          setMessage("Check your email for a confirmation link, then sign in.");
          setMode("signin");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="centered">
      <div className="card">
        <div className="card-body">
          <div className="brand" style={{ padding: "0 0 16px" }}>
            <span className="brand-mark" aria-hidden>✝</span>
            <span>Church Directory</span>
          </div>

          <h1 style={{ fontSize: "1.25rem", marginBottom: 4 }}>
            {mode === "signin" ? "Sign in" : "Create an account"}
          </h1>
          <p className="muted small" style={{ marginBottom: 18 }}>
            {mode === "signin"
              ? "Administrators only. Directory information is not public."
              : "The first account created owns this directory. Any later account starts with no access until an owner grants it."}
          </p>

          <form onSubmit={submit}>
            {mode === "signup" ? (
              <div className="field">
                <label htmlFor="fullName">Your name</label>
                <input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  required
                  onChange={(event) => setFullName(event.target.value)}
                />
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                required
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error ? <div className="notice error" style={{ marginBottom: 12 }}>{error}</div> : null}
            {message ? <div className="notice ok" style={{ marginBottom: 12 }}>{message}</div> : null}

            <button type="submit" className="btn primary" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
              {loading ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="muted small" style={{ marginTop: 16, textAlign: "center" }}>
            {mode === "signin" ? "First time setting this up? " : "Already have an account? "}
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}
            >
              {mode === "signin" ? "Create the first account" : "Sign in instead"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
