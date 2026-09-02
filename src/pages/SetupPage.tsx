/**
 * Shown when the app has not been pointed at a Supabase project yet, so a
 * fresh clone explains itself instead of failing with a network error.
 */
import { Link } from "react-router-dom";

export function SetupPage() {
  return (
    <div className="centered wide">
      <div className="card">
        <div className="card-body">
          <div className="brand" style={{ padding: "0 0 14px" }}>
            <span className="brand-mark" aria-hidden>
              ✝
            </span>
            <span>Church Directory</span>
          </div>

          <h1 style={{ fontSize: "1.2rem", marginBottom: 8 }}>Connect your database</h1>
          <p className="muted small">
            This app stores its data in Supabase. It takes about five minutes to set up, once.
          </p>

          <ol className="small" style={{ paddingLeft: 20, lineHeight: 1.85, marginTop: 14 }}>
            <li>
              Create a free project at{" "}
              <a href="https://supabase.com" target="_blank" rel="noreferrer">
                supabase.com
              </a>
              .
            </li>
            <li>
              Open <strong>SQL Editor</strong> and run the two files in{" "}
              <span className="mono">supabase/migrations/</span>, in order.
            </li>
            <li>
              Copy <strong>Project URL</strong> and <strong>anon public</strong> key from{" "}
              <strong>Project Settings → API</strong>.
            </li>
            <li>
              Put them in a file called <span className="mono">.env.local</span> next to{" "}
              <span className="mono">package.json</span>:
            </li>
          </ol>

          <pre
            className="mono"
            style={{
              background: "var(--canvas)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-sm)",
              padding: "12px 14px",
              overflowX: "auto",
              fontSize: "0.8rem",
            }}
          >
            {`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
          </pre>

          <p className="muted small" style={{ marginTop: 12 }}>
            Then restart the dev server. When deploying to Cloudflare, set the same two values as
            environment variables on the project — they are read at build time.
          </p>

          <div className="row" style={{ marginTop: 16 }}>
            <Link className="btn primary" to="/sample">
              See a sample directory
            </Link>
            <span className="muted small">
              No account needed — it runs entirely in this browser.
            </span>
          </div>

          <div className="notice" style={{ marginTop: 14 }}>
            <strong>Is the anon key a secret?</strong> No. It is meant to ship in the browser. Every
            table is protected by row level security, so a signed-in administrator account is
            required before any name, address or photo can be read.
          </div>
        </div>
      </div>
    </div>
  );
}
