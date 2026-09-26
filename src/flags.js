// Feature flags resolved from build-time env vars. Same ship-dark pattern as
// INVITE_ENABLED (members.js): default off everywhere until flipped per env.

// Routes Lens: Route Overview block on the Itinerary tab + Route Editor sheet.
export const ROUTES_LENS_ENABLED =
  import.meta.env.VITE_ROUTES_LENS_ENABLED === "true";

// E2E cost mode: set ONLY by the Playwright webServer (playwright.config.ts),
// never in .env files, so manual dev and prod are untouched. Suppresses the
// background LLM spenders no spec asserts on (Inspirations auto-fire,
// Magazine stagger pre-load, Story narrative backfill) and caps the
// verify-place ladder at the free tiers. Explicit user actions (opening a
// Magazine city, running RG/IG, chatting) still hit the real backends.
export const E2E_CHEAP = import.meta.env.VITE_E2E_CHEAP === "1";
