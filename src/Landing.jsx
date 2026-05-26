import { useEffect, useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "./theme";

// Day 4: Public landing page for unauthenticated visitors at "/".
// Single-scroll: Hero · How it works · Pricing · FAQ · Footer.
// Mobile-first because most traffic is mobile (per CLAUDE.md).

const SUPPORT_EMAIL = "achinj.work@gmail.com";

function navTo(path) {
  window.history.pushState(null, "", path);
  // Trigger Root's popstate listener to re-render
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function Landing() {
  // The app shell locks body scroll. Release it while Landing is mounted.
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

  return (
    <div
      style={{
        background: T.bgPage,
        color: T.ink,
        fontFamily: "Georgia, serif",
        minHeight: "100vh",
      }}
    >
      <Header />
      <Hero />
      <HowItWorks />
      <Pricing />
      <FAQ />
      <Footer />
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────
function Header() {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "rgba(245,240,232,0.92)",
        backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>✈️</span>
          <span
            style={{
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontSize: 22,
              color: T.ink,
              letterSpacing: 0.3,
            }}
          >
            TripJam
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => navTo("/signin")}
            style={{
              padding: "8px 14px",
              borderRadius: RADIUS.sm,
              border: "none",
              background: "transparent",
              color: T.ink,
              fontFamily: "Georgia, serif",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Sign in
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
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Sign up free
          </button>
        </div>
      </div>
    </header>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section
      style={{
        padding: "60px 20px 80px",
        background: `linear-gradient(180deg, ${T.bgPage} 0%, ${T.warm} 100%)`,
      }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto", textAlign: "center" }}>
        <div
          style={{
            display: "inline-block",
            padding: "5px 12px",
            borderRadius: RADIUS.full,
            background: "rgba(37,99,168,0.10)",
            color: T.ocean,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.3,
            marginBottom: 22,
          }}
        >
          AI travel planning · 300 credits free
        </div>
        <h1
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: "clamp(34px, 6vw, 52px)",
            lineHeight: 1.05,
            color: T.ink,
            margin: 0,
            fontWeight: 400,
          }}
        >
          Plan trips that feel like
          <br />
          <span style={{ color: T.ocean, fontStyle: "italic" }}>actually yours.</span>
        </h1>
        <p
          style={{
            fontSize: "clamp(15px, 2.2vw, 18px)",
            color: T.dusk,
            margin: "20px auto 0",
            maxWidth: 620,
            lineHeight: 1.55,
          }}
        >
          Describe where you're going. TripJam drafts a day-by-day itinerary in seconds —
          with maps, photos, transit tips, and a magazine-style guide to every city.
          Tweak it, share it, take it offline.
        </p>
        <div
          style={{
            marginTop: 30,
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => navTo("/signup")}
            style={{
              padding: "14px 26px",
              borderRadius: RADIUS.md,
              border: "none",
              background: T.ocean,
              color: "white",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "Georgia, serif",
              cursor: "pointer",
              boxShadow: SHADOW.md,
            }}
          >
            Start planning free
          </button>
          <button
            onClick={() =>
              document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })
            }
            style={{
              padding: "14px 22px",
              borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`,
              background: "white",
              color: T.ink,
              fontSize: 15,
              fontFamily: "Georgia, serif",
              cursor: "pointer",
            }}
          >
            See how it works
          </button>
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 12,
            color: T.mist,
          }}
        >
          No credit card. Free signup includes 300 credits (~5-10 trips).
        </div>
      </div>
    </section>
  );
}

// ── How it works ────────────────────────────────────────────────────────────
const STEPS = [
  {
    n: "1",
    icon: "🌍",
    title: "Tell us where you're going",
    body: "Pick destinations, set dates, choose your vibe — solo backpacking, family beach, romantic city break. Takes 30 seconds.",
  },
  {
    n: "2",
    icon: "🛣️",
    title: "Get 4 route options",
    body: "AI proposes 4 different day-by-day routes (efficient · scenic · cultural · off-beat). Vote on the one you like, or remix.",
  },
  {
    n: "3",
    icon: "🗓️",
    title: "Full itinerary in seconds",
    body: "Day-by-day activities, transit tips, opening hours, photos, and a destination magazine. Edit anything, share with friends, take it offline.",
  },
];

function HowItWorks() {
  return (
    <section
      id="how"
      style={{
        padding: "70px 20px",
        background: T.warm,
        borderTop: `1px solid ${T.border}`,
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: "clamp(26px, 4vw, 36px)",
            color: T.ink,
            margin: "0 0 50px",
            fontWeight: 400,
            textAlign: "center",
          }}
        >
          How it works
        </h2>
        <div
          style={{
            display: "grid",
            gap: 22,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          {STEPS.map((s) => (
            <div
              key={s.n}
              style={{
                background: "white",
                borderRadius: RADIUS.lg,
                padding: "26px 22px",
                border: `1px solid ${T.border}`,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 18,
                  right: 18,
                  fontSize: 11,
                  fontWeight: 700,
                  color: T.ocean,
                  letterSpacing: 1,
                }}
              >
                STEP {s.n}
              </div>
              <div style={{ fontSize: 38, marginBottom: 14 }}>{s.icon}</div>
              <h3
                style={{
                  fontFamily: "'DM Serif Display', Georgia, serif",
                  fontSize: 19,
                  margin: "0 0 8px",
                  color: T.ink,
                  fontWeight: 400,
                  lineHeight: 1.25,
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  fontSize: 14,
                  color: T.dusk,
                  margin: 0,
                  lineHeight: 1.55,
                }}
              >
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Pricing ─────────────────────────────────────────────────────────────────
function Pricing() {
  const packs = [
    {
      label: "Free start",
      price: "$0",
      sub: "on signup",
      credits: "300 credits",
      bullets: [
        "Plan ~5-10 trips",
        "Full magazine + itinerary",
        "Offline access on mobile",
        "No card required",
      ],
      cta: "Start free",
      ctaPath: "/signup",
      highlight: false,
    },
    {
      label: "Small pack",
      price: "$5",
      sub: "300 credits",
      credits: "$0.017 / credit",
      bullets: [
        "Top up when you run low",
        "Credits never expire",
        "Works for any trip length",
      ],
      cta: "Top up later",
      ctaPath: "/signup",
      highlight: false,
    },
    {
      label: "Large pack",
      price: "$10",
      sub: "1000 credits",
      credits: "$0.010 / credit · best value",
      bullets: [
        "3.3× more credits per dollar",
        "Great for power planners",
        "Credits never expire",
      ],
      cta: "Top up later",
      ctaPath: "/signup",
      highlight: true,
    },
  ];

  return (
    <section style={{ padding: "70px 20px", background: T.bgPage }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: "clamp(26px, 4vw, 36px)",
            color: T.ink,
            margin: "0 0 8px",
            fontWeight: 400,
            textAlign: "center",
          }}
        >
          Pay only when you use AI
        </h2>
        <p
          style={{
            textAlign: "center",
            color: T.dusk,
            fontSize: 14,
            margin: "0 0 40px",
            maxWidth: 540,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          One credit ≈ $0.01 of AI cost. Most actions use 1-3 credits. Generating a full
          itinerary uses 20-30. Free signup covers your first trips.
        </p>
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          {packs.map((p) => (
            <div
              key={p.label}
              style={{
                background: "white",
                border: p.highlight ? `2px solid ${T.ocean}` : `1px solid ${T.border}`,
                borderRadius: RADIUS.lg,
                padding: "28px 24px",
                display: "flex",
                flexDirection: "column",
                position: "relative",
                boxShadow: p.highlight ? SHADOW.md : "none",
              }}
            >
              {p.highlight && (
                <div
                  style={{
                    position: "absolute",
                    top: -12,
                    right: 18,
                    background: T.ocean,
                    color: "white",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1,
                    padding: "4px 10px",
                    borderRadius: RADIUS.full,
                  }}
                >
                  BEST VALUE
                </div>
              )}
              <div
                style={{
                  fontSize: 12,
                  color: T.mist,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                {p.label}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontFamily: "'DM Serif Display', Georgia, serif",
                    fontSize: 38,
                    color: T.ink,
                    lineHeight: 1,
                  }}
                >
                  {p.price}
                </span>
                <span style={{ fontSize: 13, color: T.mist }}>{p.sub}</span>
              </div>
              <div style={{ fontSize: 13, color: T.dusk, marginBottom: 18 }}>
                {p.credits}
              </div>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "0 0 22px",
                  flex: 1,
                }}
              >
                {p.bullets.map((b) => (
                  <li
                    key={b}
                    style={{
                      fontSize: 14,
                      color: T.dusk,
                      padding: "6px 0",
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                    }}
                  >
                    <span style={{ color: T.moss, flexShrink: 0 }}>✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => navTo(p.ctaPath)}
                style={{
                  padding: "11px 18px",
                  borderRadius: RADIUS.md,
                  border: p.highlight ? "none" : `1px solid ${T.border}`,
                  background: p.highlight ? T.ocean : "white",
                  color: p.highlight ? "white" : T.ink,
                  fontFamily: "Georgia, serif",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                {p.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── FAQ ─────────────────────────────────────────────────────────────────────
const FAQS = [
  {
    q: "Is my data private?",
    a: "Your trips are yours. We don't sell data, don't run ads. Trips are private by default — you choose when to share via a read-only link.",
  },
  {
    q: "What's a credit?",
    a: "A credit ≈ $0.01 of AI cost passed through to you. Generating a quick to-do list uses ~1 credit; a full multi-day itinerary uses 20-30. Most users get 5-10 trips out of the free 300 credits.",
  },
  {
    q: "Do credits expire?",
    a: "No. Buy whenever; use whenever. Refunds available within 30 days if something is broken on our end — just email support.",
  },
  {
    q: "Can I plan offline?",
    a: "Yes. TripJam works as a PWA — install it on your phone (Add to Home Screen on iOS, Install on Android) and your saved trips are available offline. AI features need internet.",
  },
  {
    q: "Can I collaborate with friends?",
    a: "Yes. Each trip has a share link with optional join-as-collaborator. Voting on routes, suggesting activities, and comments work in real time.",
  },
  {
    q: "Why not just use ChatGPT?",
    a: "TripJam combines the AI itinerary with maps, photos, transit timing, opening hours, and offline access — all stitched into a single tool you can take on your trip. No copy-pasting between apps.",
  },
];

function FAQ() {
  const [open, setOpen] = useState(0); // first FAQ open by default
  return (
    <section
      style={{
        padding: "70px 20px",
        background: T.warm,
        borderTop: `1px solid ${T.border}`,
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: "clamp(26px, 4vw, 36px)",
            color: T.ink,
            margin: "0 0 30px",
            fontWeight: 400,
            textAlign: "center",
          }}
        >
          Questions
        </h2>
        <div>
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                style={{
                  background: "white",
                  border: `1px solid ${T.border}`,
                  borderRadius: RADIUS.md,
                  marginBottom: 10,
                  overflow: "hidden",
                  transition: `box-shadow ${MOTION.normal}`,
                  boxShadow: isOpen ? SHADOW.sm : "none",
                }}
              >
                <button
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "16px 20px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "Georgia, serif",
                    fontSize: 15,
                    color: T.ink,
                    fontWeight: 600,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span>{f.q}</span>
                  <span
                    style={{
                      color: T.mist,
                      fontSize: 18,
                      transition: `transform ${MOTION.fast}`,
                      transform: isOpen ? "rotate(45deg)" : "rotate(0)",
                    }}
                  >
                    +
                  </span>
                </button>
                {isOpen && (
                  <div
                    style={{
                      padding: "0 20px 18px",
                      fontSize: 14,
                      color: T.dusk,
                      lineHeight: 1.6,
                    }}
                  >
                    {f.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer
      style={{
        background: T.ink,
        color: T.sand,
        padding: "50px 20px 30px",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 32,
          marginBottom: 32,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 20 }}>✈️</span>
            <span
              style={{
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontSize: 22,
                color: "white",
              }}
            >
              TripJam
            </span>
          </div>
          <p style={{ fontSize: 13, color: T.mist, margin: 0, lineHeight: 1.55 }}>
            AI travel planning that feels personal. Made for travelers who want to spend
            less time planning and more time being there.
          </p>
        </div>
        <div>
          <div
            style={{
              fontSize: 11,
              color: T.mist,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            Product
          </div>
          <FooterLink onClick={() => navTo("/signup")}>Sign up free</FooterLink>
          <FooterLink onClick={() => navTo("/signin")}>Sign in</FooterLink>
          <FooterLink
            onClick={() =>
              document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            How it works
          </FooterLink>
        </div>
        <div>
          <div
            style={{
              fontSize: 11,
              color: T.mist,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            Support
          </div>
          <FooterLink href={`mailto:${SUPPORT_EMAIL}`}>Email us</FooterLink>
          <FooterLink href="/privacy">Privacy policy</FooterLink>
          <FooterLink href="/terms">Terms of service</FooterLink>
          <div style={{ fontSize: 11, color: T.mist, marginTop: 10 }}>
            We reply within 24h on weekdays.
          </div>
        </div>
      </div>
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          paddingTop: 22,
          borderTop: `1px solid rgba(255,255,255,0.08)`,
          fontSize: 11,
          color: T.mist,
          textAlign: "center",
        }}
      >
        © {new Date().getFullYear()} TripJam · Made with care for travelers
      </div>
    </footer>
  );
}

function FooterLink({ children, onClick, href }) {
  const baseStyle = {
    display: "block",
    color: T.sand,
    fontSize: 14,
    textDecoration: "none",
    padding: "4px 0",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: "Georgia, serif",
    textAlign: "left",
  };
  if (href) {
    return (
      <a href={href} style={baseStyle}>
        {children}
      </a>
    );
  }
  return (
    <button onClick={onClick} style={baseStyle}>
      {children}
    </button>
  );
}
