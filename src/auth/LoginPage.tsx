import { useState } from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "./AuthProvider";

/**
 * Sign in, or create the very first account.
 *
 * The database gives the first person to sign up the owner role and creates
 * every later account with no access at all, so a brand new project can be
 * claimed without anyone touching a service key — and a stranger who finds the
 * URL cannot see a single name until an owner lets them in.
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
    <div className="auth-screen">
      <div className="auth-inner">
        <Logo className="auth-logo" />

        <div className="auth-card">
          <h1 className="auth-title">
            {mode === "signin" ? "Church Directory" : "Create an account"}
          </h1>
          <p className="auth-sub">
            {mode === "signin"
              ? "Sign in to manage the directory. Administrators only."
              : "The first account created owns the directory. Any later account waits for an owner to grant access."}
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
                autoCapitalize="none"
                spellCheck={false}
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

            {error ? (
              <div className="notice error" style={{ marginBottom: 14 }}>
                {error}
              </div>
            ) : null}
            {message ? (
              <div className="notice ok" style={{ marginBottom: 14 }}>
                {message}
              </div>
            ) : null}

            <button type="submit" className="btn primary auth-submit" disabled={loading}>
              {loading ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="auth-switch">
            {mode === "signin"
              ? "Setting this up for the first time? "
              : "Already have an account? "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
                setMessage(null);
              }}
            >
              {mode === "signin" ? "Create the first account" : "Sign in instead"}
            </button>
          </div>
        </div>

        <p className="auth-foot">
          Directory information is private to this church and is not published.
        </p>
      </div>
    </div>
  );
}
