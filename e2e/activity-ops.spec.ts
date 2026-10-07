import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Database contract for apply_activity_ops (the RPC chat edits go through),
// run as the qa user against staging on a throwaway trip. No browser, no LLM.

function readEnv() {
  const env: Record<string, string> = {};
  const raw = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
    "utf8",
  );
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

type Act = {
  id: string;
  day_id: string;
  title: string;
  position: number;
  time: string | null;
  lat: number | null;
  confirmed: boolean | null;
  transition_data: unknown;
};

let sb: SupabaseClient;
let tripId: string;
let d1: string;
let d2: string;

const titlesOf = (rows: Act[]) => rows.map((a) => a.title);

async function dayActs(dayId: string): Promise<Act[]> {
  const { data } = await sb
    .from("activities")
    .select("*")
    .eq("day_id", dayId)
    .order("position");
  return (data || []) as Act[];
}

async function seed() {
  await sb.from("activities").delete().in("day_id", [d1, d2]);
  const rows = [
    ["A", d1, 0, { mode: "walk" }],
    ["B", d1, 1, { mode: "walk" }],
    ["C", d1, 2, null],
    ["X", d2, 0, { mode: "taxi" }],
    ["Y", d2, 1, null],
  ].map(([title, day_id, position, transition_data]) => ({
    title,
    day_id,
    position,
    time: `${10 + (position as number)}:00`,
    lat: 7.0,
    lng: 80.0,
    confirmed: title === "B",
    transition_data,
  }));
  const { data, error } = await sb.from("activities").insert(rows).select();
  expect(error).toBeNull();
  return Object.fromEntries((data as Act[]).map((a) => [a.title, a]));
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const env = readEnv();
  sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({
    email: "qa-tester@tripjam.app",
    password: "qaTest123!",
  });
  const uid = (await sb.auth.getUser()).data.user!.id;
  tripId = crypto.randomUUID();
  const { error: tripErr } = await sb.from("trips").insert({
    id: tripId,
    name: "ZZ activity ops contract",
    destination: "Sri Lanka",
    start_date: "2026-11-02",
    end_date: "2026-11-03",
    created_by: uid,
    owner_id: uid,
  });
  expect(tripErr).toBeNull();
  // The app adds the creator as an edit member when it creates a trip; the
  // days/activities RLS policies key off that row.
  const { error: memErr } = await sb
    .from("trip_members")
    .insert({ trip_id: tripId, user_id: uid, role: "edit" });
  expect(memErr).toBeNull();
  const { data: days, error: dayErr } = await sb
    .from("days")
    .insert([
      { trip_id: tripId, label: "Day 1", city: "Galle", position: 0 },
      { trip_id: tripId, label: "Day 2", city: "Ella", position: 1 },
    ])
    .select("id, position")
    .order("position");
  expect(dayErr).toBeNull();
  d1 = days![0].id;
  d2 = days![1].id;
});

test.afterAll(async () => {
  if (tripId) await sb.from("trips").delete().eq("id", tripId);
});

test("inserts keep their order; replace makes a fresh row in the slot", async () => {
  const s = await seed();
  const { data, error } = await sb.rpc("apply_activity_ops", {
    p_ops: [
      {
        op: "insert",
        day_id: d1,
        after_id: s.A.id,
        activity: { title: "N1", time: "10:30", type: "food" },
      },
      {
        op: "insert",
        day_id: d1,
        after_id: s.A.id,
        activity: { title: "N2", time: "10:45", type: "sight" },
      },
      {
        op: "insert",
        day_id: d1,
        after_id: null,
        activity: { title: "N0", time: "09:00", type: "sight" },
      },
      {
        op: "replace",
        activity_id: s.B.id,
        activity: {
          title: "B2",
          time: "11:00",
          type: "sight",
          geocode: "B2 place",
        },
      },
      { op: "set_time", activity_id: s.C.id, time: "13:15" },
    ],
  });
  expect(error).toBeNull();
  const rows = await dayActs(d1);
  expect(titlesOf(rows)).toEqual(["N0", "A", "N1", "N2", "B2", "C"]);
  expect(rows.map((a) => a.position)).toEqual([0, 1, 2, 3, 4, 5]);
  const b2 = rows.find((a) => a.title === "B2")!;
  expect(b2.id).not.toBe(s.B.id);
  expect(b2.lat).toBeNull();
  expect(b2.confirmed).toBe(false);
  expect(rows.find((a) => a.title === "C")!.time).toBe("13:15");
  // A's next changed (B → N1): its transit hint is stale and cleared.
  expect(rows.find((a) => a.title === "A")!.transition_data).toBeNull();
  // Day 2 untouched by any op: X keeps its hint.
  expect((await dayActs(d2))[0].transition_data).toEqual({ mode: "taxi" });
  // Undo snapshot is the day as it was, data intact.
  const before = (
    data.before as Array<{ day_id: string; activities: Act[] }>
  ).find((d) => d.day_id === d1)!.activities;
  expect(titlesOf(before)).toEqual(["A", "B", "C"]);
  expect(before[1].confirmed).toBe(true);
  expect(before[1].lat).toBe(7);
  const after = (
    data.after as Array<{ day_id: string; activities: Act[] }>
  ).find((d) => d.day_id === d1)!.activities;
  expect(titlesOf(after)).toEqual(titlesOf(rows));
});

test("move across days and remove renumber both days", async () => {
  const s = await seed();
  const { error } = await sb.rpc("apply_activity_ops", {
    p_ops: [
      { op: "move", activity_id: s.A.id, day_id: d2, after_id: s.X.id },
      { op: "remove", activity_id: s.Y.id },
    ],
  });
  expect(error).toBeNull();
  const one = await dayActs(d1);
  const two = await dayActs(d2);
  expect(titlesOf(one)).toEqual(["B", "C"]);
  expect(one.map((a) => a.position)).toEqual([0, 1]);
  expect(titlesOf(two)).toEqual(["X", "A"]);
  expect(two.map((a) => a.position)).toEqual([0, 1]);
  // Moved row keeps its saved data.
  expect(two[1].id).toBe(s.A.id);
  expect(two[1].lat).toBe(7);
});

test("a bad operation rolls the whole batch back", async () => {
  const s = await seed();
  const { error } = await sb.rpc("apply_activity_ops", {
    p_ops: [
      { op: "remove", activity_id: s.A.id },
      // Anchor on the other day: invalid.
      {
        op: "insert",
        day_id: d1,
        after_id: s.X.id,
        activity: { title: "Nope" },
      },
    ],
  });
  expect(error).not.toBeNull();
  expect(titlesOf(await dayActs(d1))).toEqual(["A", "B", "C"]);
});

test("unknown activity is an error, not a silent no-op", async () => {
  await seed();
  const { error } = await sb.rpc("apply_activity_ops", {
    p_ops: [{ op: "remove", activity_id: crypto.randomUUID() }],
  });
  expect(error).not.toBeNull();
});
