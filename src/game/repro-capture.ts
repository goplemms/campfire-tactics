/**
 * **Repro Dump** — render-layer half (capture, dump affordance, restore boot).
 *
 * The pure serialize/restore lives in {@link "../core/repro"}; this file owns the
 * browser-only pieces the debugging workflow needs:
 *
 *  - **Passive capture.** {@link captureRepro} snapshots the live run into `window.campfire`
 *    (and `localStorage`) at each scene transition — *before* the click that might freeze.
 *    An uncaught render exception leaves the canvas dead but not the page, so the last-good
 *    capture is still there to read from the console.
 *  - **Dump affordance.** {@link installReproDump} wires a freeze-proof **Shift+D** hotkey
 *    (a raw `window` listener, not the Phaser input a wedged scene can't service) and a
 *    `window.campfire.dump()` console function — both copy the JSON to the clipboard and log
 *    it. `campfire.restore(json)` boots straight back into that state.
 *  - **Restore boot.** {@link restoreAndBoot} rehydrates a pasted dump and lands the
 *    OverworldScene on the captured node's **prep camp** — the exact pre-Begin screen — so a
 *    reported freeze reproduces on the first click.
 *
 * Same-browser convenience: capture also writes the latest dump to `localStorage`, so
 * `#repro` (see {@link "./boot/repro".ReproBootScene}) re-enters the last state on reload.
 */
import type Phaser from "phaser";
import { dumpRun, serializeDump, parseDump, restoreRun, RunLoop, type ReproDump, type RunState } from "../core";
import type { RunHandoff } from "./scenes/OverworldScene";

/** Where the latest dump is stashed for the `#repro` same-browser re-entry. */
export const REPRO_LS_KEY = "campfire:repro:last";
/** How many recent captures to keep in the in-memory ring (the last is what dump() reads). */
const RING = 8;

/** Where a capture was taken — surfaced in the console so a tester knows what they grabbed. */
export interface ReproContext {
  /** The scene key (e.g. `"OverworldScene"`). */
  scene: string;
  /** A short phase tag (e.g. `"prep-camp"`, `"commit:combat"`, `"battle-staged"`). */
  phase: string;
  /** The node in play, if any. */
  node?: string;
}

interface Capture {
  dump: ReproDump;
  context: ReproContext;
  /** Wall-clock ms at capture (render layer — a plain timestamp, no determinism concern). */
  at: number;
}

interface ReproGlobal {
  last?: Capture;
  history: Capture[];
  /** Copy the last dump's JSON to the clipboard + log it; returns the JSON (or "" if none). */
  dump: () => string;
  /** Restore a pasted dump JSON and boot into it. */
  restore: (json: string) => void;
}

type ReproWindow = Window & { campfire?: ReproGlobal; campfireDump?: () => string; game?: Phaser.Game };

function ns(): ReproGlobal {
  const w = window as ReproWindow;
  if (!w.campfire) w.campfire = { history: [], dump: () => "", restore: () => {} };
  return w.campfire;
}

/**
 * Snapshot the live run into `window.campfire` + `localStorage`. Passive and defensive: a
 * capture failure must never break the game it is trying to help debug, so it is fully
 * swallowed (with a console warning).
 */
export function captureRepro(run: RunState, context: ReproContext): void {
  try {
    const cap: Capture = { dump: dumpRun(run), context, at: Date.now() };
    const g = ns();
    g.last = cap;
    g.history.push(cap);
    if (g.history.length > RING) g.history.shift();
    try {
      window.localStorage?.setItem(REPRO_LS_KEY, serializeDump(cap.dump));
    } catch {
      /* localStorage disabled/full — the in-memory capture still stands */
    }
  } catch (e) {
    console.warn("[repro] capture failed:", e);
  }
}

/** Best-effort clipboard copy (a Shift+D press is a user gesture, so this normally succeeds). */
function copyToClipboard(text: string): void {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    /* no clipboard permission — the JSON is still logged below for a manual copy */
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
}

/**
 * Wire the dump affordance onto the running game: the `window.campfire` API, the
 * `campfireDump()` convenience alias, and the freeze-proof **Shift+D** hotkey. Idempotent —
 * safe to call once at boot.
 */
export function installReproDump(game: Phaser.Game): void {
  const g = ns();
  g.dump = () => {
    if (!g.last) {
      console.warn("[repro] nothing captured yet — play a step first");
      return "";
    }
    const text = serializeDump(g.last.dump);
    copyToClipboard(text);
    console.log(
      `[repro] dump copied to clipboard (${text.length} chars) — ${g.last.context.scene}/${g.last.context.phase}` +
        (g.last.context.node ? ` @ ${g.last.context.node}` : ""),
    );
    console.log(text);
    return text;
  };
  g.restore = (json: string) => restoreAndBoot(game, json);
  (window as ReproWindow).campfireDump = g.dump;

  // A raw window listener (capture phase) so it fires even if a scene's Phaser input is
  // wedged by the very exception we're trying to capture.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.shiftKey && (e.key === "D" || e.key === "d") && !isTypingTarget(e.target)) {
        e.preventDefault();
        g.dump();
      }
    },
    { capture: true },
  );
}

/** The live run of the top-most active scene that owns one (Overworld/Battle), if any. */
function liveRun(game: Phaser.Game): RunState | undefined {
  for (const s of game.scene.getScenes(true)) {
    const r = (s as unknown as { run?: RunState }).run;
    if (r && (r as Partial<RunState>).map && Array.isArray((r as Partial<RunState>).party)) return r;
  }
  return undefined;
}

/** The freshest dump JSON to export: the live run if a scene owns one, else the last capture. */
function exportText(game: Phaser.Game): string {
  const run = liveRun(game);
  if (run) return serializeDump(dumpRun(run));
  const g = ns();
  return g.last ? serializeDump(g.last.dump) : "";
}

/**
 * Rehydrate a pasted dump and boot into it — the OverworldScene, landed on the captured
 * node's **prep camp** (the pre-Begin screen). Mirrors the jump tool's "collapse the running
 * scene stack, then hand off through a live scene's plugin" sequence so the restore doesn't
 * layer atop a stale scene. Throws (with the parse error) on a malformed paste.
 */
export function restoreAndBoot(game: Phaser.Game, json: string): void {
  const run = restoreRun(parseDump(json));
  const loop = new RunLoop(run);
  const handoff: RunHandoff = { run, loop, reproCampNode: run.mapNodeId };
  const running = game.scene.getScenes(true);
  for (let i = 1; i < running.length; i++) game.scene.stop(running[i].scene.key);
  const driver = running[0];
  if (driver) driver.scene.start("OverworldScene", handoff);
  else game.scene.start("OverworldScene", handoff);
  console.log(`[repro] restored → ${run.mapNodeId} (night ${run.night})`);
}

// --- In-game Save / Load panel (D95) ----------------------------------------
// A DOM overlay (a canvas sibling, so it survives scene transitions) that surfaces the
// export/import loop without the console — mirrors the debug-jump menu + playtest-log button.
// Parked top-right (the debug menu owns top-left; the playtest log owns bottom-right).

const SAVE_TOGGLE_ID = "repro-save-toggle";
const SAVE_PANEL_ID = "repro-save-panel";

function style(el: HTMLElement, s: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, s);
}

/** A small styled button matching the other debug affordances. */
function panelButton(label: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = title;
  style(b, {
    padding: "5px 10px",
    background: "#2f6b46",
    color: "#eafff0",
    border: "1px solid #57b07a",
    borderRadius: "4px",
    font: "12px monospace",
    cursor: "pointer",
  });
  return b;
}

/**
 * Mount the **Save / Load** overlay for `game`: a parked "💾 Save / Load" toggle that opens a
 * panel to **Export** the current run as JSON (into the textarea + clipboard, or a downloaded
 * file) and **Import** a pasted dump ({@link restoreAndBoot}). Idempotent; no-ops headless.
 *
 * This is the on-screen twin of the Shift+D hotkey / `window.campfire` console API — same
 * engine, a clickable surface for testing. Available on every build (it's a testing aid); gate
 * it behind a hash later if it should be dev-only.
 */
export function installSavePanel(game: Phaser.Game): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(SAVE_TOGGLE_ID)) return;

  // Parked bottom-right, stacked just above the "⬇ Session log" button (the two testing
  // affordances group together) — clear of the run-bar (top) and the debug-jump menu (top-left).
  const toggle = panelButton("💾 Save / Load", "Export the current run as a repro dump, or import one to jump into it");
  toggle.id = SAVE_TOGGLE_ID;
  style(toggle, { position: "fixed", right: "12px", bottom: "48px", zIndex: "10000" });
  document.body.appendChild(toggle);

  const panel = document.createElement("div");
  panel.id = SAVE_PANEL_ID;
  // Opens upward from just above the toggle (bottom-anchored), so it never collides with the run-bar.
  style(panel, {
    position: "fixed",
    right: "12px",
    bottom: "84px",
    zIndex: "10000",
    width: "340px",
    display: "none",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    background: "#12211a",
    border: "1px solid #57b07a",
    borderRadius: "6px",
    font: "12px monospace",
    color: "#eafff0",
    boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
  });
  document.body.appendChild(panel);

  const title = document.createElement("div");
  title.textContent = "Save / Load — repro dump";
  style(title, { fontWeight: "bold", color: "#bfeccf" });

  const area = document.createElement("textarea");
  area.placeholder = "Export drops the current save here (and copies it). Paste a save here, then Load.";
  style(area, {
    width: "100%",
    height: "120px",
    resize: "vertical",
    boxSizing: "border-box",
    background: "#0b1712",
    color: "#cfeeda",
    border: "1px solid #2f6b46",
    borderRadius: "4px",
    font: "11px monospace",
    padding: "6px",
  });

  const status = document.createElement("div");
  style(status, { minHeight: "16px", color: "#9fd8b4" });
  const setStatus = (msg: string, ok = true) => {
    status.textContent = msg;
    status.style.color = ok ? "#9fd8b4" : "#f0a58a";
  };

  const exportBtn = panelButton("⬆ Export", "Serialize the current run into the box (and copy to clipboard)");
  const copyBtn = panelButton("⧉ Copy", "Copy the box contents to the clipboard");
  const dlBtn = panelButton("⬇ File", "Download the current save as a .json file");
  const loadBtn = panelButton("▶ Load", "Restore the save in the box and jump into it");
  style(loadBtn, { background: "#3a5", flex: "1" });

  exportBtn.onclick = () => {
    const text = exportText(game);
    if (!text) return setStatus("Nothing to export yet — start a run first.", false);
    area.value = text;
    void navigator.clipboard?.writeText(text).catch(() => {});
    setStatus(`Exported ${text.length} chars (copied to clipboard).`);
  };
  copyBtn.onclick = () => {
    if (!area.value) return setStatus("Box is empty — Export first.", false);
    void navigator.clipboard?.writeText(area.value).catch(() => {});
    setStatus("Copied to clipboard.");
  };
  dlBtn.onclick = () => {
    const text = area.value || exportText(game);
    if (!text) return setStatus("Nothing to download yet.", false);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "campfire-save.json";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Downloaded campfire-save.json.");
  };
  loadBtn.onclick = () => {
    const text = area.value.trim();
    if (!text) return setStatus("Paste a save into the box first.", false);
    try {
      restoreAndBoot(game, text);
      setStatus("Loaded — jumped into the save.");
      panel.style.display = "none";
    } catch (e) {
      setStatus(`Load failed: ${(e as Error).message}`, false);
    }
  };

  const topRow = document.createElement("div");
  style(topRow, { display: "flex", gap: "6px", flexWrap: "wrap" });
  topRow.append(exportBtn, copyBtn, dlBtn);
  const loadRow = document.createElement("div");
  style(loadRow, { display: "flex", gap: "6px" });
  loadRow.append(loadBtn);

  panel.append(title, topRow, area, loadRow, status);

  toggle.onclick = () => {
    panel.style.display = panel.style.display === "none" ? "flex" : "none";
  };
}
