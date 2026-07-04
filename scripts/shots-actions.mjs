// Screenshot the overworld ACTION readouts (Recovery / Economy drawers + the Intel/Survey
// drawer) so we can review their info design. Reuses the dossier shot's Chrome contract.
//   node scripts/shots-actions.mjs

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
const OUT_DIR = path.resolve(ROOT, process.env.SHOTS_OUT ?? "screenshots/actions");
const CACHE_DIR = path.resolve(ROOT, ".cache", "chrome");
const PORT = Number(process.env.SHOTS_PORT ?? 5194);

const PLATFORMS = {
  "linux-x64": ["linux64", "chrome-linux64/chrome"],
  "darwin-arm64": ["mac-arm64", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
  "win32-x64": ["win64", "chrome-win64/chrome.exe"],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

const S = `window.game.scene.getScene("OverworldScene")`;
const wrap = (body) => `(()=>{const s=${S};${body}})()`;

// Kit the party out so every action drawer populates: a Scout (Survey), a Cook (Stew),
// a Banker (purse verbs) and a Noble (Patronize) — then wound them so Triage shows too.
const SETUP = wrap(`
  const p = s.run.party;
  if (p[0]) { p[0].jobId = "scout"; p[0].heldJobs = ["scout"]; p[0].jobLevels = { scout: { level: 2, xp: 0 } }; }
  if (p[1]) { p[1].jobId = "cook"; p[1].heldJobs = ["cook"]; }
  if (p[2]) { p[2].jobId = "banker"; p[2].heldJobs = ["banker"]; }
  if (p[3]) { p[3].jobId = "noble"; p[3].heldJobs = ["noble"]; }
  p.forEach((u,i)=>{ u.hp = Math.max(1, Math.floor(u.maxHp*0.5)); u.fatigue = 3+i; });
  s.run.overworld.influence = 10;
`);

const STEPS = [
  // Prep camp with the Recovery + Economy drawers open — the action rows + their cost readouts.
  {
    name: "01-camp-actions",
    minMs: 700,
    eval: `${SETUP};${wrap(`
      s.enterCamp(s.loop.reachable()[0]);
      if (s.overlay) { s.overlay.forEach((o)=>o.destroy && o.destroy()); s.overlay.length = 0; }
      s.campDrawers = { recovery: true, economy: true };
      s.renderCamp();
    `)}`,
  },
  // Hover the Triage row so the EFFECT PREVIEW panel fills in (the off-panel readout).
  {
    name: "02-camp-actions-preview",
    eval: wrap(`
      const prev = window.__cft_triagePreview;
      if (s.previewObjects && prev) s.showActionPreview(prev);
    `),
  },
  // The react camp's Intel drawer — the Survey rows (one per reachable node) + cost readouts.
  {
    name: "03-intel-survey",
    eval: wrap(`
      s.showSurvey();
      s.campDrawers = { intel: true };
      s.showSurvey();
    `),
  },
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
    await page.evaluateOnNewDocument(() => { window.__SHOT__ = true; });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));

    await page.goto(`${url}#overworld`, { waitUntil: "load", timeout: 30000 });
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
  }
  console.log(`\n✓ action frames captured to ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
