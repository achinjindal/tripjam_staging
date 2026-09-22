import { defineConfig } from "@playwright/test";

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
  },
});
