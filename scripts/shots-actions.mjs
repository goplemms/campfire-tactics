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
  const setJob = (u, job, lvl) => { if (!u) return; u.primaryJob = job; u.jobId = job; u.heldJobs = [job]; if (lvl) u.jobLevels = { [job]: { level: lvl, xp: 0 } }; };
  setJob(p[0], "scout", 2); // Survey (Intel drawer)
  setJob(p[1], "cook");     // Cook Stew / Feast
  setJob(p[2], "banker");   // Economy: Invest / Borrow / Guard
  setJob(p[3], "noble");    // Economy: Patronize
  p.forEach((u,i)=>{ u.hp = Math.max(1, Math.floor(u.maxHp*0.5)); u.fatigue = 3+i; });
  s.run.overworld.influence = 10;
`);

const STEPS = [
  // The map with a node preview showing — LOW intel, so the gated fields read "???" (the reveal loop).
  { name: "00-map-preview", minMs: 700, eval: wrap(`s.run.party.forEach((u)=>{u.intelligence=0;}); s._probe=s.loop.reachable().find((n)=>n.kind==='combat')||s.loop.reachable()[0]; s.showPreview(s._probe);`) },
  // The same node with full intel — the "???" fields filled in.
  { name: "00b-map-preview-known", eval: wrap(`s.run.party.forEach((u)=>{u.intelligence=9;}); s.showPreview(s._probe);`) },
  // Intel meters at differing depths: base tier 1, two reachable combats scouted to 2/3 and full.
  {
    name: "00c-map-intel-meters",
    minMs: 600,
    eval: wrap(`
      s.run.party.forEach((u)=>{u.intelligence=3;}); // base = tier 1 everywhere
      const reach = s.loop.reachable().filter((n)=>n.kind==='combat');
      if (reach[0]) s.run.overworld.scouted[reach[0].id] = 2; // → tier 3 (full ring)
      if (reach[1]) s.run.overworld.scouted[reach[1].id] = 1; // → tier 2
      s.drawMap();
    `),
  },
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
      s.showReactCamp();
      s.campDrawers = { intel: true };
      s.showReactCamp();
    `),
  },
  // A synthetic demo of the cost-component columns with VARIED costs (the real drawers only carry
  // gold today), so the strict-column alignment across component types is actually visible.
  {
    name: "04-cost-columns",
    minMs: 500,
    eval: wrap(`
      s.enterCamp(s.loop.reachable()[0]);
      if (s.overlay) { s.overlay.forEach((o)=>o.destroy&&o.destroy()); s.overlay.length = 0; }
      s.campObjects.forEach((o)=>o.destroy&&o.destroy()); s.campObjects.length = 0;
      const noop = () => {};
      const A = (name, actor, costs) => ({ name, actor, enabled: true, onClick: noop, tip: "", costs });
      const rows = [
        A("Cook Stew", "Pip", { gold: 5 }),
        A("Forage", "Vale", { fatigue: 2 }),
        A("Survey", "Rook", { fatigue: 4, cooldown: 1 }),
        A("Provision", "Pip", { gold: 8, material: { id: "ration", n: 2 } }),
        A("Guard the Purse", "Coin", { gold: 30, cooldown: 2 }),
        A("Patronize", "Nyx", { gold: 30, fatigue: 1, material: { id: "gift", n: 1 }, cooldown: 3 }),
        A("Find Trade", "Coin", {}),
      ];
      const H = (x, t) => s.campObjects.push(s.add.text(x, 96, t, { color: "#d6c98a", fontFamily: "monospace", fontSize: "13px" }).setDepth(11));
      // Left block: strict columns (gold · fatigue · material · cooldown line up down the rows).
      H(24, "STRICT COLUMNS");
      let y = 132;
      for (const r of rows) { s.renderActionCard(24, y, 380, 26, r, false); y += 34; }
      // Right block: packed (chips hug the right edge of each row).
      H(416, "PACKED (right-anchored)");
      y = 132;
      for (const r of rows) { s.renderActionCard(416, y, 380, 26, r, true); y += 34; }
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
