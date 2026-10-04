// E2E: the **playtest launcher** (the editor's Launch tab). Boots `#editor`, drives the sixth tab's
// levers — target · kit · run flags · seed · party setup — into the REAL BattleScene and back, and
// boots the tab's copied `#launch?…` link in a fresh document.
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
//   · the party setup re-levels the Hollow Mill's ARRIVAL party at the finale node (level + per-unit)
//   · a node seed is the route salt: a non-number refuses instead of being silently dropped
//   · Copy link → `#launch?…` boots the same fight; a bad link says why on screen (no freeze)
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

/** Type into a launch-tab text field and fire input (the field's own handler does the state write). */
const setText = (role, value) =>
  `(() => { const i = document.querySelector('input[data-role="${role}"]'); i.value = ${JSON.stringify(value)};
    i.dispatchEvent(new Event("input")); return i.value; })()`;

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
  const level = q('input[data-role="launch-level"]');
  const hp = q('input[data-role="launch-hp"]');
  const tweaks = q('input[data-role="launch-tweaks"]');
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
    hasLevel: !!level, hasHp: !!hp, hasTweaks: !!tweaks, hasCopyLink: !!q('button[data-role="launch-copy-link"]'),
    levelValue: level ? level.value : null,
    status: status ? status.textContent : null,
    link: status ? status.dataset.link ?? null : null,
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
    partyLevels: live && bt.run ? Object.fromEntries(bt.run.party.map((u) => [u.id, u.level])) : null,
    partyHp: live && bt.run ? Object.fromEntries(bt.run.party.map((u) => [u.id, [u.hp, u.maxHp]])) : null,
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
        check("lever 5 — the party setup: level, start HP % and per-unit fields", t.hasLevel && t.hasHp && t.hasTweaks);
        check("the Copy link button is present", t.hasCopyLink);
        await shot(g, path.join(OUT, "01-launch-tab.png"));

        console.log("• the target picker offers drafts, content levels AND expedition nodes");
        check("the draft is offered", t.targetOptions.includes("draft"));
        check("content levels are offered", t.targetOptions.some((v) => v.startsWith("level:")));
        check("the finale level is offered", t.targetOptions.includes("level:the-rescue"));
        check("expedition nodes are offered", t.targetOptions.some((v) => v.startsWith("node:")));
        check("the finale NODE is offered", t.targetOptions.includes("node:the-rescue-expedition:finale"));
        check("the Hollow Mill arc's finale node is offered too", t.targetOptions.includes("node:hollow-mill:finale"));
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
        const fits = await g.eval(`(() => Object.fromEntries(["launch-seed", "launch-level", "launch-hp", "launch-tweaks"].map((role) => {
          const i = document.querySelector('input[data-role="' + role + '"]');
          const probe = document.createElement("span");
          probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:" + getComputedStyle(i).font;
          probe.textContent = i.placeholder; document.body.appendChild(probe);
          const w = probe.getBoundingClientRect().width; probe.remove();
          return [role, w <= i.clientWidth - 6];
        })))()`);
        check("the seed placeholder renders un-clipped in its field", fits["launch-seed"] === true);
        check("…and so do the party-setup placeholders", fits["launch-level"] && fits["launch-hp"] && fits["launch-tweaks"]);
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
        // The seed from step 6 is still "probe-seed-42" — for a node it is the route SALT, and a
        // non-number used to be dropped silently. It must refuse now, saying why.
        await g.eval(`document.querySelector('button[data-role="launch"]').click()`);
        await sleep(500);
        b = await g.eval(BATTLE);
        t = await g.eval(TAB);
        check("a non-number seed on a node launch refuses (stays in the editor)", b.editorActive && !b.battleActive);
        check("…and says the node seed must be a whole number", /whole number/.test(t.status));
        await g.eval(setText("launch-seed", ""));
        await sleep(80);
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

        // ---------------------------------------------------------------
        // 7b. The PARTY SETUP on the Hollow Mill finale: the arc's arrival party, re-levelled.
        // ---------------------------------------------------------------
        console.log("• the Hollow Mill finale with the arrival party at level 6, Rook at 8 and full HP");
        await g.eval(clickTab("Launch"));
        await g.eval(setSelect("launch-target", "node:hollow-mill:finale"));
        await g.eval(setText("launch-level", "6"));
        await g.eval(setText("launch-tweaks", "rook.level=8; rook.hp=100"));
        await sleep(150);
        t = await g.eval(TAB);
        check("the status previews the arrival party and the setup", /arrival party/.test(t.status) && /level 6/.test(t.status));
        await g.eval(`document.querySelector('button[data-role="launch"]').click()`);
        await sleep(2500);
        b = await g.eval(BATTLE);
        check("the Hollow Mill finale booted", b.battleActive && b.nodeId === "finale" && b.encounterId === "the-rescue");
        const lv = b.partyLevels || {};
        check("it fielded the ARC party (Edrin, the Lord, is in it — not a kit)", "edrin" in lv);
        check("every other unit is at level 6", Object.entries(lv).every(([id, n]) => id === "rook" || n === 6));
        check("the per-unit tweak won for Rook (level 8)", lv.rook === 8);
        check("…at full HP", b.partyHp && b.partyHp.rook[0] === b.partyHp.rook[1]);
        await g.screenshot(path.join(OUT, "06b-hollow-mill-levelled.png"));
        await exitToEditor(g);

        console.log("• a per-unit tweak naming a unit the party lacks refuses, listing the party");
        await g.eval(clickTab("Launch"));
        await g.eval(setText("launch-tweaks", "nyx.level=3"));
        await sleep(80);
        await g.eval(`document.querySelector('button[data-role="launch"]').click()`);
        await sleep(2000);
        b = await g.eval(BATTLE);
        t = await g.eval(TAB);
        check("the launch refused (stays in the editor)", b.editorActive && !b.battleActive);
        check("…naming the missing unit and the real party", /no party unit "nyx"/.test(t.status) && /edrin/.test(t.status));

        // ---------------------------------------------------------------
        // 7c. Copy link → the #launch boot reaches the same fight in a fresh document.
        // ---------------------------------------------------------------
        console.log("• Copy link, then boot the link in a fresh document");
        await g.eval(setText("launch-tweaks", "rook.level=8"));
        await g.eval(`document.querySelector('button[data-role="launch-copy-link"]').click()`);
        await sleep(150);
        t = await g.eval(TAB);
        check("Copy link produced a #launch link", typeof t.link === "string" && t.link.includes("#launch?"));
        const linkHash = t.link.slice(t.link.indexOf("#"));
        check("…carrying the target, the level and the tweak",
          /target=node%3Ahollow-mill%3Afinale/.test(linkHash) && /level=6/.test(linkHash) && /tweaks=rook.level%3D8/.test(linkHash));
        await g.boot(linkHash);
        await sleep(2500);
        b = await g.eval(BATTLE);
        check("the link booted straight into the finale", b.battleActive && b.nodeId === "finale" && b.encounterId === "the-rescue");
        check("…with the same party setup (level 6, Rook 8)",
          (b.partyLevels || {}).rook === 8 && Object.entries(b.partyLevels || {}).every(([id, n]) => id === "rook" || n === 6));
        await g.screenshot(path.join(OUT, "06c-launch-link.png"));

        console.log("• a bad link says why on screen instead of freezing");
        await g.boot("#launch?target=level:no-such-level");
        await sleep(900);
        const linkErr = await g.eval(`window.campfireLaunchError ?? null`);
        check("the bad link reported its reason", /no content level "no-such-level"/.test(linkErr || ""));
        b = await g.eval(BATTLE);
        check("…and did not start a battle", !b.battleActive);
        await g.screenshot(path.join(OUT, "06d-bad-link.png"));

        await g.boot("#editor");
        await sleep(900);

        // ---------------------------------------------------------------
        // 8. The last launch survives a RELOAD (D113), not just a scene return.
        // ---------------------------------------------------------------
        console.log("• the four levers survive a full page reload");
        await g.eval(clickTab("Launch"));
        await g.eval(setSelect("launch-target", "level:the-rescue"));
        await g.eval(setSelect("launch-kit", "Skirmishers (4)"));
        await g.eval(setFlag("side-door-intel", true));
        await g.eval(`(() => { const s = document.querySelector('input[data-role="launch-seed"]');
          s.value = "sticky-seed"; s.dispatchEvent(new Event("input")); })()`);
        await g.eval(setText("launch-tweaks", "")); // the level stays: it must survive the reload too
        await sleep(150);

        await g.boot("#editor"); // a genuine fresh document, not a scene restart
        await sleep(900);
        await g.eval(clickTab("Launch"));
        await sleep(150);
        t = await g.eval(TAB);
        check("the target survived the reload", t.targetValue === "level:the-rescue");
        check("the kit survived the reload", t.kitValue === "Skirmishers (4)");
        check("the seed survived the reload", t.seedValue === "sticky-seed");
        check("the party level survived the reload", t.levelValue === "6");
        const flagOn = await g.eval(`document.querySelector('input[data-role="launch-flag-side-door-intel"]').checked`);
        check("the flag survived the reload", flagOn === true);
        check("…and it is immediately re-launchable (status reads OK)", /✓/.test(t.status));
        await shot(g, path.join(OUT, "07-restored-after-reload.png"));

        // ---------------------------------------------------------------
        // 9. A tampered store must not wedge the tab, and a stale flag must be SAID.
        // ---------------------------------------------------------------
        console.log("• a garbage launch store falls back cleanly instead of wedging");
        await g.eval(`localStorage.setItem("campfire-editor-launch", "{not json")`);
        await g.boot("#editor");
        await sleep(900);
        await g.eval(clickTab("Launch"));
        await sleep(150);
        t = await g.eval(TAB);
        check("the editor still booted with a live Launch tab", t.hasTab && t.hasTarget && t.hasButton);
        check("…falling back to the draft default", t.targetValue === "draft");

        console.log("• a STALE flag id is dropped and named, not silently swallowed");
        await g.eval(`localStorage.setItem("campfire-editor-launch", JSON.stringify(
          { targetKey: "level:the-rescue", kit: "Standard (3)", flags: ["side-door-intel", "ghost-flag"], seed: "" }))`);
        await g.boot("#editor");
        await sleep(900);
        await g.eval(clickTab("Launch"));
        await sleep(150);
        t = await g.eval(TAB);
        check("the tab reports the dropped flag by name", /ghost-flag/.test(t.status));
        const keptReal = await g.eval(`document.querySelector('input[data-role="launch-flag-side-door-intel"]').checked`);
        check("…while keeping the flag that IS known", keptReal === true);
        await shot(g, path.join(OUT, "08-stale-flag-dropped.png"));

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
