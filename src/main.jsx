import { StrictMode, useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import posthog from "posthog-js";
import * as Sentry from "@sentry/react";
import { supabase } from "./supabase";
import Auth from "./Auth.jsx";
import Home from "./Home.jsx";
import App from "./App.jsx";
import TripPublicView from "./TripPublicView.jsx";
import AdminConsole from "./Admin.jsx";
import CreditsOverlay from "./CreditsOverlay.jsx";
import AddRealEmailPrompt from "./AddRealEmailPrompt.jsx";
import Avatar from "./Avatar.jsx";
import LowCreditsBanner from "./LowCreditsBanner.jsx";
import { refreshCredits, CREDITS_UI_ENABLED } from "./credits";

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
  // Legacy /trip/:token format — only if no suffix (backwards compat)
  const legacyPublic = path.match(/^\/trip\/([a-f0-9-]{36})$/);
  // Check suffixed routes first (these are always authenticated trip views)
  const routesMatch = path.match(/^\/trip\/([^/]+)\/plans$/);
  if (routesMatch) return { page: "edit", tripId: routesMatch[1] };
  const tabMatch = path.match(/^\/trip\/([^/]+)\/(magazine|map|board)$/);
  if (tabMatch) return { page: "trip", tripId: tabMatch[1], tab: tabMatch[2] };
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

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => setSession(session));
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

  if (session === undefined) return null;
  if (!session) return <Auth />;

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

  if (screen === "home") {
    return (
      <>
        <Home
          session={session}
          onOpenTrip={openTrip}
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
  </StrictMode>,
);
