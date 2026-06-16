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
const OUT_DIR = path.resolve(ROOT, process.env.SHOTS_OUT ?? (process.env.BOOT_HASH === "expedition" ? "screenshots/m13/expedition" : "screenshots/m13"));
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
const STEPS = BOOT === "expedition"
  ? [
      { name: "01-intro", minMs: 700, eval: `void 0;` }, // the orientation card over the map
      { name: "02-map-fog", eval: wrap(clearOverlay) }, // dismiss the card → the curated map + fog
      { name: "03-preview", eval: wrap(`s.showPreview(s.loop.reachable()[0]);`) },
      { name: "04-make-camp", eval: wrap(`s.enterCamp(s.loop.reachable().find(n=>n.kind==='combat')||s.loop.reachable()[0]);`) },
      { name: "05-ledger", eval: wrap(`s.showLedgerPanel(()=>{});`) },
      { name: "06-survey", eval: wrap(`${clearOverlay}s.showSurvey();`) },
    ]
  : [
      { name: "01-map-fog", minMs: 700, eval: `void 0;` }, // initial: the map with fog
      { name: "02-make-camp", eval: wrap(`s.enterCamp(s.loop.reachable()[0]);`) },
      { name: "03-ledger", eval: wrap(`s.showLedgerPanel(()=>{});`) },
      { name: "04-ledger-skip-food", eval: wrap(`s.toggleSkip("food",()=>{});`) },
      { name: "04b-ledger-skip-both", eval: wrap(`s.toggleSkip("repairs",()=>{});`) },
      { name: "04c-ledger-restore-food", eval: wrap(`s.toggleSkip("food",()=>{});`) },
      { name: "05-survey", eval: wrap(`${clearOverlay}s.showSurvey();`) },
      { name: "06-after-inplace-rest", eval: wrap(`s.run.party.forEach(u=>{u.hp=Math.max(1,Math.floor(u.maxHp*0.4));});s.doInPlaceRest();`) },
      { name: "07-break-camp-gate", eval: wrap(`s.run.camp.gold=0;s.run.overworld.debt=30;s.breakCampToMap();`) },
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
