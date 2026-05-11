import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { T, RADIUS, SHADOW, MOTION } from "./theme";

const COST_RATES = {
  "claude-sonnet-4-6": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  "claude-haiku-4-5-20251001": { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
};

function calcCost(model, inputTokens, outputTokens) {
  const rate = COST_RATES[model] || COST_RATES["claude-sonnet-4-6"];
  return inputTokens * rate.input + outputTokens * rate.output;
}

function fmtCost(cost) {
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtNum(n) {
  return n?.toLocaleString("en-US") || "0";
}

export default function AdminConsole({ session, onHome }) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [trips, setTrips] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [llmUsage, setLlmUsage] = useState([]);
  const [dailyUsage, setDailyUsage] = useState([]);
  const [tripDetail, setTripDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load users
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: profiles } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      const { data: allTrips } = await supabase.from("trips").select("id, name, destination, start_date, end_date, created_by, created_at, ig_response, ig_count").order("created_at", { ascending: false });
      const { data: messages } = await supabase.from("trip_messages").select("user_id, trip_id, role");
      const { data: members } = await supabase.from("trip_members").select("user_id, trip_id");

      const userMap = (profiles || []).map(p => {
        const userTrips = (allTrips || []).filter(t => t.created_by === p.id);
        const userMessages = (messages || []).filter(m => m.user_id === p.id && m.role === "user");
        return {
          ...p,
          tripCount: userTrips.length,
          chatCount: userMessages.length,
          lastTrip: userTrips[0]?.created_at || null,
        };
      });
      setUsers(userMap);
      setTrips(allTrips || []);
      setLoading(false);
    })();
  }, []);

  // Load LLM usage
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("llm_usage").select("*").order("created_at", { ascending: false }).limit(1000);
      setLlmUsage(data || []);

      // Daily aggregation
      const byDay = {};
      (data || []).forEach(row => {
        const day = row.created_at?.split("T")[0];
        if (!day) return;
        if (!byDay[day]) byDay[day] = { day, input: 0, output: 0, calls: 0, cost: 0 };
        byDay[day].input += row.input_tokens;
        byDay[day].output += row.output_tokens;
        byDay[day].calls += 1;
        byDay[day].cost += calcCost(row.model, row.input_tokens, row.output_tokens);
      });
      setDailyUsage(Object.values(byDay).sort((a, b) => b.day.localeCompare(a.day)));
    })();
  }, []);

  // Load trip detail
  const loadTripDetail = async (tripId) => {
    const [{ data: days }, { data: messages }, { data: genLog }, { data: brainstorm }, { data: todos }, { data: bookmarks }, { data: expenses }] = await Promise.all([
      supabase.from("days").select("id, label, city, activities(id, type)").eq("trip_id", tripId),
      supabase.from("trip_messages").select("id, role").eq("trip_id", tripId),
      supabase.from("generation_log").select("*").eq("trip_id", tripId).order("created_at", { ascending: false }),
      supabase.from("brainstorm_items").select("id, dismissed").eq("trip_id", tripId),
      supabase.from("trip_todos").select("id, done").eq("trip_id", tripId),
      supabase.from("trip_bookmarks").select("id").eq("trip_id", tripId),
      supabase.from("trip_expenses").select("id, amount").eq("trip_id", tripId),
    ]);

    const tripUsage = llmUsage.filter(u => u.trip_id === tripId);
    const totalCost = tripUsage.reduce((s, u) => s + calcCost(u.model, u.input_tokens, u.output_tokens), 0);

    setTripDetail({
      days: days || [],
      messages: messages || [],
      genLog: genLog || [],
      brainstorm: brainstorm || [],
      todos: todos || [],
      bookmarks: bookmarks || [],
      expenses: expenses || [],
      usage: tripUsage,
      totalCost,
      activityCount: (days || []).reduce((s, d) => s + (d.activities?.length || 0), 0),
      activityTypes: (days || []).flatMap(d => d.activities || []).reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {}),
    });
  };

  const headerStyle = { fontFamily: "'DM Serif Display', serif", fontSize: 20, color: T.ink, marginBottom: 16 };
  const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "Georgia, serif" };
  const thStyle = { textAlign: "left", padding: "8px 6px", color: T.mist, borderBottom: `2px solid ${T.border}`, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 };
  const tdStyle = { padding: "7px 6px", borderBottom: `1px solid ${T.border}`, color: T.ink };
  const tabBtn = (key) => ({
    padding: "8px 16px", border: "none", borderRadius: RADIUS.md, cursor: "pointer",
    fontFamily: "Georgia, serif", fontSize: 13, fontWeight: 600, transition: `all ${MOTION.normal}`,
    background: tab === key ? T.ocean : "transparent", color: tab === key ? T.chalk : T.mist,
  });

  // Global stats
  const totalCost = llmUsage.reduce((s, u) => s + calcCost(u.model, u.input_tokens, u.output_tokens), 0);
  const totalInput = llmUsage.reduce((s, u) => s + u.input_tokens, 0);
  const totalOutput = llmUsage.reduce((s, u) => s + u.output_tokens, 0);

  return (
    <div style={{ minHeight: "100vh", background: T.bgPage, fontFamily: "Georgia, serif" }}>
      {/* Header */}
      <div style={{ background: T.chalk, borderBottom: `1px solid ${T.border}`, padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onHome} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: T.mist }}>←</button>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: T.ink }}>Admin Console</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setTab("users")} style={tabBtn("users")}>Users</button>
          <button onClick={() => setTab("trips")} style={tabBtn("trips")}>Trips</button>
          <button onClick={() => setTab("credits")} style={tabBtn("credits")}>Credits</button>
          <button onClick={() => setTab("daily")} style={tabBtn("daily")}>Daily</button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px" }}>

        {/* Stats bar */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          {[
            { label: "Users", value: users.length },
            { label: "Trips", value: trips.length },
            { label: "LLM Calls", value: llmUsage.length },
            { label: "Total Cost", value: fmtCost(totalCost) },
            { label: "Input Tokens", value: fmtNum(totalInput) },
            { label: "Output Tokens", value: fmtNum(totalOutput) },
          ].map((s, i) => (
            <div key={i} style={{ background: T.chalk, borderRadius: RADIUS.lg, padding: "12px 16px", border: `1px solid ${T.border}`, flex: "1 1 120px", minWidth: 120 }}>
              <div style={{ fontSize: 11, color: T.mist, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: T.ink }}>{s.value}</div>
            </div>
          ))}
        </div>

        {loading && <div style={{ textAlign: "center", padding: 40, color: T.mist }}>Loading…</div>}

        {/* ── USERS TAB ── */}
        {tab === "users" && !loading && (
          selectedUser ? (
            <div>
              <button onClick={() => { setSelectedUser(null); setSelectedTrip(null); setTripDetail(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: T.ocean, fontSize: 13, marginBottom: 16 }}>← All Users</button>
              <div style={headerStyle}>{selectedUser.face_icon || "👤"} {selectedUser.username}</div>
              <div style={{ fontSize: 12, color: T.mist, marginBottom: 16 }}>
                {selectedUser.tripCount} trips · {selectedUser.chatCount} chats · Last active: {fmtDate(selectedUser.lastTrip)}
              </div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Trip</th>
                    <th style={thStyle}>Destination</th>
                    <th style={thStyle}>Dates</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>IG</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.filter(t => t.created_by === selectedUser.id).map(t => {
                    const status = t.ig_response ? "Built" : "Planning";
                    return (
                      <tr key={t.id}>
                        <td style={tdStyle}>{t.name?.slice(0, 30)}</td>
                        <td style={tdStyle}>{t.destination?.slice(0, 20)}</td>
                        <td style={tdStyle}>{fmtDate(t.start_date)}</td>
                        <td style={{ ...tdStyle, color: status === "Built" ? T.moss : T.gold }}>{status}</td>
                        <td style={tdStyle}>{t.ig_count || 0}×</td>
                        <td style={tdStyle}>
                          <button onClick={() => { setSelectedTrip(t); loadTripDetail(t.id); }} style={{ background: T.ocean, color: T.chalk, border: "none", borderRadius: RADIUS.sm, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>Detail</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Trip detail */}
              {selectedTrip && tripDetail && (
                <div style={{ marginTop: 24, background: T.chalk, borderRadius: RADIUS.lg, padding: 16, border: `1px solid ${T.border}` }}>
                  <div style={{ ...headerStyle, fontSize: 16 }}>{selectedTrip.name}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                    {[
                      { label: "Days", value: tripDetail.days.length },
                      { label: "Activities", value: tripDetail.activityCount },
                      { label: "Chat Messages", value: tripDetail.messages.length },
                      { label: "Routes Generated", value: tripDetail.brainstorm.length },
                      { label: "Routes Dismissed", value: tripDetail.brainstorm.filter(b => b.dismissed).length },
                      { label: "IG Generations", value: tripDetail.genLog.length },
                      { label: "Todos", value: tripDetail.todos.length },
                      { label: "Bookmarks", value: tripDetail.bookmarks.length },
                      { label: "Expenses", value: tripDetail.expenses.length },
                      { label: "API Cost", value: fmtCost(tripDetail.totalCost) },
                    ].map((s, i) => (
                      <div key={i} style={{ fontSize: 12 }}>
                        <span style={{ color: T.mist }}>{s.label}: </span>
                        <span style={{ color: T.ink, fontWeight: 600 }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                  {/* Activity type breakdown */}
                  <div style={{ fontSize: 12, color: T.mist, marginBottom: 8 }}>Activity Types:</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    {Object.entries(tripDetail.activityTypes).map(([type, count]) => (
                      <span key={type} style={{ fontSize: 11, background: T.sand, padding: "2px 8px", borderRadius: RADIUS.sm, color: T.ink }}>{type}: {count}</span>
                    ))}
                  </div>
                  {/* IG timing */}
                  {tripDetail.genLog.length > 0 && (
                    <div style={{ fontSize: 12, marginBottom: 8 }}>
                      <span style={{ color: T.mist }}>Latest IG: </span>
                      <span style={{ color: T.ink }}>
                        Compact {tripDetail.genLog[0].compact_secs || "?"}s
                        {tripDetail.genLog[0].detailed_secs ? ` · Detailed ${tripDetail.genLog[0].detailed_secs}s` : ""}
                      </span>
                    </div>
                  )}
                  {/* LLM usage for this trip */}
                  {tripDetail.usage.length > 0 && (
                    <table style={{ ...tableStyle, marginTop: 12 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Function</th>
                          <th style={thStyle}>Model</th>
                          <th style={thStyle}>Input</th>
                          <th style={thStyle}>Output</th>
                          <th style={thStyle}>Cost</th>
                          <th style={thStyle}>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tripDetail.usage.map((u, i) => (
                          <tr key={i}>
                            <td style={tdStyle}>{u.function_name}</td>
                            <td style={tdStyle}>{u.model.includes("haiku") ? "Haiku" : "Sonnet"}</td>
                            <td style={tdStyle}>{fmtNum(u.input_tokens)}</td>
                            <td style={tdStyle}>{fmtNum(u.output_tokens)}</td>
                            <td style={tdStyle}>{fmtCost(calcCost(u.model, u.input_tokens, u.output_tokens))}</td>
                            <td style={tdStyle}>{fmtDate(u.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={headerStyle}>Users</div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>User</th>
                    <th style={thStyle}>Trips</th>
                    <th style={thStyle}>Chats</th>
                    <th style={thStyle}>Last Active</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={tdStyle}>{u.face_icon || "👤"} {u.username}</td>
                      <td style={tdStyle}>{u.tripCount}</td>
                      <td style={tdStyle}>{u.chatCount}</td>
                      <td style={tdStyle}>{fmtDate(u.lastTrip)}</td>
                      <td style={tdStyle}>
                        <button onClick={() => setSelectedUser(u)} style={{ background: T.ocean, color: T.chalk, border: "none", borderRadius: RADIUS.sm, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ── TRIPS TAB ── */}
        {tab === "trips" && !loading && (
          <div>
            <div style={headerStyle}>All Trips ({trips.length})</div>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Trip</th>
                  <th style={thStyle}>Destination</th>
                  <th style={thStyle}>Dates</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>IG</th>
                  <th style={thStyle}>Created</th>
                </tr>
              </thead>
              <tbody>
                {trips.map(t => {
                  const status = t.ig_response ? "Built" : "Planning";
                  return (
                    <tr key={t.id}>
                      <td style={tdStyle}>{t.name?.slice(0, 30)}</td>
                      <td style={tdStyle}>{t.destination?.slice(0, 20)}</td>
                      <td style={tdStyle}>{fmtDate(t.start_date)} – {fmtDate(t.end_date)}</td>
                      <td style={{ ...tdStyle, color: status === "Built" ? T.moss : T.gold }}>{status}</td>
                      <td style={tdStyle}>{t.ig_count || 0}×</td>
                      <td style={tdStyle}>{fmtDate(t.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── CREDITS TAB ── */}
        {tab === "credits" && (
          <div>
            <div style={headerStyle}>Credit Usage</div>
            {/* By function */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, color: T.mist, marginBottom: 8 }}>By Function</div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Function</th>
                    <th style={thStyle}>Model</th>
                    <th style={thStyle}>Calls</th>
                    <th style={thStyle}>Input Tokens</th>
                    <th style={thStyle}>Output Tokens</th>
                    <th style={thStyle}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const grouped = {};
                    llmUsage.forEach(u => {
                      const key = `${u.function_name}|${u.model}`;
                      if (!grouped[key]) grouped[key] = { fn: u.function_name, model: u.model, calls: 0, input: 0, output: 0, cost: 0 };
                      grouped[key].calls++;
                      grouped[key].input += u.input_tokens;
                      grouped[key].output += u.output_tokens;
                      grouped[key].cost += calcCost(u.model, u.input_tokens, u.output_tokens);
                    });
                    return Object.values(grouped).sort((a, b) => b.cost - a.cost).map((g, i) => (
                      <tr key={i}>
                        <td style={tdStyle}>{g.fn}</td>
                        <td style={tdStyle}>{g.model.includes("haiku") ? "Haiku" : "Sonnet"}</td>
                        <td style={tdStyle}>{g.calls}</td>
                        <td style={tdStyle}>{fmtNum(g.input)}</td>
                        <td style={tdStyle}>{fmtNum(g.output)}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtCost(g.cost)}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── DAILY TAB ── */}
        {tab === "daily" && (
          <div>
            <div style={headerStyle}>Daily Usage (last 30 days)</div>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Calls</th>
                  <th style={thStyle}>Input Tokens</th>
                  <th style={thStyle}>Output Tokens</th>
                  <th style={thStyle}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {dailyUsage.slice(0, 30).map((d, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{d.day}</td>
                    <td style={tdStyle}>{d.calls}</td>
                    <td style={tdStyle}>{fmtNum(d.input)}</td>
                    <td style={tdStyle}>{fmtNum(d.output)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtCost(d.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
