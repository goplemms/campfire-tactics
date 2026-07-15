/**
 * A collapsible bottom-right **dev tray** for the DOM testing affordances — the Save/Load
 * repro panel (repro-capture.ts) and the Session-log export (playtest-log-ui.ts). They
 * used to be fixed buttons pinned over the canvas corner, occluding the game HUD (the
 * turn-order rail, rumor text) — a visual-audit finding. Now they mount INSIDE a tray
 * that collapses to a single corner chevron, so the rendered UI is unobstructed by
 * default; one click reveals the tools, another tucks them away.
 *
 * {@link getDevTray} is idempotent — it builds the tray + corner toggle once and returns
 * the tray container for a caller to append its button into. No-ops headless (no DOM).
 */
const TRAY_ID = "dev-tray";
const TOGGLE_ID = "dev-tray-toggle";

/** The shared tray container (built on first call), or `null` with no document (headless). */
export function getDevTray(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(TRAY_ID);
  if (existing) return existing;

  // The tools column: bottom-right, stacked and right-aligned just above the corner
  // chevron. Hidden until the chevron is clicked, so nothing sits over the canvas.
  const tray = document.createElement("div");
  tray.id = TRAY_ID;
  Object.assign(tray.style, {
    position: "fixed",
    right: "12px",
    bottom: "46px",
    zIndex: "10000",
    display: "none",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "8px",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(tray);

  // The corner chevron — the only thing showing most of the time. Down-facing (⌄) while
  // the tools are tucked away; clicking flips it (⌃) and reveals the tray.
  const toggle = document.createElement("button");
  toggle.id = TOGGLE_ID;
  toggle.title = "Show / hide dev tools (Save · Load, Session log)";
  toggle.textContent = "⌄";
  Object.assign(toggle.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: "10001",
    width: "26px",
    height: "26px",
    padding: "0",
    lineHeight: "24px",
    textAlign: "center",
    background: "#1c2b23",
    color: "#8fcaa6",
    border: "1px solid #3c6b50",
    borderRadius: "4px",
    font: "15px monospace",
    cursor: "pointer",
    opacity: "0.5",
  } as Partial<CSSStyleDeclaration>);
  toggle.addEventListener("mouseenter", () => (toggle.style.opacity = "1"));
  toggle.addEventListener("mouseleave", () => (toggle.style.opacity = "0.5"));
  toggle.addEventListener("click", () => {
    const open = tray.style.display === "none";
    tray.style.display = open ? "flex" : "none";
    toggle.textContent = open ? "⌃" : "⌄";
  });
  document.body.appendChild(toggle);
  return tray;
}
