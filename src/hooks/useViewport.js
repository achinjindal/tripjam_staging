import { useState, useEffect } from "react";

/**
 * Returns true when viewport is ≥ `minWidth` (default 1024 — the D21 desktop
 * breakpoint). SSR-safe: initial value evaluates against `window.matchMedia`
 * on the client, returns false on the server.
 *
 * Used to switch the app between the mobile shell (single column, bottom-nav,
 * chat-as-bottom-sheet) and the desktop shell (D22: left sidebar + center
 * content + persistent map/chat right column).
 */
export function useIsDesktop(minWidth = 1024) {
  // Manual override for in-IDE browser testing where the viewport can't be
  // resized — ?desktop=1 forces the desktop shell at any width.
  const forceDesktop =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("desktop") === "1";
  const query = `(min-width: ${minWidth}px)`;
  const [isDesktop, setIsDesktop] = useState(
    () =>
      forceDesktop ||
      (typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : false),
  );
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const mql = window.matchMedia(query);
    const handler = (e) => setIsDesktop(e.matches);
    // Safari < 14 used addListener/removeListener; modern browsers use the
    // EventTarget API. Prefer the modern API and fall back if absent.
    if (mql.addEventListener) {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [query]);
  return isDesktop;
}
