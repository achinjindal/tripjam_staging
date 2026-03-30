import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "./supabase";
import Auth from "./Auth.jsx";
import Home from "./Home.jsx";
import App from "./App.jsx";

function Root() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [screen, setScreen] = useState("home");       // 'home' | 'create' | 'trip'
  const [activeTrip, setActiveTrip] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <Auth />;

  if (screen === "home") {
    return (
      <Home
        session={session}
        onOpenTrip={(trip) => { setActiveTrip(trip); setScreen("trip"); }}
        onCreateTrip={() => { setActiveTrip(null); setScreen("create"); }}
        onEditTrip={(trip) => { setActiveTrip(trip); setScreen("edit"); }}
      />
    );
  }

  // 'create', 'edit', and 'trip' all go into App
  return (
    <App
      session={session}
      initialTrip={activeTrip}
      initialScreen={screen === "create" || screen === "edit" ? "setup" : "itinerary"}
      onHome={() => { setActiveTrip(null); setScreen("home"); }}
    />
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
