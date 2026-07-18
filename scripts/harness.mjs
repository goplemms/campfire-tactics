// Shared headless-browser harness for the puppeteer-driven scripts — the
// screenshot walkthroughs (scripts/shots-*.mjs) and the assertion-bearing E2E
// tests (scripts/e2e-*.mjs). Boots a Vite dev server + a pinned
// chrome-for-testing, captures page problems (pageerror + console.error), and
// exposes scene-eval + real-input helpers so a test can *click through* the
// actual rendered scene rather than only the pure core.
//
// Chrome contract (same as the shots scripts): set CHROME_BIN to skip the
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

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CFT_VERSION = process.env.CFT_VERSION ?? "131.0.6778.204";
const CFT_HOST = process.env.CFT_HOST ?? "https://storage.googleapis.com/chrome-for-testing-public";
const CACHE_DIR = path.resolve(ROOT, ".cache", "chrome");

const PLATFORMS = {
  "linux-x64": ["linux64", "chrome-linux64/chrome"],
  "darwin-arm64": ["mac-arm64", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"],
  "win32-x64": ["win64", "chrome-win64/chrome.exe"],
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

/** Resolve a Chrome binary — CHROME_BIN, a cached fetch, or download chrome-for-testing. */
export async function ensureChrome() {
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

// Scene-eval helpers: build snippets that run inside a named scene with `s` bound.
export const OV = `window.game.scene.getScene("OverworldScene")`;
export const BS = `window.game.scene.getScene("BattleScene")`;
export const ov = (body) => `(()=>{const s=${OV};${body}})()`;
export const bs = (body) => `(()=>{const s=${BS};${body}})()`;

/**
 * In-page run-loop navigator → hand off to a scene. Builds an `ov(...)` snippet
 * that walks the loop from wherever it is to `target`, then starts a scene with the
 * run/loop (default BattleScene — staged from the loop's current node in `create`).
 *
 *  - `route` given: follow it **exactly** — choose each step in order, playing rests/
 *    events along the way but never the target/combats (so the target lands chosen-
 *    but-unplayed, ready for the BattleScene to stage).
 *  - `route` absent: the branch-aware walk — at each step take the target if it's a
 *    direct edge, else the first reachable node (playing rests/events) until the
 *    target becomes reachable.
 *  - `into`: `"overworld"` parks on the OverworldScene; default `"battle"` hands off
 *    to the BattleScene.
 */
export const jumpTo = ({ target, route, into = "battle" } = {}) => {
  const scene = into === "overworld" ? "OverworldScene" : "BattleScene";
  const handoff = `s.scene.start(${JSON.stringify(scene)},{run:s.run,loop:s.loop});`;
  const walk = route
    ? `const R=${JSON.stringify(route)},T=${JSON.stringify(target ?? route[route.length-1])};` +
      `for(let i=1;i<R.length;i++){const id=R[i];const node=s.run.map.nodes[id]||s.loop.reachable().find(x=>x.id===id);` +
      `s.loop.choose(id);if(id!==T&&node&&node.kind!=="combat")s.loop.playCurrentNode();}`
    : `const T=${JSON.stringify(target)};` +
      `while(s.run.mapNodeId!==T){const r=s.loop.reachable();if(r.length===0)break;` +
      `const n=r.find(x=>x.id===T)||r[0];s.loop.choose(n.id);` +
      `if(n.id!==T&&n.kind!=="combat")s.loop.playCurrentNode();}`;
  return ov(walk + handoff);
};

/**
 * Navigate the run loop to a target combat node, then hand off to the real
 * BattleScene — a thin back-compat wrapper over {@link jumpTo} (branch-aware walk).
 */
export const navTo = (id) => jumpTo({ target: id });

/**
 * Boot the game in a headless browser and hand a {@link GameSession} to `fn`. The
 * session collects page problems (pageerror + console.error); after `fn` resolves
 * the harness tears everything down and (unless `opts.allowProblems`) throws if any
 * problem was seen. Returns whatever `fn` returns.
 *
 * The session exposes:
 *  - `eval(body)` — run a snippet string (e.g. `bs("return s.phase")`) in the page.
 *  - `bsEval(body)` — shorthand for `eval(bs(body))` (run inside the BattleScene).
 *  - `clickScene(x, y)` — a **real** pointer click at scene coords (x,y).
 *  - `clickTile(coord)` — a real click on a grid tile (via `s.tileToWorld`).
 *  - `key(name)` — a real keyboard press (e.g. `"Escape"`, `" "`).
 *  - `problems` — the live problem list.
 */
export async function withGame(fn, opts = {}) {
  const port = opts.port ?? Number(process.env.HARNESS_PORT ?? 5195);
  const chromeBin = await ensureChrome();
  const server = await createServer({ root: ROOT, server: { port, host: "127.0.0.1" }, logLevel: "warn", clearScreen: false });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${port}/`;
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

    await page.goto(`${url}${opts.hash ?? "#demo"}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("canvas", { timeout: 15000 });

    // Canvas page-offset, so scene coords can be turned into real click points
    // (the game is a fixed 800×600 Scale.NONE canvas → 1:1 with scene coords).
    const canvasBox = async () => (await (await page.$("canvas")).boundingBox());

    const session = {
      page,
      problems,
      // The resolved dev-server base URL withGame computed — exposed so a script can
      // re-boot a fresh hash within one session (see `boot`).
      url,
      // Re-boot the page at a new hash on the SAME server/browser session — far cheaper
      // than one withGame per shot. Lets a script step through different `#demo?...`
      // hashes (e.g. node×arrival jump-boots) without tearing down Chrome each time.
      //
      // A bare goto that differs only in the hash fragment is a *same-document*
      // navigation in Chrome — it would NOT reload the module graph, so the game's
      // boot config (which reads window.location.hash once at module init) would keep
      // the previous scene. We bounce through about:blank to force a fresh document
      // load so the new hash actually takes effect.
      async boot(hash) {
        await page.goto("about:blank", { waitUntil: "load", timeout: 30000 });
        await page.goto(`${url}${hash}`, { waitUntil: "load", timeout: 30000 });
        await page.waitForSelector("canvas", { timeout: 15000 });
      },
      eval: (body) => page.evaluate(body),
      bsEval: (body) => page.evaluate(bs(body)),
      // Wait until a named scene exists AND every listed property is truthy on it.
      // Guards the boot race: the <canvas> is present the instant Phaser starts, but a
      // boot scene (HollowMillBootScene/ScenarioBootScene/…) may still be handing off to
      // the real scene, which sets `.run`/`.loop` in init(). A navigation snippet
      // (jumpTo/navTo) that reads `s.run.mapNodeId` before that handoff throws
      // "Cannot read properties of undefined (reading 'mapNodeId')" — the intermittent
      // CI freeze this replaces. Poll here first so navigation never races the boot.
      async waitForScene(key, props = [], timeout = 15000) {
        await page.waitForFunction(
          (k, ps) => {
            const s = window.game && window.game.scene && window.game.scene.getScene(k);
            return !!s && ps.every((p) => !!s[p]);
          },
          { timeout, polling: 50 },
          key,
          props,
        );
      },
      async clickScene(x, y) {
        const box = await canvasBox();
        await page.mouse.click(box.x + x, box.y + y);
      },
      // Move the pointer to scene coords without clicking (fires pointermove — for hover readouts/previews).
      async hover(x, y) {
        const box = await canvasBox();
        await page.mouse.move(box.x + x, box.y + y);
      },
      async clickTile(coord) {
        const w = await page.evaluate(bs(`const p=s.tileToWorld(${JSON.stringify(coord)});return {x:p.x,y:p.y};`));
        await this.clickScene(w.x, w.y);
      },
      // A **real** press-move-release drag from (x1,y1) to (x2,y2) in scene coords. Steps the
      // move so intermediate pointermove events fire (a scene's drag threshold needs them).
      async drag(x1, y1, x2, y2, steps = 10) {
        const box = await canvasBox();
        await page.mouse.move(box.x + x1, box.y + y1);
        await page.mouse.down();
        await page.mouse.move(box.x + x2, box.y + y2, { steps });
        await page.mouse.up();
      },
      async key(name) {
        await page.keyboard.press(name === " " ? "Space" : name);
      },
      async screenshot(file) {
        await mkdir(path.dirname(file), { recursive: true });
        const canvas = await page.$("canvas");
        await canvas.screenshot({ path: file });
      },
    };
    return await fn(session);
  } finally {
    await browser.close();
    await server.close();
  }
}

/** After `withGame` returns, throw a readable error if any page problem was seen. */
export function assertNoProblems(problems) {
  if (problems.length) {
    throw new Error([`${problems.length} page problem(s):`, ...problems.map((p) => `  - ${p}`)].join("\n"));
  }
}
