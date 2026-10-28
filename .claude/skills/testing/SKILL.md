---
name: testing
description: Running TripJam's Playwright E2E suite and the review gate — test user credentials, flag-gated specs, the serial trip fixture, and the ISP DNS-hijack workaround. Use when running, writing, or debugging E2E tests.
---

# Testing TripJam

## Review gate

Run `npm run check` before sending code for review (format:check + lint +
typecheck + build). If formatting fails, run `npm run format`, then rerun.

## E2E suite

- Playwright runs with `workers: 1` (sequential) — the API-dependent specs
  cannot run in parallel.
- Test user: `qa-tester` / `qaTest123!`
- Tests hit **real Supabase**, not mocks. Board tests create their trips via a
  serial setup fixture.
- `collab-invite.spec.ts` members/invite tests skip unless
  `VITE_INVITE_ENABLED=true` AND the invite RPC migrations are applied to
  staging; the invalid-token test always runs.
- `playwright.config.ts` defaults `VITE_ROUTES_LENS_ENABLED=true` (mirrors
  prod) and `VITE_E2E_CHEAP=1`, but `reuseExistingServer` means a manually
  started `npm run dev` without those flags gets reused — kill it first.
- Several collab specs pin a trip **by name** and skip when it is absent, so a
  missing fixture reads as "skipped" rather than failing loudly. Check the skip
  count, not just the pass count.
- QA skills: `/code-review` (static analysis), `/qa-e2e` (browser tests with
  cost tracking).

## ISP DNS hijack workaround

If the local network's ISP hijacks `*.supabase.co` DNS — E2E seeding fails with
TLS resets, observed 2026-09 — run:

```bash
TRIPJAM_DNS_PIN=1 NODE_OPTIONS="--import ./e2e/dns-pin.mjs" npx playwright test …
```

That pins the real edge IPs for both Node and Chromium without touching system
DNS.

## Admin console

`/admin`, gated by the `is_admin` boolean on the profiles table. Tabs: Users,
Trips, Credits (by function/model), Daily Usage. Shows trip counts, chat counts,
IG timing, activity breakdown, token usage and cost estimates — useful for
confirming that a change actually altered spend.
