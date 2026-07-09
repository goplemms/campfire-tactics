// Screenshot the **Node 2 traveler-gift** beat (D79) end to end, headlessly, driving the
// scene's OWN methods — the real flow, not a synthetic state (cf. shots-discard.mjs, which
// stuffs the stash directly to capture the menu in isolation). Boots the #demo Hollow Mill
// run, positions the caravan at e1 so camp2 is the next node (WITHOUT fighting e1 — its
// battle trips a headless Phaser texture bug and isn't this beat), then: opens the traveler
// event panel → accepts the gifts (trap kits + iron weapons land over the full cap-5 stash)
// → Break Camp surfaces the discard menu from the *genuine* overflow → one drop re-renders.
// Reuses the Chrome contract from the sibling shots scripts (CHROME_BIN to skip the
// download). Run: node scripts/shots-traveler-gift.mjs

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
const OUT_DIR = path.resolve(ROOT, process.env.SHOTS_OUT ?? "screenshots/node2-traveler");
const CACHE_DIR = path.resolve(ROOT, ".cache", "chrome");
const PORT = Number(process.env.SHOTS_PORT ?? 5196);

const PLATFORMS = {
  "linux-x64": ["linux64", "chrome-linux64/chrome"],
  "darwin-arm64": ["mac-arm64", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
  "win32-x64": ["win64", "chrome-win64/chrome.exe"],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

const S = `window.game.scene.getScene("OverworldScene")`;
const wrap = (body) => `(()=>{const s=${S};${body}})()`;

// Position the caravan at e1 so camp2 is the next reachable node, and clear the demo's
// intro card. The bundle is the untouched cap-5 start (salve×2, stimulant×1, antidote×2,
// trap-kit×2 = 5/5 — exactly full), i.e. the real "arrive at Node 2 with a full stash" state.
const AT_CAMP2 = `
  for (const o of s.overlay) o.destroy(); s.overlay = [];
  s.run.mapNodeId = "e1";
  s.run.path = ["start", "e1"];
`;

const STEPS = [
  // The traveler-gift event panel — the unconditional gift (D79), no longer a pick-one.
  { name: "01-traveler-event", minMs: 650, eval: wrap(`${AT_CAMP2}; s.enterCamp(s.run.map.nodes["camp2"]); s.commit();`) },
  // Accept the gifts → trap kits + iron weapons land over the full stash; the outcome overlay.
  { name: "02-gift-accepted", minMs: 500, eval: wrap(`s.onEventChoice(s.loop.eventChoices().find((c) => c.id === "accept-gift"));`) },
  // Break Camp → the GENUINE overflow (slotsOver > 0) forces the discard menu (Trap Kit ×4,
  // Iron Weapons ×1, the medical stacks) — the real state, not a synthetic one.
  { name: "03-discard-menu", minMs: 500, eval: wrap(`s.afterNode(); s.setOutToMap();`) },
  // Drop one trap-kit: its footprint shrinks 4→3, the stash drops to 2 over, the menu re-renders.
  { name: "04-after-one-drop", minMs: 500, eval: wrap(`s.run.inventory.counts["trap-kit"] -= 1; s.refreshReadoutLine(); s.setOutToMap();`) },
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

    await page.goto(`${url}#demo`, { waitUntil: "load", timeout: 30000 });
    const canvas = await page.waitForSelector("canvas", { timeout: 15000 });
    // The demo builds the Hollow Mill run at boot; wait for it (incl. the camp2 node) before driving.
    await page.waitForFunction(`!!${S}?.run?.map?.nodes?.camp2 && !!${S}?.loop`, { timeout: 15000 });

    for (const step of STEPS) {
      if (step.eval) {
        try { await page.evaluate(step.eval); }
        catch (e) { console.error(`\n!! STEP ${step.name} threw:\n${String(e).slice(0, 600)}\n`); throw e; }
      }
      await sleep(step.minMs ?? 350);
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
  console.log(`\n✓ Node 2 traveler-gift frames captured to ${OUT_DIR} with no page errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
