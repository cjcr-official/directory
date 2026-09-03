import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/auth/AuthProvider";
import { useDirectory } from "@/data/DirectoryContext";
import { APP_VERSION } from "@/lib/version";

function Item({ to, label, count }: { to: string; label: string; count?: number }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
      end={to === "/"}
    >
      <span>{label}</span>
      {count === undefined ? null : <span className="count">{count}</span>}
    </NavLink>
  );
}

export function AppShell() {
  const { profile, role, isOwner, signOut } = useAuth();
  const { households, people, tags } = useDirectory();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Following a link should put the drawer away.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const individuals = people.filter((person) => !person.household_id).length;

  return (
    <div className="shell">
      <header className="topbar">
        <button
          type="button"
          className="menu-btn"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            {menuOpen ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
            )}
          </svg>
        </button>
        <Logo className="topbar-logo" />
        <span className="spacer" />
        <span className="pill role">{role ?? "no access"}</span>
      </header>

      {menuOpen ? <div className="scrim" onClick={() => setMenuOpen(false)} /> : null}

      <nav className={`sidebar${menuOpen ? " open" : ""}`}>
        <div className="brand">
          <Logo />
          <span className="app-name">Church Directory</span>
        </div>

        <Item to="/" label="Overview" />

        <div className="nav-section">Congregation</div>
        <Item to="/families" label="Families" count={households.length} />
        <Item to="/people" label="People" count={people.length} />
        <Item to="/groups" label="Groups" count={tags.length} />

        <div className="nav-section">Printing</div>
        <Item to="/projects" label="Directories" />

        <div className="nav-section">Settings</div>
        <Item to="/backup" label="Backup" />
        {isOwner ? <Item to="/administrators" label="Administrators" /> : null}

        <div className="sidebar-foot">
          <div className="sidebar-who">
            <span className="sidebar-name">{profile?.full_name || profile?.email}</span>
            <span className="pill role">{role ?? "no access"}</span>
          </div>
          {individuals > 0 ? (
            <div className="muted small">{individuals} listed on their own</div>
          ) : null}
          <div className="sidebar-actions">
            <button type="button" className="btn small" onClick={() => void signOut()}>
              Sign out
            </button>
            {/* So "which version are you on?" has an answer that does not
                involve reading a URL bar that is not there. */}
            <span className="sidebar-version" title={`Build ${APP_VERSION}`}>
              Version {APP_VERSION.slice(0, 7)}
            </span>
          </div>
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
