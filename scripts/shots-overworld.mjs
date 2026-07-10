// Screenshot the M13 overworld economic layer in a real (headless) browser.
//
// The pure `core/` logic is unit-tested and `vite build` proves it compiles, but
// neither renders a pixel of the OverworldScene. This boots `#overworld` (a debug
// boot that drops a real run at its start node) and drives the M13 surfaces via the
// scene's own render methods — the same code the live game runs — capturing a frame
// of each and failing loudly on any page error. Run with:  node scripts/shots-overworld.mjs
//
// Reuses screenshot.mjs's Chrome-fetch contract: set CHROME_BIN to skip the
// download, or let it pin + fetch chrome-for-testing from storage.googleapis.com.

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
const OUT_DIR = path.resolve(ROOT, process.env.SHOTS_OUT ?? `screenshots/m13/${process.env.BOOT_HASH ?? "overworld"}`);
const CACHE_DIR = path.resolve(ROOT, ".cache", "chrome");
const PORT = Number(process.env.SHOTS_PORT ?? 5191);

const PLATFORMS = {
  "linux-x64": ["linux64", "chrome-linux64/chrome"],
  "darwin-arm64": ["mac-arm64", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
  "win32-x64": ["win64", "chrome-win64/chrome.exe"],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

// Each step runs a plain function in the page against the live OverworldScene.
const S = `window.game.scene.getScene("OverworldScene")`;
const BOOT = process.env.BOOT_HASH ?? "overworld";
const wrap = (body) => `(()=>{const s=${S};${body}})()`;
const clearOverlay = `for(const o of s.overlay)o.destroy();s.overlay=[];`;
const BS = `window.game.scene.getScene("BattleScene")`;
const STEPS = BOOT === "battle"
  ? [
      { name: "01-deploy", minMs: 900, eval: `void 0;` }, // the enlarged deployment board
      { name: "02-battle", minMs: 700, eval: `(()=>{const s=${BS};if(s.phase==="deployment")s.onPrimary();for(let i=0;i<16&&!s.waitingFor;i++){s.busy=false;s.over=false;s.onAdvance();}})()` },
      // The Noble's BRIBE by standing (D62): field the real Noble from the roster (the
      // job-gate that backs the offer), give the run some Influence and render the action
      // row → the Bribe button shows the broking Noble + its live cost + success chance.
      { name: "03-bribe-by-standing", minMs: 500, eval: `(()=>{const s=${BS};const n=(s.guild?s.guild.roster:[]).find(u=>u.jobId==='noble');if(n&&!s.run.party.includes(n))s.run.party.push(n);s.run.overworld.influence=16;s.busy=false;if(s.waitingFor)s.showSkillButtons(s.waitingFor);})()` },
    ]
  : BOOT === "expedition"
  ? [
      { name: "01-intro", minMs: 700, eval: `void 0;` }, // the orientation card over the map
      { name: "02-map-fog", eval: wrap(clearOverlay) }, // dismiss the card → the curated map + fog
      { name: "03-preview", eval: wrap(`s.showPreview(s.loop.reachable()[0]);`) },
      { name: "04-make-camp", eval: wrap(`s.enterCamp(s.loop.reachable().find(n=>n.kind==='combat')||s.loop.reachable()[0]);`) },
      { name: "05-ledger", eval: wrap(`s.openTent(()=>s.renderCamp(),"ledger");`) },
      { name: "06-survey", eval: wrap(`${clearOverlay}s.showReactCamp();`) },
    ]
  : [
      { name: "01-map-fog", minMs: 700, eval: `void 0;` }, // initial: the map with fog
      { name: "02-make-camp", eval: wrap(`s.enterCamp(s.loop.reachable()[0]);`) },
      // The gated Market overlay (D61): buy trap kits + herbs in bulk (the +/− stepper),
      // sell salvage. Bump the trap-kit quantity so the bulk control shows.
      { name: "02b-market", eval: wrap(`s.openMarket(()=>s.renderCamp());s.marketQty['trap-kit']=3;s.renderMarket();`) },
      { name: "03-ledger", eval: wrap(`s.openTent(()=>s.renderCamp(),"ledger");`) },
      { name: "04-ledger-skip-food", eval: wrap(`s.toggleSkip("food",()=>{});`) },
      { name: "04b-ledger-skip-both", eval: wrap(`s.toggleSkip("repairs",()=>{});`) },
      { name: "04c-ledger-restore-food", eval: wrap(`s.toggleSkip("food",()=>{});`) },
      { name: "05-survey", eval: wrap(`${clearOverlay}s.showReactCamp();`) },
      { name: "06-after-inplace-rest", eval: wrap(`s.run.party.forEach(u=>{u.hp=Math.max(1,Math.floor(u.maxHp*0.4));});s.doInPlaceRest();`) },
      // The economy classes (D62/D30): field the real Noble + Banker from the roster (the
      // job-gate that replaced the old Int>=3 proxy), give some standing + gold, and expand
      // the Advanced panel → its verbs, each tagged with the specialist who works them.
      // enterCamp may raise an early-road event over the (not-yet-drawn) camp; in real play the
      // player dismisses it before the camp renders. The shot force-renders the camp to show the
      // Economy drawer, so clear that transient overlay first — otherwise the event modal and the
      // camp stack (a capture-only artifact, not a live overlap).
      { name: "06d-influence-patronize", eval: wrap(`s.enterCamp(s.loop.reachable()[0]);for(const jid of ['noble','banker']){const m=(s.guild?s.guild.roster:[]).find(u=>u.jobId===jid);if(m&&!s.run.party.includes(m))s.run.party.push(m);}s.run.camp.gold=120;s.run.overworld.influence=16;${clearOverlay}s.renderCamp();`) },
      { name: "07-break-camp-gate", eval: wrap(`s.run.camp.gold=0;s.run.overworld.debt=30;s.setOutToMap();`) },
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
    // Stable captures: still motion/animation before any page script runs (the
    // scenes read window.__SHOT__ at boot via isScreenshotMode()).
    await page.evaluateOnNewDocument(() => { window.__SHOT__ = true; });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));

    await page.goto(`${url}#${BOOT}`, { waitUntil: "load", timeout: 30000 });
    const canvas = await page.waitForSelector("canvas", { timeout: 15000 });

    for (const step of STEPS) {
      if (step.eval) await page.evaluate(step.eval);
      await sleep(step.minMs ?? 350);
      const out = path.join(OUT_DIR, `${step.name}.png`);
      await canvas.screenshot({ path: out });
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
  console.log(`\n✓ overworld M13 frames captured to ${OUT_DIR} with no page errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
