#!/usr/bin/env node
/**
 * Phase-1 collaboration BACKEND lifecycle validator (API-level, no browser).
 *
 * Exercises the membership lifecycle RPCs against STAGING using real test users
 * and the anon key + per-user auth sessions (so every RPC runs as auth.uid()).
 *
 * Contracts asserted come from:
 *   supabase/migrations/20260721000005_accept_invite.sql
 *   supabase/migrations/20260721000006_membership_lifecycle.sql
 *   supabase/migrations/20260721000007_invite_rpcs.sql
 *   docs/collaboration/documentation.md §3 "Membership lifecycle"
 *
 * Run:  node scripts/collab-lifecycle-check.mjs
 * Requires .env with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (staging).
 * Uncommitted by design; leaves test users behind (acceptable on staging).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- Load staging creds from .env -----------------------------------------
function loadEnv() {
  const raw = readFileSync(join(ROOT, ".env"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const ENV = loadEnv();
const URL = ENV.VITE_SUPABASE_URL;
const ANON = ENV.VITE_SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}
if (!URL.includes("wlrzvwjdrjpfqcwgmzch")) {
  console.error(
    `Refusing to run: expected STAGING (wlrzvwjdrjpfqcwgmzch), got ${URL}`,
  );
  process.exit(1);
}

const PASSWORD = "qaTest123!";
const EMAILS = {
  A: "collab-api-a@tripjam.app",
  B: "collab-api-b@tripjam.app",
  C: "collab-api-c@tripjam.app",
};

// --- Result tracking -------------------------------------------------------
const results = [];
function record(id, title, pass, evidence) {
  results.push({ id, title, pass, evidence });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${id}. ${title}`);
  if (evidence) console.log(`        → ${evidence}`);
}

// Extract a stable error signature from a supabase/postgres error.
function errSig(err) {
  if (!err) return null;
  // PostgREST wraps RAISE EXCEPTION messages in err.message; code often 'P0001'.
  return `${err.code || "?"}: ${err.message || err.hint || JSON.stringify(err)}`;
}

async function signInOrUp(email) {
  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let { data, error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) {
    const up = await client.auth.signUp({ email, password: PASSWORD });
    if (up.error) throw new Error(`signUp(${email}): ${up.error.message}`);
    // Some projects require confirmation; try sign-in again.
    if (!up.data.session) {
      const retry = await client.auth.signInWithPassword({
        email,
        password: PASSWORD,
      });
      if (retry.error)
        throw new Error(
          `signIn after signUp(${email}): ${retry.error.message}`,
        );
      data = retry.data;
    } else {
      data = up.data;
    }
  }
  const uid = data.user.id;
  return { client, uid, email };
}

async function main() {
  console.log("=== Phase-1 collab lifecycle check (STAGING) ===");
  console.log(`URL: ${URL}\n`);

  // ---- Setup: three users ----
  const A = await signInOrUp(EMAILS.A);
  const B = await signInOrUp(EMAILS.B);
  const C = await signInOrUp(EMAILS.C);
  console.log(`Users: A=${A.uid} B=${B.uid} C=${C.uid}\n`);

  // Ensure profiles rows exist with usernames (preview asserts inviter = A username).
  // profiles are normally auto-created on signup; fetch A's username for later assert.
  let aUsername = null;
  {
    const { data } = await A.client
      .from("profiles")
      .select("username")
      .eq("id", A.uid)
      .single();
    aUsername = data?.username ?? null;
  }

  // ---- Setup: create a trip as A ----
  const tripId = globalThis.crypto.randomUUID();
  const tripName = `collab-api-check ${new Date().toISOString()}`;
  {
    const { error: tErr } = await A.client.from("trips").insert({
      id: tripId,
      name: tripName,
      destination: "Tokyo, Japan",
      start_date: "2026-09-01",
      end_date: "2026-09-07",
      created_by: A.uid,
      owner_id: A.uid,
    });
    if (tErr) throw new Error(`trip insert: ${errSig(tErr)}`);

    const { error: mErr } = await A.client.from("trip_members").insert({
      trip_id: tripId,
      user_id: A.uid,
      role: "edit",
    });
    if (mErr) throw new Error(`A trip_members insert: ${errSig(mErr)}`);

    const { data: readBack, error: rErr } = await A.client
      .from("trips")
      .select("id, owner_id, created_by")
      .eq("id", tripId)
      .single();
    if (rErr || !readBack)
      throw new Error(`A cannot read own trip: ${errSig(rErr)}`);
    console.log(
      `Trip ${tripId} created; A can read it. owner_id=${readBack.owner_id}\n`,
    );
  }

  const memberCount = async (client) => {
    const { count, error } = await client
      .from("trip_members")
      .select("*", { count: "exact", head: true })
      .eq("trip_id", tripId);
    if (error) return { count: null, error };
    return { count };
  };

  // ================= CHECK 1: Invite + preview =================
  let token = null;
  try {
    const { data: tk, error } = await A.client.rpc(
      "create_or_get_invite_link",
      {
        p_trip: tripId,
      },
    );
    if (error) throw new Error(errSig(error));
    token = tk;
    // Preview as B (not yet a member).
    const { data: preview, error: pErr } = await B.client.rpc(
      "get_invite_preview",
      {
        p_token: token,
      },
    );
    if (pErr) throw new Error(`preview: ${errSig(pErr)}`);
    const okValid = preview?.valid === true;
    const okName = preview?.trip_name === tripName;
    const okCount = preview?.member_count === 1;
    const okInviter = aUsername
      ? preview?.inviter === aUsername
      : preview?.inviter != null;
    const pass = okValid && okName && okCount && okInviter;
    record(
      1,
      "Invite + preview (valid, name, member_count=1, inviter=A)",
      pass,
      `token=${token?.slice(0, 12)}… valid=${preview?.valid} name_match=${okName} ` +
        `member_count=${preview?.member_count} inviter=${preview?.inviter} (A.username=${aUsername})`,
    );
  } catch (e) {
    record(1, "Invite + preview", false, `unexpected error: ${e.message}`);
  }

  // ================= CHECK 2: Accept =================
  try {
    const { data: bTrip, error: bErr } = await B.client.rpc("accept_invite", {
      p_token: token,
    });
    if (bErr) throw new Error(`B accept: ${errSig(bErr)}`);
    const after2 = await memberCount(A.client);
    const { data: cTrip, error: cErr } = await C.client.rpc("accept_invite", {
      p_token: token,
    });
    if (cErr) throw new Error(`C accept: ${errSig(cErr)}`);
    const after3 = await memberCount(A.client);
    const { data: isMemberB, error: imErr } = await A.client.rpc(
      "is_trip_member",
      {
        p_trip: tripId,
        p_uid: B.uid,
      },
    );
    if (imErr) throw new Error(`is_trip_member: ${errSig(imErr)}`);
    const pass =
      bTrip === tripId &&
      cTrip === tripId &&
      after2.count === 2 &&
      after3.count === 3 &&
      isMemberB === true;
    record(
      2,
      "Accept (B→2 members, C→3 members, is_trip_member(B)=true)",
      pass,
      `B_ret=${bTrip === tripId} C_ret=${cTrip === tripId} count_after_B=${after2.count} ` +
        `count_after_C=${after3.count} is_member(B)=${isMemberB}`,
    );
  } catch (e) {
    record(2, "Accept", false, `unexpected error: ${e.message}`);
  }

  // ================= CHECK 3: Reuse (same token) =================
  try {
    const { data: tk2, error } = await A.client.rpc(
      "create_or_get_invite_link",
      {
        p_trip: tripId,
      },
    );
    if (error) throw new Error(errSig(error));
    const pass = tk2 === token;
    record(
      3,
      "Reuse invite link returns SAME token",
      pass,
      `first=${token?.slice(0, 12)}… second=${tk2?.slice(0, 12)}… equal=${pass}`,
    );
  } catch (e) {
    record(3, "Reuse invite link", false, `unexpected error: ${e.message}`);
  }

  // ================= CHECK 4: Owner must transfer before leaving =================
  try {
    const { data, error } = await A.client.rpc("leave_trip", {
      p_trip: tripId,
    });
    const sig = errSig(error);
    const raised =
      !!error && /transfer_ownership_first/.test(error.message || "");
    const after = await memberCount(A.client);
    const stillThree = after.count === 3;
    const pass = raised && stillThree && data == null;
    record(
      4,
      "Owner leave_trip → transfer_ownership_first (A did not leave, still 3)",
      pass,
      `error=${sig} members=${after.count}`,
    );
  } catch (e) {
    record(
      4,
      "Owner leave_trip guard",
      false,
      `unexpected error: ${e.message}`,
    );
  }

  // ================= CHECK 5: Poll-vote cleanup on removal =================
  let pollId = null;
  let commentInserted = false;
  try {
    // As B, create a poll + a vote (+ optional vote-note comment).
    pollId = globalThis.crypto.randomUUID();
    const { error: pErr } = await B.client.from("polls").insert({
      id: pollId,
      trip_id: tripId,
      created_by: B.uid,
      question: "Where to eat?",
      options: [
        { id: "o1", label: "Sushi" },
        { id: "o2", label: "Ramen" },
      ],
      mode: "single",
      entity_type: "freeform",
      status: "open",
    });
    if (pErr) throw new Error(`B poll insert: ${errSig(pErr)}`);

    const { error: vErr } = await B.client.from("poll_votes").insert({
      poll_id: pollId,
      user_id: B.uid,
      option_id: "o1",
    });
    if (vErr) throw new Error(`B vote insert: ${errSig(vErr)}`);

    // Optional vote-note (best-effort; comments table shape is live-drift).
    const { error: cErr } = await B.client.from("comments").insert({
      entity_type: "poll",
      entity_id: pollId,
      user_id: B.uid,
      content: "I prefer sushi",
    });
    commentInserted = !cErr;

    // Owner A removes B.
    const { error: rmErr } = await A.client.rpc("remove_member", {
      p_trip: tripId,
      p_user: B.uid,
    });
    if (rmErr) throw new Error(`A remove_member(B): ${errSig(rmErr)}`);

    const after = await memberCount(A.client);
    const bGone = after.count === 2;

    // B's poll_votes for this trip deleted — check via A (owner can read poll_votes).
    const { count: voteCount, error: vcErr } = await A.client
      .from("poll_votes")
      .select("*", { count: "exact", head: true })
      .eq("poll_id", pollId)
      .eq("user_id", B.uid);
    const votesDeleted = !vcErr && voteCount === 0;

    // Poll row still exists (created_by kept).
    const { data: pollRow, error: prErr } = await A.client
      .from("polls")
      .select("id, created_by")
      .eq("id", pollId)
      .maybeSingle();
    const pollKept = !prErr && !!pollRow && pollRow.created_by === B.uid;

    // If a vote-note was inserted, it must be deleted too.
    let commentDeleted = true;
    let commentEvidence = "no comment inserted";
    if (commentInserted) {
      const { count: cCount, error: ccErr } = await A.client
        .from("comments")
        .select("*", { count: "exact", head: true })
        .eq("entity_type", "poll")
        .eq("entity_id", pollId)
        .eq("user_id", B.uid);
      commentDeleted = !ccErr && cCount === 0;
      commentEvidence = `comment_rows_left=${cCount}`;
    }

    const pass = bGone && votesDeleted && pollKept && commentDeleted;
    record(
      5,
      "remove_member cleanup (B gone, votes deleted, poll kept, vote-note deleted)",
      pass,
      `members=${after.count} B_votes_left=${voteCount} poll_exists=${!!pollRow} ` +
        `poll_created_by=B?${pollRow?.created_by === B.uid} ${commentEvidence}`,
    );
  } catch (e) {
    record(
      5,
      "remove_member poll-vote cleanup",
      false,
      `unexpected error: ${e.message}`,
    );
  }

  // ================= CHECK 6: Non-owner guards =================
  try {
    const { error: rmErr } = await C.client.rpc("remove_member", {
      p_trip: tripId,
      p_user: A.uid,
    });
    const rmRaised = !!rmErr && /not_owner/.test(rmErr.message || "");

    const { error: rvErr } = await C.client.rpc("revoke_invite_link", {
      p_trip: tripId,
    });
    const rvRaised = !!rvErr && /not_owner/.test(rvErr.message || "");

    const pass = rmRaised && rvRaised;
    record(
      6,
      "Non-owner guards (C remove_member→not_owner, C revoke_invite_link→not_owner)",
      pass,
      `remove_member: ${errSig(rmErr)} | revoke_invite_link: ${errSig(rvErr)}`,
    );
  } catch (e) {
    record(6, "Non-owner guards", false, `unexpected error: ${e.message}`);
  }

  // ================= CHECK 7: Transfer + ex-owner leaves =================
  try {
    const { error: tErr } = await A.client.rpc("transfer_ownership", {
      p_trip: tripId,
      p_new_owner: C.uid,
    });
    if (tErr) throw new Error(`transfer: ${errSig(tErr)}`);
    // Read owner_id (read via C who is now owner; A may still read as member).
    const { data: ownerRow, error: oErr } = await C.client
      .from("trips")
      .select("owner_id")
      .eq("id", tripId)
      .single();
    if (oErr) throw new Error(`read owner_id: ${errSig(oErr)}`);
    const ownerIsC = ownerRow?.owner_id === C.uid;

    // A (now non-owner) leaves.
    const { data: leaveRet, error: lErr } = await A.client.rpc("leave_trip", {
      p_trip: tripId,
    });
    if (lErr) throw new Error(`A leave: ${errSig(lErr)}`);
    const after = await memberCount(C.client);
    const pass = ownerIsC && leaveRet === "left" && after.count === 1;
    record(
      7,
      "Transfer to C, then A leave → 'left' (1 member: C)",
      pass,
      `owner_id=C?${ownerIsC} leave_ret=${leaveRet} members=${after.count}`,
    );
  } catch (e) {
    record(
      7,
      "Transfer + ex-owner leave",
      false,
      `unexpected error: ${e.message}`,
    );
  }

  // ================= CHECK 9 (before delete): Revoke =================
  // Run revoke BEFORE the last-member delete so a trip still exists.
  try {
    // Ensure a live link exists (C is now owner/member).
    const { data: liveToken, error: clErr } = await C.client.rpc(
      "create_or_get_invite_link",
      {
        p_trip: tripId,
      },
    );
    if (clErr) throw new Error(`create link: ${errSig(clErr)}`);
    const { error: rvErr } = await C.client.rpc("revoke_invite_link", {
      p_trip: tripId,
    });
    if (rvErr) throw new Error(`revoke: ${errSig(rvErr)}`);
    const { data: preview, error: pErr } = await C.client.rpc(
      "get_invite_preview",
      {
        p_token: liveToken,
      },
    );
    if (pErr) throw new Error(`preview after revoke: ${errSig(pErr)}`);
    const pass = preview?.valid === false;
    record(
      9,
      "Revoke then preview old token → valid:false",
      pass,
      `revoked token=${liveToken?.slice(0, 12)}… preview.valid=${preview?.valid}`,
    );
  } catch (e) {
    record(9, "Revoke invite link", false, `unexpected error: ${e.message}`);
  }

  // ================= CHECK 8: Last member deletes trip =================
  try {
    const { data: leaveRet, error: lErr } = await C.client.rpc("leave_trip", {
      p_trip: tripId,
    });
    if (lErr) throw new Error(`C leave: ${errSig(lErr)}`);
    const deletedRet = leaveRet === "trip_deleted";

    // Trip row gone — read via C; owner/RLS aside, a deleted row returns nothing.
    const { data: tripRow } = await C.client
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .maybeSingle();
    const tripGone = !tripRow;

    // trip_members empty for that trip (cascade). Read via C.
    const { count: mCount } = await C.client
      .from("trip_members")
      .select("*", { count: "exact", head: true })
      .eq("trip_id", tripId);
    const membersGone = mCount === 0 || mCount == null;

    const pass = deletedRet && tripGone && membersGone;
    record(
      8,
      "Last member leave → 'trip_deleted' (trip row gone, members cascade)",
      pass,
      `leave_ret=${leaveRet} trip_exists=${!!tripRow} trip_members_left=${mCount}`,
    );
  } catch (e) {
    record(
      8,
      "Last member deletes trip",
      false,
      `unexpected error: ${e.message}`,
    );
  }

  // ---- Summary ----
  console.log("\n=== SUMMARY ===");
  const ordered = [...results].sort((a, b) => a.id - b.id);
  for (const r of ordered) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  #${r.id}  ${r.title}`);
  }
  const failed = ordered.filter((r) => !r.pass);
  console.log(
    `\n${ordered.length - failed.length}/${ordered.length} checks passed.`,
  );
  if (failed.length) {
    console.log("FAILED:", failed.map((r) => `#${r.id}`).join(", "));
    process.exitCode = 1;
  } else {
    console.log(
      "VERDICT: Phase-1 membership lifecycle backend behaves per spec.",
    );
  }
}

main().catch((e) => {
  console.error("\nFATAL:", e.message);
  process.exit(1);
});
