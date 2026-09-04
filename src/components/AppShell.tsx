import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/auth/AuthProvider";
import { useDirectory } from "@/data/DirectoryContext";
import { APP_VERSION } from "@/lib/version";

/*
 * TEMPORARY. Reading the boxes off the phone, because a band across the foot
 * of the screen has now survived three fixes reasoned out from a desktop, and
 * the desktop is where every one of them looked right. It prints, in order:
 * the window, the visual viewport, html, body, #root, the screen, the bottom
 * safe-area inset, and where the drawer and the scrim actually end.
 *
 * Delete this and the .probe rule with it once the numbers are in hand.
 */
function ViewportProbe() {
  const [text, setText] = useState("measuring");
  const inset = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bottomOf = (selector: string) => {
      const el = document.querySelector(selector);
      return el ? Math.round(el.getBoundingClientRect().bottom) : 0;
    };
    const read = () => {
      const safeArea = inset.current
        ? Math.round(parseFloat(getComputedStyle(inset.current).paddingBottom))
        : -1;
      setText(
        [
          `win ${Math.round(window.innerHeight)}`,
          `vis ${Math.round(window.visualViewport?.height ?? 0)}`,
          `html ${document.documentElement.clientHeight}`,
          `body ${document.body.clientHeight}`,
          `root ${document.getElementById("root")?.clientHeight ?? 0}`,
          `scrn ${window.screen.height}`,
          `inset ${safeArea}`,
          `drawer ${bottomOf(".sidebar")}`,
          `dim ${bottomOf(".scrim")}`,
          `dpr ${window.devicePixelRatio}`,
        ].join("  "),
      );
    };
    read();
    const again = setInterval(read, 400);
    window.addEventListener("resize", read);
    return () => {
      clearInterval(again);
      window.removeEventListener("resize", read);
    };
  }, []);

  return (
    <>
      <div ref={inset} className="probe-inset" />
      <div className="probe">{text}</div>
    </>
  );
}

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
  const { households, people, tags, entries } = useDirectory();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Following a link should put the drawer away.
  useEffect(() => setMenuOpen(false), [location.pathname]);

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

  // From the entries the book is built from, for the same reason the overview
  // counts that way: people here is every row, inactive included.
  const individuals = entries.filter((entry) => entry.type === "person").length;

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

        <ViewportProbe />

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
          <button
            type="button"
            className="btn small sidebar-signout"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
          {/* So "which version are you on?" has an answer that does not
              involve reading a URL bar that is not there. */}
          <div className="sidebar-version" title={`Build ${APP_VERSION}`}>
            <span>Version</span>
            <span className="sidebar-build">{APP_VERSION.slice(0, 7)}</span>
          </div>
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
