// E2E: the **playtest launcher** (the editor's Launch tab). Boots `#editor`, drives the sixth tab's
// four levers — target · kit · run flags · seed — into the REAL BattleScene and back.
//
// This guard is MANDATORY, not decorative (CLAUDE.md, "the visual step-through is NOT optional"):
// the core suite and the sim never render a scene and the sim's bot skips deploy entirely, so a
// render crash in a new surface reads as a **freeze**, not a stack trace (the D92/#168 tale — the
// Wave-0 mentor beats were green on every headless guard and still froze the game).
//
// Proves, per the build brief:
//   · the tab renders with all four levers
//   · a launch boots the CHOSEN TARGET with the CHOSEN KIT
//   · the finale shows the side door when the intel flag is set — and NOT when it isn't
//   · an expedition-node target walks its route and lands positioned at the node
//   · the return lands back IN the Launch tab with its selections intact
//   · fail-loud: an unlaunchable target refuses without switching scene
//   · no page error on any path
//
// Units and tiles are addressed **by lookup, never by pixel** (BoardCamera adoption is queued).
//
// Run:  npm run test:e2e:launcher   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { mkdir } from "node:fs/promises";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-launcher");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const clickTab = (t) => `document.querySelector('button[data-tab="${t}"]').click()`;
const setBrush = (b) => `document.querySelector('button[data-brush="${b}"]').click()`;

/** Set a <select>'s value and fire change (the picker's own handler does the state write). */
const setSelect = (role, value) =>
  `(() => { const s = document.querySelector('select[data-role="${role}"]'); s.value = ${JSON.stringify(value)};
    s.dispatchEvent(new Event("change")); return s.value; })()`;

/** Toggle a flag checkbox by id and fire change. */
const setFlag = (id, on) =>
  `(() => { const b = document.querySelector('input[data-role="launch-flag-${id}"]'); b.checked = ${on ? "true" : "false"};
    b.dispatchEvent(new Event("change")); return b.checked; })()`;

/** The launcher tab's own surface — controls present, selections, and the status line. */
const TAB = `(() => {
  const q = (s) => document.querySelector(s);
  const target = q('select[data-role="launch-target"]');
  const kit = q('select[data-role="launch-kit"]');
  const seed = q('input[data-role="launch-seed"]');
  const status = q('[data-role="launch-status"]');
  const drawer = q('[data-drawer="Launch"]');
  return {
    hasTab: !!q('button[data-tab="Launch"]'),
    drawerShown: !!drawer && drawer.style.display !== "none",
    hasTarget: !!target, hasKit: !!kit, hasSeed: !!seed, hasButton: !!q('button[data-role="launch"]'),
    targetValue: target ? target.value : null,
    targetOptions: target ? [...target.options].map((o) => o.value) : [],
    kitValue: kit ? kit.value : null,
    kitOptions: kit ? [...kit.options].map((o) => o.value) : [],
    flagBoxes: [...document.querySelectorAll('input[data-role^="launch-flag-"]')].map((b) => b.dataset.role),
    seedValue: seed ? seed.value : null,
    status: status ? status.textContent : null,
  };
})()`;

/**
 * Battle-side state, all by LOOKUP: which scene is live, the phase, the fielded roster, and the
 * staged spawn-zone ids (the side-door assertion) — never a pixel read.
 */
const BATTLE = `(() => {
  const g = window.game;
  const ed = g.scene.getScene("EditorScene");
  const bt = g.scene.getScene("BattleScene");
  const live = !!(bt && bt.scene.isActive("BattleScene"));
  const staged = live && bt.loop ? bt.loop.staged : null;
  return {
    editorActive: !!(ed && ed.scene.isActive("EditorScene")),
    battleActive: live,
    phase: live ? bt.phase : null,
    returnTo: bt ? bt.returnTo ?? null : null,
    partyLen: live && bt.run ? bt.run.party.length : null,
    partyJobs: live && bt.run ? bt.run.party.map((u) => u.primaryJob ?? u.jobId) : null,
    encounterId: staged && staged.source ? staged.source.id : null,
    zones: staged && staged.battle ? staged.battle.spawnZones.map((z) => z.id) : null,
    nodeId: live && bt.run ? bt.run.mapNodeId : null,
    flags: live && bt.run ? Object.keys(bt.run.flags).filter((k) => bt.run.flags[k]) : null,
    seed: live && bt.run ? String(bt.run.seed) : null,
  };
})()`;

/**
 * Full-page capture. The launcher lives in the editor's **DOM dock**, and the harness's
 * `g.screenshot` grabs the `<canvas>` element alone — so it would photograph an empty board and
 * miss the entire surface under test. `page` is already exposed on the session, so this needs no
 * change to the shared harness (13 other scripts ride it).
 */
async function shot(g, file) {
  await mkdir(path.dirname(file), { recursive: true });
  await g.page.screenshot({ path: file, fullPage: true });
}

/** Click Exit Playtest (the returnTo affordance) and wait for the editor to come back. */
async function exitToEditor(g) {
  await g.eval(`(() => { const b = window.game.scene.getScene("BattleScene");
    b.returnToOverworld(); })()`);
  await sleep(700);
}

async function main() {
  await withGame(
    async (g) => {
      try {
        await sleep(900);

        // ---------------------------------------------------------------
        // 1. The tab renders, with all four levers.
        // ---------------------------------------------------------------
        console.log("• the Launch tab renders with its four levers");
        await g.eval(clickTab("Launch"));
        await sleep(120);
        let t = await g.eval(TAB);
        check("the sixth tab exists", t.hasTab);
        check("its drawer is shown when selected", t.drawerShown);
        check("lever 1 — the target picker is present", t.hasTarget);
        check("lever 2 — the kit picker is present", t.hasKit);
        check("lever 3 — run flags render as CHECKBOXES, not free text", t.flagBoxes.length > 0);
        check("lever 4 — the seed field is present", t.hasSeed);
        check("the Launch button is present", t.hasButton);
        await shot(g, path.join(OUT, "01-launch-tab.png"));

        console.log("• the target picker offers drafts, content levels AND expedition nodes");
        check("the draft is offered", t.targetOptions.includes("draft"));
        check("content levels are offered", t.targetOptions.some((v) => v.startsWith("level:")));
        check("the finale level is offered", t.targetOptions.includes("level:the-rescue"));
        check("expedition nodes are offered", t.targetOptions.some((v) => v.startsWith("node:")));
        check("the finale NODE is offered", t.targetOptions.includes("node:the-rescue-expedition:finale"));
        check("the default target is the draft", t.targetValue === "draft");
        check("the kit picker lists the squads", t.kitOptions.length >= 3);
        check("the known intel flag has a checkbox", t.flagBoxes.includes("launch-flag-side-door-intel"));

        console.log("• the status line previews what WOULD boot, before any click");
        check("the status line is populated", !!t.status && t.status.length > 0);

        // No dead controls. The tab is taller than the dock (as the Scenario tab already is), so
        // the guard is that the panel SCROLLS rather than clipping its own controls away — a
        // launch button that exists but cannot be reached is the same bug as one that is missing.
        console.log("• the tab's controls are reachable, not clipped away");
        const reach = await g.eval(`(() => {
          const panel = document.querySelector('[data-drawer="Launch"]').parentElement;
          const btn = document.querySelector('button[data-role="launch"]');
          const r = btn.getBoundingClientRect();
          btn.scrollIntoView({ block: "center" });
          const after = btn.getBoundingClientRect();
          return {
            scrollable: panel.scrollHeight > panel.clientHeight,
            overflowY: getComputedStyle(panel).overflowY,
            w: Math.round(r.width), h: Math.round(r.height),
            rendered: btn.offsetParent !== null,
            inViewportAfterScroll: after.top >= 0 && after.bottom <= window.innerHeight,
          };
        })()`);
        check("the Launch button has real dimensions (not a zero-size dead control)", reach.w > 0 && reach.h > 0);
        check("…is actually rendered", reach.rendered);
        check("the panel scrolls its overflow instead of clipping it", reach.scrollable && reach.overflowY === "auto");
        check("…so the Launch button can be scrolled into view", reach.inViewportAfterScroll);
        // Clipped text is a bug the geometric audit hunts; the seed placeholder sat just over its
        // field's width and rendered as "blank = determini".
        const fits = await g.eval(`(() => {
          const i = document.querySelector('input[data-role="launch-seed"]');
          const probe = document.createElement("span");
          probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:" + getComputedStyle(i).font;
          probe.textContent = i.placeholder; document.body.appendChild(probe);
          const w = probe.getBoundingClientRect().width; probe.remove();
          return w <= i.clientWidth - 6;
        })()`);
        check("the seed placeholder renders un-clipped in its field", fits === true);
        await shot(g, path.join(OUT, "01b-launch-tab-scrolled.png"));

        // ---------------------------------------------------------------
        // 2. Fail loud — an unlaunchable target refuses WITHOUT switching scene.
        // ---------------------------------------------------------------
        console.log("• fail-loud: the blank draft is unplayable and the launch refuses");
        // A blank draft has no enemies → validateLevel refuses it. The status must say so, and
        // clicking Launch must NOT leave the editor.
        t = await g.eval(TAB);
        check("the status warns about the unplayable draft", /⚠/.test(t.status));
        await g.eval(`document.querySelector('button[data-role="launch"]').click()`);
        await sleep(400);
        let b = await g.eval(BATTLE);
        check("the refused launch stayed in the editor (no scene switch)", b.editorActive && !b.battleActive);
        t = await g.eval(TAB);
        check("…and said why", /refused|⚠/.test(t.status));
        await shot(g, path.join(OUT, "02-fail-loud.png"));

        // ---------------------------------------------------------------
        // 3. A LEVEL target boots with the CHOSEN KIT — and with NO intel flag,
        //    the finale stages the front gate ONLY.
        // ---------------------------------------------------------------
        console.log("• launch the finale as a content level, no intel flag");
        await g.eval(setSelect("launch-target", "level:the-rescue"));
        await g.eval(setSelect("launch-kit", "Finale probe (5)"));
        await g.eval(setFlag("side-door-intel", false));
        await sleep(120);
        t = await g.eval(TAB);
        check("the status now reads OK for the level target", /✓/.test(t.status));

        await g.eval(`document.querySelector('button[data-role="launch"]').click()`);
        await sleep(1200);
        b = await g.eval(BATTLE);
        check("the BattleScene booted", b.battleActive);
        check("it booted the CHOSEN target (the finale)", b.encounterId === "the-rescue");
        check("it fielded the CHOSEN kit (5 bodies)", b.partyLen === 5);
        check("…including the Thief the sneaking route needs", (b.partyJobs || []).includes("thief"));
        check("returnTo points back at the editor", b.returnTo === "EditorScene");
        check("WITHOUT the intel flag only the front gate stages", JSON.stringify(b.zones) === JSON.stringify(["front-gate"]));
        await g.screenshot(path.join(OUT, "03-no-intel-front-gate-only.png"));

        // ---------------------------------------------------------------
        // 4. The return lands back IN the Launch tab, selections intact.
        // ---------------------------------------------------------------
        console.log("• return to the editor — the Launch tab and its selections survive");
        await exitToEditor(g);
        b = await g.eval(BATTLE);
        check("the editor is back", b.editorActive && !b.battleActive);
        t = await g.eval(TAB);
        check("the Launch tab is still the active drawer", t.drawerShown);
        check("the target selection survived the round-trip", t.targetValue === "level:the-rescue");
        check("the kit selection survived the round-trip", t.kitValue === "Finale probe (5)");
        await shot(g, path.join(OUT, "04-returned-to-launcher.png"));

        // ---------------------------------------------------------------
        // 5. Same target, intel flag SET → the side door appears. The lever works.
        // ---------------------------------------------------------------
        console.log("• flip the intel flag — the side door unions in");
        await g.eval(setFlag("side-door-intel", true));
        await sleep(120);
        await g.eval(`document.querySelector('button[data-role="launch"]').click()`);
        await sleep(1200);
        b = await g.eval(BATTLE);
        check("the BattleScene booted again", b.battleActive);
        check("WITH the intel flag the side door stages too",
          JSON.stringify(b.zones) === JSON.stringify(["front-gate", "side-door"]));
        check("the flag actually reached the run", (b.flags || []).includes("side-door-intel"));
        await g.screenshot(path.join(OUT, "05-intel-side-door.png"));
        await exitToEditor(g);

        // ---------------------------------------------------------------
        // 6. A SEED reaches the run.
        // ---------------------------------------------------------------
        console.log("• the seed lever reaches the run");
        await g.eval(`(() => { const s = document.querySelector('input[data-role="launch-seed"]');
          s.value = "probe-seed-42"; s.dispatchEvent(new Event("input")); })()`);
        await sleep(80);
        await g.eval(`document.querySelector('button[data-role="launch"]').click()`);
        await sleep(1200);
        b = await g.eval(BATTLE);
        check("the chosen seed is the run's seed", b.seed === "probe-seed-42");
        await exitToEditor(g);

        // ---------------------------------------------------------------
        // 7. An EXPEDITION NODE target walks its route and lands positioned.
        // ---------------------------------------------------------------
        console.log("• launch an expedition NODE — the route walks and lands at the node");
        await g.eval(setSelect("launch-target", "node:the-rescue-expedition:finale"));
        await sleep(150);
        t = await g.eval(TAB);
        check("the status shows the route it would walk", /→/.test(t.status));
        await g.eval(`document.querySelector('button[data-role="launch"]').click()`);
        await sleep(2000);
        b = await g.eval(BATTLE);
        check("the BattleScene booted from a positioned run", b.battleActive);
        check("the run is positioned AT the finale node", b.nodeId === "finale");
        check("the finale encounter is what staged", b.encounterId === "the-rescue");
        check("the forced intel flag survived the walk", (b.flags || []).includes("side-door-intel"));
        check("…so the side door is open on the node launch too",
          JSON.stringify(b.zones) === JSON.stringify(["front-gate", "side-door"]));
        await g.screenshot(path.join(OUT, "06-node-launch.png"));

        console.log("• return once more — no page errors across every path");
        await exitToEditor(g);
        b = await g.eval(BATTLE);
        check("the editor is back after the node launch", b.editorActive);

        assertNoProblems(g);
        console.log(`\n✓ launcher E2E: ${passed} assertions passed, no page errors`);
        console.log(`  stage screenshots → screenshots/e2e-launcher/`);
      } catch (err) {
        await g.screenshot(path.join(OUT, "99-failure.png")).catch(() => {});
        throw err;
      }
    },
    { hash: "#editor" },
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
