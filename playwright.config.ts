import { defineConfig } from "@playwright/test";

// Mirror .env.production: Routes Lens is live in prod, so test it on by
// default (routes-lens.spec.ts and regenerate-replace.spec.ts skip without
// it). Set by `??=` so `VITE_ROUTES_LENS_ENABLED=false npx playwright test`
// still exercises the off state. Reaches Vite through webServer.env below and
// the specs through process.env (the config is evaluated in each worker).
process.env.VITE_ROUTES_LENS_ENABLED ??= "true";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  retries: 0,
  workers: 1, // Sequential — API-dependent tests can't run in parallel
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // TRIPJAM_DNS_PIN=1: route *.supabase.co around ISP DNS hijacks (pairs
    // with e2e/dns-pin.mjs for the Node side; see that file for context)
    ...(process.env.TRIPJAM_DNS_PIN === "1"
      ? {
          launchOptions: {
            args: [
              "--host-resolver-rules=MAP wlrzvwjdrjpfqcwgmzch.supabase.co 172.64.149.246, MAP viyvdqwwnbbqjuwiuzbh.supabase.co 172.64.149.246",
            ],
          },
        }
      : {}),
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node node_modules/.bin/vite --port 5173",
    port: 5173,
    reuseExistingServer: true,
    timeout: 30000,
    // E2E cost mode (see src/flags.js E2E_CHEAP): suppress background LLM
    // spenders + paid verify tiers during tests. NOTE: reuseExistingServer
    // means a manually-started `npm run dev` (no flag) will be reused —
    // kill it before test runs if you want the savings.
    env: { ...process.env, VITE_E2E_CHEAP: "1" },
  },
});
