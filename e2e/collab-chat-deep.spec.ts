import {
  test,
  expect,
  type Page,
  type BrowserContext,
  type Locator,
} from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { login, dismissTripOverlays } from "./helpers";
import { qaClient, qaEnv, seedTokyoTrip } from "./seedTrip";

// Group chat on a shared trip, in two real browsers (A = qa-tester, the
// owner; B = collab-e2e-b, a member), against staging. Trippy is mocked in
// A's browser only: A's client saves the reply row, so B receives exactly
// what a real reply would produce. No LLM, no credits.
//
// Known gaps are test.fail(): they run, are expected to fail, and turn red
// ("unexpectedly passed") once the gap is fixed, so the marker gets removed.
//
// Needs the Vite dev server: the realtime channel status these tests wait on
// is only logged in DEV builds (src/realtime.js).

const RUN = `r${Date.now().toString(36)}`;
const B_USER = "collab-e2e-b";

const sse = (events: unknown[]) =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
  "data: [DONE]\n\n";

let owner: SupabaseClient;
let member: SupabaseClient;
let tripId = "";

test.setTimeout(180000);

test.beforeAll(async () => {
  owner = await qaClient();
  const seeded = await seedTokyoTrip(owner, "ZZ collab chat");
  tripId = seeded.tripId;
  const env = qaEnv();
  member = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await member.auth.signInWithPassword({
    email: `${B_USER}@tripjam.app`,
    password: "qaTest123!",
  });
  const { data: token } = await owner.rpc("create_or_get_invite_link", {
    p_trip: tripId,
  });
  const { error } = await member.rpc("accept_invite", { p_token: token });
  if (error) throw new Error(`accept_invite: ${error.message}`);
});

test.afterAll(async () => {
  if (tripId) await owner.from("trips").delete().eq("id", tripId);
});

// Realtime only delivers to a subscribed channel and never replays, so wait
// until a page's trip channel has been SUBSCRIBED for a couple of seconds
// (optionally: re-subscribed after `after`, e.g. a reconnect).
function trackChannel(page: Page) {
  let status = "";
  let at = 0;
  page.on("console", (m) => {
    const mm = m.text().match(/channel trip:\S+ → (\w+)/);
    if (mm) {
      status = mm[1];
      at = Date.now();
    }
  });
  return async (after = 0, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (status === "SUBSCRIBED" && at > after && Date.now() - at > 2000)
        return true;
      await page.waitForTimeout(500);
    }
    return false;
  };
}

async function openChat(page: Page, user?: string) {
  await login(page, user);
  await page.goto(`/trip/${tripId}`);
  await page.waitForTimeout(2500);
  await dismissTripOverlays(page, 3000);
  const composer = page.locator('textarea[maxlength="2000"]').first();
  await composer.waitFor({ state: "visible", timeout: 20000 });
  return composer;
}

async function sendTo(
  page: Page,
  audience: "Everyone" | "Trippy",
  text: string,
) {
  const to = page.getByRole("button", { name: /^To: / });
  if (!(await to.textContent())?.includes(audience)) {
    await to.click();
    await page
      .getByText(audience === "Everyone" ? "👥 Everyone" : /✨ Trippy/)
      .last()
      .click();
  }
  const composer = page.locator('textarea[maxlength="2000"]').first();
  await composer.fill(text);
  await composer.press("Enter");
}

// The smallest block holding both a message's text and its author line.
function message(page: Page, text: string) {
  return page
    .locator("div", { hasText: text })
    .filter({ has: page.getByText("→ Everyone") })
    .last();
}

async function twoMembers(browser: import("@playwright/test").Browser) {
  const ctxA: BrowserContext = await browser.newContext();
  const ctxB: BrowserContext = await browser.newContext();
  // Keep B's WebSockets reachable so a test can drop the realtime connection.
  await ctxB.addInitScript(() => {
    const Native = window.WebSocket;
    const list: WebSocket[] = [];
    (window as unknown as { __sockets: WebSocket[] }).__sockets = list;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        list.push(this);
      }
    } as typeof WebSocket;
  });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const aReady = trackChannel(a);
  const bReady = trackChannel(b);
  await openChat(a);
  await openChat(b, B_USER);
  expect(await aReady(), "A's trip channel subscribed").toBe(true);
  expect(await bReady(), "B's trip channel subscribed").toBe(true);
  return { ctxA, ctxB, a, b, bReady };
}

test("members chat both ways live, with names, and keep order on reload", async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoMembers(browser);
  try {
    const m1 = `${RUN} hi from A`;
    const m2 = `${RUN} reply from B`;
    const m3 = `${RUN} second from A`;

    await sendTo(a, "Everyone", m1);
    await expect(b.getByText(m1)).toBeVisible({ timeout: 20000 });
    // B sees who wrote it and who it was for, on that message.
    const bubbleA = message(b, m1);
    await expect(bubbleA.getByText("qa-tester", { exact: true })).toBeVisible();
    await expect(bubbleA.getByText("→ Everyone")).toBeVisible();

    await sendTo(b, "Everyone", m2);
    await expect(a.getByText(m2)).toBeVisible({ timeout: 20000 });
    await expect(
      message(a, m2).getByText(B_USER, { exact: true }),
    ).toBeVisible();

    await sendTo(a, "Everyone", m3);
    await expect(b.getByText(m3)).toBeVisible({ timeout: 20000 });

    // Saved once each, readable by both members.
    const { data: rows } = await member
      .from("trip_messages")
      .select("content, audience, user_id")
      .eq("trip_id", tripId)
      .like("content", `${RUN}%`)
      .order("created_at");
    expect(rows!.map((r) => r.content)).toEqual([m1, m2, m3]);
    expect(rows!.every((r) => r.audience === "everyone")).toBe(true);

    // Reload: history comes back in the same order.
    await b.reload();
    await b.locator('textarea[maxlength="2000"]').first().waitFor();
    await expect(b.getByText(m3)).toBeVisible({ timeout: 20000 });
    const order = await b.evaluate(
      (texts) =>
        texts.map((t) => {
          const el = [...document.querySelectorAll("div")].find(
            (d) => d.textContent === t,
          );
          return el ? el.getBoundingClientRect().top : -1;
        }),
      [m1, m2, m3],
    );
    expect(order.every((y) => y >= 0)).toBe(true);
    expect(order[0] < order[1] && order[1] < order[2]).toBe(true);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

async function dayOne() {
  const { data } = await owner
    .from("days")
    .select("id")
    .eq("trip_id", tripId)
    .eq("position", 0)
    .single();
  return data!;
}

// Undo re-inserts removed activities with new ids, so look the row up fresh.
async function skytreeRows() {
  const { data } = await owner
    .from("activities")
    .select("id")
    .eq("day_id", (await dayOne()).id)
    .eq("title", "Tokyo Skytree");
  return data || [];
}

// A asks Trippy (mocked) to drop the Skytree; both see the change card.
async function trippyDropsSkytree(a: Page, b: Page) {
  const [row] = await skytreeRows();
  expect(row, "Tokyo Skytree is on Day 1").toBeTruthy();
  const reply = `${RUN} ${Math.random().toString(36).slice(2, 6)} Done — I took Tokyo Skytree off Day 1.`;
  await a.route("**/functions/v1/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse([
        {
          type: "final",
          data: {
            message: reply,
            actions: [
              {
                type: "activity_ops",
                ops: [{ op: "remove", activity_id: row.id }],
                dropped: [],
              },
            ],
          },
        },
      ]),
    }),
  );
  const q = `${RUN} Trippy, drop the Skytree`;
  await sendTo(a, "Trippy", q);
  await expect(a.getByText(reply)).toBeVisible({ timeout: 20000 });
  await expect(b.getByText(reply)).toBeVisible({ timeout: 20000 });
  return {
    q,
    reply,
    cardA: a.getByLabel("What changed").last(),
    cardB: b.getByLabel("What changed").last(),
  };
}

async function undoOnA(cardA: Locator) {
  await cardA.getByRole("button", { name: "Undo" }).click();
  await expect(cardA).toContainText("Undone", { timeout: 15000 });
  await expect
    .poll(async () => (await skytreeRows()).length, { timeout: 15000 })
    .toBe(1);
}

test("a Trippy edit asked by A reaches B: question, reply, change card, undo", async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoMembers(browser);
  try {
    const { q, cardA, cardB } = await trippyDropsSkytree(a, b);

    // A: change card + Undo, and the row is gone.
    await expect(cardA).toContainText("Tokyo Skytree");
    await expect(cardA.getByRole("button", { name: "Undo" })).toBeVisible();
    expect(await skytreeRows()).toHaveLength(0);

    // B: the question and the change card arrived live.
    await expect(b.getByText(q).last()).toBeVisible();
    await expect(cardB).toContainText("Tokyo Skytree");
    test.info().annotations.push({
      type: "B has Undo on A's change",
      description: String(
        await cardB.getByRole("button", { name: "Undo" }).isVisible(),
      ),
    });

    // A undoes: the activity is back for everyone.
    await undoOnA(cardA);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("known gap: B's change card shows that A undid it", async ({
  browser,
}) => {
  test.fail(true, "undo state is local to the undoer's card (App.jsx undone)");
  const { ctxA, ctxB, a, b } = await twoMembers(browser);
  try {
    const { cardA, cardB } = await trippyDropsSkytree(a, b);
    await undoOnA(cardA);
    await expect(cardB).toContainText("Undone", { timeout: 10000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("known gap: A's change card still shows Undone after a reload", async ({
  browser,
}) => {
  test.fail(true, "undo state isn't saved with the message");
  const { ctxA, ctxB, a, b } = await twoMembers(browser);
  try {
    const { reply, cardA } = await trippyDropsSkytree(a, b);
    await undoOnA(cardA);
    await a.reload();
    await a.locator('textarea[maxlength="2000"]').first().waitFor();
    await expect(a.getByText(reply)).toBeVisible({ timeout: 20000 });
    await expect(a.getByLabel("What changed").last()).toContainText("Undone", {
      timeout: 10000,
    });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// B's phone loses signal: offline, and its realtime socket closed by hand
// (Playwright's offline mode doesn't close open WebSockets). Closing Vite's
// HMR socket would reload the page, so only Supabase sockets are closed.
async function dropB(ctxB: BrowserContext, b: Page) {
  await ctxB.setOffline(true);
  await b.evaluate(() =>
    (window as unknown as { __sockets: WebSocket[] }).__sockets
      .filter((s) => s.url.includes("supabase"))
      .forEach((s) => s.close()),
  );
  await b.waitForTimeout(3000);
}

test("after a dropped connection, live chat resumes and a reload shows what was missed", async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, bReady } = await twoMembers(browser);
  try {
    const missed = `${RUN} sent while B was offline`;
    await dropB(ctxB, b);
    await sendTo(a, "Everyone", missed);
    await expect(a.getByText(missed)).toBeVisible();
    const back = Date.now();
    await ctxB.setOffline(false);

    // The realtime client rejoins on its own (retries every ~10 s).
    expect(await bReady(back, 60000), "B's channel re-subscribed").toBe(true);
    const after = `${RUN} sent after B reconnected`;
    await sendTo(a, "Everyone", after);
    await expect(b.getByText(after)).toBeVisible({ timeout: 20000 });

    // The missed message was saved; a reload shows it.
    await b.reload();
    await b.locator('textarea[maxlength="2000"]').first().waitFor();
    await expect(b.getByText(missed)).toBeVisible({ timeout: 20000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("known gap: messages missed while offline appear on reconnect, without a reload", async ({
  browser,
}) => {
  test.fail(true, "reconnect backfill doesn't refetch trip_messages");
  const { ctxA, ctxB, a, b, bReady } = await twoMembers(browser);
  try {
    const missed = `${RUN} missed, no reload`;
    await dropB(ctxB, b);
    await sendTo(a, "Everyone", missed);
    await expect(a.getByText(missed)).toBeVisible();
    const back = Date.now();
    await ctxB.setOffline(false);
    expect(await bReady(back, 60000), "B's channel re-subscribed").toBe(true);
    await expect(b.getByText(missed)).toBeVisible({ timeout: 15000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
