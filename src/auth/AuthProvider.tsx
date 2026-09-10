import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { forgetPhotoUrls } from "@/lib/photos";
import { needsSecondStep } from "@/lib/mfa";
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
  /**
   * Signed in with a password, on an account that also has an authenticator
   * app. Nothing here is a matter of politeness: migration 0006 has the
   * database refuse every row to a session in this state, so the app shows the
   * code screen rather than a directory that would come back empty.
   */
  awaitingSecondStep: boolean;
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
  const [awaitingSecondStep, setAwaitingSecondStep] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  /**
   * Which profile lookup is the current one.
   *
   * Two of these can be in the air at once - the first read on load, and the
   * one onAuthStateChange starts the moment it subscribes - and a sign-out
   * followed by a sign-in starts more. They are separate requests over a
   * network, so they can come back in any order, and the last answer to arrive
   * would win regardless of which question it answered. On a shared church
   * office computer that means the previous person's role deciding what the
   * next one is allowed to edit. Each call takes a ticket and only the newest
   * one is allowed to write.
   */
  const latestLoad = useRef(0);

  /**
   * Who the last auth event was about.
   *
   * Supabase re-announces SIGNED_IN every time the tab becomes visible again -
   * _recoverAndRefresh does it from its own visibilitychange listener - and a
   * token refresh says the same thing on the hour. Neither is a new person, and
   * telling them apart is the whole job of this ref.
   */
  const lastUser = useRef<string | undefined>(undefined);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    const ticket = (latestLoad.current += 1);
    const current = () => latestLoad.current === ticket;

    if (!userId) {
      if (!current()) return;
      setProfile(null);
      setProfileError(null);
      setAwaitingSecondStep(false);
      setProfileLoaded(true);
      return;
    }

    // Asked here rather than on its own, so that one wait decides what screen
    // comes up. It reads the token the browser already holds, so it costs no
    // request; asking it on every auth event is what eventually moves a
    // session left open on another device onto the code screen, at the next
    // token refresh, when an authenticator is set up somewhere else.
    const secondStep = await needsSecondStep();
    if (!current()) return;
    setAwaitingSecondStep(secondStep);

    // Their own row, and only their own: until the second step is done every
    // policy in the database treats this session as a stranger, and the one
    // read still open to it is the one that lets the app say who is signing in.
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (!current()) return;

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
      lastUser.current = data.session?.user.id;
      await loadProfile(data.session?.user.id);
      if (active) setReady(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUser = nextSession?.user.id;
      setSession(nextSession);
      // Only when the person actually changes. Blanking this on every event sent
      // Protected back to its loading screen, which unmounts everything below it
      // - so returning to the app from an authenticator threw away the enrolment
      // pane, and any half-filled family or person form with it. There is nothing
      // to hide while the same profile reloads: it is still the right one.
      if (nextUser !== lastUser.current) setProfileLoaded(false);
      lastUser.current = nextUser;
      // The profile row is created by a database trigger on first sign-up, so
      // it may appear a moment after the session does.
      void loadProfile(nextUser);
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
      awaitingSecondStep,
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
        setAwaitingSecondStep(false);
      },

      async refreshProfile() {
        await loadProfile(session?.user.id);
      },
    };
  }, [
    session,
    profile,
    profileLoaded,
    profileError,
    ready,
    loading,
    awaitingSecondStep,
    loadProfile,
  ]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = use(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
