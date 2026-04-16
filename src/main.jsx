import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "./supabase";
import Auth from "./Auth.jsx";
import Home from "./Home.jsx";
import App from "./App.jsx";
import TripPublicView from "./TripPublicView.jsx";
import JoinView from "./JoinView.jsx";

// Detect /trip/{token} URLs — served without authentication
const PUBLIC_TRIP_MATCH = window.location.pathname.match(/^\/trip\/([a-f0-9-]{36})$/);
// Detect /join/{token} URLs — requires auth
const JOIN_MATCH = window.location.pathname.match(/^\/join\/([a-f0-9-]{36})$/);
const JOIN_TOKEN = JOIN_MATCH?.[1] ?? null;
const PUBLIC_TRIP_TOKEN = PUBLIC_TRIP_MATCH?.[1] ?? null;

const LAST_TRIP_KEY = "tj_last_trip_id";
const LAST_SCREEN_KEY = "tj_last_screen";

function Root() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [screen, setScreen] = useState("home");       // 'home' | 'create' | 'trip'
  const [activeTrip, setActiveTrip] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // After session loads, restore last open trip from localStorage (survives HMR)
  useEffect(() => {
    if (!session) return;
    const savedScreen = localStorage.getItem(LAST_SCREEN_KEY);
    const savedTripId = localStorage.getItem(LAST_TRIP_KEY);
    if (savedScreen === "trip" && savedTripId) {
      supabase.from("trips").select("*").eq("id", savedTripId).single()
        .then(({ data }) => {
          if (data) { setActiveTrip(data); setScreen("trip"); }
        });
    }
  }, [session]);

  const openTrip = (trip) => {
    setActiveTrip(trip);
    setScreen("trip");
    if (trip?.id) {
      localStorage.setItem(LAST_TRIP_KEY, trip.id);
      localStorage.setItem(LAST_SCREEN_KEY, "trip");
    }
  };

  const goHome = () => {
    setActiveTrip(null);
    setScreen("home");
    localStorage.removeItem(LAST_TRIP_KEY);
    localStorage.removeItem(LAST_SCREEN_KEY);
  };

  // Public trip view — no auth required
  if (PUBLIC_TRIP_TOKEN) return <TripPublicView token={PUBLIC_TRIP_TOKEN} />;

  if (session === undefined) return null;
  if (!session) return <Auth />;

  // Join flow — requires auth
  if (JOIN_TOKEN) return <JoinView token={JOIN_TOKEN} session={session} />;

  if (screen === "home") {
    return (
      <Home
        session={session}
        onOpenTrip={openTrip}
        onCreateTrip={() => { setActiveTrip(null); setScreen("create"); }}
        onEditTrip={(trip) => {
          setActiveTrip(trip);
          setScreen("edit");
          // Persist so that a refresh during edit returns to this trip (rather than empty home)
          if (trip?.id) {
            localStorage.setItem(LAST_TRIP_KEY, trip.id);
            localStorage.setItem(LAST_SCREEN_KEY, "trip");
          }
        }}
      />
    );
  }

  // 'create', 'edit', and 'trip' all go into App
  return (
    <App
      session={session}
      initialTrip={activeTrip}
      initialScreen={screen === "create" || screen === "edit" ? "setup" : "itinerary"}
      onHome={goHome}
    />
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
