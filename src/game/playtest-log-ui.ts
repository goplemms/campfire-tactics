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
    Object.assign(btn.style, {
      position: "fixed",
      right: "12px",
      bottom: "12px",
      zIndex: "9999",
      padding: "6px 12px",
      background: "#2f6b46",
      color: "#eafff0",
      border: "1px solid #57b07a",
      borderRadius: "4px",
      font: "12px monospace",
      cursor: "pointer",
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(btn);
  }

  btn.onclick = () => {
    // Print the headline (did each lever bite?) so a tester can eyeball it live.
    console.log("[campfire playtest] lever summary", summarizePlaytest(log));
    download(log);
  };
}
