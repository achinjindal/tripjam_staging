import { useState, useRef, useEffect } from "react";
import {
  T,
  RADIUS,
  SHADOW,
  MOTION,
  PLACES_PROXY,
  PLACES_HEADERS,
} from "../theme";
import { supabase } from "../supabase";
import { placesAuthHeaders } from "../photos";
import { handleGatedResponse, refreshCredits } from "../credits";
import { logActivity } from "../activity";
import { showToast, confirmSheet } from "../dialogs";
import { DecisionsView } from "./Polls.jsx";

/* ─── BOARD VIEW ─────────────────────────────────────────────────────── */

function NotesView({ trip, onSaveNotes, onBack }) {
  const [text, setText] = useState(trip.board_notes || "");
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved"
  const timerRef = useRef(null);
  const textareaRef = useRef(null);
  const pendingRef = useRef(null); // tracks text waiting to be saved

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      if (pendingRef.current !== null) onSaveNotes(pendingRef.current);
    },
    [],
  );

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: T.warm,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px 10px",
          borderBottom: `1px solid ${T.sand}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            fontSize: 20,
            cursor: "pointer",
            color: T.ocean,
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 18,
              color: T.ink,
            }}
          >
            Notes
          </div>
        </div>
        <div
          style={{
            fontSize: 11,
            fontFamily: "Georgia,serif",
            color: saveStatus === "saving" ? T.mist : T.moss,
            minWidth: 50,
            textAlign: "right",
          }}
        >
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "✓ Saved"}
        </div>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        placeholder={
          "Jot anything down — hotel confirmation numbers, visa requirements, things to remember, packing notes…"
        }
        style={{
          flex: 1,
          width: "100%",
          padding: "16px 18px",
          border: "none",
          outline: "none",
          resize: "none",
          fontFamily: "Georgia,serif",
          fontSize: 14,
          lineHeight: 1.7,
          color: T.ink,
          background: T.warm,
          boxSizing: "border-box",
        }}
      />

      {/* Footer word count */}
      {wordCount > 0 && (
        <div
          style={{
            padding: "6px 18px 10px",
            fontSize: 11,
            color: T.mist,
            fontFamily: "Georgia,serif",
            flexShrink: 0,
          }}
        >
          {wordCount} word{wordCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

const CATEGORY_ORDER = [
  "Bookings",
  "Documents",
  "Health & safety",
  "Money",
  "Packing",
  "Day of travel",
];

function TodoView({ trip, onBack, boardTick = 0 }) {
  const [todos, setTodos] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [newText, setNewText] = useState("");
  const [loading, setLoading] = useState(true);
  const autoGenTriggered = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    supabase
      .from("trip_todos")
      .select("*")
      .eq("trip_id", trip.id)
      .order("position")
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
  }, [trip.id, boardTick]); // boardTick: reconcile on live co-member changes

  const generateTodos = async (existing) => {
    setGenerating(true);
    setSuggestions([]);
    try {
      // D7: edge function now requires real user auth (not anon key)
      const {
        data: { session: sess },
      } = await supabase.auth.getSession();
      const token =
        sess?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-todos`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ trip }),
        },
      );
      if (
        await handleGatedResponse(
          res,
          sess?.user?.id,
          "AI to-do suggestions need credits.",
        )
      ) {
        setGenerating(false);
        return;
      }
      const { items } = await res.json();
      const existingTexts = new Set(
        (existing || todos).map((t) => t.text.toLowerCase()),
      );
      setSuggestions(
        (items || []).filter((s) => !existingTexts.has(s.text.toLowerCase())),
      );
      if (sess?.user?.id) refreshCredits(sess.user.id);
    } catch {
      /* silent */
    }
    setGenerating(false);
  };

  const accept = async (item, idx) => {
    const { data } = await supabase
      .from("trip_todos")
      .insert({
        trip_id: trip.id,
        text: item.text,
        done: false,
        position: todos.length,
        category: item.category || null,
        due_date: item.due_date || null,
      })
      .select()
      .single();
    if (data) setTodos((prev) => [...prev, data]);
    setSuggestions((prev) => prev.filter((_, i) => i !== idx));
  };

  const discard = (idx) =>
    setSuggestions((prev) => prev.filter((_, i) => i !== idx));

  const acceptAll = async () => {
    const rows = suggestions.map((s, i) => ({
      trip_id: trip.id,
      text: s.text,
      done: false,
      position: todos.length + i,
      category: s.category || null,
      due_date: s.due_date || null,
    }));
    const { data } = await supabase.from("trip_todos").insert(rows).select();
    setTodos((prev) => [...prev, ...(data || [])]);
    setSuggestions([]);
  };

  const toggleDone = async (todo) => {
    const done = !todo.done;
    setTodos((prev) =>
      prev.map((t) => (t.id === todo.id ? { ...t, done } : t)),
    );
    await supabase.from("trip_todos").update({ done }).eq("id", todo.id);
  };

  const deleteTodo = async (todo) => {
    setTodos((prev) => prev.filter((t) => t.id !== todo.id));
    await supabase.from("trip_todos").delete().eq("id", todo.id);
    logActivity({
      tripId: trip.id,
      action: "remove_todo",
      entityType: "todo",
      entityId: todo.id,
      summary: `Removed to-do: ${todo.text}`,
      undoPayload: { todo },
    });
  };

  const addManual = async () => {
    const text = newText.trim();
    if (!text) return;
    setNewText("");
    const { data, error } = await supabase
      .from("trip_todos")
      .insert({ trip_id: trip.id, text, done: false, position: todos.length })
      .select()
      .single();
    if (error) {
      console.error("trip_todos insert:", error);
      return;
    }
    if (data) {
      setTodos((prev) => [...prev, data]);
      logActivity({
        tripId: trip.id,
        action: "add_todo",
        entityType: "todo",
        entityId: data.id,
        summary: `Added to-do: ${text}`,
        undoPayload: { id: data.id },
      });
    }
  };

  const doneCount = todos.filter((t) => t.done).length;
  const total = todos.length;

  // Group suggestions by category
  const groupedSuggestions = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = suggestions.filter((s) => s.category === cat);
    if (items.length) acc.push({ cat, items });
    return acc;
  }, []);
  const knownCats = new Set(CATEGORY_ORDER);
  const otherSuggestions = suggestions.filter(
    (s) => !knownCats.has(s.category),
  );
  if (otherSuggestions.length)
    groupedSuggestions.push({ cat: "Other", items: otherSuggestions });

  // Group todos by category
  const DUE_ORDER = [
    "2 months before",
    "1 month before",
    "2 weeks before",
    "1 week before",
    "Day before",
    "Day of travel",
  ];
  const groupedTodos = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = todos.filter((t) => (t.category || "Other") === cat);
    if (items.length) acc.push({ cat, items });
    return acc;
  }, []);
  const otherTodos = todos.filter(
    (t) => !t.category || !knownCats.has(t.category),
  );
  if (otherTodos.length) groupedTodos.push({ cat: "Other", items: otherTodos });

  const CATEGORY_ICONS = {
    Bookings: "📋",
    Documents: "📄",
    Packing: "🧳",
    "Health & safety": "🏥",
    Money: "💳",
    "Day of travel": "✈️",
    Other: "📌",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: T.warm,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px 10px",
          borderBottom: `1px solid ${T.sand}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            fontSize: 20,
            cursor: "pointer",
            color: T.ocean,
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 18,
              color: T.ink,
            }}
          >
            To-do
          </div>
          {total > 0 && (
            <div
              style={{
                fontSize: 11,
                color: T.mist,
                fontFamily: "Georgia,serif",
              }}
            >
              {doneCount}/{total} done
            </div>
          )}
        </div>
        {/* Generate button moved to suggestions section below */}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ── TOP HALF: My checklist ── */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {loading ? (
            <div
              style={{
                padding: "24px 16px",
                color: T.mist,
                fontFamily: "Georgia,serif",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              Loading…
            </div>
          ) : todos.length === 0 && !generating ? (
            <div style={{ padding: "32px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
              <div
                style={{
                  fontFamily: "'DM Serif Display',serif",
                  fontSize: 16,
                  color: T.ink,
                  marginBottom: 6,
                }}
              >
                Nothing here yet
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: T.mist,
                  fontFamily: "Georgia,serif",
                  lineHeight: 1.6,
                }}
              >
                Accept suggestions below or add items manually.
              </div>
            </div>
          ) : (
            <div style={{ padding: "8px 16px 0" }}>
              {groupedTodos.map(({ cat, items }) => (
                <div key={cat} style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 8,
                      paddingTop: 4,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>
                      {CATEGORY_ICONS[cat] || "📌"}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: T.ink,
                        fontFamily: "Georgia,serif",
                        letterSpacing: 0.3,
                      }}
                    >
                      {cat}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: T.mist,
                        fontFamily: "Georgia,serif",
                      }}
                    >
                      ({items.filter((t) => t.done).length}/{items.length})
                    </span>
                  </div>
                  {items.map((todo) => (
                    <div
                      key={todo.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "8px 4px",
                        borderBottom: `1px solid ${T.sand}`,
                      }}
                    >
                      <button
                        onClick={() => toggleDone(todo)}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          flexShrink: 0,
                          marginTop: 1,
                          cursor: "pointer",
                          border: `2px solid ${todo.done ? T.moss : T.sand}`,
                          background: todo.done ? T.moss : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "white",
                          fontSize: 12,
                        }}
                      >
                        {todo.done ? "✓" : ""}
                      </button>
                      <div style={{ flex: 1, paddingTop: 2 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontFamily: "Georgia,serif",
                            color: todo.done ? T.mist : T.ink,
                            textDecoration: todo.done ? "line-through" : "none",
                            lineHeight: 1.5,
                          }}
                        >
                          {todo.text}
                        </div>
                        {todo.due_date && !todo.done && (
                          <div
                            style={{
                              fontSize: 10,
                              color: T.ocean,
                              fontFamily: "Georgia,serif",
                              marginTop: 2,
                            }}
                          >
                            ⏰ {todo.due_date}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => deleteTodo(todo)}
                        aria-label="Delete to-do"
                        style={{
                          background: "none",
                          border: "none",
                          fontSize: 14,
                          color: T.sand,
                          cursor: "pointer",
                          padding: "0 2px",
                          flexShrink: 0,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── BOTTOM HALF: Suggestions ── */}
        <div
          style={{
            borderTop: `2px solid ${T.sand}`,
            background: T.warm,
            flexShrink: 0,
            maxHeight: "45%",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px 6px",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: T.ocean,
                fontFamily: "Georgia,serif",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              ✨ Suggestions{" "}
              {suggestions.length > 0 ? `(${suggestions.length})` : ""}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {suggestions.length > 0 && (
                <button
                  onClick={acceptAll}
                  style={{
                    fontSize: 11,
                    color: T.moss,
                    fontFamily: "Georgia,serif",
                    background: "none",
                    border: `1px solid ${T.moss}`,
                    borderRadius: RADIUS.full,
                    padding: "3px 10px",
                    cursor: "pointer",
                  }}
                >
                  Accept all
                </button>
              )}
              <button
                onClick={() => generateTodos()}
                disabled={generating}
                style={{
                  fontSize: 11,
                  color: "white",
                  fontFamily: "Georgia,serif",
                  background: generating ? T.sand : T.ocean,
                  border: "none",
                  borderRadius: RADIUS.full,
                  padding: "3px 10px",
                  cursor: generating ? "default" : "pointer",
                }}
              >
                {generating ? "Generating…" : "✨ Generate"}
              </button>
            </div>
          </div>
          {generating && suggestions.length === 0 && (
            <div style={{ padding: "20px 24px", textAlign: "center" }}>
              <div
                style={{
                  fontSize: 24,
                  marginBottom: 8,
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              >
                ✨
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: T.mist,
                  fontFamily: "Georgia,serif",
                }}
              >
                Generating suggestions for your {trip.destination} trip…
              </div>
            </div>
          )}
          {!generating && suggestions.length === 0 && (
            <div style={{ padding: "16px 24px", textAlign: "center" }}>
              <div
                style={{
                  fontSize: 12,
                  color: T.mist,
                  fontFamily: "Georgia,serif",
                }}
              >
                {todos.length > 0
                  ? "No new suggestions. Tap Generate for more."
                  : "Tap Generate for a personalised checklist."}
              </div>
            </div>
          )}
          {suggestions.length > 0 && (
            <div style={{ padding: "4px 16px 12px" }}>
              {groupedSuggestions.map(({ cat, items }) => (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: T.mist,
                      fontFamily: "Georgia,serif",
                      letterSpacing: 0.5,
                      marginBottom: 6,
                      paddingLeft: 2,
                    }}
                  >
                    {CATEGORY_ICONS[cat] || "📌"} {cat}
                  </div>
                  {items.map((item, globalIdx) => {
                    const idx = suggestions.indexOf(item);
                    return (
                      <div
                        key={globalIdx}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          background: T.skyLight,
                          border: `1px solid ${T.skyBorder}`,
                          borderRadius: RADIUS.md,
                          padding: "10px 12px",
                          marginBottom: 6,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontFamily: "Georgia,serif",
                              color: T.ink,
                              lineHeight: 1.4,
                            }}
                          >
                            {item.text}
                          </div>
                          {item.due_date && (
                            <div
                              style={{
                                fontSize: 10,
                                color: T.ocean,
                                fontFamily: "Georgia,serif",
                                marginTop: 3,
                              }}
                            >
                              ⏰ {item.due_date}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => accept(item, idx)}
                          title="Add to list"
                          style={{
                            background: T.moss,
                            border: "none",
                            borderRadius: "50%",
                            width: 28,
                            height: 28,
                            color: "white",
                            fontSize: 14,
                            cursor: "pointer",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => discard(idx)}
                          title="Discard"
                          style={{
                            background: "none",
                            border: `1px solid ${T.sand}`,
                            borderRadius: "50%",
                            width: 28,
                            height: 28,
                            color: T.mist,
                            fontSize: 14,
                            cursor: "pointer",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          ✕
                        </button>
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
      <div
        style={{
          padding: "10px 16px",
          paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
          borderTop: `1px solid ${T.sand}`,
          background: T.chalk,
          display: "flex",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <input
          ref={inputRef}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addManual()}
          placeholder="Add an item…"
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: RADIUS.full,
            border: `1.5px solid ${T.sand}`,
            fontFamily: "Georgia,serif",
            fontSize: 13,
            color: T.ink,
            outline: "none",
            background: T.warm,
          }}
        />
        <button
          onClick={addManual}
          disabled={!newText.trim()}
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: newText.trim() ? T.ocean : T.sand,
            color: "white",
            border: "none",
            fontSize: 18,
            cursor: newText.trim() ? "pointer" : "default",
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

/* ─── BOOKMARKS VIEW ─────────────────────────────────────────────────── */
function BookmarksView({ trip, onBack, boardTick = 0 }) {
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState(null);
  const titleRef = useRef(null);

  useEffect(() => {
    supabase
      .from("trip_bookmarks")
      .select("*")
      .eq("trip_id", trip.id)
      .order("position")
      .then(({ data }) => {
        setBookmarks(data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [trip.id, boardTick]); // boardTick: reconcile on live co-member changes

  const iconForUrl = (u) => {
    if (/booking\.com/i.test(u)) return "🏨";
    if (/airbnb/i.test(u)) return "🏠";
    if (/airline|flight|skyscanner|kayak|google\.com\/travel\/flights/i.test(u))
      return "✈️";
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
      const path =
        new URL(u).pathname.replace(/\/$/, "").split("/").pop() || "";
      const readable = path
        ? decodeURIComponent(path).replace(/[-_]/g, " ")
        : hostname;
      setTitle(readable.charAt(0).toUpperCase() + readable.slice(1));
    } catch {
      /* invalid URL */
    }
  }, [url, editing]);

  const addBookmark = async () => {
    const t = title.trim();
    let u = url.trim();
    if (!t || !u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    setTitle("");
    setUrl("");
    const icon = iconForUrl(u);
    const { data } = await supabase
      .from("trip_bookmarks")
      .insert({
        trip_id: trip.id,
        title: t,
        url: u,
        icon,
        position: bookmarks.length,
      })
      .select()
      .single();
    if (data) {
      setBookmarks((prev) => [...prev, data]);
      logActivity({
        tripId: trip.id,
        action: "add_bookmark",
        entityType: "bookmark",
        entityId: data.id,
        summary: `Added bookmark: ${t}`,
        undoPayload: { id: data.id },
      });
    }
  };

  const deleteBookmark = async (bm) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== bm.id));
    await supabase.from("trip_bookmarks").delete().eq("id", bm.id);
    logActivity({
      tripId: trip.id,
      action: "remove_bookmark",
      entityType: "bookmark",
      entityId: bm.id,
      summary: `Removed bookmark: ${bm.title}`,
      undoPayload: { bookmark: bm },
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const t = title.trim();
    let u = url.trim();
    if (!t || !u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const icon = iconForUrl(u);
    setBookmarks((prev) =>
      prev.map((b) =>
        b.id === editing.id ? { ...b, title: t, url: u, icon } : b,
      ),
    );
    setEditing(null);
    setTitle("");
    setUrl("");
    await supabase
      .from("trip_bookmarks")
      .update({ title: t, url: u, icon })
      .eq("id", editing.id);
  };

  const startEdit = (bm) => {
    setEditing(bm);
    setTitle(bm.title);
    setUrl(bm.url);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const cancelEdit = () => {
    setEditing(null);
    setTitle("");
    setUrl("");
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: T.warm,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px 10px",
          borderBottom: `1px solid ${T.sand}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            fontSize: 20,
            cursor: "pointer",
            color: T.ocean,
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 18,
              color: T.ink,
            }}
          >
            Bookmarks
          </div>
          {bookmarks.length > 0 && (
            <div
              style={{
                fontSize: 11,
                color: T.mist,
                fontFamily: "Georgia,serif",
              }}
            >
              {bookmarks.length} saved
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div
            style={{
              padding: "24px 16px",
              color: T.mist,
              fontFamily: "Georgia,serif",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            Loading…
          </div>
        ) : bookmarks.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔖</div>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 16,
                color: T.ink,
                marginBottom: 6,
              }}
            >
              No bookmarks yet
            </div>
            <div
              style={{
                fontSize: 13,
                color: T.mist,
                fontFamily: "Georgia,serif",
                lineHeight: 1.6,
              }}
            >
              Save links to flights, hotels, reservations, or any useful pages
              for your trip.
            </div>
          </div>
        ) : (
          <div style={{ padding: "12px 16px 0" }}>
            {bookmarks.map((bm) => (
              <div
                key={bm.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 4px",
                  borderBottom: `1px solid ${T.sand}`,
                }}
              >
                <span style={{ fontSize: 20, flexShrink: 0 }}>{bm.icon}</span>
                <a
                  href={bm.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ flex: 1, textDecoration: "none", minWidth: 0 }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontFamily: "Georgia,serif",
                      color: T.ink,
                      lineHeight: 1.4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {bm.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: T.mist,
                      fontFamily: "Georgia,serif",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {bm.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                  </div>
                </a>
                <button
                  onClick={() => startEdit(bm)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: 13,
                    color: T.mist,
                    cursor: "pointer",
                    padding: "0 4px",
                    flexShrink: 0,
                  }}
                >
                  ✏️
                </button>
                <button
                  onClick={() => deleteBookmark(bm)}
                  aria-label="Delete bookmark"
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: 14,
                    color: T.sand,
                    cursor: "pointer",
                    padding: "0 2px",
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          padding: "10px 16px",
          paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
          borderTop: `1px solid ${T.sand}`,
          background: T.chalk,
          flexShrink: 0,
        }}
      >
        {editing && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: T.ocean,
                fontFamily: "Georgia,serif",
              }}
            >
              Editing bookmark
            </span>
            <button
              onClick={cancelEdit}
              style={{
                fontSize: 11,
                color: T.mist,
                fontFamily: "Georgia,serif",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Flight to Tokyo)"
            style={{
              padding: "10px 14px",
              borderRadius: RADIUS.lg,
              border: `1.5px solid ${T.sand}`,
              fontFamily: "Georgia,serif",
              fontSize: 13,
              color: T.ink,
              outline: "none",
              background: T.warm,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && (editing ? saveEdit() : addBookmark())
              }
              placeholder="URL (e.g. booking.com/...)"
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: RADIUS.lg,
                border: `1.5px solid ${T.sand}`,
                fontFamily: "Georgia,serif",
                fontSize: 13,
                color: T.ink,
                outline: "none",
                background: T.warm,
              }}
            />
            <button
              onClick={editing ? saveEdit : addBookmark}
              disabled={!title.trim() || !url.trim()}
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "none",
                fontSize: 18,
                cursor: title.trim() && url.trim() ? "pointer" : "default",
                background: title.trim() && url.trim() ? T.ocean : T.sand,
                color: "white",
              }}
            >
              {editing ? "✓" : "+"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── EXPENSES VIEW ──────────────────────────────────────────────────── */
const EXPENSE_CATEGORIES = [
  "Stay",
  "Transport",
  "Food",
  "Activities",
  "Shopping",
  "Other",
];
const EXPENSE_ICONS = {
  Stay: "🏨",
  Transport: "🚌",
  Food: "🍜",
  Activities: "🎭",
  Shopping: "🛍️",
  Other: "📦",
};
const EXPENSE_COLORS = {
  Stay: "#7C3AED",
  Transport: "#2563A8",
  Food: "#D97706",
  Activities: "#059669",
  Shopping: "#DB2777",
  Other: "#6B7280",
};

function ExpensesView({
  trip,
  onBack,
  onUpdateTrip,
  boardTick = 0,
  members = [],
  session = null,
}) {
  // WS4: splitting is a shared-trip feature — solo trips see today's widget.
  const isShared = (members || []).length > 1;
  const selfId = session?.user?.id || null;
  const [addPaidBy, setAddPaidBy] = useState(null); // null = not split
  const memberOf = (uid) => (members || []).find((m) => m.user_id === uid);
  const nameOf = (uid) =>
    memberOf(uid)?.profiles?.username || (uid === selfId ? "You" : "Someone");
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
  const [budgetInput, setBudgetInput] = useState(
    trip.budget_amount?.toString() || "",
  );
  const [tab, setTab] = useState("planned"); // "planned" | "actual"
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    supabase
      .from("trip_expenses")
      .select("*")
      .eq("trip_id", trip.id)
      .order("position")
      .then(({ data }) => {
        setExpenses(data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [trip.id, boardTick]); // boardTick: reconcile on live co-member changes

  const addExpense = async () => {
    const t = addTitle.trim();
    const amt = parseFloat(addAmount);
    if (!t || isNaN(amt) || amt <= 0) return;
    if (editingExpense) {
      // Update existing
      setExpenses((prev) =>
        prev.map((e) =>
          e.id === editingExpense.id
            ? {
                ...e,
                title: t,
                amount: amt,
                currency: addCurrency,
                category: addCategory,
              }
            : e,
        ),
      );
      setEditingExpense(null);
      setAddTitle("");
      setAddAmount("");
      setShowAdd(false);
      await supabase
        .from("trip_expenses")
        .update({
          title: t,
          amount: amt,
          currency: addCurrency,
          category: addCategory,
        })
        .eq("id", editingExpense.id);
      logActivity({
        tripId: trip.id,
        action: "update_expense",
        entityType: "expense",
        entityId: editingExpense.id,
        summary: `Edited expense: ${t}`,
        undoPayload: { expense: editingExpense },
      });
    } else {
      setAddTitle("");
      setAddAmount("");
      setShowAdd(false);
      const { data } = await supabase
        .from("trip_expenses")
        .insert({
          trip_id: trip.id,
          title: t,
          amount: amt,
          currency: addCurrency,
          category: addCategory,
          is_planned: addIsPlanned,
          position: expenses.length,
          // WS4: payer + even split across the group (member count frozen at
          // entry so later joins/leaves don't rewrite old splits)
          ...(isShared && addPaidBy
            ? {
                paid_by: addPaidBy,
                split_mode: "even",
                split_count: members.length,
              }
            : {}),
        })
        .select()
        .single();
      if (data) {
        setExpenses((prev) => [...prev, data]);
        logActivity({
          tripId: trip.id,
          action: "add_expense",
          entityType: "expense",
          entityId: data.id,
          summary: `Added expense: ${t}`,
          undoPayload: { id: data.id },
        });
      }
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
    setShowAdd(false);
    setEditingExpense(null);
    setAddTitle("");
    setAddAmount("");
  };

  const deleteExpense = async (exp) => {
    setExpenses((prev) => prev.filter((e) => e.id !== exp.id));
    await supabase.from("trip_expenses").delete().eq("id", exp.id);
    logActivity({
      tripId: trip.id,
      action: "remove_expense",
      entityType: "expense",
      entityId: exp.id,
      summary: `Removed expense: ${exp.title}`,
      undoPayload: { expense: exp },
    });
  };

  const saveBudget = async () => {
    const amt = parseFloat(budgetInput);
    if (isNaN(amt) || amt <= 0) return;
    const priorBudget = trip.budget_amount ?? null; // for Phase-3 undo
    setBudget(amt);
    setEditingBudget(false);
    await supabase
      .from("trips")
      .update({ budget_amount: amt })
      .eq("id", trip.id);
    if (onUpdateTrip) onUpdateTrip({ budget_amount: amt });
    logActivity({
      tripId: trip.id,
      action: "set_budget",
      entityType: "trip",
      entityId: trip.id,
      summary: `Set budget to ${amt}`,
      undoPayload: { budget_amount: priorBudget },
    });
  };

  const generateEstimate = async () => {
    setGenerating(true);
    try {
      const {
        data: { session: sess },
      } = await supabase.auth.getSession();
      const token =
        sess?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estimate-expenses`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ trip }),
        },
      );
      if (
        await handleGatedResponse(
          res,
          sess?.user?.id,
          "AI budget estimates need credits.",
        )
      ) {
        setGenerating(false);
        return;
      }
      const { items } = await res.json();
      if (items?.length) {
        const existingTitles = new Set(
          expenses.map((e) => e.title.toLowerCase()),
        );
        const newItems = (items || []).filter(
          (i) => !existingTitles.has(i.title.toLowerCase()),
        );
        const rows = newItems.map((item, i) => ({
          trip_id: trip.id,
          title: item.title,
          amount: item.amount,
          category: item.category || "Other",
          is_planned: true,
          position: expenses.length + i,
        }));
        if (rows.length) {
          const { data } = await supabase
            .from("trip_expenses")
            .insert(rows)
            .select();
          setExpenses((prev) => [...prev, ...(data || [])]);
          // Auto-set budget if not set
          if (!budget) {
            const total = [...expenses, ...(data || [])].reduce(
              (s, e) => s + (e.is_planned ? Number(e.amount) : 0),
              0,
            );
            setBudget(total);
            setBudgetInput(total.toString());
            await supabase
              .from("trips")
              .update({ budget_amount: total })
              .eq("id", trip.id);
          }
        }
      }
      if (sess?.user?.id) refreshCredits(sess.user.id);
    } catch {
      /* silent */
    }
    setGenerating(false);
  };

  const filtered = expenses.filter((e) =>
    tab === "planned" ? e.is_planned : !e.is_planned,
  );
  const totalPlanned = expenses
    .filter((e) => e.is_planned)
    .reduce((s, e) => s + Number(e.amount), 0);
  const totalActual = expenses
    .filter((e) => !e.is_planned)
    .reduce((s, e) => s + Number(e.amount), 0);

  // Category breakdown
  const categoryTotals = EXPENSE_CATEGORIES.map((cat) => ({
    cat,
    planned: expenses
      .filter((e) => e.is_planned && e.category === cat)
      .reduce((s, e) => s + Number(e.amount), 0),
    actual: expenses
      .filter((e) => !e.is_planned && e.category === cat)
      .reduce((s, e) => s + Number(e.amount), 0),
  })).filter((c) => c.planned > 0 || c.actual > 0);

  const maxCatTotal = Math.max(
    ...categoryTotals.map((c) => Math.max(c.planned, c.actual)),
    1,
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: T.warm,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px 10px",
          borderBottom: `1px solid ${T.sand}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            fontSize: 20,
            cursor: "pointer",
            color: T.ocean,
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 18,
              color: T.ink,
            }}
          >
            Expenses
          </div>
        </div>
        {expenses.filter((e) => e.is_planned).length === 0 && (
          <button
            onClick={generateEstimate}
            disabled={generating}
            style={{
              background: generating ? T.sand : T.ocean,
              color: "white",
              border: "none",
              borderRadius: RADIUS.full,
              padding: "7px 14px",
              fontSize: 12,
              fontFamily: "Georgia,serif",
              cursor: generating ? "default" : "pointer",
            }}
          >
            {generating ? "Estimating…" : "✨ Estimate"}
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Budget bar */}
        <div style={{ padding: "14px 16px 10px" }}>
          {editingBudget ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span
                style={{
                  fontSize: 13,
                  fontFamily: "Georgia,serif",
                  color: T.mist,
                }}
              >
                Budget $
              </span>
              <input
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveBudget()}
                autoFocus
                style={{
                  width: 100,
                  padding: "6px 10px",
                  borderRadius: RADIUS.md,
                  border: `1.5px solid ${T.sand}`,
                  fontFamily: "Georgia,serif",
                  fontSize: 14,
                  color: T.ink,
                  outline: "none",
                }}
              />
              <button
                onClick={saveBudget}
                style={{
                  background: T.ocean,
                  color: "white",
                  border: "none",
                  borderRadius: RADIUS.md,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontFamily: "Georgia,serif",
                  cursor: "pointer",
                }}
              >
                Save
              </button>
              <button
                onClick={() => setEditingBudget(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 12,
                  color: T.mist,
                  cursor: "pointer",
                  fontFamily: "Georgia,serif",
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div
              onClick={() => {
                setEditingBudget(true);
                setBudgetInput(budget?.toString() || "");
              }}
              style={{ cursor: "pointer" }}
            >
              {budget ? (
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontFamily: "Georgia,serif",
                        color: T.mist,
                      }}
                    >
                      Budget
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontFamily: "Georgia,serif",
                        fontWeight: 600,
                        color: totalPlanned > budget ? T.error : T.ink,
                      }}
                    >
                      ${totalPlanned.toLocaleString()} / $
                      {budget.toLocaleString()}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 3,
                      background: T.sand,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        borderRadius: 3,
                        background:
                          totalPlanned / budget > 1
                            ? T.error
                            : totalPlanned / budget > 0.8
                              ? T.warning
                              : T.moss,
                        width: `${Math.min(100, (totalPlanned / budget) * 100)}%`,
                        transition: `width ${MOTION.slow}`,
                      }}
                    />
                  </div>
                  {totalActual > 0 && (
                    <div
                      style={{
                        fontSize: 11,
                        color: T.mist,
                        fontFamily: "Georgia,serif",
                        marginTop: 4,
                      }}
                    >
                      Spent so far: ${totalActual.toLocaleString()} (
                      {budget > 0
                        ? Math.round((totalActual / budget) * 100)
                        : 0}
                      %)
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    color: T.ocean,
                    fontFamily: "Georgia,serif",
                  }}
                >
                  + Set a budget
                </div>
              )}
            </div>
          )}
        </div>

        {/* Category breakdown */}
        {categoryTotals.length > 0 && (
          <div style={{ padding: "0 16px 12px" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {categoryTotals.map(({ cat, planned, actual }) => (
                <div
                  key={cat}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    background: T.chalk,
                    border: `1px solid ${T.sand}`,
                    borderRadius: RADIUS.md,
                    padding: "4px 10px",
                  }}
                >
                  <span style={{ fontSize: 12 }}>{EXPENSE_ICONS[cat]}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "Georgia,serif",
                      color: T.ink,
                    }}
                  >
                    ${(tab === "planned" ? planned : actual).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab switch */}
        <div
          style={{
            display: "flex",
            margin: "0 16px 12px",
            background: T.sand,
            borderRadius: RADIUS.md,
            padding: 2,
          }}
        >
          {[
            {
              key: "planned",
              label: `Planned ($${totalPlanned.toLocaleString()})`,
            },
            {
              key: "actual",
              label: `Actual ($${totalActual.toLocaleString()})`,
            },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setAddIsPlanned(key === "planned");
              }}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: RADIUS.md,
                border: "none",
                background: tab === key ? T.chalk : "transparent",
                color: tab === key ? T.ink : T.mist,
                fontFamily: "Georgia,serif",
                fontSize: 12,
                fontWeight: tab === key ? 600 : 400,
                cursor: "pointer",
                boxShadow: tab === key ? SHADOW.sm : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* WS4: who-owes-whom (split actual expenses only), grouped per currency */}
        {isShared &&
          tab === "actual" &&
          (() => {
            const split = expenses.filter(
              (e) =>
                !e.is_planned &&
                e.paid_by &&
                e.split_mode === "even" &&
                Number(e.amount) > 0,
            );
            if (!split.length) return null;
            // Per currency: net = paid − fair share. Settle via greedy netting.
            const byCurrency = {};
            for (const e of split) {
              const cur = e.currency || "USD";
              const net = (byCurrency[cur] ||= {});
              const n = e.split_count || members.length || 1;
              const share = Number(e.amount) / n;
              net[e.paid_by] = (net[e.paid_by] || 0) + Number(e.amount);
              for (const m of members)
                net[m.user_id] = (net[m.user_id] || 0) - share;
            }
            const lines = [];
            for (const [cur, net] of Object.entries(byCurrency)) {
              const creditors = Object.entries(net)
                .filter(([, v]) => v > 0.5)
                .sort((a, b) => b[1] - a[1]);
              const debtors = Object.entries(net)
                .filter(([, v]) => v < -0.5)
                .sort((a, b) => a[1] - b[1]);
              let ci = 0;
              for (const [duid, dv] of debtors) {
                let owe = -dv;
                while (owe > 0.5 && ci < creditors.length) {
                  const [cuid, cv] = creditors[ci];
                  const pay = Math.min(owe, cv);
                  lines.push(
                    `${nameOf(duid)} → ${nameOf(cuid)}: ${cur} ${Math.round(pay).toLocaleString()}`,
                  );
                  creditors[ci][1] -= pay;
                  owe -= pay;
                  if (creditors[ci][1] <= 0.5) ci++;
                }
              }
            }
            if (!lines.length) return null;
            return (
              <div
                style={{
                  margin: "0 16px 12px",
                  padding: "12px 14px",
                  background: T.chalk,
                  border: `1px solid ${T.border}`,
                  borderRadius: RADIUS.lg,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: T.ink,
                    fontFamily: "Georgia,serif",
                    marginBottom: 6,
                  }}
                >
                  ⚖️ Settle up
                </div>
                {lines.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 12,
                      color: T.mist,
                      fontFamily: "Georgia,serif",
                      marginTop: 2,
                    }}
                  >
                    {l}
                  </div>
                ))}
              </div>
            );
          })()}

        {/* Expense list */}
        {loading ? (
          <div
            style={{
              padding: "24px 16px",
              color: T.mist,
              fontFamily: "Georgia,serif",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>
              {tab === "planned" ? "📊" : "💸"}
            </div>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 16,
                color: T.ink,
                marginBottom: 6,
              }}
            >
              {tab === "planned" ? "No planned expenses" : "No expenses logged"}
            </div>
            <div
              style={{
                fontSize: 13,
                color: T.mist,
                fontFamily: "Georgia,serif",
                lineHeight: 1.6,
              }}
            >
              {tab === "planned"
                ? expenses.filter((e) => e.is_planned).length === 0
                  ? "Tap ✨ Estimate for an AI-generated budget, or add items manually."
                  : "All planned expenses are in the Actual tab."
                : "Log expenses as you spend during your trip."}
            </div>
          </div>
        ) : (
          <div style={{ padding: "0 16px" }}>
            {EXPENSE_CATEGORIES.map((cat) => {
              const catItems = filtered.filter((e) => e.category === cat);
              if (catItems.length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{EXPENSE_ICONS[cat]}</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: T.ink,
                        fontFamily: "Georgia,serif",
                      }}
                    >
                      {cat}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: T.mist,
                        fontFamily: "Georgia,serif",
                      }}
                    >
                      $
                      {catItems
                        .reduce((s, e) => s + Number(e.amount), 0)
                        .toLocaleString()}
                    </span>
                  </div>
                  {catItems.map((exp) => (
                    <div
                      key={exp.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 4px",
                        borderBottom: `1px solid ${T.sand}`,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontFamily: "Georgia,serif",
                            color: T.ink,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {exp.title}
                        </div>
                        {isShared && exp.paid_by && (
                          <div
                            style={{
                              fontSize: 10.5,
                              color: T.mist,
                              fontFamily: "Georgia,serif",
                            }}
                          >
                            paid by{" "}
                            {exp.paid_by === selfId
                              ? "you"
                              : nameOf(exp.paid_by)}{" "}
                            · split {exp.split_count || members.length} ways
                          </div>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          fontFamily: "Georgia,serif",
                          fontWeight: 600,
                          color: T.ink,
                          flexShrink: 0,
                        }}
                      >
                        {(exp.currency || "USD") === "USD"
                          ? "$"
                          : exp.currency + " "}
                        {Number(exp.amount).toLocaleString()}
                      </div>
                      <button
                        onClick={() => startEditExpense(exp)}
                        style={{
                          background: "none",
                          border: "none",
                          fontSize: 13,
                          color: T.ocean,
                          cursor: "pointer",
                          padding: "2px 4px",
                          flexShrink: 0,
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => deleteExpense(exp)}
                        aria-label="Delete expense"
                        style={{
                          background: "none",
                          border: `1px solid ${T.errorBorder}`,
                          borderRadius: RADIUS.sm,
                          fontSize: 12,
                          color: T.error,
                          cursor: "pointer",
                          padding: "2px 6px",
                          flexShrink: 0,
                        }}
                      >
                        ✕
                      </button>
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
        <div
          style={{
            padding: "12px 16px",
            paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            borderTop: `1px solid ${T.sand}`,
            background: T.chalk,
            flexShrink: 0,
          }}
        >
          {editingExpense && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: T.ocean,
                  fontFamily: "Georgia,serif",
                }}
              >
                Editing expense
              </span>
              <button
                onClick={cancelAdd}
                style={{
                  fontSize: 11,
                  color: T.mist,
                  fontFamily: "Georgia,serif",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}
          <input
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            placeholder="What for?"
            autoFocus
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: RADIUS.lg,
              border: `1.5px solid ${T.sand}`,
              fontFamily: "Georgia,serif",
              fontSize: 13,
              color: T.ink,
              outline: "none",
              background: T.warm,
              boxSizing: "border-box",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select
              value={addCurrency}
              onChange={(e) => setAddCurrency(e.target.value)}
              style={{
                width: 80,
                padding: "10px 8px",
                borderRadius: RADIUS.lg,
                border: `1.5px solid ${T.sand}`,
                fontFamily: "Georgia,serif",
                fontSize: 13,
                color: T.ink,
                outline: "none",
                background: T.warm,
                appearance: "none",
                textAlign: "center",
              }}
            >
              {[
                "USD",
                "EUR",
                "GBP",
                "INR",
                "JPY",
                "AUD",
                "CAD",
                "SGD",
                "AED",
                "THB",
                "IDR",
                "MYR",
                "VND",
                "KRW",
                "CHF",
                "SEK",
                "NOK",
                "DKK",
                "NZD",
                "ZAR",
                "BRL",
                "MXN",
                "TRY",
                "SAR",
                "QAR",
                "PHP",
                "TWD",
                "HKD",
                "CNY",
                "CZK",
                "PLN",
                "HUF",
                "ILS",
                "EGP",
                "MAD",
                "LKR",
                "NPR",
                "MMK",
                "KHR",
                "LAK",
              ].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
              placeholder="Amount"
              type="number"
              inputMode="decimal"
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: RADIUS.lg,
                border: `1.5px solid ${T.sand}`,
                fontFamily: "Georgia,serif",
                fontSize: 13,
                color: T.ink,
                outline: "none",
                background: T.warm,
                textAlign: "right",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            {EXPENSE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setAddCategory(cat)}
                style={{
                  padding: "5px 10px",
                  borderRadius: RADIUS.md,
                  border: `1.5px solid ${addCategory === cat ? EXPENSE_COLORS[cat] : T.sand}`,
                  background:
                    addCategory === cat
                      ? EXPENSE_COLORS[cat] + "15"
                      : "transparent",
                  color: addCategory === cat ? EXPENSE_COLORS[cat] : T.mist,
                  fontSize: 11,
                  fontFamily: "Georgia,serif",
                  cursor: "pointer",
                }}
              >
                {EXPENSE_ICONS[cat]} {cat}
              </button>
            ))}
          </div>
          {isShared && (
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  color: T.mist,
                  fontFamily: "Georgia,serif",
                  marginBottom: 5,
                }}
              >
                Paid by (splits evenly across {members.length} travellers)
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  onClick={() => setAddPaidBy(null)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: RADIUS.md,
                    border: `1.5px solid ${addPaidBy === null ? T.ink : T.sand}`,
                    background: addPaidBy === null ? T.sand : "transparent",
                    color: addPaidBy === null ? T.ink : T.mist,
                    fontSize: 11,
                    fontFamily: "Georgia,serif",
                    cursor: "pointer",
                  }}
                >
                  Not split
                </button>
                {(members || []).map((m) => (
                  <button
                    key={m.user_id}
                    onClick={() => setAddPaidBy(m.user_id)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: RADIUS.md,
                      border: `1.5px solid ${addPaidBy === m.user_id ? T.ocean : T.sand}`,
                      background:
                        addPaidBy === m.user_id
                          ? T.ocean + "15"
                          : "transparent",
                      color: addPaidBy === m.user_id ? T.ocean : T.mist,
                      fontSize: 11,
                      fontFamily: "Georgia,serif",
                      cursor: "pointer",
                    }}
                  >
                    {m.user_id === selfId
                      ? "You"
                      : m.profiles?.username || "Traveler"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={cancelAdd}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: RADIUS.lg,
                border: `1.5px solid ${T.sand}`,
                background: "transparent",
                color: T.mist,
                fontFamily: "Georgia,serif",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={addExpense}
              disabled={!addTitle.trim() || !addAmount}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: RADIUS.lg,
                border: "none",
                background: addTitle.trim() && addAmount ? T.ocean : T.sand,
                color: "white",
                fontFamily: "Georgia,serif",
                fontSize: 13,
                cursor: addTitle.trim() && addAmount ? "pointer" : "default",
              }}
            >
              {editingExpense ? "Save" : "Add"}
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: "10px 16px",
            paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
            borderTop: `1px solid ${T.sand}`,
            background: T.chalk,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => {
              setEditingExpense(null);
              setShowAdd(true);
            }}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: RADIUS.lg,
              border: `1.5px dashed ${T.sand}`,
              background: "transparent",
              color: T.ocean,
              fontFamily: "Georgia,serif",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            + Add {tab === "planned" ? "planned" : "actual"} expense
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── MODE PILLS ─────────────────────────────────────────────────────── */
const TRAVEL_MODES = [
  { id: "flight", label: "✈️ Flight" },
  { id: "train", label: "🚂 Train" },
  { id: "bus", label: "🚌 Bus" },
  { id: "road", label: "🚗 Road" },
];
function ModePills({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
      {TRAVEL_MODES.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          style={{
            flex: 1,
            padding: "6px 2px",
            borderRadius: RADIUS.md,
            border: `1.5px solid ${value === m.id ? T.ocean : T.sand}`,
            background: value === m.id ? T.ocean : "transparent",
            color: value === m.id ? "white" : T.mist,
            fontFamily: "Georgia,serif",
            fontSize: 11,
            cursor: "pointer",
            transition: `all ${MOTION.normal}`,
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/* ─── CITY INPUT ─────────────────────────────────────────────────────── */
const _cityAutocompleteCache = new Map();

function CityInput({
  value,
  onChange,
  placeholder,
  inputStyle,
  airportOnly = false,
  hotelCity = null,
  contextHint = null, // region bias appended to the query (no type filter)
  onPick = null, // called with the picked text when a suggestion is chosen
  openUpward = false,
}) {
  const [suggs, setSuggs] = useState([]);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const abortRef = useRef(null);

  const handleChange = (val) => {
    onChange(val);
    if (val.trim().length < 1) {
      setSuggs([]);
      setShow(false);
      setLoading(false);
      return;
    }
    const types = airportOnly ? "airport" : hotelCity ? "lodging" : "";
    const q = hotelCity
      ? `${val} ${hotelCity}`
      : contextHint
        ? `${val} ${contextHint}`
        : val;
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
          headers: await placesAuthHeaders(),
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
    const picked = fmt?.mainText?.text || s.placePrediction?.text?.text || "";
    onChange(picked);
    setSuggs([]);
    setShow(false);
    setLoading(false);
    onPick?.(picked);
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        placeholder={placeholder}
        style={inputStyle}
      />
      {show && (loading || suggs.length > 0) && (
        <div
          style={{
            position: "absolute",
            ...(openUpward
              ? { bottom: "calc(100% + 4px)", top: "auto" }
              : { top: "calc(100% + 4px)", bottom: "auto" }),
            left: 0,
            right: 0,
            background: T.chalk,
            border: `1.5px solid ${T.sand}`,
            borderRadius: RADIUS.md,
            zIndex: 200,
            boxShadow: SHADOW.md,
            overflow: "hidden",
          }}
        >
          {loading && suggs.length === 0 && (
            <div
              style={{
                padding: "9px 12px",
                fontFamily: "Georgia,serif",
                fontSize: 12,
                color: T.mist,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  border: `2px solid ${T.sand}`,
                  borderTopColor: T.ocean,
                  animation: "spin 0.7s linear infinite",
                }}
              />
              Searching…
            </div>
          )}
          {suggs.map((s, i) => {
            const fmt = s.placePrediction?.structuredFormat;
            const main =
              fmt?.mainText?.text || s.placePrediction?.text?.text || "";
            const sub = fmt?.secondaryText?.text || "";
            return (
              <div
                key={i}
                onMouseDown={() => pick(s)}
                style={{
                  padding: "9px 12px",
                  cursor: "pointer",
                  borderBottom:
                    i < suggs.length - 1 ? `1px solid ${T.sand}` : "none",
                  fontFamily: "Georgia,serif",
                }}
              >
                <div style={{ fontSize: 13, color: T.ink }}>{main}</div>
                {sub && (
                  <div style={{ fontSize: 11, color: T.mist, marginTop: 1 }}>
                    {sub}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── LOGISTICS TAB ──────────────────────────────────────────────────── */
/* ─── Travel legs (P3): booked flights/trains from trips.travel_data ─── */

// "London (LHR)" → { place: "London", code: "LHR" }
const splitPlace = (s) => {
  const m = String(s || "").match(/^(.*?)\s*\(([A-Z]{3})\)\s*$/);
  return m
    ? { place: m[1].trim(), code: m[2] }
    : { place: String(s || "").trim(), code: "" };
};
const legIata = (s) => {
  const m = String(s || "").match(/\(([A-Z]{3})\)/);
  if (m) return m[1];
  const bare = String(s || "").trim();
  return /^[A-Z]{3}$/.test(bare) ? bare : "";
};
const legCity = (s) =>
  String(s || "")
    .replace(/\s*\([A-Z]{3}\)\s*/g, " ")
    .trim();

// Same-leg identity, mirroring the edge function: ref match wins, else
// (kind, number, date).
const legMatches = (a, b) => {
  // A shared ref alone isn't identity — one airline PNR covers outbound +
  // return, so a ref match must also agree on the number when both known.
  const ac = String(a.confirmation || "");
  const bc = String(b.confirmation || "");
  const an = String(a.number || "");
  const bn = String(b.number || "");
  if (ac && bc && ac.toLowerCase() === bc.toLowerCase()) {
    if (!an || !bn || an.toLowerCase() === bn.toLowerCase()) return true;
  }
  return (
    a.kind === b.kind &&
    !!an &&
    an.toLowerCase() === bn.toLowerCase() &&
    a.date === b.date
  );
};

const validHHMM = (s) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s || ""));

// Client mirror of the edge function's boundary auto-fill: a booked leg on
// the trip's first/last day fills the arrival/departure editors. Only
// validated HH:MM times (a free-typed "6pm" must never reach the timestamp
// compose); an existing time is overwritten only for a ref-matched
// reschedule (isUpdate) whose airport agrees.
const legBoundaryPatch = (trip, leg, isUpdate = false) => {
  if (leg.status !== "booked") return null;
  const mode = leg.kind === "flight" ? "flight" : "train";
  if (leg.date === trip.start_date && validHHMM(leg.arrive_time)) {
    const iata = leg.kind === "flight" ? legIata(leg.to) : "";
    if (
      trip.arrival_time &&
      !(isUpdate && iata && iata === trip.arrival_airport_iata)
    )
      return null;
    const patch = {
      arrival_time: `${trip.start_date}T${leg.arrive_time}:00`,
      arrival_mode: mode,
    };
    if (iata) patch.arrival_airport_iata = iata;
    if (!trip.arrival_city) patch.arrival_city = legCity(leg.to) || null;
    return patch;
  }
  if (leg.date === trip.end_date && validHHMM(leg.depart_time)) {
    const iata = leg.kind === "flight" ? legIata(leg.from) : "";
    if (
      trip.departure_time &&
      !(isUpdate && iata && iata === trip.departure_airport_iata)
    )
      return null;
    const patch = {
      departure_time: `${trip.end_date}T${leg.depart_time}:00`,
      departure_mode: mode,
    };
    if (iata) patch.departure_airport_iata = iata;
    if (!trip.departure_city) patch.departure_city = legCity(leg.from) || null;
    return patch;
  }
  return null;
};

// Route headline: "London LHR → Rome FCO" with small codes, ocean arrow.
function LegRoute({ from, to, fontSize = 14, color }) {
  const f = splitPlace(from);
  const t = splitPlace(to);
  const code = (c) =>
    c ? (
      <span
        style={{
          fontFamily: "Georgia,serif",
          fontSize: Math.round(fontSize * 0.72),
          color: T.mist,
          letterSpacing: 0.6,
          verticalAlign: 2,
          marginLeft: 3,
        }}
      >
        {c}
      </span>
    ) : null;
  return (
    <span
      style={{
        fontFamily: "'DM Serif Display',serif",
        fontSize,
        color: color || T.ink,
      }}
    >
      {f.place}
      {code(f.code)} <span style={{ color: T.ocean }}>→</span> {t.place}
      {code(t.code)}
    </span>
  );
}

function TravelLegRow({ leg, onRemove }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const cancelled = leg.status === "cancelled";
  const metaBits = [
    [leg.carrier, leg.number].filter(Boolean).join(" "),
    leg.date,
    leg.depart_time ? `dep ${leg.depart_time}` : "",
    leg.class,
  ].filter(Boolean);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: T.warm,
        border: `1px solid ${T.border}`,
        borderRadius: RADIUS.md + 2,
        padding: "9px 11px",
        marginBottom: 8,
        opacity: cancelled ? 0.55 : 1,
        position: "relative",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: T.skyLight,
          border: `1px solid ${T.skyBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {leg.kind === "flight" ? "✈️" : "🚆"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textDecoration: cancelled ? "line-through" : "none",
          }}
        >
          <LegRoute
            from={leg.from}
            to={leg.to}
            fontSize={14}
            color={cancelled ? T.mist : T.ink}
          />
        </div>
        <div
          style={{
            fontFamily: "Georgia,serif",
            fontSize: 11,
            color: T.mist,
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {cancelled ? "Cancelled · " : ""}
          {metaBits.join(" · ")}
          {leg.confirmation && (
            <span
              style={{
                background: T.sand,
                borderRadius: 6,
                padding: "1px 6px",
                marginLeft: 6,
                color: T.dusk,
              }}
            >
              REF {leg.confirmation}
            </span>
          )}
          {leg.via && (
            <span style={{ marginLeft: 6 }}>
              {leg.via === "email" ? "📩" : "📎"}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Leg options"
        style={{
          background: "none",
          border: "none",
          color: T.mist,
          cursor: "pointer",
          fontSize: 16,
          padding: "2px 6px",
          flexShrink: 0,
        }}
      >
        ⋯
      </button>
      {menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            style={{
              position: "absolute",
              right: 8,
              top: "80%",
              zIndex: 41,
              background: T.chalk,
              border: `1px solid ${T.border}`,
              borderRadius: RADIUS.md,
              boxShadow: SHADOW.lg,
              minWidth: 140,
              overflow: "hidden",
            }}
          >
            {leg.confirmation && (
              <button
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(leg.confirmation)
                    .then(() => showToast("Ref copied"))
                    .catch(() => {});
                  setMenuOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 13px",
                  background: "none",
                  border: "none",
                  borderBottom: `1px solid ${T.border}`,
                  fontFamily: "Georgia,serif",
                  fontSize: 13,
                  color: T.ink,
                  cursor: "pointer",
                }}
              >
                Copy ref
              </button>
            )}
            <button
              onClick={() => {
                setMenuOpen(false);
                onRemove(leg);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 13px",
                background: "none",
                border: "none",
                fontFamily: "Georgia,serif",
                fontSize: 13,
                color: T.error,
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Downscale a screenshot to ≤1600px JPEG so uploads stay well under the
// edge function's 4MB cap; PDFs pass through untouched.
async function fileToUpload(file) {
  if (file.type === "application/pdf") {
    if (file.size > 3_500_000) throw new Error("PDF too large (max 3.5 MB)");
    const buf = await file.arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { media_type: "application/pdf", data: btoa(bin) };
  }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type))
    throw new Error("Use a JPG/PNG screenshot or a PDF");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Couldn't read that image"));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { media_type: "image/jpeg", data: dataUrl.split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// "Add a booking" — one front door: forward the email, or upload a
// screenshot/PDF. Upload parses via the metered dry_run endpoint; apply is
// a client-side RLS write (no new endpoint).
function AddBookingSheet({
  trip,
  ingestAddress,
  onClose,
  onApplyLeg,
  onApplyHotel,
}) {
  const [stage, setStage] = useState("choose"); // choose|parsing|preview|done|error
  const [errMsg, setErrMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [leg, setLeg] = useState(null); // editable leg preview
  const [doneLabel, setDoneLabel] = useState("");
  const [addrCopied, setAddrCopied] = useState(false);
  const fileRef = useRef(null);

  const copyAddr = () => {
    navigator.clipboard
      ?.writeText(ingestAddress)
      .then(() => {
        setAddrCopied(true);
        setTimeout(() => setAddrCopied(false), 1800);
      })
      .catch(() => {});
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setStage("parsing");
    try {
      const upload = await fileToUpload(file);
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session?.access_token)
        throw new Error("Your session expired — sign in again to upload");
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbound-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sess?.session?.access_token || ""}`,
          },
          body: JSON.stringify({
            dry_run: true,
            to: ingestAddress || "",
            subject: file.name,
            file: upload,
          }),
        },
      );
      if (res.status === 429)
        throw new Error("Daily limit reached — try again tomorrow");
      if (!res.ok) throw new Error("We couldn't read that file");
      const out = await res.json();
      if (out.leg_preview) {
        setParsed(out.parsed);
        setLeg({ ...out.leg_preview, via: "upload" });
        setStage("preview");
      } else if (out.parsed?.kind === "hotel" && out.parsed.hotel?.name) {
        setParsed(out.parsed);
        setLeg(null);
        setStage("preview");
      } else {
        throw new Error(
          "That didn't look like a hotel, flight or train confirmation",
        );
      }
    } catch (err) {
      setErrMsg(err.message || "Something went wrong");
      setStage("error");
    }
  };

  const apply = async () => {
    setStage("saving");
    try {
      const cancelled = parsed?.status === "cancelled";
      if (leg) {
        await onApplyLeg(leg);
        const label = [leg.carrier, leg.number].filter(Boolean).join(" ");
        setDoneLabel(
          cancelled
            ? `${label} is marked cancelled.`
            : `${label} is in Travel & Hotels.`,
        );
      } else {
        const h = parsed.hotel;
        await onApplyHotel({
          city: h.city || trip.destination,
          name: h.name,
          status: cancelled ? null : "booked",
          confirmation: h.confirmation || "",
          via: "upload",
        });
        setDoneLabel(
          cancelled
            ? `${h.name} is no longer marked booked.`
            : `${h.name} is in Travel & Hotels.`,
        );
      }
      setStage("done");
    } catch (err) {
      setErrMsg(
        err?.message === "save failed" || !err?.message
          ? "Couldn't save it just now — try again in a minute"
          : err.message,
      );
      setStage("error");
    }
  };

  const field = (label, value, onChange, width) => (
    <div style={{ flex: width ? `0 0 ${width}px` : 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          color: T.mist,
          fontFamily: "Georgia,serif",
          textTransform: "uppercase",
          letterSpacing: 0.8,
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "7px 9px",
          borderRadius: RADIUS.sm,
          border: `1.5px solid ${T.sand}`,
          fontFamily: "Georgia,serif",
          fontSize: 12.5,
          color: T.ink,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );

  const sheetBtn = (label, onClick, primary) => (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        marginTop: primary ? 12 : 4,
        background: primary ? T.ocean : "none",
        color: primary ? "#fff" : T.mist,
        border: "none",
        borderRadius: RADIUS.md + 2,
        padding: primary ? 12 : 8,
        fontFamily: "Georgia,serif",
        fontSize: primary ? 14 : 12,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(15,25,35,0.4)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          background: T.chalk,
          borderRadius: "20px 20px 0 0",
          padding: "16px 18px 26px",
          boxShadow: SHADOW.lg,
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 999,
            background: T.border,
            margin: "0 auto 14px",
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.pdf,application/pdf"
          onChange={onFile}
          style={{ display: "none" }}
        />

        {stage === "choose" && (
          <>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 18,
                color: T.ink,
                marginBottom: 4,
              }}
            >
              Add a booking
            </div>
            <div
              style={{
                fontFamily: "Georgia,serif",
                fontSize: 12,
                color: T.mist,
                marginBottom: 12,
              }}
            >
              Hotel, flight or train — we'll read it and file it on this trip.
            </div>
            {ingestAddress && (
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  border: `1.5px solid ${T.border}`,
                  borderRadius: RADIUS.lg,
                  padding: "13px 12px",
                  marginBottom: 10,
                  background: T.warm,
                }}
              >
                <div style={{ fontSize: 17, flexShrink: 0 }}>📩</div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "'DM Serif Display',serif",
                      fontSize: 15,
                      color: T.ink,
                      marginBottom: 2,
                    }}
                  >
                    Forward the confirmation email
                  </div>
                  <div
                    style={{
                      fontFamily: "Georgia,serif",
                      fontSize: 11.5,
                      color: T.mist,
                      lineHeight: 1.45,
                    }}
                  >
                    Works from Gmail, Outlook, anything. We reply once it's
                    filed.
                  </div>
                  <button
                    onClick={copyAddr}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: T.sand,
                      border: "none",
                      borderRadius: 8,
                      padding: "3px 9px",
                      fontFamily: "ui-monospace, Menlo, monospace",
                      fontSize: 11,
                      color: T.dusk,
                      marginTop: 6,
                      cursor: "pointer",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {addrCopied ? "copied ✓" : `${ingestAddress} ⧉`}
                  </button>
                </div>
              </div>
            )}
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                border: `1.5px solid ${T.border}`,
                borderRadius: RADIUS.lg,
                padding: "13px 12px",
                background: T.warm,
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 17, flexShrink: 0 }}>📎</div>
              <div>
                <div
                  style={{
                    fontFamily: "'DM Serif Display',serif",
                    fontSize: 15,
                    color: T.ink,
                    marginBottom: 2,
                  }}
                >
                  Upload a screenshot or PDF
                </div>
                <div
                  style={{
                    fontFamily: "Georgia,serif",
                    fontSize: 11.5,
                    color: T.mist,
                  }}
                >
                  Ticket PDFs, app screenshots, boarding passes.
                </div>
              </div>
            </div>
            {sheetBtn("Cancel", onClose)}
          </>
        )}

        {(stage === "parsing" || stage === "saving") && (
          <div
            style={{
              textAlign: "center",
              padding: "28px 0 20px",
              fontFamily: "Georgia,serif",
              color: T.mist,
              fontSize: 13,
            }}
          >
            {stage === "saving"
              ? "Saving to the trip…"
              : `Reading ${fileName || "your booking"}…`}
          </div>
        )}

        {stage === "preview" && (
          <>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 18,
                color: T.ink,
                marginBottom: 4,
              }}
            >
              Here's what we read
            </div>
            <div
              style={{
                fontFamily: "Georgia,serif",
                fontSize: 12,
                color: T.mist,
                marginBottom: 10,
              }}
            >
              Check it before it goes on the trip.
            </div>
            <div
              style={{
                background: T.skyLight,
                border: `1px solid ${T.skyBorder}`,
                borderRadius: RADIUS.lg,
                padding: "13px 13px 11px",
              }}
            >
              {leg ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontSize: 18 }}>
                      {leg.kind === "flight" ? "✈️" : "🚆"}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <LegRoute from={leg.from} to={leg.to} fontSize={16} />
                      <div
                        style={{
                          fontFamily: "Georgia,serif",
                          fontSize: 11,
                          color: T.mist,
                        }}
                      >
                        {[leg.carrier, leg.number].filter(Boolean).join(" ")} ·{" "}
                        {leg.kind}
                        {parsed?.status === "cancelled" ? " · cancelled" : ""}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginBottom: 6,
                    }}
                  >
                    {field("Date", leg.date, (v) =>
                      setLeg((l) => ({ ...l, date: v })),
                    )}
                    {field(
                      "Departs",
                      leg.depart_time,
                      (v) => setLeg((l) => ({ ...l, depart_time: v })),
                      86,
                    )}
                    {field(
                      "Ref",
                      leg.confirmation,
                      (v) => setLeg((l) => ({ ...l, confirmation: v })),
                      110,
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {field("From", leg.from, (v) =>
                      setLeg((l) => ({ ...l, from: v })),
                    )}
                    {field("To", leg.to, (v) =>
                      setLeg((l) => ({ ...l, to: v })),
                    )}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    fontFamily: "Georgia,serif",
                    fontSize: 13,
                    color: T.ink,
                  }}
                >
                  🏨 <b>{parsed.hotel.name}</b>
                  {parsed.hotel.city ? ` · ${parsed.hotel.city}` : ""}
                  {parsed.hotel.confirmation
                    ? ` · #${parsed.hotel.confirmation}`
                    : ""}
                  {parsed.status === "cancelled" ? " · cancelled" : ""}
                </div>
              )}
            </div>
            <div
              style={{
                fontFamily: "Georgia,serif",
                fontSize: 12,
                color: T.dusk,
                margin: "10px 2px 0",
              }}
            >
              Adding to{" "}
              <span
                style={{
                  background: T.sand,
                  borderRadius: 999,
                  padding: "2px 10px",
                  fontSize: 11,
                }}
              >
                {trip.name}
              </span>
            </div>
            {sheetBtn(
              parsed?.status === "cancelled" ? "Update trip" : "Add to trip",
              apply,
              true,
            )}
            {sheetBtn("Discard", onClose)}
          </>
        )}

        {stage === "done" && (
          <div style={{ textAlign: "center", padding: "14px 0 4px" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>
              {leg ? (leg.kind === "flight" ? "✈️" : "🚆") : "🏨"}
            </div>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 18,
                color: T.ink,
              }}
            >
              On the trip.
            </div>
            <div
              style={{
                fontFamily: "Georgia,serif",
                fontSize: 12,
                color: T.mist,
                marginTop: 4,
              }}
            >
              {doneLabel}
            </div>
            {sheetBtn("Done", onClose)}
          </div>
        )}

        {stage === "error" && (
          <div style={{ textAlign: "center", padding: "14px 0 4px" }}>
            <div
              style={{
                fontFamily: "Georgia,serif",
                fontSize: 13,
                color: T.error,
                marginBottom: 6,
              }}
            >
              {errMsg}
            </div>
            {sheetBtn("Try another file", () => fileRef.current?.click(), true)}
            {sheetBtn("Close", onClose)}
          </div>
        )}
      </div>
    </div>
  );
}

function LogisticsTab({
  trip,
  days,
  onSaveFlights,
  onSaveHotels,
  onApplyHotels,
  onSaveTravelLegs,
}) {
  const cities = [...new Set(days.map((d) => d.city))];
  const flightsFromTrip = () => ({
    arrivalCity: trip.arrival_city || "",
    arrivalTime: trip.arrival_time
      ? trip.arrival_time.split("T")[1]?.substring(0, 5)
      : "",
    arrivalMode: trip.arrival_mode || "flight",
    departureCity: trip.departure_city || "",
    departureTime: trip.departure_time
      ? trip.departure_time.split("T")[1]?.substring(0, 5)
      : "",
    departureMode: trip.departure_mode || "flight",
  });
  const [flights, setFlights] = useState(flightsFromTrip);

  // Resync when the arrival/departure fields change underneath the form —
  // P3's boundary auto-fill (leg upload / forwarded email) is the first
  // writer of these outside this form; without the resync, the next Save
  // would clobber the auto-fill with the stale values the form mounted with.
  const flightsDataKey = JSON.stringify([
    trip.id,
    trip.arrival_city,
    trip.arrival_time,
    trip.arrival_mode,
    trip.departure_city,
    trip.departure_time,
    trip.departure_mode,
  ]);
  useEffect(() => {
    setFlights(flightsFromTrip());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightsDataKey]);

  // Auto-resolve airport for first/last day's city when flight fields are empty.
  // Uses bundled OurAirports dataset (free, ~98KB gzipped, lazy-loaded).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!trip.id) return; // SAMPLE_TRIP / pre-creation state
      const needArrival =
        !trip.arrival_city &&
        days[0]?.city &&
        (trip.arrival_mode || "flight") === "flight";
      const needDeparture =
        !trip.departure_city &&
        days[days.length - 1]?.city &&
        (trip.departure_mode || "flight") === "flight";
      if (!needArrival && !needDeparture) return;
      const { resolveAirportForCity } = await import("../airports.js");
      const updates = {};
      let arrivalAirportIata = null,
        departureAirportIata = null;
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
      await onSaveFlights({
        ...next,
        arrivalAirportIata,
        departureAirportIata,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [trip.id]);
  // The itinerary already picked a specific hotel per city (IG's
  // "Check in at X" activities) — surface it as a tappable suggestion on
  // empty rows instead of making the user re-find it.
  const suggestedHotels = (() => {
    const map = {};
    for (const d of days) {
      const act = (d.activities || []).find(
        (a) => a.type === "hotel" && /check in at /i.test(a.title || ""),
      );
      if (act && d.city && !map[d.city])
        map[d.city] = act.title.replace(/^check in at /i, "").trim();
    }
    return map;
  })();
  // Per-trip forwarding address: bookings+<trip id prefix>@… — routes the
  // email to THIS trip deterministically (plus-addressing through the
  // catch-all; the inbound function matches the id prefix).
  // First email-booked stay → one-time celebration card (global, dismissible)
  const emailBookedExists = (trip.hotels_data || []).some(
    (h) => h.via === "email" && h.status === "booked",
  );
  const [celebrated, setCelebrated] = useState(() => {
    try {
      return localStorage.getItem("tripjam_email_book_celebrated") === "1";
    } catch {
      return true;
    }
  });
  const dismissCelebration = () => {
    try {
      localStorage.setItem("tripjam_email_book_celebrated", "1");
    } catch {
      /* private mode */
    }
    setCelebrated(true);
  };
  const [addrCopied, setAddrCopied] = useState(false);
  const copyIngestAddress = () => {
    // writeText rejects async (permissions, insecure context) — a try/catch
    // around the call can't see that, so confirm only on resolution.
    navigator.clipboard
      ?.writeText(tripIngestAddress)
      .then(() => {
        setAddrCopied(true);
        setTimeout(() => setAddrCopied(false), 1800);
      })
      .catch(() => {});
  };
  const tripIngestAddress = (() => {
    const base = import.meta.env.VITE_EMAIL_INGEST_ADDRESS;
    if (!base || !trip?.id) return base;
    const [local, domain] = base.split("@");
    return `${local}+${String(trip.id).slice(0, 8)}@${domain}`;
  })();
  // Spread the saved entry first: fields this form doesn't edit (via:"email"
  // from inbound ingestion, future metadata) must survive a round-trip.
  const hotelsFromTrip = () =>
    cities.map((city) => {
      const saved = (trip.hotels_data || []).find((h) => h.city === city) || {};
      return {
        ...saved,
        city,
        name: saved.name || "",
        status: saved.status || null, // "booked" | null
        confirmation: saved.confirmation || "",
      };
    });
  const [hotels, setHotels] = useState(hotelsFromTrip);
  // Travel legs (P3): derived straight from trip.travel_data — the server
  // (forwarded email) or the Add-a-booking sheet writes them; this card
  // only deletes.
  const travelLegs = Array.isArray(trip.travel_data) ? trip.travel_data : [];
  const bookedLegs = travelLegs
    .filter((l) => l.status !== "cancelled")
    .sort((a, b) =>
      `${a.date || ""} ${a.depart_time || ""}`.localeCompare(
        `${b.date || ""} ${b.depart_time || ""}`,
      ),
    );
  const cancelledLegs = travelLegs.filter((l) => l.status === "cancelled");
  const [showCancelledLegs, setShowCancelledLegs] = useState(false);
  const [showAddBooking, setShowAddBooking] = useState(false);

  const removeLeg = async (leg) => {
    const ok = await confirmSheet({
      title: "Remove this leg?",
      message: `${[leg.carrier, leg.number].filter(Boolean).join(" ")} · ${legCity(leg.from)} → ${legCity(leg.to)}. Re-forwarding the confirmation adds it back.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await onSaveTravelLegs(
      travelLegs.filter((l) => (l.id ? l.id !== leg.id : l !== leg)),
    );
  };

  const applyLegFromSheet = async (leg) => {
    const list = [...travelLegs];
    const idx = list.findIndex((x) => legMatches(x, leg));
    // Honor the parsed status: a cancellation upload must cancel the
    // matching leg (mirroring the email path) — never book it, never
    // resurrect a cancelled leg, never auto-fill boundaries from it.
    if (leg.status === "cancelled") {
      if (idx < 0)
        throw new Error(
          "That's a cancellation — there's no matching booked leg on this trip",
        );
      list[idx] = { ...list[idx], status: "cancelled" };
      const ok = await onSaveTravelLegs(list);
      if (ok === false) throw new Error("save failed");
      logActivity({
        tripId: trip.id,
        action: "booking_uploaded",
        entityType: "trip",
        entityId: trip.id,
        summary: `cancelled ${[list[idx].carrier, list[idx].number].filter(Boolean).join(" ")} from an upload`,
      });
      return;
    }
    let saved = { ...leg, status: "booked" };
    if (idx >= 0) {
      saved = { ...list[idx], ...saved, id: list[idx].id };
      list[idx] = saved;
    } else list.push(saved);
    const patch = legBoundaryPatch(trip, saved, idx >= 0) || {};
    const ok = await onSaveTravelLegs(list, patch);
    if (ok === false) throw new Error("save failed");
    logActivity({
      tripId: trip.id,
      action: "booking_uploaded",
      entityType: "trip",
      entityId: trip.id,
      summary: `added ${[saved.carrier, saved.number].filter(Boolean).join(" ")} from an upload`,
    });
  };

  const applyHotelFromSheet = async (entry) => {
    const list = Array.isArray(trip.hotels_data) ? [...trip.hotels_data] : [];
    let idx = list.findIndex(
      (x) =>
        x.name?.toLowerCase() === entry.name.toLowerCase() ||
        (entry.confirmation && x.confirmation === entry.confirmation),
    );
    if (idx < 0)
      idx = list.findIndex(
        (x) =>
          entry.city &&
          x.city?.toLowerCase() === entry.city.toLowerCase() &&
          x.status !== "booked",
      );
    // A cancellation (status null) with no matching stay must not create a
    // ghost unbooked row.
    if (idx < 0 && !entry.status)
      throw new Error(
        "That's a cancellation — there's no matching stay on this trip",
      );
    if (idx >= 0) list[idx] = { ...list[idx], ...entry, city: list[idx].city };
    else list.push(entry);
    await onSaveHotels(list);
    await onApplyHotels(list);
    logActivity({
      tripId: trip.id,
      action: "booking_uploaded",
      entityType: "trip",
      entityId: trip.id,
      summary: `added ${entry.name} from an upload`,
    });
  };
  // Resync when hotels_data changes underneath us (email ingestion writes
  // server-side) — otherwise the next Save would overwrite the new booking
  // with the stale rows this form mounted with.
  const hotelsDataKey = JSON.stringify(trip.hotels_data || []);
  useEffect(() => {
    setHotels(hotelsFromTrip());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelsDataKey]);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | done

  const saved = {
    arrivalCity: trip.arrival_city || "",
    arrivalTime: trip.arrival_time
      ? trip.arrival_time.split("T")[1]?.substring(0, 5)
      : "",
    arrivalMode: trip.arrival_mode || "flight",
    departureCity: trip.departure_city || "",
    departureTime: trip.departure_time
      ? trip.departure_time.split("T")[1]?.substring(0, 5)
      : "",
    departureMode: trip.departure_mode || "flight",
  };
  const hotelsChanged = hotels.some((h) => {
    const orig = (trip.hotels_data || []).find((x) => x.city === h.city) || {};
    return (
      h.name !== (orig.name || "") ||
      (h.status || null) !== (orig.status || null) ||
      (h.confirmation || "") !== (orig.confirmation || "")
    );
  });
  const flightsChanged = JSON.stringify(flights) !== JSON.stringify(saved);
  const hasChanges =
    saveStatus !== "saving" && (flightsChanged || hotelsChanged);

  const handleSaveAll = async () => {
    if (!hasChanges) return;
    setSaveStatus("saving");
    // Only write the section the user actually touched — a hotels-only save
    // must never push stale arrival/departure values over a boundary
    // auto-fill that landed since mount (and vice versa).
    if (flightsChanged) await onSaveFlights({ ...flights });
    if (hotelsChanged) {
      // Keep hotels_data entries whose city isn't one of this form's rows
      // (email-ingested bookings can carry city names outside the itinerary's
      // city list) — dropping them here would silently delete the booking.
      const rowCities = new Set(hotels.map((h) => h.city));
      const unmatched = (trip.hotels_data || []).filter(
        (h) => !rowCities.has(h.city),
      );
      const merged = [...hotels, ...unmatched];
      await onSaveHotels(merged);
      await onApplyHotels(merged);
    }
    setSaveStatus("done");
    setTimeout(() => setSaveStatus("idle"), 2500);
  };

  const inputStyle = (filled) => ({
    width: "100%",
    padding: "10px 12px",
    borderRadius: RADIUS.md,
    border: `1.5px solid ${filled ? T.ocean : T.sand}`,
    fontFamily: "Georgia,serif",
    fontSize: 13,
    color: T.ink,
    outline: "none",
    boxSizing: "border-box",
    background: "white",
  });

  const dateLabel = (iso) =>
    iso
      ? new Date(iso + "T12:00:00").toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : "—";

  return (
    <div
      style={{
        padding: "20px 16px 100px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Travel */}
      <div
        style={{
          background: T.chalk,
          borderRadius: RADIUS.lg,
          padding: 16,
          border: `1.5px solid ${T.sand}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 16,
              color: T.ink,
            }}
          >
            🧭 Travel
          </div>
          <button
            onClick={() => setShowAddBooking(true)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: T.ocean,
              fontFamily: "Georgia,serif",
              fontSize: 12,
              cursor: "pointer",
              padding: 0,
            }}
          >
            ＋ Add a booking
          </button>
        </div>

        {/* Arrival */}
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              color: T.mist,
              fontFamily: "Georgia,serif",
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Arriving
          </div>
          <ModePills
            value={flights.arrivalMode}
            onChange={(v) => setFlights((f) => ({ ...f, arrivalMode: v }))}
          />
          <CityInput
            value={flights.arrivalCity}
            onChange={(v) => setFlights((f) => ({ ...f, arrivalCity: v }))}
            placeholder={
              flights.arrivalMode === "flight"
                ? "Arrival airport (e.g. Mumbai)"
                : "Arrival city (e.g. Mumbai)"
            }
            airportOnly={flights.arrivalMode === "flight"}
            inputStyle={{ ...inputStyle(flights.arrivalCity), marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: RADIUS.md,
                border: `1.5px solid ${T.sand}`,
                fontFamily: "Georgia,serif",
                fontSize: 12,
                color: T.mist,
                background: "#f7f7f7",
              }}
            >
              {dateLabel(trip.start_date)}
            </div>
            {flights.arrivalMode !== "road" && (
              <input
                type="time"
                value={flights.arrivalTime}
                onChange={(e) =>
                  setFlights((f) => ({ ...f, arrivalTime: e.target.value }))
                }
                style={{ ...inputStyle(flights.arrivalTime), flex: 1 }}
              />
            )}
          </div>
          {import.meta.env.VITE_FLIGHT_LINK_PREFIX &&
            flights.arrivalMode === "flight" &&
            !flights.arrivalTime &&
            !bookedLegs.some(
              (l) => l.kind === "flight" && l.date === trip.start_date,
            ) && (
              <a
                href={import.meta.env.VITE_FLIGHT_LINK_PREFIX}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontFamily: "Georgia,serif",
                  fontSize: 11.5,
                  color: T.ocean,
                  textDecoration: "none",
                  display: "inline-block",
                  marginTop: 6,
                }}
              >
                Compare flights ↗
              </a>
            )}
        </div>

        {/* Booked legs (P3) — any count; mid-trip legs also surface on
            their itinerary day card */}
        {travelLegs.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 11,
                color: T.mist,
                fontFamily: "Georgia,serif",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Booked legs
            </div>
            {bookedLegs.map((l, i) => (
              <TravelLegRow
                key={l.id || `${l.number}-${l.date}-${i}`}
                leg={l}
                onRemove={removeLeg}
              />
            ))}
            {cancelledLegs.length > 0 && (
              <>
                {showCancelledLegs &&
                  cancelledLegs.map((l, i) => (
                    <TravelLegRow
                      key={l.id || `cxl-${l.number}-${l.date}-${i}`}
                      leg={l}
                      onRemove={removeLeg}
                    />
                  ))}
                <div
                  onClick={() => setShowCancelledLegs((v) => !v)}
                  style={{
                    fontSize: 11,
                    color: T.mist,
                    textAlign: "center",
                    cursor: "pointer",
                    fontFamily: "Georgia,serif",
                    padding: "2px 0",
                  }}
                >
                  {showCancelledLegs ? "hide" : "show"} cancelled (
                  {cancelledLegs.length}) {showCancelledLegs ? "▴" : "▾"}
                </div>
              </>
            )}
          </div>
        )}

        {/* Departure */}
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 11,
              color: T.mist,
              fontFamily: "Georgia,serif",
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Departing
          </div>
          <ModePills
            value={flights.departureMode}
            onChange={(v) => setFlights((f) => ({ ...f, departureMode: v }))}
          />
          <CityInput
            value={flights.departureCity}
            onChange={(v) => setFlights((f) => ({ ...f, departureCity: v }))}
            placeholder={
              flights.departureMode === "flight"
                ? "Departure airport (e.g. Goa)"
                : "Departure city (e.g. Goa)"
            }
            airportOnly={flights.departureMode === "flight"}
            inputStyle={{
              ...inputStyle(flights.departureCity),
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: RADIUS.md,
                border: `1.5px solid ${T.sand}`,
                fontFamily: "Georgia,serif",
                fontSize: 12,
                color: T.mist,
                background: "#f7f7f7",
              }}
            >
              {dateLabel(trip.end_date)}
            </div>
            {flights.departureMode !== "road" && (
              <input
                type="time"
                value={flights.departureTime}
                onChange={(e) =>
                  setFlights((f) => ({ ...f, departureTime: e.target.value }))
                }
                style={{ ...inputStyle(flights.departureTime), flex: 1 }}
              />
            )}
          </div>
          {import.meta.env.VITE_FLIGHT_LINK_PREFIX &&
            flights.departureMode === "flight" &&
            !flights.departureTime &&
            !bookedLegs.some(
              (l) => l.kind === "flight" && l.date === trip.end_date,
            ) && (
              <a
                href={import.meta.env.VITE_FLIGHT_LINK_PREFIX}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontFamily: "Georgia,serif",
                  fontSize: 11.5,
                  color: T.ocean,
                  textDecoration: "none",
                  display: "inline-block",
                  marginTop: 6,
                }}
              >
                Compare flights ↗
              </a>
            )}
        </div>
      </div>

      {showAddBooking && (
        <AddBookingSheet
          trip={trip}
          ingestAddress={tripIngestAddress}
          onClose={() => setShowAddBooking(false)}
          onApplyLeg={applyLegFromSheet}
          onApplyHotel={applyHotelFromSheet}
        />
      )}

      {/* Hotels */}
      <div
        style={{
          background: T.chalk,
          borderRadius: RADIUS.lg,
          padding: 16,
          border: `1.5px solid ${T.sand}`,
        }}
      >
        <div
          style={{
            fontFamily: "'DM Serif Display',serif",
            fontSize: 16,
            color: T.ink,
            marginBottom: 14,
          }}
        >
          🏨 Hotels
          {hotels.some((h) => h.status === "booked") && (
            <span
              style={{
                fontFamily: "Georgia,serif",
                fontSize: 12,
                color: T.moss,
                marginLeft: 8,
                fontWeight: 400,
              }}
            >
              {hotels.filter((h) => h.status === "booked").length} of{" "}
              {hotels.length} booked
            </span>
          )}
          {import.meta.env.VITE_EMAIL_INGEST_ADDRESS &&
            hotels.some((h) => h.status === "booked") && (
              <div
                style={{
                  fontFamily: "Georgia,serif",
                  fontSize: 11.5,
                  color: T.mist,
                  fontWeight: 400,
                  marginTop: 3,
                }}
              >
                📩 Forward hotel, flight or train confirmations to{" "}
                <b
                  style={{ color: T.ocean, cursor: "pointer" }}
                  title="Tap to copy"
                  onClick={copyIngestAddress}
                >
                  {addrCopied ? "copied ✓" : tripIngestAddress}
                </b>
              </div>
            )}
        </div>
        {/* First-booking celebration — shown once, ever, after the first
            stay books itself from a forwarded email */}
        {emailBookedExists && !celebrated && (
          <div
            style={{
              background: `${T.moss}12`,
              border: `1.5px solid ${T.moss}`,
              borderRadius: RADIUS.md + 2,
              padding: "12px 14px",
              marginBottom: 14,
              fontFamily: "Georgia,serif",
              fontSize: 12.5,
              color: T.ink,
              position: "relative",
            }}
          >
            <button
              onClick={dismissCelebration}
              aria-label="Dismiss"
              style={{
                position: "absolute",
                top: 6,
                right: 8,
                background: "none",
                border: "none",
                color: T.mist,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              ✕
            </button>
            <b style={{ color: T.moss }}>✨ That stay booked itself.</b> A
            forwarded confirmation email did that — every trip has its own
            forwarding address (it's in this section), so bookings can keep
            checking themselves off.
          </div>
        )}
        {/* Empty state: teaching moment gets the space the feature deserves */}
        {import.meta.env.VITE_EMAIL_INGEST_ADDRESS &&
          !hotels.some((h) => h.status === "booked") && (
            <div
              style={{
                border: `1.5px dashed ${T.ocean}50`,
                background: `${T.ocean}07`,
                borderRadius: RADIUS.md + 2,
                padding: "12px 14px",
                marginBottom: 14,
                fontFamily: "Georgia,serif",
                fontSize: 12.5,
                color: T.ink,
                lineHeight: 1.55,
              }}
            >
              <b>📩 Book by forwarding.</b> Send hotel, flight or train
              confirmation emails to this trip's own address and they'll file
              themselves here — name, route, booked status, confirmation number.
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={copyIngestAddress}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: RADIUS.full,
                    border: `1px solid ${T.ocean}`,
                    background: "white",
                    color: T.ocean,
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontSize: 11.5,
                    cursor: "pointer",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {addrCopied ? "copied ✓" : `${tripIngestAddress} ⧉`}
                </button>
                <button
                  onClick={() => setShowAddBooking(true)}
                  style={{
                    marginLeft: 10,
                    background: "none",
                    border: "none",
                    color: T.ocean,
                    fontFamily: "Georgia,serif",
                    fontSize: 11.5,
                    cursor: "pointer",
                    padding: "6px 0",
                  }}
                >
                  or upload a ticket →
                </button>
              </div>
            </div>
          )}
        {hotels.map((h, i) => (
          <div
            key={h.city}
            style={{ marginBottom: i < hotels.length - 1 ? 12 : 16 }}
          >
            <div
              style={{
                fontSize: 11,
                color: T.mist,
                fontFamily: "Georgia,serif",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {h.city}
            </div>
            <CityInput
              value={h.name}
              onChange={(v) =>
                setHotels((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, name: v } : x)),
                )
              }
              placeholder={`Hotel in ${h.city}`}
              hotelCity={h.city}
              inputStyle={{ ...inputStyle(h.name) }}
            />
            {!h.name &&
              suggestedHotels[h.city] &&
              suggestedHotels[h.city] !== h.name && (
                <button
                  onClick={() =>
                    setHotels((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, name: suggestedHotels[h.city] } : x,
                      ),
                    )
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 6,
                    padding: "5px 10px",
                    borderRadius: RADIUS.full,
                    border: `1px dashed ${T.ocean}60`,
                    background: `${T.ocean}0A`,
                    color: T.ocean,
                    fontFamily: "Georgia,serif",
                    fontSize: 12,
                    cursor: "pointer",
                    maxWidth: "100%",
                  }}
                >
                  <span style={{ flexShrink: 0 }}>✨</span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    From your itinerary: {suggestedHotels[h.city]}
                  </span>
                </button>
              )}
            {h.name.trim() && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 6,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() =>
                    setHotels((prev) =>
                      prev.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              status: x.status === "booked" ? null : "booked",
                            }
                          : x,
                      ),
                    )
                  }
                  aria-pressed={h.status === "booked"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "5px 12px",
                    borderRadius: RADIUS.full,
                    border: `1.5px solid ${h.status === "booked" ? T.moss : T.sand}`,
                    background: h.status === "booked" ? T.moss : "white",
                    color: h.status === "booked" ? "white" : T.mist,
                    fontFamily: "Georgia,serif",
                    fontSize: 12,
                    cursor: "pointer",
                    flexShrink: 0,
                    fontWeight: h.status === "booked" ? 700 : 400,
                  }}
                >
                  {h.status === "booked" ? "✓ Booked" : "Mark booked"}
                </button>
                {h.status === "booked" && (
                  <input
                    value={h.confirmation}
                    onChange={(e) =>
                      setHotels((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, confirmation: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="Confirmation # (optional)"
                    style={{
                      flex: 1,
                      minWidth: 150,
                      padding: "6px 10px",
                      borderRadius: RADIUS.md,
                      border: `1.5px solid ${h.confirmation ? T.moss : T.sand}`,
                      fontFamily: "Georgia,serif",
                      fontSize: 12,
                      color: T.ink,
                      outline: "none",
                      boxSizing: "border-box",
                      background: "white",
                    }}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          padding: "12px 0 8px",
          background: T.warm,
        }}
      >
        <button
          onClick={handleSaveAll}
          disabled={!hasChanges}
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: RADIUS.lg,
            border: "none",
            background:
              saveStatus === "done"
                ? T.moss
                : !hasChanges
                  ? T.sand
                  : `linear-gradient(135deg,${T.ocean},${T.dusk})`,
            color: !hasChanges ? T.mist : "white",
            fontFamily: "'DM Serif Display',serif",
            fontSize: 15,
            cursor: hasChanges ? "pointer" : "default",
            transition: `background ${MOTION.slow}`,
          }}
        >
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "done"
              ? "✓ Saved"
              : "Save and update itinerary"}
        </button>
      </div>
    </div>
  );
}

/* ─── BOARD VIEW (main) ──────────────────────────────────────────────── */
function BoardView({
  trip,
  onSaveNotes,
  days,
  onSaveFlights,
  onSaveHotels,
  onApplyHotels,
  onSaveTravelLegs,
  initialSection = null,
  onInitialSectionConsumed,
  isSharedTrip = false,
  session = null,
  members = [],
  polls = [],
  onPollChanged,
  onClosePoll,
  onComposePoll,
  boardTick = 0,
}) {
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
    supabase
      .from("trip_todos")
      .select("id, text, done")
      .eq("trip_id", trip.id)
      .order("position")
      .limit(5)
      .then(({ data }) => setTodoItems(data || []))
      .catch(() => setTodoItems([]));
    supabase
      .from("trip_bookmarks")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", trip.id)
      .then(({ count }) => setBookmarkCount(count || 0))
      .catch(() => setBookmarkCount(0));
  }, [trip?.id, activeSection, boardTick]); // re-fetch on return + on live board changes

  if (activeSection === "notes") {
    return <NotesView trip={trip} onSaveNotes={onSaveNotes} onBack={goBack} />;
  }
  if (activeSection === "todo") {
    return <TodoView trip={trip} onBack={goBack} boardTick={boardTick} />;
  }
  if (activeSection === "bookmarks") {
    return <BookmarksView trip={trip} onBack={goBack} boardTick={boardTick} />;
  }
  if (activeSection === "decisions") {
    return (
      <DecisionsView
        trip={trip}
        session={session}
        members={members}
        polls={polls}
        onChanged={onPollChanged}
        onClosePoll={onClosePoll}
        onCompose={onComposePoll}
        onBack={goBack}
      />
    );
  }
  if (activeSection === "expenses") {
    return (
      <ExpensesView
        trip={trip}
        onBack={goBack}
        onUpdateTrip={(updates) => Object.assign(trip, updates)}
        boardTick={boardTick}
        members={members}
        session={session}
      />
    );
  }
  if (activeSection === "logistics") {
    return (
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderBottom: `1px solid ${T.sand}`,
            background: T.chalk,
          }}
        >
          <button
            onClick={goBack}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: T.ocean,
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ←
          </button>
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 18,
              color: T.ink,
            }}
          >
            Travel & Hotels
          </div>
        </div>
        <LogisticsTab
          trip={trip}
          days={days || []}
          onSaveFlights={onSaveFlights}
          onSaveHotels={onSaveHotels}
          onApplyHotels={onApplyHotels}
          onSaveTravelLegs={onSaveTravelLegs}
        />
      </div>
    );
  }

  const noteText = trip.board_notes?.trim() || null;
  const notePreview = noteText
    ? noteText.slice(0, 120) + (noteText.length > 120 ? "…" : "")
    : null;
  const doneTodos = (todoItems || []).filter((t) => t.done).length;

  return (
    <div
      style={{
        padding: "16px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* ── DECISIONS (shared trips only) ── */}
      {isSharedTrip && (
        <div
          onClick={() => openSection("decisions")}
          style={{
            background: T.chalk,
            borderRadius: RADIUS.lg,
            border: `1px solid ${T.sand}`,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 16px 10px",
            }}
          >
            <div style={{ fontSize: 24, flexShrink: 0 }}>🗳️</div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: "'DM Serif Display',serif",
                  fontSize: 15,
                  color: T.ink,
                }}
              >
                Decisions
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: T.mist,
                  fontFamily: "Georgia,serif",
                }}
              >
                {(() => {
                  const open = polls.filter((p) => p.status === "open").length;
                  return open > 0
                    ? `${open} open ${open === 1 ? "poll" : "polls"} — cast your vote`
                    : "Start a poll when the group can't agree";
                })()}
              </div>
            </div>
            <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
          </div>
        </div>
      )}

      {/* ── TRAVEL & HOTELS ── */}
      <div
        onClick={() => openSection("logistics")}
        style={{
          background: T.chalk,
          borderRadius: RADIUS.lg,
          border: `1px solid ${T.sand}`,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px 10px",
          }}
        >
          <div style={{ fontSize: 24, flexShrink: 0 }}>🧭</div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 15,
                color: T.ink,
              }}
            >
              Travel & Hotels
            </div>
            <div
              style={{
                fontSize: 12,
                color: T.mist,
                fontFamily: "Georgia,serif",
              }}
            >
              {trip.arrival_city
                ? `${trip.arrival_city} → ${trip.departure_city || trip.arrival_city}`
                : "Add flights and hotel details"}
            </div>
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
      </div>

      {/* ── EXPENSES ── */}
      <div
        onClick={() => openSection("expenses")}
        style={{
          background: T.chalk,
          borderRadius: RADIUS.lg,
          border: `1px solid ${T.sand}`,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px 10px",
          }}
        >
          <div style={{ fontSize: 24, flexShrink: 0 }}>💸</div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 15,
                color: T.ink,
              }}
            >
              Expenses
            </div>
            <div
              style={{
                fontSize: 12,
                color: T.mist,
                fontFamily: "Georgia,serif",
              }}
            >
              Plan your trip budget
            </div>
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
      </div>

      {/* ── NOTES ── */}
      <div
        onClick={() => openSection("notes")}
        style={{
          background: T.chalk,
          borderRadius: RADIUS.lg,
          border: `1px solid ${T.sand}`,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px 10px",
          }}
        >
          <div style={{ fontSize: 24, flexShrink: 0 }}>📝</div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 15,
                color: T.ink,
              }}
            >
              Notes
            </div>
            <div
              style={{
                fontSize: 12,
                color: T.mist,
                fontFamily: "Georgia,serif",
              }}
            >
              Shared notes for the trip
            </div>
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
        <div
          style={{
            borderTop: `1px solid ${T.sand}`,
            padding: "10px 16px 14px",
          }}
        >
          {notePreview ? (
            <div
              style={{
                fontSize: 12,
                color: T.ink,
                fontFamily: "Georgia,serif",
                lineHeight: 1.7,
                opacity: 0.8,
                whiteSpace: "pre-line",
              }}
            >
              {notePreview}
            </div>
          ) : (
            <div
              style={{
                fontSize: 12,
                color: T.mist,
                fontFamily: "Georgia,serif",
                fontStyle: "italic",
              }}
            >
              No notes yet — tap to add
            </div>
          )}
        </div>
      </div>

      {/* ── TO-DO ── */}
      <div
        onClick={() => openSection("todo")}
        style={{
          background: T.chalk,
          borderRadius: RADIUS.lg,
          border: `1px solid ${T.sand}`,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px 10px",
          }}
        >
          <div style={{ fontSize: 24, flexShrink: 0 }}>✅</div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 15,
                color: T.ink,
              }}
            >
              To-do
            </div>
            {todoItems && todoItems.length > 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: T.mist,
                  fontFamily: "Georgia,serif",
                }}
              >
                {doneTodos}/{todoItems.length} done
              </div>
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: T.mist,
                  fontFamily: "Georgia,serif",
                }}
              >
                Checklist for your trip
              </div>
            )}
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
        <div
          style={{
            borderTop: `1px solid ${T.sand}`,
            padding: "10px 16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {todoItems === null && (
            <div
              style={{
                fontSize: 12,
                color: T.mist,
                fontFamily: "Georgia,serif",
              }}
            >
              Loading…
            </div>
          )}
          {todoItems !== null && todoItems.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: T.mist,
                fontFamily: "Georgia,serif",
                fontStyle: "italic",
              }}
            >
              No items yet — tap to generate or add
            </div>
          )}
          {(todoItems || []).slice(0, 4).map((t) => (
            <div
              key={t.id}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  flexShrink: 0,
                  border: `1.5px solid ${t.done ? T.ocean : T.sand}`,
                  background: t.done ? T.ocean : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {t.done && (
                  <span style={{ fontSize: 9, color: "white", lineHeight: 1 }}>
                    ✓
                  </span>
                )}
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontFamily: "Georgia,serif",
                  color: t.done ? T.mist : T.ink,
                  textDecoration: t.done ? "line-through" : "none",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t.text}
              </span>
            </div>
          ))}
          {todoItems && todoItems.length > 4 && (
            <div
              style={{
                fontSize: 11,
                color: T.mist,
                fontFamily: "Georgia,serif",
                paddingLeft: 22,
              }}
            >
              +{todoItems.length - 4} more
            </div>
          )}
        </div>
      </div>

      {/* ── BOOKMARKS ── */}
      <div
        onClick={() => openSection("bookmarks")}
        style={{
          background: T.chalk,
          borderRadius: RADIUS.lg,
          border: `1px solid ${T.sand}`,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px 10px",
          }}
        >
          <div style={{ fontSize: 24, flexShrink: 0 }}>🔖</div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 15,
                color: T.ink,
              }}
            >
              Bookmarks
            </div>
            <div
              style={{
                fontSize: 12,
                color: T.mist,
                fontFamily: "Georgia,serif",
              }}
            >
              {bookmarkCount > 0
                ? `${bookmarkCount} saved`
                : "Save links to flights, hotels & more"}
            </div>
          </div>
          <div style={{ fontSize: 16, color: T.mist, flexShrink: 0 }}>›</div>
        </div>
      </div>
    </div>
  );
}

export default BoardView;
export { LogisticsTab, CityInput, LegRoute };
