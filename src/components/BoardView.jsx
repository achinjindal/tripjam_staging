import { useState, useRef, useEffect } from "react";
import { T, RADIUS, SHADOW, MOTION, PLACES_PROXY, PLACES_HEADERS } from "../theme";
import { supabase } from "../supabase";

/* ─── BOARD VIEW ─────────────────────────────────────────────────────── */

function NotesView({ trip, onSaveNotes, onBack }) {
  const [text, setText] = useState(trip.board_notes || "");
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved"
  const timerRef = useRef(null);
  const textareaRef = useRef(null);
  const pendingRef = useRef(null); // tracks text waiting to be saved

  // Focus textarea on mount
  useEffect(() => { textareaRef.current?.focus(); }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    setSaveStatus("saving");
    pendingRef.current = val;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      await onSaveNotes(val);
      pendingRef.current = null;
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(null), 2000);
    }, 1000);
  };

  // Flush any pending save on unmount (e.g. user navigates back within 1s)
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (pendingRef.current !== null) onSaveNotes(pendingRef.current);
  }, []);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.warm }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: `1px solid ${T.sand}`, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: T.ocean, padding: "0 4px", lineHeight: 1 }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink }}>Notes</div>
        </div>
        <div style={{ fontSize: 11, fontFamily: "Georgia,serif", color: saveStatus === "saving" ? T.mist : T.moss, minWidth: 50, textAlign: "right" }}>
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "✓ Saved"}
        </div>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        placeholder={"Jot anything down — hotel confirmation numbers, visa requirements, things to remember, packing notes…"}
        style={{
          flex: 1, width: "100%", padding: "16px 18px",
          border: "none", outline: "none", resize: "none",
          fontFamily: "Georgia,serif", fontSize: 14, lineHeight: 1.7,
          color: T.ink, background: T.warm,
          boxSizing: "border-box",
        }}
      />

      {/* Footer word count */}
      {wordCount > 0 && (
        <div style={{ padding: "6px 18px 10px", fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", flexShrink: 0 }}>
          {wordCount} word{wordCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

const CATEGORY_ORDER = ["Bookings", "Documents", "Health & safety", "Money", "Packing", "Day of travel"];

function TodoView({ trip, onBack }) {
  const [todos, setTodos]           = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [newText, setNewText]       = useState("");
  const [loading, setLoading]       = useState(true);
  const autoGenTriggered = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    supabase.from("trip_todos").select("*").eq("trip_id", trip.id).order("position")
      .then(({ data }) => {
        setTodos(data || []);
        setLoading(false);
        // Auto-generate on first visit if list is empty
        if ((!data || data.length === 0) && !autoGenTriggered.current) {
          autoGenTriggered.current = true;
          generateTodos(data || []);
        }
      })
      .catch(() => setLoading(false));
  }, [trip.id]);

  const generateTodos = async (existing) => {
    setGenerating(true);
    setSuggestions([]);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-todos`,
        { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ trip }) }
      );
      const { items } = await res.json();
      const existingTexts = new Set((existing || todos).map(t => t.text.toLowerCase()));
      setSuggestions((items || []).filter(s => !existingTexts.has(s.text.toLowerCase())));
    } catch { /* silent */ }
    setGenerating(false);
  };

  const accept = async (item, idx) => {
    const { data } = await supabase.from("trip_todos")
      .insert({ trip_id: trip.id, text: item.text, done: false, position: todos.length, category: item.category || null, due_date: item.due_date || null })
      .select().single();
    if (data) setTodos(prev => [...prev, data]);
    setSuggestions(prev => prev.filter((_, i) => i !== idx));
  };

  const discard = (idx) => setSuggestions(prev => prev.filter((_, i) => i !== idx));

  const acceptAll = async () => {
    const rows = suggestions.map((s, i) => ({ trip_id: trip.id, text: s.text, done: false, position: todos.length + i, category: s.category || null, due_date: s.due_date || null }));
    const { data } = await supabase.from("trip_todos").insert(rows).select();
    setTodos(prev => [...prev, ...(data || [])]);
    setSuggestions([]);
  };

  const toggleDone = async (todo) => {
    const done = !todo.done;
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, done } : t));
    await supabase.from("trip_todos").update({ done }).eq("id", todo.id);
  };

  const deleteTodo = async (todo) => {
    setTodos(prev => prev.filter(t => t.id !== todo.id));
    await supabase.from("trip_todos").delete().eq("id", todo.id);
  };

  const addManual = async () => {
    const text = newText.trim();
    if (!text) return;
    setNewText("");
    const { data, error } = await supabase.from("trip_todos")
      .insert({ trip_id: trip.id, text, done: false, position: todos.length })
      .select().single();
    if (error) { console.error("trip_todos insert:", error); return; }
    if (data) setTodos(prev => [...prev, data]);
  };

  const doneCount = todos.filter(t => t.done).length;
  const total = todos.length;

  // Group suggestions by category
  const groupedSuggestions = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = suggestions.filter(s => s.category === cat);
    if (items.length) acc.push({ cat, items });
    return acc;
  }, []);
  const knownCats = new Set(CATEGORY_ORDER);
  const otherSuggestions = suggestions.filter(s => !knownCats.has(s.category));
  if (otherSuggestions.length) groupedSuggestions.push({ cat: "Other", items: otherSuggestions });

  // Group todos by category
  const DUE_ORDER = ["2 months before", "1 month before", "2 weeks before", "1 week before", "Day before", "Day of travel"];
  const groupedTodos = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = todos.filter(t => (t.category || "Other") === cat);
    if (items.length) acc.push({ cat, items });
    return acc;
  }, []);
  const otherTodos = todos.filter(t => !t.category || !knownCats.has(t.category));
  if (otherTodos.length) groupedTodos.push({ cat: "Other", items: otherTodos });

  const CATEGORY_ICONS = { Bookings: "📋", Documents: "📄", Packing: "🧳", "Health & safety": "🏥", Money: "💳", "Day of travel": "✈️", Other: "📌" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.warm }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: `1px solid ${T.sand}`, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: T.ocean, padding: "0 4px", lineHeight: 1 }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink }}>To-do</div>
          {total > 0 && <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif" }}>{doneCount}/{total} done</div>}
        </div>
        {/* Generate button moved to suggestions section below */}
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {/* ── TOP HALF: My checklist ── */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: "24px 16px", color: T.mist, fontFamily: "Georgia,serif", fontSize: 13, textAlign: "center" }}>Loading…</div>
          ) : todos.length === 0 && !generating ? (
            <div style={{ padding: "32px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
              <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: T.ink, marginBottom: 6 }}>Nothing here yet</div>
              <div style={{ fontSize: 13, color: T.mist, fontFamily: "Georgia,serif", lineHeight: 1.6 }}>Accept suggestions below or add items manually.</div>
            </div>
          ) : (
            <div style={{ padding: "8px 16px 0" }}>
              {groupedTodos.map(({ cat, items }) => (
                <div key={cat} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, paddingTop: 4 }}>
                    <span style={{ fontSize: 14 }}>{CATEGORY_ICONS[cat] || "📌"}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.ink, fontFamily: "Georgia,serif", letterSpacing: 0.3 }}>{cat}</span>
                    <span style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif" }}>({items.filter(t => t.done).length}/{items.length})</span>
                  </div>
                  {items.map(todo => (
                    <div key={todo.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 4px", borderBottom: `1px solid ${T.sand}` }}>
                      <button onClick={() => toggleDone(todo)} style={{
                        width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1, cursor: "pointer",
                        border: `2px solid ${todo.done ? T.moss : T.sand}`,
                        background: todo.done ? T.moss : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 12,
                      }}>
                        {todo.done ? "✓" : ""}
                      </button>
                      <div style={{ flex: 1, paddingTop: 2 }}>
                        <div style={{ fontSize: 13, fontFamily: "Georgia,serif", color: todo.done ? T.mist : T.ink, textDecoration: todo.done ? "line-through" : "none", lineHeight: 1.5 }}>
                          {todo.text}
                        </div>
                        {todo.due_date && !todo.done && (
                          <div style={{ fontSize: 10, color: T.ocean, fontFamily: "Georgia,serif", marginTop: 2 }}>⏰ {todo.due_date}</div>
                        )}
                      </div>
                      <button onClick={() => deleteTodo(todo)} style={{ background: "none", border: "none", fontSize: 14, color: T.sand, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── BOTTOM HALF: Suggestions ── */}
        <div style={{ borderTop: `2px solid ${T.sand}`, background: "#F8F5EF", flexShrink: 0, maxHeight: "45%", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 6px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.ocean, fontFamily: "Georgia,serif", textTransform: "uppercase", letterSpacing: 1 }}>
              ✨ Suggestions {suggestions.length > 0 ? `(${suggestions.length})` : ""}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {suggestions.length > 0 && (
                <button onClick={acceptAll} style={{ fontSize: 11, color: T.moss, fontFamily: "Georgia,serif", background: "none", border: `1px solid ${T.moss}`, borderRadius: RADIUS.full, padding: "3px 10px", cursor: "pointer" }}>
                  Accept all
                </button>
              )}
              <button onClick={() => generateTodos()} disabled={generating} style={{
                fontSize: 11, color: "white", fontFamily: "Georgia,serif",
                background: generating ? T.sand : T.ocean, border: "none",
                borderRadius: RADIUS.full, padding: "3px 10px", cursor: generating ? "default" : "pointer",
              }}>
                {generating ? "Generating…" : "✨ Generate"}
              </button>
            </div>
          </div>
          {generating && suggestions.length === 0 && (
            <div style={{ padding: "20px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 8, animation: "pulse 1.5s ease-in-out infinite" }}>✨</div>
              <div style={{ fontSize: 13, color: T.mist, fontFamily: "Georgia,serif" }}>Generating suggestions for your {trip.destination} trip…</div>
            </div>
          )}
          {!generating && suggestions.length === 0 && (
            <div style={{ padding: "16px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>
                {todos.length > 0 ? "No new suggestions. Tap Generate for more." : "Tap Generate for a personalised checklist."}
              </div>
            </div>
          )}
          {suggestions.length > 0 && (
            <div style={{ padding: "4px 16px 12px" }}>
              {groupedSuggestions.map(({ cat, items }) => (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", letterSpacing: 0.5, marginBottom: 6, paddingLeft: 2 }}>{CATEGORY_ICONS[cat] || "📌"} {cat}</div>
                  {items.map((item, globalIdx) => {
                    const idx = suggestions.indexOf(item);
                    return (
                      <div key={globalIdx} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F0F7FF", border: `1px solid #C8DFFE`, borderRadius: RADIUS.md, padding: "10px 12px", marginBottom: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontFamily: "Georgia,serif", color: T.ink, lineHeight: 1.4 }}>{item.text}</div>
                          {item.due_date && <div style={{ fontSize: 10, color: T.ocean, fontFamily: "Georgia,serif", marginTop: 3 }}>⏰ {item.due_date}</div>}
                        </div>
                        <button onClick={() => accept(item, idx)} title="Add to list" style={{ background: T.moss, border: "none", borderRadius: "50%", width: 28, height: 28, color: "white", fontSize: 14, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</button>
                        <button onClick={() => discard(idx)} title="Discard" style={{ background: "none", border: `1px solid ${T.sand}`, borderRadius: "50%", width: 28, height: 28, color: T.mist, fontSize: 14, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add manual item */}
      <div style={{ padding: "10px 16px", paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${T.sand}`, background: T.chalk, display: "flex", gap: 8, flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addManual()}
          placeholder="Add an item…"
          style={{ flex: 1, padding: "10px 14px", borderRadius: RADIUS.full, border: `1.5px solid ${T.sand}`, fontFamily: "Georgia,serif", fontSize: 13, color: T.ink, outline: "none", background: T.warm }}
        />
        <button onClick={addManual} disabled={!newText.trim()} style={{ width: 40, height: 40, borderRadius: "50%", background: newText.trim() ? T.ocean : T.sand, color: "white", border: "none", fontSize: 18, cursor: newText.trim() ? "pointer" : "default" }}>+</button>
      </div>
    </div>
  );
}

/* ─── BOOKMARKS VIEW ─────────────────────────────────────────────────── */
function BookmarksView({ trip, onBack }) {
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState(null);
  const titleRef = useRef(null);

  useEffect(() => {
    supabase.from("trip_bookmarks").select("*").eq("trip_id", trip.id).order("position")
      .then(({ data }) => { setBookmarks(data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [trip.id]);

  const iconForUrl = (u) => {
    if (/booking\.com/i.test(u)) return "🏨";
    if (/airbnb/i.test(u)) return "🏠";
    if (/airline|flight|skyscanner|kayak|google\.com\/travel\/flights/i.test(u)) return "✈️";
    if (/maps\.google|goo\.gl\/maps/i.test(u)) return "📍";
    if (/tripadvisor/i.test(u)) return "⭐";
    if (/docs\.google|drive\.google/i.test(u)) return "📄";
    if (/visa|embassy|consulate/i.test(u)) return "🛂";
    if (/insurance/i.test(u)) return "🛡️";
    return "🔗";
  };

  // Auto-fetch page title when URL is pasted/changed
  const fetchingTitle = useRef(false);
  useEffect(() => {
    if (editing || title.trim() || !url.trim() || fetchingTitle.current) return;
    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    // Extract a readable title from the URL as fallback
    try {
      const hostname = new URL(u).hostname.replace(/^www\./, "");
      const path = new URL(u).pathname.replace(/\/$/, "").split("/").pop() || "";
      const readable = path ? decodeURIComponent(path).replace(/[-_]/g, " ") : hostname;
      setTitle(readable.charAt(0).toUpperCase() + readable.slice(1));
    } catch { /* invalid URL */ }
  }, [url, editing]);

  const addBookmark = async () => {
    const t = title.trim();
    let u = url.trim();
    if (!t || !u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    setTitle(""); setUrl("");
    const icon = iconForUrl(u);
    const { data } = await supabase.from("trip_bookmarks")
      .insert({ trip_id: trip.id, title: t, url: u, icon, position: bookmarks.length })
      .select().single();
    if (data) setBookmarks(prev => [...prev, data]);
  };

  const deleteBookmark = async (bm) => {
    setBookmarks(prev => prev.filter(b => b.id !== bm.id));
    await supabase.from("trip_bookmarks").delete().eq("id", bm.id);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const t = title.trim();
    let u = url.trim();
    if (!t || !u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const icon = iconForUrl(u);
    setBookmarks(prev => prev.map(b => b.id === editing.id ? { ...b, title: t, url: u, icon } : b));
    setEditing(null); setTitle(""); setUrl("");
    await supabase.from("trip_bookmarks").update({ title: t, url: u, icon }).eq("id", editing.id);
  };

  const startEdit = (bm) => {
    setEditing(bm);
    setTitle(bm.title);
    setUrl(bm.url);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const cancelEdit = () => { setEditing(null); setTitle(""); setUrl(""); };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.warm }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: `1px solid ${T.sand}`, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: T.ocean, padding: "0 4px", lineHeight: 1 }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink }}>Bookmarks</div>
          {bookmarks.length > 0 && <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif" }}>{bookmarks.length} saved</div>}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: "24px 16px", color: T.mist, fontFamily: "Georgia,serif", fontSize: 13, textAlign: "center" }}>Loading…</div>
        ) : bookmarks.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔖</div>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: T.ink, marginBottom: 6 }}>No bookmarks yet</div>
            <div style={{ fontSize: 13, color: T.mist, fontFamily: "Georgia,serif", lineHeight: 1.6 }}>Save links to flights, hotels, reservations, or any useful pages for your trip.</div>
          </div>
        ) : (
          <div style={{ padding: "12px 16px 0" }}>
            {bookmarks.map(bm => (
              <div key={bm.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 4px", borderBottom: `1px solid ${T.sand}` }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{bm.icon}</span>
                <a href={bm.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textDecoration: "none", minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontFamily: "Georgia,serif", color: T.ink, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bm.title}</div>
                  <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bm.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</div>
                </a>
                <button onClick={() => startEdit(bm)} style={{ background: "none", border: "none", fontSize: 13, color: T.mist, cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>✏️</button>
                <button onClick={() => deleteBookmark(bm)} style={{ background: "none", border: "none", fontSize: 14, color: T.sand, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "10px 16px", paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${T.sand}`, background: T.chalk, flexShrink: 0 }}>
        {editing && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: T.ocean, fontFamily: "Georgia,serif" }}>Editing bookmark</span>
            <button onClick={cancelEdit} style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title (e.g. Flight to Tokyo)"
            style={{ padding: "10px 14px", borderRadius: RADIUS.lg, border: `1.5px solid ${T.sand}`, fontFamily: "Georgia,serif", fontSize: 13, color: T.ink, outline: "none", background: T.warm }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (editing ? saveEdit() : addBookmark())}
              placeholder="URL (e.g. booking.com/...)"
              style={{ flex: 1, padding: "10px 14px", borderRadius: RADIUS.lg, border: `1.5px solid ${T.sand}`, fontFamily: "Georgia,serif", fontSize: 13, color: T.ink, outline: "none", background: T.warm }}
            />
            <button onClick={editing ? saveEdit : addBookmark} disabled={!title.trim() || !url.trim()} style={{
              width: 40, height: 40, borderRadius: "50%", border: "none", fontSize: 18, cursor: (title.trim() && url.trim()) ? "pointer" : "default",
              background: (title.trim() && url.trim()) ? T.ocean : T.sand, color: "white",
            }}>{editing ? "✓" : "+"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── EXPENSES VIEW ──────────────────────────────────────────────────── */
const EXPENSE_CATEGORIES = ["Stay", "Transport", "Food", "Activities", "Shopping", "Other"];
const EXPENSE_ICONS = { Stay: "🏨", Transport: "🚌", Food: "🍜", Activities: "🎭", Shopping: "🛍️", Other: "📦" };
const EXPENSE_COLORS = { Stay: "#7C3AED", Transport: "#2563A8", Food: "#D97706", Activities: "#059669", Shopping: "#DB2777", Other: "#6B7280" };

function ExpensesView({ trip, onBack, onUpdateTrip }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [addTitle, setAddTitle] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addCurrency, setAddCurrency] = useState(trip.budget_currency || "USD");
  const [addCategory, setAddCategory] = useState("Food");
  const [addIsPlanned, setAddIsPlanned] = useState(true);
  const [budget, setBudget] = useState(trip.budget_amount || null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState(trip.budget_amount?.toString() || "");
  const [tab, setTab] = useState("planned"); // "planned" | "actual"
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    supabase.from("trip_expenses").select("*").eq("trip_id", trip.id).order("position")
      .then(({ data }) => { setExpenses(data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [trip.id]);

  const addExpense = async () => {
    const t = addTitle.trim();
    const amt = parseFloat(addAmount);
    if (!t || isNaN(amt) || amt <= 0) return;
    if (editingExpense) {
      // Update existing
      setExpenses(prev => prev.map(e => e.id === editingExpense.id ? { ...e, title: t, amount: amt, currency: addCurrency, category: addCategory } : e));
      setEditingExpense(null); setAddTitle(""); setAddAmount(""); setShowAdd(false);
      await supabase.from("trip_expenses").update({ title: t, amount: amt, currency: addCurrency, category: addCategory }).eq("id", editingExpense.id);
    } else {
      setAddTitle(""); setAddAmount(""); setShowAdd(false);
      const { data } = await supabase.from("trip_expenses")
        .insert({ trip_id: trip.id, title: t, amount: amt, currency: addCurrency, category: addCategory, is_planned: addIsPlanned, position: expenses.length })
        .select().single();
      if (data) setExpenses(prev => [...prev, data]);
    }
  };

  const startEditExpense = (exp) => {
    setEditingExpense(exp);
    setAddTitle(exp.title);
    setAddAmount(String(exp.amount));
    setAddCurrency(exp.currency || "USD");
    setAddCategory(exp.category || "Other");
    setShowAdd(true);
  };

  const cancelAdd = () => {
    setShowAdd(false); setEditingExpense(null);
    setAddTitle(""); setAddAmount("");
  };

  const deleteExpense = async (exp) => {
    setExpenses(prev => prev.filter(e => e.id !== exp.id));
    await supabase.from("trip_expenses").delete().eq("id", exp.id);
  };

  const saveBudget = async () => {
    const amt = parseFloat(budgetInput);
    if (isNaN(amt) || amt <= 0) return;
    setBudget(amt);
    setEditingBudget(false);
    await supabase.from("trips").update({ budget_amount: amt }).eq("id", trip.id);
    if (onUpdateTrip) onUpdateTrip({ budget_amount: amt });
  };

  const generateEstimate = async () => {
    setGenerating(true);
    try {
      const igReq = trip.ig_request || {};
      const budgetLabel = { budget: "budget", mid: "mid-range", luxury: "luxury" }[igReq.budget] || "mid-range";
      const numDays = trip.start_date && trip.end_date
        ? Math.max(1, Math.round((new Date(trip.end_date) - new Date(trip.start_date)) / 864e5) + 1)
        : 5;
      const prompt = `Estimate trip costs for: ${trip.destination}, ${numDays} days, ${igReq.travelers || 2} travelers, ${budgetLabel} budget.
Return ONLY a JSON array of estimated expenses. Each: {"title":"...","amount":number,"category":"Stay|Transport|Food|Activities|Shopping|Other"}
Include: accommodation (total), flights/transport, daily food budget, key activities, misc. Use USD. Be realistic for the destination and budget level. 8-12 items.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": "", // Client-side — use edge function instead
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
      });
      // Actually, let's use an edge function approach
      throw new Error("use-edge");
    } catch {
      // Fallback: use generate-todos-style edge function
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estimate-expenses`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ trip }),
        });
        const { items } = await res.json();
        if (items?.length) {
          const existingTitles = new Set(expenses.map(e => e.title.toLowerCase()));
          const newItems = (items || []).filter(i => !existingTitles.has(i.title.toLowerCase()));
          const rows = newItems.map((item, i) => ({
            trip_id: trip.id, title: item.title, amount: item.amount,
            category: item.category || "Other", is_planned: true, position: expenses.length + i,
          }));
          if (rows.length) {
            const { data } = await supabase.from("trip_expenses").insert(rows).select();
            setExpenses(prev => [...prev, ...(data || [])]);
            // Auto-set budget if not set
            if (!budget) {
              const total = [...expenses, ...(data || [])].reduce((s, e) => s + (e.is_planned ? Number(e.amount) : 0), 0);
              setBudget(total);
              setBudgetInput(total.toString());
              await supabase.from("trips").update({ budget_amount: total }).eq("id", trip.id);
            }
          }
        }
      } catch { /* silent */ }
    }
    setGenerating(false);
  };

  const filtered = expenses.filter(e => tab === "planned" ? e.is_planned : !e.is_planned);
  const totalPlanned = expenses.filter(e => e.is_planned).reduce((s, e) => s + Number(e.amount), 0);
  const totalActual = expenses.filter(e => !e.is_planned).reduce((s, e) => s + Number(e.amount), 0);

  // Category breakdown
  const categoryTotals = EXPENSE_CATEGORIES.map(cat => ({
    cat,
    planned: expenses.filter(e => e.is_planned && e.category === cat).reduce((s, e) => s + Number(e.amount), 0),
    actual: expenses.filter(e => !e.is_planned && e.category === cat).reduce((s, e) => s + Number(e.amount), 0),
  })).filter(c => c.planned > 0 || c.actual > 0);

  const maxCatTotal = Math.max(...categoryTotals.map(c => Math.max(c.planned, c.actual)), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.warm }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: `1px solid ${T.sand}`, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: T.ocean, padding: "0 4px", lineHeight: 1 }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink }}>Expenses</div>
        </div>
        {expenses.filter(e => e.is_planned).length === 0 && (
          <button onClick={generateEstimate} disabled={generating} style={{
            background: generating ? T.sand : T.ocean, color: "white", border: "none",
            borderRadius: RADIUS.full, padding: "7px 14px", fontSize: 12,
            fontFamily: "Georgia,serif", cursor: generating ? "default" : "pointer",
          }}>
            {generating ? "Estimating…" : "✨ Estimate"}
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Budget bar */}
        <div style={{ padding: "14px 16px 10px" }}>
          {editingBudget ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, fontFamily: "Georgia,serif", color: T.mist }}>Budget $</span>
              <input value={budgetInput} onChange={e => setBudgetInput(e.target.value)} onKeyDown={e => e.key === "Enter" && saveBudget()}
                autoFocus style={{ width: 100, padding: "6px 10px", borderRadius: RADIUS.md, border: `1.5px solid ${T.sand}`, fontFamily: "Georgia,serif", fontSize: 14, color: T.ink, outline: "none" }} />
              <button onClick={saveBudget} style={{ background: T.ocean, color: "white", border: "none", borderRadius: RADIUS.md, padding: "6px 12px", fontSize: 12, fontFamily: "Georgia,serif", cursor: "pointer" }}>Save</button>
              <button onClick={() => setEditingBudget(false)} style={{ background: "none", border: "none", fontSize: 12, color: T.mist, cursor: "pointer", fontFamily: "Georgia,serif" }}>Cancel</button>
            </div>
          ) : (
            <div onClick={() => { setEditingBudget(true); setBudgetInput(budget?.toString() || ""); }} style={{ cursor: "pointer" }}>
              {budget ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontFamily: "Georgia,serif", color: T.mist }}>Budget</span>
                    <span style={{ fontSize: 13, fontFamily: "Georgia,serif", fontWeight: 600, color: (totalPlanned > budget) ? T.error : T.ink }}>
                      ${totalPlanned.toLocaleString()} / ${budget.toLocaleString()}
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: T.sand, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 3, background: (totalPlanned / budget) > 1 ? T.error : (totalPlanned / budget) > 0.8 ? T.warning : T.moss, width: `${Math.min(100, (totalPlanned / budget) * 100)}%`, transition: `width ${MOTION.slow}` }} />
                  </div>
                  {totalActual > 0 && (
                    <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", marginTop: 4 }}>
                      Spent so far: ${totalActual.toLocaleString()} ({budget > 0 ? Math.round((totalActual / budget) * 100) : 0}%)
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: T.ocean, fontFamily: "Georgia,serif" }}>+ Set a budget</div>
              )}
            </div>
          )}
        </div>

        {/* Category breakdown */}
        {categoryTotals.length > 0 && (
          <div style={{ padding: "0 16px 12px" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {categoryTotals.map(({ cat, planned, actual }) => (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 4, background: T.chalk, border: `1px solid ${T.sand}`, borderRadius: RADIUS.md, padding: "4px 10px" }}>
                  <span style={{ fontSize: 12 }}>{EXPENSE_ICONS[cat]}</span>
                  <span style={{ fontSize: 11, fontFamily: "Georgia,serif", color: T.ink }}>${(tab === "planned" ? planned : actual).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab switch */}
        <div style={{ display: "flex", margin: "0 16px 12px", background: T.sand, borderRadius: RADIUS.md, padding: 2 }}>
          {[{ key: "planned", label: `Planned ($${totalPlanned.toLocaleString()})` }, { key: "actual", label: `Actual ($${totalActual.toLocaleString()})` }].map(({ key, label }) => (
            <button key={key} onClick={() => { setTab(key); setAddIsPlanned(key === "planned"); }} style={{
              flex: 1, padding: "8px 0", borderRadius: RADIUS.md, border: "none",
              background: tab === key ? T.chalk : "transparent",
              color: tab === key ? T.ink : T.mist,
              fontFamily: "Georgia,serif", fontSize: 12, fontWeight: tab === key ? 600 : 400,
              cursor: "pointer", boxShadow: tab === key ? SHADOW.sm : "none",
            }}>{label}</button>
          ))}
        </div>

        {/* Expense list */}
        {loading ? (
          <div style={{ padding: "24px 16px", color: T.mist, fontFamily: "Georgia,serif", fontSize: 13, textAlign: "center" }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>{tab === "planned" ? "📊" : "💸"}</div>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16, color: T.ink, marginBottom: 6 }}>
              {tab === "planned" ? "No planned expenses" : "No expenses logged"}
            </div>
            <div style={{ fontSize: 13, color: T.mist, fontFamily: "Georgia,serif", lineHeight: 1.6 }}>
              {tab === "planned"
                ? expenses.filter(e => e.is_planned).length === 0
                  ? "Tap ✨ Estimate for an AI-generated budget, or add items manually."
                  : "All planned expenses are in the Actual tab."
                : "Log expenses as you spend during your trip."
              }
            </div>
          </div>
        ) : (
          <div style={{ padding: "0 16px" }}>
            {EXPENSE_CATEGORIES.map(cat => {
              const catItems = filtered.filter(e => e.category === cat);
              if (catItems.length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 14 }}>{EXPENSE_ICONS[cat]}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.ink, fontFamily: "Georgia,serif" }}>{cat}</span>
                    <span style={{ fontSize: 10, color: T.mist, fontFamily: "Georgia,serif" }}>
                      ${catItems.reduce((s, e) => s + Number(e.amount), 0).toLocaleString()}
                    </span>
                  </div>
                  {catItems.map(exp => (
                    <div key={exp.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 4px", borderBottom: `1px solid ${T.sand}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontFamily: "Georgia,serif", color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exp.title}</div>
                      </div>
                      <div style={{ fontSize: 14, fontFamily: "Georgia,serif", fontWeight: 600, color: T.ink, flexShrink: 0 }}>
                        {(exp.currency || "USD") === "USD" ? "$" : exp.currency + " "}{Number(exp.amount).toLocaleString()}
                      </div>
                      <button onClick={() => startEditExpense(exp)} style={{ background: "none", border: "none", fontSize: 13, color: T.ocean, cursor: "pointer", padding: "2px 4px", flexShrink: 0 }}>✏️</button>
                      <button onClick={() => deleteExpense(exp)} style={{ background: "none", border: `1px solid ${T.errorBorder}`, borderRadius: RADIUS.sm, fontSize: 12, color: T.error, cursor: "pointer", padding: "2px 6px", flexShrink: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit expense form */}
      {showAdd ? (
        <div style={{ padding: "12px 16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${T.sand}`, background: T.chalk, flexShrink: 0 }}>
          {editingExpense && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: T.ocean, fontFamily: "Georgia,serif" }}>Editing expense</span>
              <button onClick={cancelAdd} style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
            </div>
          )}
          <input value={addTitle} onChange={e => setAddTitle(e.target.value)} placeholder="What for?" autoFocus
            style={{ width: "100%", padding: "10px 14px", borderRadius: RADIUS.lg, border: `1.5px solid ${T.sand}`, fontFamily: "Georgia,serif", fontSize: 13, color: T.ink, outline: "none", background: T.warm, boxSizing: "border-box", marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={addCurrency} onChange={e => setAddCurrency(e.target.value)}
              style={{ width: 80, padding: "10px 8px", borderRadius: RADIUS.lg, border: `1.5px solid ${T.sand}`, fontFamily: "Georgia,serif", fontSize: 13, color: T.ink, outline: "none", background: T.warm, appearance: "none", textAlign: "center" }}>
              {["USD","EUR","GBP","INR","JPY","AUD","CAD","SGD","AED","THB","IDR","MYR","VND","KRW","CHF","SEK","NOK","DKK","NZD","ZAR","BRL","MXN","TRY","SAR","QAR","PHP","TWD","HKD","CNY","CZK","PLN","HUF","ILS","EGP","MAD","LKR","NPR","MMK","KHR","LAK"].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input value={addAmount} onChange={e => setAddAmount(e.target.value)} placeholder="Amount" type="number" inputMode="decimal"
              style={{ flex: 1, padding: "10px 14px", borderRadius: RADIUS.lg, border: `1.5px solid ${T.sand}`, fontFamily: "Georgia,serif", fontSize: 13, color: T.ink, outline: "none", background: T.warm, textAlign: "right" }} />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {EXPENSE_CATEGORIES.map(cat => (
              <button key={cat} onClick={() => setAddCategory(cat)} style={{
                padding: "5px 10px", borderRadius: RADIUS.md, border: `1.5px solid ${addCategory === cat ? EXPENSE_COLORS[cat] : T.sand}`,
                background: addCategory === cat ? EXPENSE_COLORS[cat] + "15" : "transparent",
                color: addCategory === cat ? EXPENSE_COLORS[cat] : T.mist,
                fontSize: 11, fontFamily: "Georgia,serif", cursor: "pointer",
              }}>{EXPENSE_ICONS[cat]} {cat}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={cancelAdd} style={{ flex: 1, padding: "10px 0", borderRadius: RADIUS.lg, border: `1.5px solid ${T.sand}`, background: "transparent", color: T.mist, fontFamily: "Georgia,serif", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={addExpense} disabled={!addTitle.trim() || !addAmount} style={{
              flex: 1, padding: "10px 0", borderRadius: RADIUS.lg, border: "none",
              background: (addTitle.trim() && addAmount) ? T.ocean : T.sand, color: "white",
              fontFamily: "Georgia,serif", fontSize: 13, cursor: (addTitle.trim() && addAmount) ? "pointer" : "default",
            }}>{editingExpense ? "Save" : "Add"}</button>
          </div>
        </div>
      ) : (
        <div style={{ padding: "10px 16px", paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))", borderTop: `1px solid ${T.sand}`, background: T.chalk, flexShrink: 0 }}>
          <button onClick={() => { setEditingExpense(null); setShowAdd(true); }} style={{
            width: "100%", padding: "12px 0", borderRadius: RADIUS.lg, border: `1.5px dashed ${T.sand}`,
            background: "transparent", color: T.ocean, fontFamily: "Georgia,serif", fontSize: 13, cursor: "pointer",
          }}>+ Add {tab === "planned" ? "planned" : "actual"} expense</button>
        </div>
      )}
    </div>
  );
}

/* ─── MODE PILLS ─────────────────────────────────────────────────────── */
const TRAVEL_MODES = [
  { id:"flight", label:"✈️ Flight" },
  { id:"train",  label:"🚂 Train"  },
  { id:"bus",    label:"🚌 Bus"    },
  { id:"road",   label:"🚗 Road"   },
];
function ModePills({ value, onChange }) {
  return (
    <div style={{display:"flex",gap:6,marginBottom:8}}>
      {TRAVEL_MODES.map(m => (
        <button key={m.id} onClick={()=>onChange(m.id)} style={{
          flex:1, padding:"6px 2px", borderRadius:RADIUS.md,
          border:`1.5px solid ${value===m.id?T.ocean:T.sand}`,
          background:value===m.id?T.ocean:"transparent",
          color:value===m.id?"white":T.mist,
          fontFamily:"Georgia,serif", fontSize:11, cursor:"pointer", transition:`all ${MOTION.normal}`,
        }}>{m.label}</button>
      ))}
    </div>
  );
}

/* ─── CITY INPUT ─────────────────────────────────────────────────────── */
const _cityAutocompleteCache = new Map();

function CityInput({ value, onChange, placeholder, inputStyle, airportOnly = false, hotelCity = null }) {
  const [suggs, setSuggs] = useState([]);
  const [show, setShow]   = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const abortRef = useRef(null);

  const handleChange = (val) => {
    onChange(val);
    if (val.trim().length < 1) { setSuggs([]); setShow(false); setLoading(false); return; }
    const types = airportOnly ? "airport" : (hotelCity ? "lodging" : "");
    const q = hotelCity ? `${val} ${hotelCity}` : val;
    const cacheKey = `${q.trim().toLowerCase()}|${types}`;
    const cached = _cityAutocompleteCache.get(cacheKey);
    if (cached) {
      setSuggs(cached);
      setShow(cached.length > 0);
      setLoading(false);
      return;
    }
    setShow(true);
    setLoading(true);
    clearTimeout(timer.current);
    abortRef.current?.abort();
    timer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const body = { q };
        if (types) body.types = types;
        const res = await fetch(`${PLACES_PROXY}?action=autocomplete`, {
          method: "POST",
          headers: PLACES_HEADERS,
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const data = await res.json();
        const items = (data.suggestions || []).slice(0, 6);
        _cityAutocompleteCache.set(cacheKey, items);
        if (ctrl.signal.aborted) return;
        setSuggs(items);
        setShow(items.length > 0);
        setLoading(false);
      } catch (err) {
        if (err.name === "AbortError") return;
        setSuggs([]);
        setLoading(false);
      }
    }, 200);
  };

  const pick = (s) => {
    const fmt = s.placePrediction?.structuredFormat;
    onChange(fmt?.mainText?.text || s.placePrediction?.text?.text || "");
    setSuggs([]);
    setShow(false);
    setLoading(false);
  };

  return (
    <div style={{position:"relative"}}>
      <input
        value={value}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        placeholder={placeholder}
        style={inputStyle}
      />
      {show && (loading || suggs.length > 0) && (
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:T.chalk,border:`1.5px solid ${T.sand}`,borderRadius:RADIUS.md,zIndex:200,boxShadow:SHADOW.md,overflow:"hidden"}}>
          {loading && suggs.length === 0 && (
            <div style={{padding:"9px 12px",fontFamily:"Georgia,serif",fontSize:12,color:T.mist,display:"flex",alignItems:"center",gap:8}}>
              <span style={{display:"inline-block",width:10,height:10,borderRadius:"50%",border:`2px solid ${T.sand}`,borderTopColor:T.ocean,animation:"spin 0.7s linear infinite"}}/>
              Searching…
            </div>
          )}
          {suggs.map((s,i) => {
            const fmt = s.placePrediction?.structuredFormat;
            const main = fmt?.mainText?.text || s.placePrediction?.text?.text || "";
            const sub  = fmt?.secondaryText?.text || "";
            return (
              <div key={i} onMouseDown={() => pick(s)}
                style={{padding:"9px 12px",cursor:"pointer",borderBottom:i<suggs.length-1?`1px solid ${T.sand}`:"none",fontFamily:"Georgia,serif"}}>
                <div style={{fontSize:13,color:T.ink}}>{main}</div>
                {sub && <div style={{fontSize:11,color:T.mist,marginTop:1}}>{sub}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── LOGISTICS TAB ──────────────────────────────────────────────────── */
function LogisticsTab({ trip, days, onSaveFlights, onSaveHotels, onApplyHotels }) {
  const cities = [...new Set(days.map(d => d.city))];
  const [flights, setFlights] = useState({
    arrivalCity:   trip.arrival_city   || "",
    arrivalTime:   trip.arrival_time   ? trip.arrival_time.split("T")[1]?.substring(0,5)   : "",
    arrivalMode:   trip.arrival_mode   || "flight",
    departureCity: trip.departure_city || "",
    departureTime: trip.departure_time ? trip.departure_time.split("T")[1]?.substring(0,5) : "",
    departureMode: trip.departure_mode || "flight",
  });

  useEffect(() => {
    setFlights({
      arrivalCity:   trip.arrival_city   || "",
      arrivalTime:   trip.arrival_time   ? trip.arrival_time.split("T")[1]?.substring(0,5)   : "",
      arrivalMode:   trip.arrival_mode   || "flight",
      departureCity: trip.departure_city || "",
      departureTime: trip.departure_time ? trip.departure_time.split("T")[1]?.substring(0,5) : "",
      departureMode: trip.departure_mode || "flight",
    });
  }, [trip.id]);

  // Auto-resolve airport for first/last day's city when flight fields are empty.
  // Uses bundled OurAirports dataset (free, ~98KB gzipped, lazy-loaded).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!trip.id) return; // SAMPLE_TRIP / pre-creation state
      const needArrival   = !trip.arrival_city   && days[0]?.city                       && (trip.arrival_mode   || "flight") === "flight";
      const needDeparture = !trip.departure_city && days[days.length - 1]?.city         && (trip.departure_mode || "flight") === "flight";
      if (!needArrival && !needDeparture) return;
      const { resolveAirportForCity } = await import("../airports.js");
      const updates = {};
      let arrivalAirportIata = null, departureAirportIata = null;
      if (needArrival) {
        const ap = await resolveAirportForCity(days[0].city);
        if (ap) {
          updates.arrivalCity = `${ap.name} (${ap.iata})`;
          updates.arrivalTime = "12:00";
          arrivalAirportIata = ap.iata;
        }
      }
      if (needDeparture) {
        const ap = await resolveAirportForCity(days[days.length - 1].city);
        if (ap) {
          updates.departureCity = `${ap.name} (${ap.iata})`;
          updates.departureTime = "19:00";
          departureAirportIata = ap.iata;
        }
      }
      if (cancelled || (!arrivalAirportIata && !departureAirportIata)) return;
      const next = { ...flights, ...updates };
      setFlights(next);
      // Auto-save: trip row already exists by the time this tab is reachable.
      await onSaveFlights({ ...next, arrivalAirportIata, departureAirportIata });
    })();
    return () => { cancelled = true; };
  }, [trip.id]);
  const [hotels, setHotels] = useState(
    cities.map(city => ({
      city,
      name: ((trip.hotels_data || []).find(h => h.city === city) || {}).name || "",
    }))
  );
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | done

  const saved = {
    arrivalCity:   trip.arrival_city   || "",
    arrivalTime:   trip.arrival_time   ? trip.arrival_time.split("T")[1]?.substring(0,5)   : "",
    arrivalMode:   trip.arrival_mode   || "flight",
    departureCity: trip.departure_city || "",
    departureTime: trip.departure_time ? trip.departure_time.split("T")[1]?.substring(0,5) : "",
    departureMode: trip.departure_mode || "flight",
  };
  const hotelsChanged = hotels.some((h, i) => {
    const orig = ((trip.hotels_data || []).find(x => x.city === h.city) || {}).name || "";
    return h.name !== orig;
  });
  const hasChanges = saveStatus !== "saving" && (
    JSON.stringify(flights) !== JSON.stringify(saved) ||
    hotelsChanged
  );

  const handleSaveAll = async () => {
    if (!hasChanges) return;
    setSaveStatus("saving");
    await onSaveFlights({ ...flights });
    await onSaveHotels(hotels);
    await onApplyHotels(hotels);
    setSaveStatus("done");
    setTimeout(() => setSaveStatus("idle"), 2500);
  };

  const inputStyle = (filled) => ({
    width:"100%", padding:"10px 12px", borderRadius:RADIUS.md,
    border:`1.5px solid ${filled ? T.ocean : T.sand}`,
    fontFamily:"Georgia,serif", fontSize:13, color:T.ink,
    outline:"none", boxSizing:"border-box", background:"white",
  });

  const dateLabel = (iso) => iso
    ? new Date(iso+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})
    : "—";


  return (
    <div style={{padding:"20px 16px 100px",display:"flex",flexDirection:"column",gap:16}}>

      {/* Travel */}
      <div style={{background:T.chalk,borderRadius:RADIUS.lg,padding:16,border:`1.5px solid ${T.sand}`}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.ink,marginBottom:14}}>🧭 Travel</div>

        {/* Arrival */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Arriving</div>
          <ModePills value={flights.arrivalMode} onChange={v=>setFlights(f=>({...f,arrivalMode:v}))}/>
          <CityInput value={flights.arrivalCity} onChange={v=>setFlights(f=>({...f,arrivalCity:v}))}
            placeholder={flights.arrivalMode === "flight" ? "Arrival airport (e.g. Mumbai)" : "Arrival city (e.g. Mumbai)"}
            airportOnly={flights.arrivalMode === "flight"}
            inputStyle={{...inputStyle(flights.arrivalCity),marginBottom:8}}/>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{flex:1,padding:"10px 12px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:12,color:T.mist,background:"#f7f7f7"}}>
              {dateLabel(trip.start_date)}
            </div>
            {flights.arrivalMode !== "road" && (
              <input type="time" value={flights.arrivalTime} onChange={e=>setFlights(f=>({...f,arrivalTime:e.target.value}))}
                style={{...inputStyle(flights.arrivalTime),flex:1}}/>
            )}
          </div>
        </div>

        {/* Departure */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>Departing</div>
          <ModePills value={flights.departureMode} onChange={v=>setFlights(f=>({...f,departureMode:v}))}/>
          <CityInput value={flights.departureCity} onChange={v=>setFlights(f=>({...f,departureCity:v}))}
            placeholder={flights.departureMode === "flight" ? "Departure airport (e.g. Goa)" : "Departure city (e.g. Goa)"}
            airportOnly={flights.departureMode === "flight"}
            inputStyle={{...inputStyle(flights.departureCity),marginBottom:8}}/>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{flex:1,padding:"10px 12px",borderRadius:RADIUS.md,border:`1.5px solid ${T.sand}`,fontFamily:"Georgia,serif",fontSize:12,color:T.mist,background:"#f7f7f7"}}>
              {dateLabel(trip.end_date)}
            </div>
            {flights.departureMode !== "road" && (
              <input type="time" value={flights.departureTime} onChange={e=>setFlights(f=>({...f,departureTime:e.target.value}))}
                style={{...inputStyle(flights.departureTime),flex:1}}/>
            )}
          </div>
        </div>


      </div>

      {/* Hotels */}
      <div style={{background:T.chalk,borderRadius:RADIUS.lg,padding:16,border:`1.5px solid ${T.sand}`}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:16,color:T.ink,marginBottom:14}}>🏨 Hotels</div>
        {hotels.map((h, i) => (
          <div key={h.city} style={{marginBottom:i < hotels.length-1 ? 12 : 16}}>
            <div style={{fontSize:11,color:T.mist,fontFamily:"Georgia,serif",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>{h.city}</div>
            <CityInput value={h.name} onChange={v=>setHotels(prev=>prev.map((x,j)=>j===i?{...x,name:v}:x))}
              placeholder={`Hotel in ${h.city}`}
              hotelCity={h.city}
              inputStyle={{...inputStyle(h.name)}}/>
          </div>
        ))}
      </div>

      <div style={{position:"sticky",bottom:0,padding:"12px 0 8px",background:T.warm}}>
        <button onClick={handleSaveAll} disabled={!hasChanges} style={{
          width:"100%",padding:"12px 0",borderRadius:RADIUS.lg,border:"none",
          background: saveStatus==="done" ? T.moss : !hasChanges ? T.sand : `linear-gradient(135deg,${T.ocean},${T.dusk})`,
          color: !hasChanges ? T.mist : "white",
          fontFamily:"'DM Serif Display',serif",fontSize:15,
          cursor: hasChanges ? "pointer" : "default",
          transition:`background ${MOTION.slow}`,
        }}>{saveStatus==="saving" ? "Saving…" : saveStatus==="done" ? "✓ Saved" : "Save and update itinerary"}</button>
      </div>
    </div>
  );
}

/* ─── BOARD VIEW (main) ──────────────────────────────────────────────── */
function BoardView({ trip, onSaveNotes, days, onSaveFlights, onSaveHotels, onApplyHotels, initialSection = null, onInitialSectionConsumed }) {
  const [activeSection, setActiveSection] = useState(null);
  const [todoItems, setTodoItems] = useState(null);
  const [bookmarkCount, setBookmarkCount] = useState(null);

  // Push/pop history entries so browser back works inside sub-views
  const openSection = (section) => {
    setActiveSection(section);
    window.history.pushState({ boardSection: section }, "");
  };

  // Deep-link: open a sub-section when parent requests it (e.g. clicking "Land at" jumps to Travel & Hotels).
  useEffect(() => {
    if (initialSection) {
      openSection(initialSection);
      onInitialSectionConsumed?.();
    }
  }, [initialSection]);
  useEffect(() => {
    const onPop = (e) => {
      if (activeSection) {
        setActiveSection(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [activeSection]);

  const goBack = () => {
    setActiveSection(null);
    window.history.back();
  };

  useEffect(() => {
    if (!trip?.id) return;
    supabase.from("trip_todos").select("id, text, done").eq("trip_id", trip.id).order("position").limit(5)
      .then(({ data }) => setTodoItems(data || []))
      .catch(() => setTodoItems([]));
    supabase.from("trip_bookmarks").select("id", { count: "exact", head: true }).eq("trip_id", trip.id)
      .then(({ count }) => setBookmarkCount(count || 0))
      .catch(() => setBookmarkCount(0));
  }, [trip?.id, activeSection]); // re-fetch when returning from sub-view

  if (activeSection === "notes") {
    return <NotesView trip={trip} onSaveNotes={onSaveNotes} onBack={goBack} />;
  }
  if (activeSection === "todo") {
    return <TodoView trip={trip} onBack={goBack} />;
  }
  if (activeSection === "bookmarks") {
    return <BookmarksView trip={trip} onBack={goBack} />;
  }
  if (activeSection === "expenses") {
    return <ExpensesView trip={trip} onBack={goBack} onUpdateTrip={(updates) => Object.assign(trip, updates)} />;
  }
  if (activeSection === "logistics") {
    return (
      <div style={{flex:1,overflowY:"auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",borderBottom:`1px solid ${T.sand}`,background:T.chalk}}>
          <button onClick={goBack} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ocean,padding:"0 4px",lineHeight:1}}>←</button>
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,color:T.ink}}>Travel & Hotels</div>
        </div>
        <LogisticsTab trip={trip} days={days || []} onSaveFlights={onSaveFlights} onSaveHotels={onSaveHotels} onApplyHotels={onApplyHotels} />
      </div>
    );
  }

  const noteText = trip.board_notes?.trim() || null;
  const notePreview = noteText ? noteText.slice(0, 120) + (noteText.length > 120 ? "…" : "") : null;
  const doneTodos = (todoItems || []).filter(t => t.done).length;

  return (
    <div style={{ padding: "16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── TRAVEL & HOTELS ── */}
      <div onClick={() => openSection("logistics")} style={{ background: T.chalk, borderRadius: RADIUS.lg, border: `1px solid ${T.sand}`, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px" }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>🧭</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: T.ink }}>Travel & Hotels</div>
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>
              {trip.arrival_city ? `${trip.arrival_city} → ${trip.departure_city || trip.arrival_city}` : "Add flights and hotel details"}
            </div>
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
      </div>

      {/* ── EXPENSES ── */}
      <div onClick={() => openSection("expenses")} style={{ background: T.chalk, borderRadius: RADIUS.lg, border: `1px solid ${T.sand}`, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px" }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>💸</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: T.ink }}>Expenses</div>
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>Plan your trip budget</div>
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
      </div>

      {/* ── NOTES ── */}
      <div onClick={() => openSection("notes")} style={{ background: T.chalk, borderRadius: RADIUS.lg, border: `1px solid ${T.sand}`, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px" }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>📝</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: T.ink }}>Notes</div>
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>Shared notes for the trip</div>
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
        <div style={{ borderTop: `1px solid ${T.sand}`, padding: "10px 16px 14px" }}>
          {notePreview
            ? <div style={{ fontSize: 12, color: T.ink, fontFamily: "Georgia,serif", lineHeight: 1.7, opacity: 0.8, whiteSpace: "pre-line" }}>{notePreview}</div>
            : <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", fontStyle: "italic" }}>No notes yet — tap to add</div>
          }
        </div>
      </div>

      {/* ── TO-DO ── */}
      <div onClick={() => openSection("todo")} style={{ background: T.chalk, borderRadius: RADIUS.lg, border: `1px solid ${T.sand}`, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px" }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>✅</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: T.ink }}>To-do</div>
            {todoItems && todoItems.length > 0
              ? <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>{doneTodos}/{todoItems.length} done</div>
              : <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>Checklist for your trip</div>
            }
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
        <div style={{ borderTop: `1px solid ${T.sand}`, padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
          {todoItems === null && (
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>Loading…</div>
          )}
          {todoItems !== null && todoItems.length === 0 && (
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif", fontStyle: "italic" }}>No items yet — tap to generate or add</div>
          )}
          {(todoItems || []).slice(0, 4).map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                border: `1.5px solid ${t.done ? T.ocean : T.sand}`,
                background: t.done ? T.ocean : "none",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {t.done && <span style={{ fontSize: 9, color: "white", lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: 12, fontFamily: "Georgia,serif", color: t.done ? T.mist : T.ink, textDecoration: t.done ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</span>
            </div>
          ))}
          {todoItems && todoItems.length > 4 && (
            <div style={{ fontSize: 11, color: T.mist, fontFamily: "Georgia,serif", paddingLeft: 22 }}>+{todoItems.length - 4} more</div>
          )}
        </div>
      </div>

      {/* ── BOOKMARKS ── */}
      <div onClick={() => openSection("bookmarks")} style={{ background: T.chalk, borderRadius: RADIUS.lg, border: `1px solid ${T.sand}`, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px" }}>
          <div style={{ fontSize: 24, flexShrink: 0 }}>🔖</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15, color: T.ink }}>Bookmarks</div>
            <div style={{ fontSize: 12, color: T.mist, fontFamily: "Georgia,serif" }}>
              {bookmarkCount > 0 ? `${bookmarkCount} saved` : "Save links to flights, hotels & more"}
            </div>
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
      </div>

    </div>
  );
}

export default BoardView;
export { LogisticsTab, CityInput };
