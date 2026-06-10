import { useEffect } from "react";
import { T, RADIUS, SPACE } from "./theme";

// Day 5: shared scrollable layout for Privacy + Terms pages.
// Both pages render plain prose content. Public — no auth required.
//
// Disclaimer: These are pragmatic templates suitable for an early-stage
// launch. Have a lawyer review before scaling to large user base or
// regulated markets.

function navTo(path) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function LegalPage({ title, lastUpdated, children }) {
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const prev = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      htmlOverflow: html.style.overflow,
    };
    body.style.overflow = "auto";
    body.style.position = "static";
    html.style.overflow = "auto";
    return () => {
      body.style.overflow = prev.bodyOverflow;
      body.style.position = prev.bodyPosition;
      html.style.overflow = prev.htmlOverflow;
    };
  }, []);

  // Scroll to top on mount/title change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [title]);

  return (
    <div
      style={{
        background: T.bgPage,
        color: T.ink,
        fontFamily: "Georgia, serif",
        minHeight: "100vh",
      }}
    >
      <header
        style={{
          background: "white",
          borderBottom: `1px solid ${T.border}`,
          padding: "12px 20px",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <button
            onClick={() => navTo("/")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "Georgia, serif",
              padding: 0,
            }}
          >
            <span style={{ fontSize: 22 }}>✈️</span>
            <span
              style={{
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontSize: 22,
                color: T.ink,
              }}
            >
              TripJam
            </span>
          </button>
          <button
            onClick={() => navTo("/signup")}
            style={{
              padding: "8px 14px",
              borderRadius: RADIUS.sm,
              border: "none",
              background: T.ocean,
              color: "white",
              fontFamily: "Georgia, serif",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Sign up free
          </button>
        </div>
      </header>

      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: `${SPACE.xxl}px ${SPACE.lg}px`,
        }}
      >
        <h1
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: "clamp(28px, 5vw, 40px)",
            color: T.ink,
            margin: 0,
            fontWeight: 400,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontSize: 13,
            color: T.mist,
            margin: `${SPACE.sm}px 0 ${SPACE.xl}px`,
          }}
        >
          Last updated: {lastUpdated}
        </p>
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: T.dusk,
          }}
        >
          {children}
        </div>

        <div
          style={{
            marginTop: SPACE.xxl,
            paddingTop: SPACE.lg,
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            gap: SPACE.lg,
            fontSize: 13,
            color: T.mist,
            flexWrap: "wrap",
          }}
        >
          <button onClick={() => navTo("/")} style={navLinkStyle}>
            ← Home
          </button>
          <button onClick={() => navTo("/privacy")} style={navLinkStyle}>
            Privacy Policy
          </button>
          <button onClick={() => navTo("/terms")} style={navLinkStyle}>
            Terms of Service
          </button>
          <a
            href="mailto:achinj.work@gmail.com"
            style={{ ...navLinkStyle, textDecoration: "none" }}
          >
            Support
          </a>
        </div>
      </main>
    </div>
  );
}

const navLinkStyle = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: T.ocean,
  fontFamily: "Georgia, serif",
  fontSize: 13,
  padding: 0,
};

// ── Shared block components ──
export function H2({ children }) {
  return (
    <h2
      style={{
        fontFamily: "'DM Serif Display', Georgia, serif",
        fontSize: 22,
        fontWeight: 400,
        color: T.ink,
        marginTop: 36,
        marginBottom: 12,
      }}
    >
      {children}
    </h2>
  );
}

export function P({ children }) {
  return <p style={{ margin: "0 0 14px" }}>{children}</p>;
}

export function UL({ children }) {
  return <ul style={{ margin: "0 0 14px", paddingLeft: 22 }}>{children}</ul>;
}

export function LI({ children }) {
  return <li style={{ marginBottom: 6 }}>{children}</li>;
}
