// Showcase the D64 **telegraph / action-forecast** render layer in a real (headless)
// browser: a Heavy Knight arming Cleave (the arc + caught foe) and Shove (the push
// arrow, into a trap), and a Medic arming Heal (the branching herb forecast box) —
// plus the persistent tarpit aura ring. Drives the BattleScene's own methods (the
// same code the live game runs), re-jobbing a live player unit so the showcase
// doesn't depend on the demo roster carrying a Heavy Knight / Medic.
//
// Reuses the Chrome-fetch contract: set CHROME_BIN to skip the download, or let it
// pin + fetch chrome-for-testing from storage.googleapis.com.
//
//   node scripts/shots-telegraph.mjs

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
const OUT_DIR = path.resolve(ROOT, process.env.SHOTS_OUT ?? "screenshots/telegraph");
const CACHE_DIR = path.resolve(ROOT, ".cache", "chrome");
const PORT = Number(process.env.SHOTS_PORT ?? 5196);

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

// Start the battle and open a real player turn so `waitingFor` is set. Commit the
// deployment (startBattle), then hand the turn to a living player unit directly
// (skipping the enemy's animated turns, which would leave the scene busy/async).
const intoBattle = bs(
  `if(s.phase==="deployment"){s.busy=false; s.startBattle();}` +
  `s.busy=false; s.over=false;` +
  `const p=s.battle.units.find(x=>x.side==="player"&&x.alive&&!x.captured&&!x.hidden);` +
  `if(p)s.beginPlayerTurn(p);`,
);

// Re-job the active player unit so the showcase carries the signature footprints,
// regardless of the demo roster. Mutates the live unit + re-stamps job passives so
// the tarpit aura (Heavy Knight) lights up, then snaps a foe (or ally) adjacent and
// arms the chosen skill at it via the scene's own footprint/forecast path.
//
// `setup` is a JS expression evaluated with `s` (scene), `u` (active unit), and
// `B`/`U` (Battle / units) bound — it positions targets + returns the skill to arm
// and the aim tile, which the harness then feeds straight into drawPreview.
const stage = (setup) => bs(
  `const u=s.waitingFor; if(!u) return "no-turn";` +
  `const B=s.battle, U=B.units;` +
  `const place=(unit,col,row)=>{unit.pos={col,row}; s.placeView(unit);};` +
  `const {skill,aim,job}=(${setup})(s,u,B,U,place);` +
  `if(job){u.jobId=job; u.heldJobs=[job];}` +
  // Arm + aim, then recompute reach and redraw — drawPreview paints the footprint +
  // forecast box, refreshAuras (driven inside drawPreview) lights the tarpit ring.
  `s.armedSkill=skill; s.armedAim=aim;` +
  `s.recomputeReach(u);` +
  `s.drawPreview(); s.refreshFocusCard();`,
);

// The skill literals (mirror the Heavy Knight / Medic JobDefs in core/jobs.ts).
const CLEAVE = `{id:"cleave",name:"Cleave",description:"",phase:"battle",target:"enemy",range:1,spend:"act",unlockLevel:1,effect:{kind:"cleave",bonusAttack:0,reach:3}}`;
const SHOVE = `{id:"shove",name:"Shove",description:"",phase:"battle",target:"enemy",range:1,spend:"act",unlockLevel:2,effect:{kind:"forced-move",tiles:1,bonusAttack:0}}`;
const MEDHEAL = `{id:"med-heal",name:"Heal",description:"",phase:"battle",target:"ally",range:1,spend:"act",unlockLevel:1,effect:{kind:"med-heal"}}`;

const STEPS = [
  { name: "00-nav", minMs: 1200, eval: navTo("e1") },
  { name: "00-deploy-aura", minMs: 700, eval: bs(
    // In Deployment: re-job the first player unit to a Heavy Knight so the tarpit
    // ring is visible to position around (the original audit gap).
    `const u=s.battle.units.find(x=>x.side==="player"&&!x.captured&&!x.hidden);` +
    `if(u){u.jobId="heavy-knight"; u.passives={tarpit:1}; s.drawZones();}`,
  ) },

  { name: "01-cleave-arc", minMs: 800, eval: intoBattle },
  { name: "01b-cleave-arc", minMs: 600, eval: stage(
    `(s,u,B,U,place)=>{` +
    `u.attack=18; u.maxHp=40; u.hp=40; u.passives={tarpit:1};` +
    `place(u,2,2);` +
    `const foes=U.filter(x=>x.side!=="player"&&x.alive);` +
    // line up a foe directly to the right (the aimed arc tile) and one on a flank.
    `if(foes[0])place(foes[0],3,2); if(foes[1])place(foes[1],3,1);` +
    `return {skill:${CLEAVE}, aim:{col:3,row:2}, job:"heavy-knight"};}`,
  ) },

  { name: "02-shove-into-trap", minMs: 700, eval: stage(
    `(s,u,B,U,place)=>{` +
    `u.attack=14; u.maxHp=40; u.hp=40; u.passives={tarpit:1};` +
    `place(u,2,2);` +
    `const foe=U.find(x=>x.side!=="player"&&x.alive);` +
    `if(foe)place(foe,3,2);` +
    // drop an armed concealed trap one tile past the foe — the push landing.
    `B.entities.register({id:"tele-trap",pos:{col:4,row:2},owner:"enemy",revealed:true,sprung:false,concealment:0,kind:"trap",onUnitEnterTile(){}});` +
    `s.redrawTrapMarkers?.();` +
    `return {skill:${SHOVE}, aim:{col:3,row:2}, job:"heavy-knight"};}`,
  ) },

  { name: "03-medic-heal-branch", minMs: 700, eval: stage(
    `(s,u,B,U,place)=>{` +
    `u.jobId="medic"; u.passives={triage:0.5}; u.attack=4; u.maxHp=20; u.hp=20;` +
    `place(u,2,2);` +
    `const ally=U.find(x=>x.side==="player"&&x!==u&&x.alive);` +
    `if(ally){ally.maxHp=30; ally.hp=9; place(ally,3,2);}` +
    // make sure the stash carries some herbs so rows light, antidote out of stock.
    `s.run.inventory.salve=1; s.run.inventory.stimulant=1; if("antidote" in s.run.inventory)delete s.run.inventory.antidote;` +
    `s.pendingHerb="salve";` +
    `return {skill:${MEDHEAL}, aim:{col:3,row:2}, job:"medic"};}`,
  ) },
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
  console.log(`\n✓ Telegraph showcase captured to ${OUT_DIR} with no page errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
