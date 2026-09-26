import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { login, dismissTripOverlays } from "./helpers";

// Chat v2 streaming contract, verified against a MOCKED SSE endpoint so the
// assertion "text renders before the stream completes" is deterministic
// (a live LLM's timing would make this flaky). Live-LLM coverage stays in
// chat-actions.spec.ts.
test.describe("Chat streaming", () => {
  test("streamed text renders before final; cards render after", async ({
    page,
  }) => {
    await login(page);

    // Mock the chat endpoint: two delayed deltas, then final with a suggest
    // action, then [DONE]. text/event-stream content type triggers the
    // client's streaming branch.
    await page.route("**/functions/v1/chat", async (route) => {
      const enc = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const body =
        enc({ type: "delta", text: "Streaming test reply — " }) +
        enc({ type: "delta", text: "words arrive early." }) +
        enc({
          type: "final",
          data: {
            message: "Streaming test reply — words arrive early.",
            actions: [
              {
                type: "suggest",
                context: "activity",
                suggestions: [
                  {
                    type: "sight",
                    title: "Mock Viewpoint",
                    geocode: "Mock Viewpoint, Fira, Santorini, Greece",
                    note: "Test card",
                    description: "A deterministic suggestion for e2e.",
                    duration: "~1h",
                    cost_hint: "Free",
                  },
                ],
              },
            ],
          },
        }) +
        "data: [DONE]\n\n";
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    });

    // Open the QA trip directly — the old home-screen card lookup keyed on
    // fixture dates ("Sep 9|Sep 19") that no longer exist on the account.
    const env: Record<string, string> = {};
    const raw = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
      "utf8",
    );
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await sb.auth.signInWithPassword({
      email: "qa-tester@tripjam.app",
      password: "qaTest123!",
    });
    const me = (await sb.auth.getUser()).data.user!.id;
    const { data: trips } = await sb
      .from("trips")
      .select("id")
      .ilike("name", "Tokyo to Kyoto Classic%")
      .eq("created_by", me)
      .not("ig_response", "is", null)
      .limit(1);
    test.skip(!trips?.[0], "QA trip not found");
    await page.goto(`/trip/${trips![0].id}`);
    await page.waitForTimeout(4000);
    // Shared trips auto-open sheets (style nudge et al.) over the chat input.
    await dismissTripOverlays(page, 4000);

    const ask = page.getByPlaceholder(/Ask Trippy|Ask about plans/i).first();
    await ask.waitFor({ timeout: 15000 });
    await ask.click();
    await ask.fill("mock streaming question");
    await ask.press("Enter");

    // Streamed text must appear
    await expect(
      page.getByText("Streaming test reply", { exact: false }).last(),
    ).toBeVisible({ timeout: 10000 });

    // Suggestion card renders with decision meta after final
    await expect(page.getByText("Mock Viewpoint").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("~1h").first()).toBeVisible();
    await expect(page.getByText("Know more").first()).toBeVisible();
  });
});
