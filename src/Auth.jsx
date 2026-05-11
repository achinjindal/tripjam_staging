import { useState } from "react";
import { supabase } from "./supabase";
import { T, RADIUS, SHADOW, MOTION } from "./theme";

const FACE_ICONS = ["👦", "👧", "🧑", "👨", "👩", "🧔", "👱", "🧓", "🥸", "😎"];

export default function Auth() {
  const [mode, setMode] = useState("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [faceIcon, setFaceIcon] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const fakeEmail = (u) => `${u.toLowerCase().trim().replace(/[^a-z0-9._-]/g, "")}@tripjam.app`;

  async function handleSignUp() {
    setError("");
    if (!username.trim() || !password) return setError("Username and password are required.");
    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: fakeEmail(username),
      password,
    });
    if (signUpError) { setLoading(false); return setError(signUpError.message); }
    if (data?.user?.id) {
      await supabase.from("profiles").upsert({
        id: data.user.id,
        username: username.trim(),
        face_icon: FACE_ICONS[faceIcon],
      });
    }
    setLoading(false);
  }

  async function handleSignIn() {
    setError("");
    if (!username.trim() || !password) return setError("Username and password are required.");
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: fakeEmail(username),
      password,
    });
    setLoading(false);
    if (signInError) setError("Invalid username or password.");
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: T.ink,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "Georgia, serif",
    }}>
      <div style={{
        background: T.dusk,
        borderRadius: RADIUS.lg,
        padding: "40px 36px",
        width: "100%",
        maxWidth: 400,
        boxShadow: SHADOW.lg,
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✈️</div>
          <h1 style={{ color: T.chalk, fontSize: 26, fontWeight: 400, margin: 0, fontFamily: "'DM Serif Display', serif" }}>TripJam</h1>
          <p style={{ color: T.mist, fontSize: 12, margin: "4px 0 0" }}>Plan together, travel better</p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", background: T.ink, borderRadius: RADIUS.md, padding: 4, marginBottom: 24 }}>
          {["signin", "signup"].map((m) => (
            <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: RADIUS.sm,
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "Georgia, serif",
              background: mode === m ? T.ocean : "transparent",
              color: mode === m ? T.chalk : T.mist,
              transition: `all ${MOTION.normal}`,
            }}>
              {m === "signin" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (mode === "signin" ? handleSignIn() : handleSignUp())}
            style={inputStyle}
          />

          {/* Face icon picker — signup only */}
          {mode === "signup" && (
            <div>
              <p style={{ color: T.mist, fontSize: 12, margin: "4px 0 8px" }}>Choose your icon</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {FACE_ICONS.map((icon, i) => (
                  <button key={i} onClick={() => setFaceIcon(i)} style={{
                    width: 44,
                    height: 44,
                    borderRadius: RADIUS.md,
                    border: faceIcon === i ? `2px solid ${T.sky}` : `2px solid transparent`,
                    background: faceIcon === i ? "rgba(74,144,217,0.15)" : T.ink,
                    fontSize: 22,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: `all ${MOTION.normal}`,
                  }}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p style={{ color: T.error, fontSize: 12, margin: 0 }}>{error}</p>
          )}

          <button
            onClick={mode === "signin" ? handleSignIn : handleSignUp}
            disabled={loading}
            style={{
              marginTop: 4,
              padding: "10px 20px",
              borderRadius: RADIUS.md,
              border: "none",
              background: loading ? T.mist : T.ocean,
              color: T.chalk,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "Georgia, serif",
              cursor: loading ? "not-allowed" : "pointer",
              minHeight: 44,
              transition: `all ${MOTION.normal}`,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "..." : mode === "signin" ? "Sign In" : "Create Account"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: "10px 14px",
  borderRadius: RADIUS.md,
  border: "1.5px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.2)",
  color: "#fff",
  fontSize: 14,
  fontFamily: "Georgia, serif",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
  transition: `border-color ${MOTION.normal}, box-shadow ${MOTION.normal}`,
};
