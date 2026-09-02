import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { forgetPhotoUrls } from "@/lib/photos";
import type { AppRole, ProfileRow } from "@/lib/database.types";

interface AuthState {
  session: Session | null;
  profile: ProfileRow | null;
  loading: boolean;
  /** True once we know whether someone is signed in. */
  ready: boolean;
  role: AppRole | null;
  canEdit: boolean;
  isOwner: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(
    email: string,
    password: string,
    fullName: string,
  ): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    setProfile((data as ProfileRow | null) ?? null);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (active) setReady(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      // The profile row is created by a database trigger on first sign-up, so
      // it may appear a moment after the session does.
      void loadProfile(nextSession?.user.id);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthState>(() => {
    const role = profile?.is_active ? profile.role : null;
    return {
      session,
      profile,
      ready,
      loading,
      role,
      canEdit: role === "owner" || role === "editor",
      isOwner: role === "owner",

      async signIn(email, password) {
        setLoading(true);
        try {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw new Error(error.message);
        } finally {
          setLoading(false);
        }
      },

      async signUp(email, password, fullName) {
        setLoading(true);
        try {
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
          });
          if (error) throw new Error(error.message);
          // With email confirmation switched on, Supabase returns a user but
          // no session until the link is clicked.
          return { needsConfirmation: !data.session };
        } finally {
          setLoading(false);
        }
      },

      async signOut() {
        await supabase.auth.signOut();
        forgetPhotoUrls();
        setProfile(null);
      },

      async refreshProfile() {
        await loadProfile(session?.user.id);
      },
    };
  }, [session, profile, ready, loading, loadProfile]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = use(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
