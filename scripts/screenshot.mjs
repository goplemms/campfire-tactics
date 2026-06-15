// Screenshot the live game in a real (headless) browser.
//
// Our tests cover the pure `core/` logic, and `vite build` proves it compiles —
// but neither renders a single pixel. Phaser draws to a <canvas> via WebGL, so
// the only way to actually *see* a UI change (panel layout, range previews, HP
// bars…) is to boot the app in a browser and capture frames. This script does
// exactly that, end to end:
//
//   1. ensure a Chrome binary  (downloaded + cached on first run)
//   2. start the Vite dev server (in-process)
//   3. drive the demo with the keyboard and screenshot the canvas
//
// Run it with:  npm run shots
//
// Why a *pinned, hand-downloaded* Chrome instead of `npx playwright install`
// or full `puppeteer`? In the web/CI sandbox the usual browser-download CDNs
// are blocked by the network policy, but Google's chrome-for-testing object
// host (storage.googleapis.com) is reachable for direct downloads. So we pin a
// version and fetch the zip straight from there. On a machine where that host
// is blocked (or you'd rather use a browser you already have), set CHROME_BIN
// to any Chrome/Chromium executable and the download is skipped entirely.
//
// Env overrides:
//   CHROME_BIN   path to an existing Chrome/Chromium  (skips the download)
//   CFT_VERSION  chrome-for-testing version to pin     (default below)
//   CFT_HOST     download host                         (default below)
//   SHOTS_OUT    output directory                      (default ./screenshots)
//   SHOTS_PORT   dev-server port                       (default 5188)

import { createServer } from "vite";
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, access, chmod } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CFT_VERSION = process.env.CFT_VERSION ?? "131.0.6778.204";
const CFT_HOST = process.env.CFT_HOST ?? "https://storage.googleapis.com/chrome-for-testing-public";
const OUT_DIR = path.resolve(ROOT, process.env.SHOTS_OUT ?? "screenshots");
const CACHE_DIR = path.resolve(ROOT, ".cache", "chrome");
const PORT = Number(process.env.SHOTS_PORT ?? 5188);

// A "standard route" walk of the whole demo — one capture per screen the game can
// show, so a glance at the sheet flags any regression (panel sizing, board layout,
// overlays, hint wiring). Each step optionally presses keys, runs an `eval`, parks
// the cursor, waits for the animation-idle gate, then screenshots the canvas.
//
// Two ways to drive it:
//   • keys      — the real playtester controls (Space = advance/primary, 1–9 =
//                 abilities). Preferred: it exercises the genuine input path.
//   • eval      — a function run in the page to reach screens the keyboard can't.
//                 The mid-quest beats (rest choice, encounters 2–3, the end) sit
//                 behind combat that can't be scripted by clicks, so we jump there
//                 via the runner's `beatIndex` and let the scene render the beat
//                 with its own methods — the same code the live game runs.
//
// `minMs` floors the wait before the idle gate (waitForSettled) takes over and
// makes the frame deterministic. `hoverCanvas` parks the cursor (800×600 canvas
// coords) to exercise a hover state; otherwise it's parked off-board so no stray
// hover leaks in.
const STEPS = [
  // --- Beat 1: Provision, then Encounter 1 (real keyboard play) --------------
  { name: "01-provision", minMs: 800 },                        // initial load — Provision screen (hint card collapsed, top-right)
  { name: "01b-hint-peek", hoverCanvas: { x: 693, y: 248 }, minMs: 300 }, // hover a herb button → tip peeks the card open
  { name: "01c-hint-pinned", minMs: 300, eval: togglePin() }, // click-pin → card stays open (resting tip + keys)
  { name: "02-encounter1-open", keys: ["Space"], minMs: 400, eval: togglePin() }, // unpin, then March Out → deployment
  { name: "02a-deploy-gamble", minMs: 600, eval: spotDeploy(6) }, // push Edrin deep + spotted → he bolts for cover (capture rolls)
  { name: "02b-encounter1-hover", hoverCanvas: { x: 536, y: 309 }, minMs: 300 }, // hover the isolated Bandit Cutthroat
  { name: "03-advance-1", keys: ["Space"], minMs: 300 },       // advance the clock; a player turn
  { name: "04-kit-panel", keys: ["Space"], minMs: 300 },       // opens the right-hand kit panel
  { name: "05-advance-3", keys: ["Space"], minMs: 300 },
  { name: "06-advance-4", keys: ["Space"], minMs: 300 },
  // --- Beat 3: Rest + the deserter choice ------------------------------------
  { name: "07-rest-choice", minMs: 300, eval: gotoBeat(2) },   // jump to the rest beat → choice box
  { name: "07b-rest-hover", hoverCanvas: { x: 713, y: 264 }, minMs: 300 }, // hover Spare → tradeoff in the hint bar
  // --- Beats 4–5: the later encounters ---------------------------------------
  { name: "08-encounter2", minMs: 300, eval: stageEncounter(3, true) }, // Ambush (spare path reveals it)
  { name: "09-encounter3", minMs: 300, eval: stageEncounter(4, false) }, // the Captain's Holdout (bridge-cut)
  // --- Terminal: a full auto-played run, then the end screen ------------------
  { name: "10-end", minMs: 300, eval: autoPlayToEnd() },
  // --- The guild hall (boots on the base URL, no #demo) -----------------------
  { name: "11-guild", goto: "", minMs: 500 },                  // hall: card pinned open (feedback visible)
  { name: "11b-guild-collapsed", minMs: 600, eval: togglePin("GuildScene") }, // unpin → collapses to a bottom-right chip
  // --- The real mission scene (#battle: a headless boot into a deterministic run) ---
  { name: "12-battle-deploy", goto: "battle", minMs: 900 },    // genuine BattleScene: the deployment board
  { name: "13-battle-start", minMs: 500, eval: battleStart() }, // Start Battle → the battle phase
  { name: "14-battle-preview", minMs: 700, eval: battleToPlayerTurn() }, // advance to a player turn → move/attack preview
];

// Each helper returns a *plain function* puppeteer serializes and runs in the page
// (so it can't close over anything here). They call the DemoScene's own render
// methods, keeping every captured frame faithful to what the live game draws.

/** Toggle a scene's hint-card pinned-open state (DemoScene unless named). */
function togglePin(scene = "DemoScene") {
  return new Function(`window.game.scene.getScene(${JSON.stringify(scene)}).hintPanel.togglePin();`);
}
/** Push the current deploy unit deep, max the alert, and trigger a spot → the unit
 *  bolts for cover rolling capture per tile (seeded, so the outcome is reproducible). */
function spotDeploy(col) {
  return new Function(
    `const s=window.game.scene.getScene("DemoScene");const u=s.deployActor;` +
      `if(u){u.pos={col:${col},row:u.pos.row};s.placeView(u);s.deployAlert.meter=100;s.resolveDeploy(u);}`,
  );
}
/** Jump to beat `i` and let the scene dispatch it (provision / rest). */
function gotoBeat(i) {
  return new Function(`const s=window.game.scene.getScene("DemoScene");s.runner.outcome=undefined;s.runner.beatIndex=${i};s.nextBeat();`);
}
/** Stage encounter beat `i` and draw its opening board; `reveal` un-hides the ambush.
 *  Clears any leftover command panel — a fresh board shows none until a player's turn
 *  (in live play the prior beat's panel is torn down on the click that advanced it). */
function stageEncounter(i, reveal) {
  return new Function(`const s=window.game.scene.getScene("DemoScene");const r=s.runner;r.outcome=undefined;r.beatIndex=${i};r.ambushRevealed=${reveal};s.startEncounter();s.clearButtons();`);
}
/** Leave deployment and enter the battle phase (the real BattleScene). */
function battleStart() {
  return new Function(`const s=window.game.scene.getScene("BattleScene"); if(s.phase==="deployment") s.onPrimary();`);
}
/** Start the battle and advance the clock until a player unit's turn so the
 *  move/attack preview is painted (forcing past any enemy turn's busy gate). */
function battleToPlayerTurn() {
  return new Function(
    `const s=window.game.scene.getScene("BattleScene");` +
      `if(s.phase==="deployment") s.onPrimary();` +
      `for(let i=0;i<16 && !s.waitingFor;i++){ s.busy=false; s.over=false; s.onAdvance(); }`,
  );
}
/** Reset to a pristine party, auto-play the whole quest, then show the end screen. */
function autoPlayToEnd() {
  return new Function(
    `const s=window.game.scene.getScene("DemoScene");const r=s.runner;` +
      `r.beatIndex=0;r.outcome=undefined;r.log.length=0;r.ambushRevealed=false;r.gold=0;` +
      `r.party.forEach(u=>{u.hp=u.maxHp;u.alive=true;});r.autoPlay("spare");s.nextBeat();`,
  );
}

// chrome-for-testing packages per platform: [zip subpath, binary subpath].
const PLATFORMS = {
  "linux-x64": ["linux64", "chrome-linux64/chrome"],
  "darwin-arm64": ["mac-arm64", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
  "darwin-x64": ["mac-x64", "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
  "win32-x64": ["win64", "chrome-win64/chrome.exe"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

/**
 * Wait for the demo to reach an animation-idle state so frames are deterministic
 * (no tween caught mid-flight). Floors at `minMs` to let the keypress kick off
 * whatever it triggers, then polls DemoScene.isSettled() until true or timeout.
 */
async function waitForSettled(page, minMs = 250, timeoutMs = 8000) {
  await sleep(minMs);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const settled = await page.evaluate(() => {
      const scene = window.game?.scene?.getScene?.("DemoScene");
      if (!scene || typeof scene.isSettled !== "function") return true;
      try { return scene.isSettled(); } catch { return true; } // inactive scene (e.g. on the Guild page)
    });
    if (settled) return;
    await sleep(80);
  }
}

/** Resolve a usable Chrome binary, downloading + caching it on first run. */
async function ensureChrome() {
  if (process.env.CHROME_BIN) {
    console.log(`• using CHROME_BIN=${process.env.CHROME_BIN}`);
    return process.env.CHROME_BIN;
  }
  const key = `${process.platform}-${process.arch}`;
  const plat = PLATFORMS[key];
  if (!plat) throw new Error(`No pinned Chrome mapping for ${key}; set CHROME_BIN to an existing browser.`);
  const [zipDir, binSub] = plat;
  const versionDir = path.join(CACHE_DIR, CFT_VERSION);
  const binary = path.join(versionDir, binSub);
  if (await exists(binary)) {
    console.log(`• Chrome ${CFT_VERSION} (cached)`);
    return binary;
  }
  const url = `${CFT_HOST}/${CFT_VERSION}/${zipDir}/chrome-${zipDir}.zip`;
  console.log(`• downloading Chrome ${CFT_VERSION} from ${url}`);
  await mkdir(versionDir, { recursive: true });
  const zipPath = path.join(versionDir, "chrome.zip");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} — host may be blocked; set CHROME_BIN instead.`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));
  // No zip support in node core; shell out to `unzip` (present on Linux/macOS).
  try {
    execFileSync("unzip", ["-q", "-o", zipPath, "-d", versionDir], { stdio: "inherit" });
  } catch {
    throw new Error("`unzip` is required to extract Chrome but was not found on PATH.");
  }
  await rm(zipPath, { force: true });
  await chmod(binary, 0o755).catch(() => {});
  console.log(`• Chrome ready at ${binary}`);
  return binary;
}

async function main() {
  const chromeBin = await ensureChrome();
  await mkdir(OUT_DIR, { recursive: true });

  // In-process dev server — no port-guessing, clean shutdown. (vite.config.ts
  // also carries the vitest block; vite simply ignores the `test` key.)
  const server = await createServer({
    root: ROOT,
    server: { port: PORT, host: "127.0.0.1" },
    logLevel: "warn",
    clearScreen: false,
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${PORT}/`;
  console.log(`• dev server: ${url}`);

  const browser = await puppeteer.launch({
    executablePath: chromeBin,
    headless: true,
    protocolTimeout: 60000,
    args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--window-size=820,680"],
  });

  const captured = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 820, height: 680 });
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));

    // Tell the scene we're capturing, so it freezes perpetual motion (the
    // chevron bob) — set before any page script runs.
    await page.evaluateOnNewDocument(() => { window.__SHOT__ = true; });
    // "load" (not networkidle0): Vite's HMR WebSocket holds the connection open,
    // so the page can never reach network-idle — the same reason the re-navigations
    // below use "load". Readiness/determinism comes from the canvas-selector wait
    // plus the per-step waitForSettled gate, not from network quiescence.
    await page.goto(`${url}#demo`, { waitUntil: "load", timeout: 30000 });
    let canvas = await page.waitForSelector("canvas", { timeout: 15000 });

    for (const step of STEPS) {
      // A `goto` re-navigates to another scene (e.g. "" boots the Guild hall on the
      // base URL); the canvas element is recreated, so re-acquire it.
      if (step.goto !== undefined) {
        // "load" (not networkidle0) — the dev server's HMR socket keeps the page
        // from ever going network-idle on a re-navigation. The settle gate below
        // still makes the frame deterministic.
        await page.goto(step.goto ? `${url}#${step.goto}` : url, { waitUntil: "load", timeout: 30000 });
        // A hash-only change (e.g. → #battle) is a same-document navigation, so the
        // page wouldn't reload and config.ts wouldn't re-read the hash. Force it.
        if (step.goto) await page.reload({ waitUntil: "load", timeout: 30000 });
        canvas = await page.waitForSelector("canvas", { timeout: 15000 });
      }
      if (step.eval) await page.evaluate(step.eval);
      for (const key of step.keys ?? []) await page.keyboard.press(key);
      // Position the cursor (canvas coords → page coords via the canvas box).
      const box = await canvas.boundingBox();
      const h = step.hoverCanvas;
      if (h) await page.mouse.move(box.x + (h.x * box.width) / 800, box.y + (h.y * box.height) / 600);
      else await page.mouse.move(box.x + 2, box.y + 2); // parked off the board
      await waitForSettled(page, step.minMs ?? 250);
      const file = path.join(OUT_DIR, `${step.name}.png`);
      // Clip to the canvas so every shot is exactly the 800×600 game, free of
      // the surrounding page chrome.
      await canvas.screenshot({ path: file });
      captured.push(file);
      console.log(`  ✓ ${path.relative(ROOT, file)}`);
    }

    // Phaser/runtime errors won't fail the build, so surface them loudly here —
    // ignore the harmless favicon 404 that the demo page always emits.
    const real = problems.filter((p) => !/favicon|404/.test(p));
    if (real.length) console.warn(`\n⚠ ${real.length} browser error(s):\n  ${real.slice(0, 8).join("\n  ")}`);
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`\n${captured.length} screenshot(s) in ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
