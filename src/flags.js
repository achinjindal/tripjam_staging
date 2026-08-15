// Feature flags resolved from build-time env vars. Same ship-dark pattern as
// INVITE_ENABLED (members.js): default off everywhere until flipped per env.

// Routes Lens: Route Overview block on the Itinerary tab + Route Editor sheet.
export const ROUTES_LENS_ENABLED =
  import.meta.env.VITE_ROUTES_LENS_ENABLED === "true";
