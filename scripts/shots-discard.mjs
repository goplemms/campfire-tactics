// Screenshot the storage-overflow discard menu (D75) headlessly.
// Boots #overworld, enters camp, over-stuffs the stash past its cap (the state a
// grant leaves behind), and opens the discard menu via setOutToMap. A second
// frame shows the menu re-rendered after one drop (a footprint shrinks). Reuses
// the Chrome contract from the sibling shots scripts (CHROME_BIN to skip the
// download). Run: node scripts/shots-discard.mjs

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
const OUT_DIR = path.resolve(ROOT, process.env.SHOTS_OUT ?? "screenshots/discard");
const CACHE_DIR = path.resolve(ROOT, ".cache", "chrome");
const PORT = Number(process.env.SHOTS_PORT ?? 5195);

const PLATFORMS = {
  "linux-x64": ["linux64", "chrome-linux64/chrome"],
  "darwin-arm64": ["mac-arm64", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
  "win32-x64": ["win64", "chrome-win64/chrome.exe"],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

const S = `window.game.scene.getScene("OverworldScene")`;
const wrap = (body) => `(()=>{const s=${S};${body}})()`;

// Over-stuff the stash: cap 4, 6 slots carried (2 over). trap-kit×2 (2 slots),
// a half-stack of wild-herbs (cheapest, 1 slot), salve×3 (1 slot), valuables×1
// (1 slot), and the relic (highest value — the trim protects it). This is the
// state a grant leaves: loot landed over the cap, now you choose what to let go.
const OVERFLOW = `
  s.run.inventory.storageCap = 4;
  s.run.inventory.counts = { "trap-kit": 2, "wild-herbs": 5, salve: 3, valuables: 1, "relic-hollow-blade": 1 };
`;

const STEPS = [
  { name: "01-enter-camp", minMs: 700, eval: wrap(`s.enterCamp(s.loop.reachable()[0]);`) },
  { name: "02-overflow-menu", minMs: 450, eval: wrap(`${OVERFLOW}; s.setOutToMap();`) },
  // Drop one trap-kit: its footprint shrinks 2→1, the stash drops to 1 over, the
  // menu re-renders (the same path the row's click handler drives).
  { name: "03-after-one-drop", minMs: 450, eval: wrap(`s.run.inventory.counts["trap-kit"] = 1; s.setOutToMap();`) },
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
    process.exit(1);
  }
  console.log(`\n✓ discard frames captured to ${OUT_DIR} with no page errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
