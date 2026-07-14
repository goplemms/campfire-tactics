// Visual audit: walk the core player-facing surfaces in a *real* headless browser
// and, for each screen, (a) capture a labelled screenshot and (b) run an in-page
// GEOMETRIC LINTER over every rendered Text / interactive object — the two halves
// of the visual-bug net that the pure-core suite and the sim are blind to.
//
// Why this exists: `vitest`/`sim` never render a Phaser scene, and the shots-*.mjs
// walkthroughs capture images but are explicitly NOT pass/fail gates (see CLAUDE.md).
// So a layout that *renders* but reads wrong — text stacked on text, a label spilled
// off-canvas, a live button collapsed to zero size, a caption left at alpha 0 — sails
// through every green guard. This linter catches the geometrically-decidable cases
// deterministically; the paired screenshots feed the subagent's vision pass (the
// game-visual-auditor agent) for the fuzzy ones (contrast, cramped margins, spill).
//
// Output (all gitignored, like the other screenshots/):
//   screenshots/visual-audit/NN-<name>.png   one capture per surface
//   screenshots/visual-audit/report.json     structured findings + page problems
//
// Run:  npm run audit:visual         (needs Chrome — see scripts/harness.mjs)
// Exit: non-zero if any error-severity finding or page problem is seen, so it can
//       double as a CI gate. The report.json is ALWAYS written first, so the
//       subagent can read the findings regardless of exit code.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { withGame, ov, bs, navTo, jumpTo, sleep, ROOT } from "./harness.mjs";

// Best-effort Chrome discovery so `npm run audit:visual` works without the caller
// knowing the box's browser path. Honours an explicit CHROME_BIN (the harness does
// too); otherwise probes the usual Playwright / system locations before the harness
// falls back to downloading chrome-for-testing.
function resolveChrome() {
  if (process.env.CHROME_BIN) return;
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const candidates = [];
  try {
    for (const d of readdirSync(pw)) if (d.startsWith("chromium-")) candidates.push(path.join(pw, d, "chrome-linux", "chrome"));
  } catch { /* no playwright dir */ }
  candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  const found = candidates.find((p) => existsSync(p));
  if (found) process.env.CHROME_BIN = found;
}

const OUT = path.join(ROOT, "screenshots", "visual-audit");
const CANVAS = { w: 800, h: 600 };

// --- scene drivers (reused from the shots/e2e vocabulary) --------------------
// Start the battle (leave deployment), then step the CT clock one actor at a time —
// clearing the busy animation lock so it keeps moving — and STOP at the first player
// turn (`waitingFor`), so the action row / preview card render. Critically it stops
// *before* the fight can decide: an earlier naive `advance(12)` blasted the clock with
// no player input and drove E1 to a Defeat, so this surface silently captured a Defeat
// modal instead of mid-battle (and `forceWin` below then no-op'd on the already-over
// battle, making the resolution shot identical). This never lets that happen.
const driveBattle = async (g) => {
  // COMMIT to battle first. In deployment `onPrimary` is "End Turn / Advance Clock"
  // (it just advances the closing net) — driving it with no player input marches the
  // net in until the party is captured → Defeat, still in the deployment phase. The
  // real "join battle" verb is `startBattle` (the button e2e-deploy-battle clicks).
  await g.bsEval(`if(s.phase==="deployment")s.startBattle();`);
  for (let i = 0; i < 30; i++) {
    const st = await g.bsEval(`return { waiting: !!s.waitingFor, over: !!s.over, phase: s.phase };`);
    if (st.waiting || st.over || st.phase === "resolution") break; // stop at the first player turn
    await g.bsEval(`s.busy = false; s.onAdvance();`);
    await sleep(160);
  }
};
// Force a clean WIN on the live (not-yet-decided) battle and finish → the victory
// resolution report. Runs right after driveBattle parks on a player turn, so `s.over`
// is false and this actually resolves (its guard would bail on an already-over fight).
const forceWin = bs(`if(s.over||!s.battle)return;for(const u of s.battle.units)if(u.side==="enemy")u.alive=false;s.busy=false;s.waitingFor=null;s.finishBattle();`);
// Open an authored overworld event's screen (the arc-events dispatch path). The jumpTo
// walk must SETTLE before commit() — firing commit on the same tick leaves the event
// modal unopened (the plain map shows instead), the bug that made this surface capture
// the wrong screen. Mirror e2e-arc-events: walk, sleep, then commit.
const driveEvent = (node) => async (g) => {
  await g.eval(jumpTo({ target: node, into: "overworld" }));
  await sleep(700);
  await g.eval(ov(`const n=s.run.map.nodes[${JSON.stringify(node)}];s.campNode=n;s.commit();`));
};

// A content probe for `expect`: does ANY visible Text in the active scene graph match
// `re`? Robust to where a surface stores its objects (s.overlay vs a bespoke card vs a
// container) — it scans the same display list the linter walks, not one named field.
const seesText = (re) => `(() => {
  const rx = ${re};
  for (const sc of window.game.scene.getScenes(true)) {
    const stack = [...sc.children.list];
    while (stack.length) {
      const o = stack.pop();
      if (o.list && Array.isArray(o.list)) stack.push(...o.list);
      if (o.type === "Text" && o.visible !== false && rx.test(o.text || "")) return true;
    }
  }
  return false;
})()`;

// The core surfaces (D-scope: the highest-traffic screens). Each step runs on the SAME
// #demo run in sequence (forward-only), except `boot` steps that reset first. Every
// surface carries an `expect` predicate (a scene-eval returning truthy) asserting it
// reached its INTENDED state — so a wrong-content capture (a fallback screen, a Defeat
// modal, an unopened event) is a loud `coverage` error, never a silent "geometry clean".
// That guard is the whole point: a screenshot that lays out fine but shows the wrong
// screen is exactly the hole a data-only test leaves open.
const SURFACES = [
  { name: "overworld-intro", minMs: 800, note: "the expedition orientation card over the fogged map",
    expect: { desc: "the orientation card is open", eval: seesText("/expedition/i") } },
  { name: "overworld-map", eval: ov(`for(const o of s.overlay)o.destroy();s.overlay=[];`), note: "the hand-built Hollow Mill map, overlay cleared",
    expect: { desc: "the map is showing (no overlay)", eval: ov(`return s.overlay.length===0;`) } },
  { name: "intel-card", minMs: 500, eval: ov(`s.showPreview(s.run.map.nodes["snares"]);`), note: "the pinned intel preview card on the map",
    expect: { desc: "the intel preview card is open", eval: seesText("/rumors|hazards/i") } },
  { name: "camp", minMs: 500, eval: ov(`s.enterCamp(s.loop.reachable()[0]);`), note: "the make-camp screen (camp action row)",
    expect: { desc: "the camp screen is entered", eval: ov(`return !!s.campNode;`) } },
  { name: "ledger", minMs: 500, eval: ov(`s.openTent(()=>s.renderCamp(),"ledger");`), note: "the Captain's Tent ledger + forecast",
    expect: { desc: "the ledger sheet is open", eval: seesText("/ledger|forecast/i") } },
  { name: "deploy", minMs: 1100, eval: navTo("e1"), note: "the E1 skirmish deployment board",
    expect: { desc: "the deployment board is up", eval: bs(`return s.phase==="deployment";`) } },
  { name: "battle", minMs: 700, drive: driveBattle, note: "mid-battle: action row, CT rail, combat log",
    expect: { desc: "a live battle turn (not decided)", eval: bs(`return s.phase==="battle"&&!s.over;`) } },
  { name: "resolution", minMs: 900, eval: forceWin, note: "the victory resolution report (reward + level-up)",
    expect: { desc: "a victory resolution report", eval: bs(`return s.phase==="resolution"&&!s.battle.units.some(u=>u.side==="enemy"&&u.alive);`) } },
  {
    name: "overworld-event",
    boot: "#demo",
    minMs: 700,
    waitScene: ["OverworldScene", ["run", "loop"]],
    drive: driveEvent("guildContact"),
    note: "an authored overworld event screen (guild-contact)",
    expect: { desc: "the authored event modal is open", eval: seesText("/tavern|token|guild/i") },
  },
];

// --- the geometric linter (runs IN-PAGE over the live scene graph) -----------
// Walks the display list of every ACTIVE scene (recursing into containers), reads
// each Text / interactive object's world bounds + effective visibility, and reports
// the geometrically-decidable defects. Returns plain JSON. Pure detection — no
// mutation of the scene. Kept in one function so puppeteer can serialize it whole.
function lintScene(W, H, MIN_ALPHA) {
  const game = window.game;
  if (!game || !game.scene) return { error: "no game" };
  const active = game.scene.getScenes(true); // running (visible) scenes only

  // Effective visibility/alpha: an object inside an invisible/faded container is
  // itself invisible even when its own flag says otherwise — climb the parent chain.
  const effective = (o) => {
    let n = o, vis = true, alpha = 1;
    while (n) {
      if (n.visible === false) vis = false;
      if (typeof n.alpha === "number") alpha *= n.alpha;
      n = n.parentContainer;
    }
    return { vis, alpha };
  };

  const texts = [];       // visible, non-empty Text objects (for overlap/off-canvas)
  const hiddenText = [];   // intended-visible text left functionally invisible
  const deadControls = []; // intended-visible interactive objects collapsed to nothing
  const occluders = [];    // opaque filled rects that hide whatever sits below them

  const walk = (list, sceneKey) => {
    for (const o of list) {
      // Recurse into containers first (their children aren't on the scene list).
      if (o.list && Array.isArray(o.list)) walk(o.list, sceneKey);
      const { vis, alpha } = effective(o);
      // Opaque filled rectangles are occluders: a modal card box (boxAlpha 0.96) drawn
      // over the map genuinely HIDES the map nodes/legend beneath it, so text under such
      // a panel isn't a real visual collision. The 0.55 dim-backdrop stays below the
      // threshold on purpose (it dims but doesn't hide). Depth-gated at compare time.
      if (o.type === "Rectangle" && o.isFilled && vis && alpha * (o.fillAlpha ?? 1) >= 0.9) {
        try { const rb = o.getBounds(); occluders.push({ x: rb.x, y: rb.y, w: rb.width, h: rb.height, depth: o.depth ?? 0 }); } catch { /* skip */ }
      }
      const isText = o.type === "Text";
      const clickable = !!(o.input && o.input.enabled);
      if (!isText && !clickable) continue;
      let b;
      try { b = o.getBounds(); } catch { continue; }
      const box = { x: b.x, y: b.y, w: b.width, h: b.height };
      const depth = o.depth ?? 0;
      if (isText) {
        const label = (o.text || "").replace(/\s+/g, " ").trim();
        if (!label) continue; // whitespace-only text can't visually collide
        if (vis && alpha < MIN_ALPHA) {
          hiddenText.push({ scene: sceneKey, text: label.slice(0, 60), alpha: +alpha.toFixed(3), box, depth });
        } else if (vis) {
          texts.push({ scene: sceneKey, text: label.slice(0, 60), depth, box });
        }
      }
      if (clickable && vis && alpha >= MIN_ALPHA && (b.width < 1 || b.height < 1)) {
        deadControls.push({ scene: sceneKey, type: o.type, box, depth });
      }
    }
  };
  for (const sc of active) walk(sc.children.list, sc.scene.key);

  // An object is occluded when a strictly-higher-depth opaque rect fully covers its box
  // (a panel on top). Such an object is invisible to the player, so it can't be part of
  // a real visual defect — drop it before finding overlaps / off-canvas / dead controls.
  const EPS = 1;
  const occluded = (o) => occluders.some((r) =>
    r.depth > o.depth &&
    r.x <= o.box.x + EPS && r.y <= o.box.y + EPS &&
    r.x + r.w >= o.box.x + o.box.w - EPS && r.y + r.h >= o.box.y + o.box.h - EPS);
  const occludedText = texts.filter(occluded).length;
  const visibleTexts = texts.filter((t) => !occluded(t));
  texts.length = 0; texts.push(...visibleTexts);
  const liveHidden = hiddenText.filter((t) => !occluded(t));
  const liveDead = deadControls.filter((c) => !occluded(c));

  const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
  const findings = [];

  // (1) Text off-canvas: a visible label whose box leaves the 800×600 frame.
  for (const t of texts) {
    const { x, y, w, h } = t.box;
    const outL = Math.max(0, -x), outT = Math.max(0, -y);
    const outR = Math.max(0, x + w - W), outB = Math.max(0, y + h - H);
    const spill = Math.max(outL, outT, outR, outB);
    if (spill <= 0.5) continue;
    const fullyOut = x + w <= 0 || y + h <= 0 || x >= W || y >= H;
    findings.push({
      kind: "text-offcanvas",
      severity: fullyOut ? "error" : spill > 4 ? "error" : "warn",
      scene: t.scene,
      detail: `"${t.text}" ${fullyOut ? "is entirely off-canvas" : `spills ${Math.round(spill)}px past the frame`}`,
      box: round(t.box),
    });
  }

  // (2) Text-on-text overlap: two visible labels whose boxes intersect on a
  // meaningful area (≥35% of the smaller box, ≥3px each way). Almost always a bug.
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].box, b = texts[j].box;
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ix < 3 || iy < 3) continue;
      const inter = ix * iy;
      const smaller = Math.min(a.w * a.h, b.w * b.h) || 1;
      if (inter / smaller < 0.35) continue;
      findings.push({
        kind: "text-overlap",
        severity: "error",
        scene: texts[i].scene,
        detail: `"${texts[i].text}" overlaps "${texts[j].text}" (${Math.round((inter / smaller) * 100)}% of the smaller label)`,
        box: round({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), w: ix, h: iy }),
      });
    }
  }

  // (3) Functionally-invisible text: meant to show, left at ~0 alpha.
  for (const t of liveHidden) {
    findings.push({ kind: "text-invisible", severity: "warn", scene: t.scene, detail: `"${t.text}" is visible-flagged but alpha≈${t.alpha}`, box: round(t.box) });
  }
  // (4) Dead control: an enabled hit-target collapsed to zero size (unclickable).
  for (const c of liveDead) {
    findings.push({ kind: "control-zero-size", severity: "warn", scene: c.scene, detail: `an interactive ${c.type} is visible but ${Math.round(c.box.w)}×${Math.round(c.box.h)}px (no usable hit area)`, box: round(c.box) });
  }

  return { findings, counts: { texts: texts.length, occludedText, hiddenText: liveHidden.length, deadControls: liveDead.length } };
}

async function main() {
  resolveChrome();
  await mkdir(OUT, { recursive: true });
  const report = { canvas: CANVAS, generatedBy: "scripts/visual-audit.mjs", surfaces: [] };

  await withGame(async (g) => {
    await g.waitForScene("OverworldScene", ["run", "loop"]);
    let seq = 0;
    let seenProblems = 0;

    for (const s of SURFACES) {
      const idx = String(++seq).padStart(2, "0");
      const file = path.join(OUT, `${idx}-${s.name}.png`);
      try {
        if (s.boot) {
          await g.boot(s.boot);
          if (s.waitScene) await g.waitForScene(s.waitScene[0], s.waitScene[1]);
        }
        if (s.drive) await s.drive(g);
        else if (s.eval) await g.eval(s.eval);
      } catch (e) {
        report.surfaces.push({ name: s.name, screenshot: path.relative(ROOT, file), note: s.note, driveError: String(e).slice(0, 300), findings: [], pageProblems: [] });
        await g.screenshot(file).catch(() => {});
        console.error(`  ✗ ${s.name}: drive error — ${String(e).slice(0, 160)}`);
        continue;
      }
      await sleep(s.minMs ?? 400);
      await g.screenshot(file);

      const active = await g.eval(`window.game.scene.getScenes(true).map(sc => sc.scene.key)`);
      const lint = await g.page.evaluate(lintScene, CANVAS.w, CANVAS.h, 0.06);
      const pageProblems = g.problems.slice(seenProblems);
      seenProblems = g.problems.length;

      const findings = lint.findings ?? [];
      // Coverage gate: did the surface actually reach the screen we claim to audit? A
      // screenshot can be geometry-clean yet show the wrong thing (a fallback/Defeat
      // modal, an unopened event). Assert intended state and flag a loud error if not —
      // the one check that stops "green but wrong screen" from slipping through.
      if (s.expect) {
        const reached = await g.eval(s.expect.eval).catch((e) => `err:${String(e).slice(0, 80)}`);
        if (reached !== true) {
          findings.unshift({ kind: "coverage", severity: "error", scene: active[0] ?? "?", detail: `surface did not reach its intended state (${s.expect.desc}); the screenshot shows the wrong screen and its geometry check is meaningless`, box: null });
        }
      }
      report.surfaces.push({
        name: s.name,
        note: s.note,
        screenshot: path.relative(ROOT, file),
        activeScenes: active,
        counts: lint.counts,
        findings,
        pageProblems,
      });
      const errs = findings.filter((f) => f.severity === "error").length + pageProblems.length;
      const warns = findings.filter((f) => f.severity === "warn").length;
      const tag = errs ? `✗ ${errs} error` : warns ? `• ${warns} warn` : "✓ clean";
      console.log(`  ${tag}  ${idx}-${s.name}  (${(lint.counts && lint.counts.texts) ?? 0} labels)`);
      for (const f of findings) console.log(`      [${f.severity}] ${f.kind}: ${f.detail}`);
      for (const p of pageProblems) console.log(`      [error] page-problem: ${p}`);
    }
  });

  const allFindings = report.surfaces.flatMap((s) => s.findings);
  const allProblems = report.surfaces.flatMap((s) => s.pageProblems);
  report.summary = {
    surfaces: report.surfaces.length,
    errors: allFindings.filter((f) => f.severity === "error").length + allProblems.length,
    warnings: allFindings.filter((f) => f.severity === "warn").length,
  };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  console.log(`\nGeometric audit: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s) across ${report.summary.surfaces} surface(s).`);
  console.log(`  screenshots + report.json → ${path.relative(ROOT, OUT)}/`);
  console.log(`  Next: the game-visual-auditor subagent reads each PNG for the visual (contrast/margin/spill) issues this linter can't decide.`);
  if (report.summary.errors > 0) process.exit(1);
}

main().catch((e) => { console.error(`\n${e.stack || e}`); process.exit(1); });
