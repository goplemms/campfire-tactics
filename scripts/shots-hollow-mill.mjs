// Walk **The Hollow Mill** (#demo) end to end in a real (headless) browser and
// screenshot each beat: the overworld camp/ledger, then each authored fight
// (deploy → battle → resolution) including E2's hidden ambush and E3's closing-gate
// banner + the 3-way terminal. Drives the scenes' own methods — the same code the
// live game runs. Run with:  node scripts/shots-hollow-mill.mjs
//
// Reuses the Chrome-fetch contract: set CHROME_BIN to skip the download, or let it
// pin + fetch chrome-for-testing from storage.googleapis.com.

import { createServer } from "vite";
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, access, chmod } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ov, bs, navTo } from "./harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CFT_VERSION = process.env.CFT_VERSION ?? "131.0.6778.204";
const CFT_HOST = process.env.CFT_HOST ?? "https://storage.googleapis.com/chrome-for-testing-public";
const OUT_DIR = path.resolve(ROOT, process.env.SHOTS_OUT ?? "screenshots/m14/hollow-mill");
const CACHE_DIR = path.resolve(ROOT, ".cache", "chrome");
const PORT = Number(process.env.SHOTS_PORT ?? 5193);

const PLATFORMS = {
  "linux-x64": ["linux64", "chrome-linux64/chrome"],
  "darwin-arm64": ["mac-arm64", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
  "win32-x64": ["win64", "chrome-win64/chrome.exe"],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

// `ov`, `bs` (scene-eval string builders) and `navTo` (the run-loop navigator) are
// shared with the harness/e2e — imported from ./harness.mjs (single source of truth).

// Advance a battle a few turns (clearing the busy *animation* lock so the clock keeps
// moving) to fill the clock + show the objective gauge mid-fight. Stop the moment a player
// turn opens (`waitingFor`) or the fight decides (`over`) — do NOT clear `over`, since that
// would defeat `finishBattle`'s re-entry guard and double-call `resolve()` on a torn-down battle.
const advance = (n) => bs(`if(s.phase==="deployment")s.onPrimary();for(let i=0;i<${n}&&!s.waitingFor&&!s.over;i++){s.busy=false;s.onAdvance();}`);
// Force a clean win and finish: every enemy down ⇒ the field clears (gate met too).
const forceWin = bs(`if(s.over||!s.battle)return;for(const u of s.battle.units)if(u.side==="enemy")u.alive=false;s.busy=false;s.waitingFor=null;s.finishBattle();`);

const STEPS = [
  { name: "01-intro", minMs: 800 }, // the expedition orientation card over the fogged map
  { name: "02-map-fog", eval: ov(`for(const o of s.overlay)o.destroy();s.overlay=[];`) }, // the hand-built Hollow Mill map
  // The pinned intel card on the snares node (D83), in its real MAP context: the
  // Hazards lane ("5 snares" at the party's tier-2 floor) + the rumors info box
  // (two lines revealed, the third a locked ???). Inspect on the map (not camp), so
  // the card docks over empty ground rather than colliding with camp action buttons.
  { name: "02b-snares-intel", minMs: 500, eval: ov(`s.showPreview(s.run.map.nodes["snares"]);`) },
  // The fully-scouted card (D85): a Survey bump to tier 3 fills every lane — HAZARDS
  // "5 snares · 1 marked", exact reward, all rumors — and the "✓ No new intel to find"
  // terminal appears (stop spending scout resources). No phantom Type lane (authored).
  { name: "02c-snares-scouted", minMs: 500, eval: ov(`s.run.overworld.scouted["snares"]=1;s.showPreview(s.run.map.nodes["snares"]);`) },
  { name: "03-make-camp", eval: ov(`s.enterCamp(s.loop.reachable()[0]);`) }, // camp, heading to E1
  { name: "04-ledger", eval: ov(`s.openTent(()=>s.renderCamp(),"ledger");`) }, // the Captain's Tent ledger + forecast over the authored reward

  { name: "05-e1-deploy", minMs: 1100, eval: navTo("e1") }, // E1 — the skirmish deployment board
  { name: "06-e1-battle", minMs: 900, eval: advance(12) }, // a few turns in
  { name: "07-e1-victory", minMs: 900, eval: forceWin }, // resolution overlay — reward + level-up feedback
  { name: "08-after-e1", minMs: 900, eval: bs(`s.returnToOverworld();`) }, // back on the overworld map

  { name: "09-snares-deploy", minMs: 1100, eval: navTo("snares") }, // The Sapper's Snares — the trap-field board
  // Reveal every concealed trap on the deploy board so the ⚠ markers draw for the shot
  // (the strong-snare/weak-enemy set-piece reads in the pre-combat setup, not mid-fight).
  { name: "10-snares-spot", minMs: 1000, eval: bs(`for(const e of s.battle.entities.all())if(e.concealment!==undefined)e.revealed=true;s.redrawTrapMarkers();`) },
  { name: "11-snares-victory", minMs: 900, eval: forceWin },
  { name: "12-after-snares", minMs: 900, eval: bs(`s.returnToOverworld();`) },

  // The Layer-4 FORK → the hard road (4B Prison Wagon, frees the Medic). The mid-fight
  // `advance` frames are skipped: the auto-advance render path trips a Phaser texture
  // bug in the headless harness (a screenshot-tooling rough edge, not a slice bug — see
  // the redesign report), so the demo captures the deploy board + the victory/recruit.
  { name: "13-wagon-deploy", minMs: 1100, eval: navTo("wagon4b") },
  { name: "14-wagon-victory", minMs: 900, eval: forceWin }, // win frees Sela the Medic
  { name: "15-after-wagon", minMs: 900, eval: bs(`s.returnToOverworld();`) },

  // The Layer-6 offshoot — the Thieves' Den (relic reward).
  { name: "16-den-deploy", minMs: 1100, eval: navTo("den") },
  { name: "17-den-victory", minMs: 900, eval: forceWin },
  { name: "18-after-den", minMs: 900, eval: bs(`s.returnToOverworld();`) },

  // The stub finale (run-complete terminal).
  { name: "19-finale-deploy", minMs: 1100, eval: navTo("finale") },
  { name: "20-finale-victory", minMs: 900, eval: forceWin },
  { name: "21-complete", minMs: 900, eval: bs(`s.returnToOverworld();`) },
];

async function ensureChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const key = `${process.platform}-${process.arch}`;
  const plat = PLATFORMS[key];
  if (!plat) throw new Error(`No pinned Chrome for ${key}; set CHROME_BIN.`);
  const [zipDir, binSub] = plat;
  const versionDir = path.join(CACHE_DIR, CFT_VERSION);
  const binary = path.join(versionDir, binSub);
  if (await exists(binary)) return binary;
  const url = `${CFT_HOST}/${CFT_VERSION}/${zipDir}/chrome-${zipDir}.zip`;
  console.log(`• downloading Chrome ${CFT_VERSION}`);
  await mkdir(versionDir, { recursive: true });
  const zipPath = path.join(versionDir, "chrome.zip");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}; set CHROME_BIN.`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", versionDir], { stdio: "inherit" });
  await rm(zipPath, { force: true });
  await chmod(binary, 0o755).catch(() => {});
  return binary;
}

async function main() {
  const chromeBin = await ensureChrome();
  await mkdir(OUT_DIR, { recursive: true });
  const server = await createServer({ root: ROOT, server: { port: PORT, host: "127.0.0.1" }, logLevel: "warn", clearScreen: false });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${PORT}/`;
  console.log(`• dev server: ${url}`);

  const browser = await puppeteer.launch({
    executablePath: chromeBin,
    headless: true,
    protocolTimeout: 60000,
    args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--window-size=820,680"],
  });

  const problems = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 820, height: 680 });
    // Stable captures: tell the game to still motion/animation before any of its
    // scripts run (the scenes read window.__SHOT__ at boot via isScreenshotMode()).
    await page.evaluateOnNewDocument(() => { window.__SHOT__ = true; });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));

    await page.goto(`${url}#demo`, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("canvas", { timeout: 15000 });

    for (const step of STEPS) {
      if (step.eval) {
        try { await page.evaluate(step.eval); }
        catch (e) { console.error(`\n!! STEP ${step.name} threw:\n${String(e).slice(0, 600)}\n`); throw e; }
      }
      await sleep(step.minMs ?? 350);
      // Re-grab the canvas each step — a scene transition replaces nothing, but be safe.
      const canvas = await page.waitForSelector("canvas", { timeout: 15000 });
      await canvas.screenshot({ path: path.join(OUT_DIR, `${step.name}.png`) });
      console.log(`• ${step.name}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }

  if (problems.length) {
    console.error(`\n✗ ${problems.length} page problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\n✓ Hollow Mill walkthrough captured to ${OUT_DIR} with no page errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
