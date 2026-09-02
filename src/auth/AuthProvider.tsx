import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { forgetPhotoUrls } from "@/lib/photos";
import type { AppRole, ProfileRow } from "@/lib/database.types";

interface AuthState {
  session: Session | null;
  profile: ProfileRow | null;
  /** True once a profile lookup has finished, whether or not it found one. */
  profileLoaded: boolean;
  /** Why the lookup failed, when it did. Surfaced so a broken setup explains itself. */
  profileError: string | null;
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
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      setProfileError(null);
      setProfileLoaded(true);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    // Swallowing this is what turned a missing table into a spinner that never
    // stopped; the message names the problem, so it gets kept and shown.
    setProfileError(error ? error.message : null);
    setProfile(error ? null : ((data as ProfileRow | null) ?? null));
    setProfileLoaded(true);
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
      setProfileLoaded(false);
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
      profileLoaded,
      profileError,
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
        setProfileError(null);
      },

      async refreshProfile() {
        await loadProfile(session?.user.id);
      },
    };
  }, [session, profile, profileLoaded, profileError, ready, loading, loadProfile]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = use(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
