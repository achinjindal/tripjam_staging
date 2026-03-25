import { useState } from "react";
import { supabase } from "./supabase";

const T = {
  ink:   "#0F1923",
  dusk:  "#1E2D3D",
  ocean: "#2563A8",
  sky:   "#4A90D9",
  sand:  "#F0E6D3",
  warm:  "#FAF6F0",
  terra: "#C4622D",
  mist:  "#8BA5BB",
  chalk: "#FFFFFF",
};

const FACE_ICONS = ["👦", "👧", "🧑", "👨", "👩", "🧔", "👱", "🧓", "🥸", "😎"];

export default function Auth() {
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [faceIcon, setFaceIcon] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const fakeEmail = (u) => `${u.toLowerCase().trim()}@tripjam.app`;

  async function handleSignUp() {
    setError("");
    if (!username.trim() || !password) return setError("Username and password are required.");
    if (username.trim().length < 3) return setError("Username must be at least 3 characters.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: fakeEmail(username),
      password,
    });

    if (signUpError) {
      setLoading(false);
      if (signUpError.message.includes("already registered")) {
        return setError("Username already taken. Try another.");
      }
      return setError(signUpError.message);
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: data.user.id,
      username: username.trim(),
      face_icon: faceIcon + 1,
    });

    setLoading(false);
    if (profileError) setError(profileError.message);
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
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    }}>
      <div style={{
        background: T.dusk,
        borderRadius: 16,
        padding: "40px 36px",
        width: "100%",
        maxWidth: 400,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✈️</div>
          <h1 style={{ color: T.chalk, fontSize: 22, fontWeight: 700, margin: 0 }}>TripJam</h1>
          <p style={{ color: T.mist, fontSize: 13, margin: "4px 0 0" }}>Plan together, travel better</p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", background: T.ink, borderRadius: 8, padding: 4, marginBottom: 24 }}>
          {["signin", "signup"].map((m) => (
            <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              background: mode === m ? T.ocean : "transparent",
              color: mode === m ? T.chalk : T.mist,
              transition: "all 0.15s",
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
              <p style={{ color: T.mist, fontSize: 13, margin: "4px 0 8px" }}>Choose your icon</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {FACE_ICONS.map((icon, i) => (
                  <button key={i} onClick={() => setFaceIcon(i)} style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    border: faceIcon === i ? `2px solid ${T.sky}` : `2px solid transparent`,
                    background: faceIcon === i ? "rgba(74,144,217,0.15)" : T.ink,
                    fontSize: 22,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p style={{ color: "#e05c5c", fontSize: 13, margin: 0 }}>{error}</p>
          )}

          <button
            onClick={mode === "signin" ? handleSignIn : handleSignUp}
            disabled={loading}
            style={{
              marginTop: 4,
              padding: "12px 0",
              borderRadius: 8,
              border: "none",
              background: loading ? T.mist : T.ocean,
              color: T.chalk,
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
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
  padding: "11px 14px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(0,0,0,0.2)",
  color: "#fff",
  fontSize: 14,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
