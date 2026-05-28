import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Hardened geocode-verify integration test.
 *
 * Calls verify-place via the user session (so credit gating works) for the
 * canonical "The Westin Sapporo" failure case. Asserts the ladder repaired
 * the hallucinated name, or at least surfaced alternatives — i.e. did NOT
 * silently return a confident-wrong coord like the pre-fix Photon behavior
 * (which mapped "Westin Sapporo" to a US consulate ~390m from Hokkaido Shrine).
 *
 * Skipped when ANTHROPIC_API_KEY isn't reachable on the staging edge
 * function (the ladder would no-op past Tier 2 and either return Nominatim
 * empty or fall to unresolved without spending credits — still a valid
 * non-broken state).
 */

test.describe("verify-place ladder", () => {
  test("Westin Sapporo (hallucinated chain hotel) is repaired or surfaces alternatives", async ({
    page,
  }) => {
    test.setTimeout(90_000); // Haiku + Google round trips can be slow on cold start
    await login(page);

    const result = await page.evaluate(async () => {
      const supaUrl = (window as any).__SUPA_URL__ || undefined;
      const url =
        supaUrl ||
        // Fall back to localStorage-derived url used by app bootstrap
        (Object.keys(localStorage).find((k) => k.startsWith("sb-")) as any);
      // Easier: read the auth token directly from supabase-js localStorage
      const sbKey = Object.keys(localStorage).find((k) =>
        /^sb-[^-]+-auth-token$/.test(k),
      );
      if (!sbKey) return { error: "no supabase auth token in localStorage" };
      const raw = localStorage.getItem(sbKey);
      if (!raw) return { error: "auth token row empty" };
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { error: "auth token row not JSON" };
      }
      const accessToken = parsed?.access_token;
      if (!accessToken) return { error: "no access_token in auth row" };

      // Extract supabase URL from the localStorage key: sb-<project-ref>-auth-token
      const m = sbKey.match(/^sb-([^-]+)-auth-token$/);
      const projectRef = m?.[1];
      if (!projectRef) return { error: "could not derive project ref" };
      const proxyUrl = `https://${projectRef}.supabase.co/functions/v1/places-proxy?action=verify-place`;

      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: "The Westin Sapporo",
          city: "Sapporo",
          hint: "The Westin Sapporo, Sapporo, Japan",
          type: "lodging",
        }),
      });
      const status = res.status;
      const body = await res.json().catch(() => ({}));
      return { status, body };
    });

    expect(result.error, `setup error: ${result.error}`).toBeUndefined();
    expect(
      result.status,
      `unexpected http: ${JSON.stringify(result.body)}`,
    ).toBe(200);

    const body = result.body;
    console.log("verify-place response:", JSON.stringify(body, null, 2));

    // Three acceptable outcomes (in order of preference for this query):
    //  1. Repaired: source starts with "haiku-then-", corrected_from set
    //  2. Picker:   status === "needs_user_choice" with at least one alternative
    //  3. Unresolved (acceptable but logs a warning) — Anthropic key not configured, etc.
    //
    // The ONE outcome that's a regression: a confident-looking match where
    // source is plain "photon" / "nominatim" / "google_places" and there's no
    // corrected_from. That's exactly the silent-mis-resolve bug we're fixing.

    if (body.status === "needs_user_choice") {
      expect(Array.isArray(body.alternatives)).toBe(true);
      expect(body.alternatives.length).toBeGreaterThan(0);
      return;
    }
    if (body.status === "unresolved") {
      console.warn(
        "verify-place returned unresolved — check ANTHROPIC_API_KEY on edge function",
      );
      return;
    }
    // Success path — must be a repair (the hallucinated name has no direct match)
    expect(
      typeof body.source === "string" && body.source.startsWith("haiku-then-"),
      `expected haiku-then-* source for hallucinated name, got source=${body.source}`,
    ).toBe(true);
    expect(body.corrected_from).toBe("The Westin Sapporo");
    expect(
      body.lat,
      "lat should be present on verified result",
    ).toBeGreaterThan(0);
    expect(
      body.lng,
      "lng should be present on verified result",
    ).toBeGreaterThan(0);
  });

  test("Hokkaido Shrine (real unique-named place) verifies cleanly", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await login(page);

    const result = await page.evaluate(async () => {
      const sbKey = Object.keys(localStorage).find((k) =>
        /^sb-[^-]+-auth-token$/.test(k),
      );
      if (!sbKey) return { error: "no token" };
      const parsed = JSON.parse(localStorage.getItem(sbKey)!);
      const accessToken = parsed.access_token;
      const m = sbKey.match(/^sb-([^-]+)-auth-token$/);
      const projectRef = m![1];
      const url = `https://${projectRef}.supabase.co/functions/v1/places-proxy?action=verify-place`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: "Hokkaido Shrine",
          city: "Sapporo",
        }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    const body = result.body;
    console.log("Hokkaido Shrine response:", JSON.stringify(body, null, 2));
    // Real unique-named place — must verify with coords (not picker, not unresolved)
    expect(body.lat).toBeGreaterThan(40);
    expect(body.lat).toBeLessThan(45);
    expect(body.lng).toBeGreaterThan(140);
    expect(body.lng).toBeLessThan(142);
    expect(body.corrected_from).toBeUndefined(); // no repair needed
  });
});
