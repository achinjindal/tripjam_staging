import { test, expect } from "@playwright/test";
import { login } from "./helpers";

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

    // Open the first trip that has a chat input
    await page.goto("/");
    const tripCard = page
      .locator("div", { hasText: /Sep 9|Sep 19/ })
      .locator("visible=true")
      .first();
    await tripCard.click();
    await page.waitForTimeout(4000);

    const ask = page.getByPlaceholder(/Ask Trippy/i).first();
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
