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
