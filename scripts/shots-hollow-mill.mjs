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

const OV = `window.game.scene.getScene("OverworldScene")`;
const BS = `window.game.scene.getScene("BattleScene")`;
const ov = (body) => `(()=>{const s=${OV};${body}})()`;
const bs = (body) => `(()=>{const s=${BS};${body}})()`;

// Advance a battle a few turns (resetting the busy/over guards between steps, as the
// #battle harness does) to fill the clock + show the objective gauge mid-fight.
const advance = (n) => bs(`if(s.phase==="deployment")s.onPrimary();for(let i=0;i<${n}&&!s.waitingFor;i++){s.busy=false;s.over=false;s.onAdvance();}`);
// Force a clean win and finish: every enemy down ⇒ the field clears (gate met too).
const forceWin = bs(`for(const u of s.battle.units)if(u.side==="enemy")u.alive=false;s.busy=false;s.over=false;s.waitingFor=null;s.finishBattle();`);
// Navigate the loop from wherever it is to a target combat node (resting at any rest
// node on the way), then hand off to the real BattleScene. Idempotent if already there.
const navTo = (id) => ov(
  `const T=${JSON.stringify(id)};` +
  `while(s.run.mapNodeId!==T){const r=s.loop.reachable();if(r.length===0)break;const n=r[0];s.loop.choose(n.id);if(n.id!==T&&n.kind!=="combat")s.loop.playCurrentNode();}` +
  `s.scene.start("BattleScene",{run:s.run,loop:s.loop});`,
);

const STEPS = [
  { name: "01-intro", minMs: 800 }, // the expedition orientation card over the fogged map
  { name: "02-map-fog", eval: ov(`for(const o of s.overlay)o.destroy();s.overlay=[];`) }, // the hand-built Hollow Mill map
  { name: "03-make-camp", eval: ov(`s.enterCamp(s.loop.reachable()[0]);`) }, // camp, heading to E1
  { name: "04-ledger", eval: ov(`s.showLedgerPanel(()=>{});`) }, // the ledger + forecast over the authored reward

  { name: "05-e1-deploy", minMs: 1100, eval: navTo("e1") }, // E1 — the skirmish deployment board
  { name: "06-e1-battle", minMs: 900, eval: advance(12) }, // a few turns in
  { name: "07-e1-victory", minMs: 900, eval: forceWin }, // resolution overlay — reward + level-up feedback
  { name: "08-after-e1", minMs: 900, eval: bs(`s.returnToOverworld();`) }, // back on the overworld map

  { name: "09-snares-deploy", minMs: 1100, eval: navTo("snares") }, // The Sapper's Snares — the trap-field board
  // Advance to a player turn, then reveal every concealed trap so the ⚠ markers
  // draw for the shot (the Search/Disarm verbs already show in the action row).
  { name: "10-snares-spot", minMs: 1000, eval: bs(`if(s.phase==="deployment")s.onPrimary();for(let i=0;i<8&&!s.waitingFor;i++){s.busy=false;s.over=false;s.onAdvance();}for(const e of s.battle.entities.all())if(e.concealment!==undefined)e.revealed=true;s.redrawTrapMarkers();`) },
  { name: "11-snares-victory", minMs: 900, eval: forceWin },
  { name: "12-after-snares", minMs: 900, eval: bs(`s.returnToOverworld();`) },

  { name: "13-e2-deploy", minMs: 1100, eval: navTo("e2") }, // route past the rest node to E2
  { name: "14-e2-ambush", minMs: 900, eval: advance(10) }, // the hidden ambush bodies lie faded until scouted
  { name: "15-e2-victory", minMs: 900, eval: forceWin },
  { name: "16-after-e2", minMs: 900, eval: bs(`s.returnToOverworld();`) },

  { name: "17-e3-deploy", minMs: 1100, eval: navTo("e3") }, // the final holdout
  { name: "18-e3-gate", minMs: 1100, eval: advance(14) }, // the objective banner: the bridge-cut gauge filling
  { name: "19-e3-victory", minMs: 900, eval: forceWin }, // win = complete (the prize)
  { name: "20-complete", minMs: 900, eval: bs(`s.returnToOverworld();`) }, // the quest-complete terminal
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
      if (step.eval) await page.evaluate(step.eval);
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
