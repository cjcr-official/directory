import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { LoginPage } from "@/auth/LoginPage";
import { AccountNotReady } from "@/auth/AccountNotReady";
import { AppShell } from "@/components/AppShell";
import { DirectoryProvider } from "@/data/DirectoryContext";
import { LoadingScreen, Notice } from "@/components/ui";
import { isConfigured } from "@/lib/supabase";
import { SetupPage } from "@/pages/SetupPage";
import { SamplePage } from "@/pages/SamplePage";
import { OverviewPage } from "@/pages/OverviewPage";
import { FamiliesPage } from "@/pages/FamiliesPage";
import { FamilyEditPage } from "@/pages/FamilyEditPage";
import { PeoplePage } from "@/pages/PeoplePage";
import { PersonEditPage } from "@/pages/PersonEditPage";
import { GroupsPage } from "@/pages/GroupsPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectEditPage } from "@/pages/ProjectEditPage";
import { ProjectPreviewPage } from "@/pages/ProjectPreviewPage";
import { AdministratorsPage } from "@/pages/AdministratorsPage";
import { BackupPage } from "@/pages/BackupPage";

function Protected() {
  const { session, profile, profileLoaded, ready, role, signOut } = useAuth();

  if (!ready) return <LoadingScreen />;
  if (!session) return <LoginPage />;

  if (!profileLoaded) return <LoadingScreen label="Signing you in…" />;

  // Signed in, but nothing behind it. Never a spinner: that state has causes a
  // person can actually fix, so say which one it is.
  if (!profile) return <AccountNotReady />;

  if (!role) {
    return (
      <div className="centered">
        <div className="card">
          <div className="card-body">
            <h1 style={{ fontSize: "1.15rem", marginBottom: 10 }}>Waiting for access</h1>
            <Notice kind="warn">
              Your account exists but has not been given access to this directory yet. Ask an owner
              to grant it — they will find you listed under Administrators.
            </Notice>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 14 }}
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DirectoryProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="families" element={<FamiliesPage />} />
          <Route path="families/new" element={<FamilyEditPage />} />
          <Route path="families/:id" element={<FamilyEditPage />} />
          <Route path="people" element={<PeoplePage />} />
          <Route path="people/new" element={<PersonEditPage />} />
          <Route path="people/:id" element={<PersonEditPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<ProjectEditPage />} />
          <Route path="projects/:id" element={<ProjectEditPage />} />
          <Route path="backup" element={<BackupPage />} />
          <Route path="administrators" element={<AdministratorsPage />} />
        </Route>
        {/* Full-bleed, outside the shell: the preview needs the whole window. */}
        <Route path="projects/:id/preview" element={<ProjectPreviewPage />} />
        <Route path="sample" element={<SamplePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DirectoryProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      {isConfigured ? (
        <AuthProvider>
          <Protected />
        </AuthProvider>
      ) : (
        // No database yet: explain the setup, but still let anyone flip through
        // a sample book to see what they are signing up for.
        <Routes>
          <Route path="/sample" element={<SamplePage />} />
          <Route path="*" element={<SetupPage />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
