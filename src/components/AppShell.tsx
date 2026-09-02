import { NavLink, Outlet } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/auth/AuthProvider";
import { useDirectory } from "@/data/DirectoryContext";

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

  const individuals = people.filter((person) => !person.household_id).length;

  return (
    <div className="shell">
      <nav className="sidebar">
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
          <div style={{ fontWeight: 600 }}>{profile?.full_name || profile?.email}</div>
          <div className="row tight" style={{ marginTop: 5 }}>
            <span className="pill role">{role ?? "no access"}</span>
            <button type="button" className="btn ghost small" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
          {individuals > 0 ? (
            <div className="muted small" style={{ marginTop: 8 }}>
              {individuals} listed on their own
            </div>
          ) : null}
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
