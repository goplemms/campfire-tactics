// Showcase the D63 "closing-net" deployment paradigm in a real (headless) browser:
// the advancing enemy danger front, the amber telegraph on the next column to fall,
// the Dig In stance, and the alarm-raising capture. Drives the BattleScene's own
// methods — the same code the live game runs. Run with:  node scripts/shots-deploy.mjs
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
const OUT_DIR = path.resolve(ROOT, process.env.SHOTS_OUT ?? "screenshots/deploy-net");
const CACHE_DIR = path.resolve(ROOT, ".cache", "chrome");
const PORT = Number(process.env.SHOTS_PORT ?? 5194);

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

// Navigate the loop to a target combat node, then hand off to the real BattleScene.
const navTo = (id) => ov(
  `const T=${JSON.stringify(id)};` +
  `while(s.run.mapNodeId!==T){const r=s.loop.reachable();if(r.length===0)break;const n=r[0];s.loop.choose(n.id);if(n.id!==T&&n.kind!=="combat")s.loop.playCurrentNode();}` +
  `s.scene.start("BattleScene",{run:s.run,loop:s.loop});`,
);

// Push the front to a target column and re-read the board for the active unit.
const pushFront = (col) => bs(
  `s.front.col=${col};` +
  `const u=s.deployActor??s.battle.units.find(x=>x.side==="player"&&!x.captured&&!x.hidden);` +
  `s.selectDeployActor(u);`,
);

const STEPS = [
  // 1) Fresh deploy: the green safe band near home, the front parked off the enemy
  //    edge, the first unit's turn with the Dig In / trap / Start Battle controls.
  { name: "01-deploy-start", minMs: 1200, eval: navTo("e1") },

  // 2) The net closing: the front has marched into mid-board — a red danger zone with
  //    an amber telegraph on the next column to fall, the green safe band squeezed.
  { name: "02-net-closing", minMs: 700, eval: pushFront("Math.max(3, Math.ceil(s.grid.cols/2)+1)") },

  // 3) Dig In, caught in the net: a unit hunkered on a danger tile, its title reading
  //    the live "IN THE NET (xx% if it closes)" capture odds.
  {
    name: "03-dig-in",
    minMs: 700,
    eval: bs(
      `const u=s.battle.units.find(x=>x.side==="player"&&!x.captured&&!x.hidden);` +
      `u.pos={col:s.front.col,row:1};s.placeView(u);s.dugIn.add(u.id);s.selectDeployActor(u);`,
    ),
  },

  // 4) The alarm: a unit snared as the net closes — netted (cage), greyed, bound where
  //    it stood inside the enemy zone, the alarm hint up. Battle begins next.
  {
    name: "04-alarm-capture",
    minMs: 700,
    eval: bs(
      `const players=s.battle.units.filter(x=>x.side==="player"&&!x.captured&&!x.hidden);` +
      `s.front.col=Math.max(3,Math.ceil(s.grid.cols/2));` +
      `const v=players.find(p=>p.pos.row===2)??players[0];v.pos={col:s.front.col+1,row:2};` +
      `v.captured=true;v.ct=0;s.placeView(v);s.tintCaptured(v,true);s.dropNet(v);` +
      `s.deployActor=null;s.drawDangerZone();s.drawSafeZone(null);s.highlightTile(null);s.clearActionButtons();` +
      `s.titleText.setText("Deployment — "+v.name+" SNARED — alarm raised · front col "+s.front.col);` +
      `s.setHint(v.name+" was snared as the net closed — the alarm goes up! Battle begins.");`,
    ),
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

    await page.goto(`${url}#demo`, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("canvas", { timeout: 15000 });

    for (const step of STEPS) {
      if (step.eval) await page.evaluate(step.eval);
      await sleep(step.minMs ?? 350);
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
  console.log(`\n✓ Closing-net deployment captured to ${OUT_DIR} with no page errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
