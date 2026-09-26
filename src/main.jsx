import { StrictMode, useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import posthog from "posthog-js";
import * as Sentry from "@sentry/react";
import { supabase } from "./supabase";
import Auth from "./Auth.jsx";
import ForgotPassword from "./ForgotPassword.jsx";
import ResetPassword from "./ResetPassword.jsx";
import Landing from "./Landing.jsx";
import Privacy from "./Privacy.jsx";
import Terms from "./Terms.jsx";
import Home from "./Home.jsx";
import App from "./App.jsx";
import TripPublicView from "./TripPublicView.jsx";
import JoinTrip, { takePendingJoin } from "./JoinTrip.jsx";
import AdminConsole from "./Admin.jsx";
import CreditsOverlay from "./CreditsOverlay.jsx";
import DialogHost from "./dialogs.jsx";
import AddRealEmailPrompt from "./AddRealEmailPrompt.jsx";
import Avatar from "./Avatar.jsx";
import LowCreditsBanner from "./LowCreditsBanner.jsx";
import { refreshCredits, CREDITS_UI_ENABLED } from "./credits";
import { initRevenueCat } from "./billing";

// ── Android status bar (APK only): lay the webview out BELOW the status
// bar instead of behind it — headers were rendering under the clock/battery
// row. Config lives in capacitor.config.json; this runtime call is the
// belt-and-braces for devices that ignore the config at cold start.
(async () => {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: "#FAF6F0" });
    await StatusBar.setStyle({ style: Style.Light });
  } catch {
    /* web build or plugin unavailable — nothing to do */
  }
})();

// ── Sentry (no-op when VITE_SENTRY_DSN is not set) ──
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_APP_ENV || "unknown",
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],
    // Performance: 10% of transactions
    tracesSampleRate: 0.1,
    // Session replays: 1% of all sessions, 100% of sessions that hit an error
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 1.0,
    // Filter out browser-extension noise + cancelled fetches
    ignoreErrors: [
      "ResizeObserver loop completed",
      "Non-Error promise rejection captured",
      /AbortError/,
    ],
  });
}

// ── PWA update check — reload on new version ──
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready.then((registration) => {
    // Check for updates every 5 minutes
    setInterval(() => registration.update(), 5 * 60 * 1000);
    // Auto-reload when new service worker activates
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}

// ── PostHog ──
if (import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    persistence: "localStorage",
  });
  posthog.register({ app_env: import.meta.env.VITE_APP_ENV || "unknown" });
}

// ── URL helpers ──

function parseUrl(path = window.location.pathname) {
  // Public share view — separate namespace from trip
  const publicMatch = path.match(/^\/share\/([a-f0-9-]{36})$/);
  if (publicMatch) return { page: "public", token: publicMatch[1] };
  // Collaboration invite link — /join/:token. Real tokens are uuids, but
  // malformed/truncated links must still reach JoinTrip so the visitor gets
  // "invite no longer valid" instead of silently landing on Home.
  const joinMatch = path.match(/^\/join\/([^/]+)$/);
  if (joinMatch) return { page: "join", token: joinMatch[1] };
  if (path === "/signin" || path === "/login") return { page: "signin" };
  if (path === "/signup") return { page: "signup" };
  if (path === "/forgot-password") return { page: "forgot-password" };
  if (path === "/reset-password") return { page: "reset-password" };
  if (path === "/privacy") return { page: "privacy" };
  if (path === "/terms") return { page: "terms" };
  // Legacy /trip/:token format — only if no suffix (backwards compat)
  const legacyPublic = path.match(/^\/trip\/([a-f0-9-]{36})$/);
  // Check suffixed routes first (these are always authenticated trip views)
  const routesMatch = path.match(/^\/trip\/([^/]+)\/plans$/);
  if (routesMatch) return { page: "edit", tripId: routesMatch[1] };
  const tabMatch = path.match(/^\/trip\/([^/]+)\/(magazine|map|board)$/);
  if (tabMatch) {
    // URL uses the friendly slug "magazine"; the App state still uses the legacy key
    // "brainstorm" for that tab. Translate at the parse boundary so deep-links + reloads
    // on /trip/:id/magazine actually render the Magazine view (otherwise the tab key
    // doesn't match any render branch and the view is blank).
    const tab = tabMatch[2] === "magazine" ? "brainstorm" : tabMatch[2];
    return { page: "trip", tripId: tabMatch[1], tab };
  }
  // /trip/:id — authenticated trip view (UUID is a trip ID, not a share token)
  const tripMatch = path.match(/^\/trip\/([^/]+)$/);
  if (tripMatch) return { page: "trip", tripId: tripMatch[1] };
  if (path === "/admin") return { page: "admin" };
  const newStepMatch = path.match(/^\/new(?:\/(\d))?$/);
  if (newStepMatch)
    return {
      page: "create",
      step: newStepMatch[1] ? parseInt(newStepMatch[1]) : 0,
    };
  return { page: "home" };
}

function pushUrl(path) {
  if (window.location.pathname !== path) {
    window.history.pushState(null, "", path);
  }
}

// ── Root ──

function Root() {
  const [session, setSession] = useState(undefined);
  const [screen, setScreen] = useState("home");
  const [activeTrip, setActiveTrip] = useState(null);
  const [initialTab, setInitialTab] = useState(null);
  const [initialStep, setInitialStep] = useState(0);
  // urlVersion bumps on popstate so unauthed routes (Landing↔Auth) re-render
  // when the path changes via pushState + dispatched PopStateEvent.
  const [, setUrlVersion] = useState(0);

  useEffect(() => {
    // Fall back to Landing after 8 s if Supabase is unreachable (e.g. paused
    // project, offline). onAuthStateChange re-authenticates once it comes back.
    const fallback = setTimeout(() => setSession(null), 8000);
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        clearTimeout(fallback);
        setSession(session);
      })
      .catch(() => {
        clearTimeout(fallback);
        setSession(null);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // Identify user in PostHog
      if (s?.user) {
        posthog.identify(s.user.id, { email: s.user.email });
        if (import.meta.env.VITE_SENTRY_DSN) {
          Sentry.setUser({ id: s.user.id, email: s.user.email });
        }
        if (CREDITS_UI_ENABLED) refreshCredits(s.user.id);
        initRevenueCat(s.user.id);
      } else {
        posthog.reset();
        if (import.meta.env.VITE_SENTRY_DSN) Sentry.setUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadTrip = useCallback(async (tripId) => {
    const { data } = await supabase
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .single();
    return data;
  }, []);

  // Resolve initial URL on session load
  useEffect(() => {
    if (!session) return;
    // Resume a pending invite after the user signed in to accept it.
    const pendingJoin = takePendingJoin();
    if (pendingJoin) {
      pushUrl(`/join/${pendingJoin}`);
      setUrlVersion((v) => v + 1);
      return;
    }
    const route = parseUrl();
    if (route.page === "trip" || route.page === "edit") {
      loadTrip(route.tripId).then((trip) => {
        if (trip) {
          setActiveTrip(trip);
          setScreen(route.page === "edit" ? "edit" : "trip");
          if (route.tab) setInitialTab(route.tab);
        } else {
          pushUrl("/");
        }
      });
    } else if (route.page === "create") {
      setScreen("create");
      setInitialStep(route.step || 0);
    }
  }, [session]);

  // Browser back/forward
  useEffect(() => {
    const onPopState = () => {
      setUrlVersion((v) => v + 1);
      const route = parseUrl();
      if (route.page === "home") {
        setActiveTrip(null);
        setScreen("home");
      } else if (route.page === "create") {
        setScreen("create");
        setInitialStep(route.step || 0);
      } else if (route.page === "trip" || route.page === "edit") {
        if (activeTrip?.id === route.tripId) {
          setScreen(route.page === "edit" ? "edit" : "trip");
          if (route.tab) setInitialTab(route.tab);
        } else {
          loadTrip(route.tripId).then((trip) => {
            if (trip) {
              setActiveTrip(trip);
              setScreen(route.page === "edit" ? "edit" : "trip");
              if (route.tab) setInitialTab(route.tab);
            }
          });
        }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [activeTrip?.id]);

  const openTrip = (trip) => {
    setActiveTrip(trip);
    setScreen("trip");
    pushUrl(`/trip/${trip.id}`);
  };

  const goHome = () => {
    setActiveTrip(null);
    setScreen("home");
    pushUrl("/");
  };

  // Public view — no auth
  const route = parseUrl();
  if (route.page === "public") return <TripPublicView token={route.token} />;
  // Legal pages — public, render regardless of session state
  if (route.page === "privacy") return <Privacy />;
  if (route.page === "terms") return <Terms />;
  // Password reset flow — render regardless of session state.
  //   /forgot-password: user enters email to request reset link (no session needed).
  //   /reset-password:  Supabase auto-signs the user in via PASSWORD_RECOVERY
  //     when they land here from the email link, so they may already have a
  //     session by the time this renders. Either way the component handles it.
  if (route.page === "forgot-password") return <ForgotPassword />;
  if (route.page === "reset-password") return <ResetPassword />;

  if (session === undefined) return null;

  // Collaboration invite landing — renders whether or not the user is signed in
  // (signed out → "Sign in to join" which stashes the token and resumes after auth).
  if (route.page === "join") {
    const joinNavigate = (p) => {
      if (p === "/") {
        goHome();
        return;
      }
      pushUrl(p);
      setUrlVersion((v) => v + 1);
    };
    const openTripById = async (tripId) => {
      const trip = await loadTrip(tripId);
      if (trip) openTrip(trip);
      else goHome();
    };
    return (
      <JoinTrip
        token={route.token}
        session={session}
        onNavigate={joinNavigate}
        onOpenTripById={openTripById}
      />
    );
  }

  if (!session) {
    // Landing page for unauthenticated visitors at "/".
    // Explicit signin/signup paths jump straight to Auth.
    // Any other path (deep-link) falls back to Auth so user can sign in then continue.
    if (route.page === "home") return <Landing />;
    if (route.page === "signup") return <Auth initialMode="signup" />;
    return <Auth initialMode="signin" />;
  }

  // Admin console — auth check is inside the component
  if (route.page === "admin") {
    return (
      <>
        <AdminConsole
          session={session}
          onHome={() => {
            pushUrl("/");
            window.location.reload();
          }}
        />
        <AddRealEmailPrompt session={session} />
        {CREDITS_UI_ENABLED && <LowCreditsBanner session={session} />}
        <Avatar session={session} />
        {CREDITS_UI_ENABLED && <CreditsOverlay session={session} />}
      </>
    );
  }

  // Deep link to a trip while its row is still loading: show a quiet
  // interstitial instead of flashing the Home list (screen stays "home"
  // until loadTrip resolves; a failed load pushes "/" and Home renders).
  if (
    screen === "home" &&
    !activeTrip &&
    (route.page === "trip" || route.page === "edit")
  ) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          background: "#FAF6F0",
          fontFamily: "Georgia,serif",
        }}
      >
        <style>{`@keyframes tjPulse{0%,100%{opacity:0.45;}50%{opacity:0.9;}}`}</style>
        <div
          style={{
            fontFamily: "'DM Serif Display',Georgia,serif",
            fontSize: 26,
            color: "#0F1923",
          }}
        >
          TripJam
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#587284",
            animation: "tjPulse 1.4s ease-in-out infinite",
          }}
        >
          Opening trip…
        </div>
      </div>
    );
  }

  if (screen === "home") {
    return (
      <>
        <Home
          session={session}
          onOpenTrip={openTrip}
          onOpenTripById={async (tripId) => {
            const trip = await loadTrip(tripId);
            if (trip) openTrip(trip);
          }}
          onCreateTrip={() => {
            setActiveTrip(null);
            setScreen("create");
            setInitialStep(0);
            pushUrl("/new/0");
          }}
          onEditTrip={(trip) => {
            setActiveTrip(trip);
            setScreen("edit");
            pushUrl(`/trip/${trip.id}/plans`);
          }}
        />
        <AddRealEmailPrompt session={session} />
        {CREDITS_UI_ENABLED && <LowCreditsBanner session={session} />}
        <Avatar session={session} />
        {CREDITS_UI_ENABLED && <CreditsOverlay session={session} />}
      </>
    );
  }

  return (
    <>
      <App
        session={session}
        initialTrip={activeTrip}
        initialScreen={
          screen === "create" || screen === "edit" ? "setup" : "itinerary"
        }
        initialTab={initialTab}
        initialSetupStep={initialStep}
        onHome={goHome}
        onUrlChange={pushUrl}
      />
      <AddRealEmailPrompt session={session} />
      {CREDITS_UI_ENABLED && <LowCreditsBanner session={session} />}
      <Avatar session={session} />
      {CREDITS_UI_ENABLED && <CreditsOverlay session={session} />}
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
    <DialogHost />
  </StrictMode>,
);
