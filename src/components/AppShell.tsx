import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Logo } from "@/components/Logo";
import { NotificationTray } from "@/components/NotificationTray";
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
  const { profile, role, canEdit, isOwner, signOut } = useAuth();
  const { households, people, tags } = useDirectory();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Where the crash screen's way out goes. Overview is the one screen that is
  // always there and never needs an id, so it is the safe place to land.
  const goHome = useCallback(() => void navigate("/"), [navigate]);

  // Following a link should put the drawer away.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  /*
   * A new screen starts at its top. Saving a new person or family is pressed
   * at the foot of a long form, and the record it opens kept that scroll - so
   * the name that had just been made was a long way up. Back and forward are
   * left alone, so a list comes back where it was left.
   *
   * Installed to the Home Screen the page scrolls #root rather than the
   * document (see app.css), so both are sent to the top.
   */
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType === "POP") return;
    window.scrollTo(0, 0);
    document.getElementById("root")?.scrollTo(0, 0);
  }, [location.pathname, navigationType]);

  /*
   * Installed to the Home Screen, the strip behind the home indicator is
   * painted from the document's background rather than from anything drawn
   * over it - so the document has to be told the drawer is open, or the
   * dimmed page ends on a pale bar. The stylesheet also says this with
   * :has(.scrim); this is the half that cannot fail to match.
   */
  useEffect(() => {
    document.documentElement.classList.toggle("drawer-open", menuOpen);
    return () => document.documentElement.classList.remove("drawer-open");
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

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
        {/* Twice in this file, and never twice on screen: the top bar is the
            phone's, the sidebar is the desk's, and the stylesheet shows
            whichever of the two that screen is using. */}
        <NotificationTray />
        <span className="pill role">{role ?? "no access"}</span>
      </header>

      {menuOpen ? <div className="scrim" onClick={() => setMenuOpen(false)} /> : null}

      <nav className={`sidebar${menuOpen ? " open" : ""}`}>
        {/*
         * The links scroll inside the drawer; the foot below them does not.
         * Ten links, four headings and the brand come to more than a phone is
         * tall, and what fell off the bottom was who you are signed in as and
         * the way back out - the two things that should never need hunting
         * for. Everything that can grow is in here. The foot is two lines,
         * whatever the congregation, and stays on screen.
         */}
        <div className="sidebar-scroll">
          <div className="brand">
            <Logo />
            <span className="app-name">Church Directory</span>
          </div>

          <Item to="/" label="Overview" />
          <NotificationTray />

          <div className="nav-section">Congregation</div>
          <Item to="/families" label="Families" count={households.length} />
          <Item to="/people" label="People" count={people.length} />
          <Item to="/groups" label="Groups" count={tags.length} />

          <div className="nav-section">Printing</div>
          <Item to="/projects" label="Directories" />
          <Item to="/tags" label="Name tags" />

          {canEdit ? (
            <>
              <div className="nav-section">Email</div>
              <Item to="/mailchimp" label="Mailchimp" />
            </>
          ) : null}

          <div className="nav-section">Settings</div>
          <Item to="/settings" label="Settings" />
          <Item to="/backup" label="Backup" />
          {isOwner ? <Item to="/administrators" label="Administrators" /> : null}
        </div>

        <div className="sidebar-foot">
          <div className="sidebar-who">
            <span className="sidebar-name">{profile?.full_name || profile?.email}</span>
            <span className="pill role">{role ?? "no access"}</span>
          </div>
          {/*
           * Sign out and the build share a line. Standing on the drawer for
           * good, every row this block takes is a row of links it covers, and
           * the count of people listed on their own that used to sit here is
           * the first sentence on the overview anyway.
           *
           * The build is here so that "which version are you on?" has an
           * answer that does not involve reading a URL bar that is not there.
           */}
          <div className="sidebar-foot-row">
            <button
              type="button"
              className="btn small sidebar-signout"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
            <div className="sidebar-version" title={`Build ${APP_VERSION}`}>
              <span>Version</span>
              <span className="sidebar-build">{APP_VERSION.slice(0, 7)}</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="main">
        {/*
         * Inside main, so a screen that throws leaves the navigation, the tray
         * and the sign-out button where they were. One page failing is then one
         * page failing, with somewhere to go from it, rather than the whole app
         * going white - which is what an uncaught render error does, and on a
         * phone opened from the Home Screen there is not even an address bar to
         * reload from.
         *
         * Keyed on the path, so walking away from a broken screen is enough to
         * clear it and no reload is needed.
         */}
        <ErrorBoundary resetKey={location.pathname} onGoHome={goHome}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
