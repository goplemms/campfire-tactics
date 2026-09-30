/**
 * Playtest-log export UI (render layer).
 *
 * The pure core records the lever timeline (`core/playtest-log.ts`); this thin
 * DOM hook lets a playtester hand it back. It parks the live log on `window`,
 * floats a "Session log" button, and on click prints the per-lever engagement
 * summary to the console and downloads `{ capturedAt, summary, log }` as JSON —
 * the artifact a tester sends after a run. No game logic here; export only.
 */
import { summarizePlaytest, type PlaytestLog } from "../core";
import { DEV_BUTTON_STYLE, getDevTray } from "./dev-tray";

const BUTTON_ID = "playtest-log-btn";

interface PlaytestWindow extends Window {
  campfirePlaytest?: {
    log: PlaytestLog;
    summary: () => ReturnType<typeof summarizePlaytest>;
    download: () => void;
  };
}

/** Build the downloadable artifact: a wall-clock stamp + the derived summary + the raw timeline. */
function artifact(log: PlaytestLog) {
  return { capturedAt: new Date().toISOString(), summary: summarizePlaytest(log), log };
}

function download(log: PlaytestLog): void {
  const blob = new Blob([JSON.stringify(artifact(log), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `campfire-playtest-${log.runId}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Attach the export affordance for a live run's log. Idempotent across scene
 * restarts — re-points the same button at the current run. Safe to call with no
 * DOM (headless): it simply no-ops.
 */
export function installPlaytestLogUI(log: PlaytestLog): void {
  if (typeof document === "undefined") return;

  const win = window as PlaytestWindow;
  win.campfirePlaytest = {
    log,
    summary: () => summarizePlaytest(log),
    download: () => download(log),
  };

  let btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.textContent = "⬇ Session log";
    btn.title = "Download this playtest run's logistics telemetry (JSON) and print a lever summary to the console";
    // Mounts inside the collapsible dev tray (with Save/Load), not fixed over the canvas —
    // hidden behind the corner chevron by default so it never occludes the rendered HUD.
    Object.assign(btn.style, DEV_BUTTON_STYLE);
    (getDevTray() ?? document.body).appendChild(btn);
  }

  btn.onclick = () => {
    // Print the headline (did each lever bite?) so a tester can eyeball it live.
    console.log("[campfire playtest] lever summary", summarizePlaytest(log));
    download(log);
  };
}
