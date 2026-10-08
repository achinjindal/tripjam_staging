import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Throwaway trips for chat specs, so they don't depend on a hand-made QA
// trip that can be edited or deleted under them (the "Tokyo to Kyoto
// Classic" trip several specs used vanished from staging on 2026-10-08).
// Each caller deletes its trip in afterAll.

export function qaEnv() {
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

export async function qaClient(): Promise<SupabaseClient> {
  const env = qaEnv();
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({
    email: "qa-tester@tripjam.app",
    password: "qaTest123!",
  });
  return sb;
}

type SeedActivity = {
  time: string;
  title: string;
  type: string;
  duration?: string;
  geocode?: string;
};

/** A built two-day Tokyo trip owned (and editable) by qa-tester. */
export async function seedTokyoTrip(sb: SupabaseClient, name: string) {
  const uid = (await sb.auth.getUser()).data.user!.id;
  const tripId = crypto.randomUUID();
  const { error } = await sb.from("trips").insert({
    id: tripId,
    name,
    destination: "Tokyo",
    start_date: "2026-11-10",
    end_date: "2026-11-11",
    created_by: uid,
    owner_id: uid,
    ig_request: { destinations: ["Tokyo"], travelers: "2" },
    ig_response: { name, cities: [] },
    detailed_ready_at: new Date().toISOString(),
  });
  if (error) throw new Error(`seed trip: ${error.message}`);
  await sb
    .from("trip_members")
    .insert({ trip_id: tripId, user_id: uid, role: "edit" });
  const { data: days } = await sb
    .from("days")
    .insert([
      {
        trip_id: tripId,
        label: "Day 1",
        city: "Tokyo",
        date: "2026-11-10",
        position: 0,
      },
      {
        trip_id: tripId,
        label: "Day 2",
        city: "Tokyo",
        date: "2026-11-11",
        position: 1,
      },
    ])
    .select("id, label, city, position")
    .order("position");
  const plan: SeedActivity[][] = [
    [
      { time: "09:00", title: "Senso-ji Temple", type: "sight" },
      { time: "11:00", title: "Nakamise Shopping Street", type: "shop" },
      { time: "12:30", title: "Lunch at Asakusa Imahan", type: "food" },
      { time: "15:00", title: "Tokyo Skytree", type: "sight" },
    ],
    [
      { time: "09:30", title: "Meiji Shrine", type: "sight" },
      { time: "12:00", title: "Lunch at Afuri Harajuku", type: "food" },
    ],
  ];
  await sb.from("activities").insert(
    plan.flatMap((acts, d) =>
      acts.map((a, i) => ({
        day_id: days![d].id,
        position: i,
        duration: "1.5h",
        geocode: `${a.title}, Tokyo`,
        ...a,
      })),
    ),
  );
  return {
    tripId,
    days: days! as Array<{ id: string; label: string; city: string }>,
  };
}
