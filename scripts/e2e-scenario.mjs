// E2E: the scenario harness (#170) — boot an ARBITRARY encounter run-less via
// `#scene=<id>` and assert the synthetic one-node run actually RENDERS a real
// deployment board (the red-team's residual-risk check: BattleScene reads off a
// synthetic run). Also proves the party-arm switch (`?party=<name>`) and that a
// natively-cuffed captive shows its lock glyph on boot with zero poking — the D90
// taste, isolated, no live-node hijack.
//
// Run:  npm run test:e2e:scenario   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-scenario");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// A compact snapshot of the staged scenario board.
const SNAP = `return {
  phase: s.phase,
  players: s.battle.units.filter(u => u.side === "player" && u.alive && !u.captured).length,
  enemies: s.battle.units.filter(u => u.side === "enemy").length,
  prisonerBound: (() => { const p = s.battle.units.find(u => u.id === "prisoner"); return p ? !!p.captured : null; })(),
  prisonerCuffed: (() => { const p = s.battle.units.find(u => u.id === "prisoner"); return p ? (p.release && p.release.kind === "lockpick") : null; })(),
  infilJob: (() => { const u = s.battle.units.find(u => u.id === "infil"); return u ? u.primaryJob : null; })(),
  lockGlyphs: s.captiveMarkers.length,
  lockGlyph: s.captiveMarkers.length ? (s.captiveMarkers[0].text ?? null) : null,
};`;

async function main() {
  await withGame(
    async (g) => {
      const snap = () => g.bsEval(SNAP);
      try {
        // --- The thief arm (the default) boots straight into a real board --------
        await sleep(1300); // ScenarioBootScene → BattleScene: stage → enterDeploy → first turn
        let st = await snap();
        console.log("• #scene=pick-the-cell boots a real deployment board");
        check("the synthetic run renders — phase is deployment", st.phase === "deployment");
        check("the party arm is fielded (two bodies)", st.players === 2);
        check("the garrison is on the board (3 enemies)", st.enemies === 3);
        check("the prisoner is staged bound", st.prisonerBound === true);
        check("the prisoner is cuffed (release: lockpick)", st.prisonerCuffed === true);
        check("a cuffed captive shows the lock glyph on boot — no poking (⚿)", st.lockGlyphs === 1 && st.lockGlyph === "⚿");
        check("the default arm is the thief (has Expert Lockpick)", st.infilJob === "thief");
        await g.screenshot(path.join(OUT, "01-pick-the-cell-thief.png")); // the cuffed cell, pre-pick

        // The taste's payoff, on a GENUINELY cuffed captive + a GENUINE Thief (no live-node
        // hijack — this is what #170 retired from e2e-deploy-battle): the Thief picks the
        // cell at deploy → the captive is freed and the lock glyph drops.
        const pick = await g.bsEval(`
          const prisoner = s.battle.units.find(u => u.id === "prisoner");
          const thief = s.battle.units.find(u => u.id === "infil"); // holds Expert Lockpick
          s.battle.rescue(prisoner, thief);   // the Thief picks the cell → unitRescued
          return { freed: !prisoner.captured, glyphGone: s.captiveMarkers.length === 0 };
        `);
        console.log("• the Thief picks the cell (D90 payoff, no hijack)");
        check("the Thief picks the cell — the captive is freed", pick.freed === true);
        check("the freed captive drops its lock glyph", pick.glyphGone === true);
        await g.screenshot(path.join(OUT, "01b-pick-the-cell-freed.png"));

        // --- The party-arm switch re-boots the same board with the scout ---------
        await g.boot("#scene=pick-the-cell?party=scout");
        await sleep(1300);
        st = await snap();
        console.log("• ?party=scout boots the frontal arm on the same board");
        check("the scout arm boots a real board too", st.phase === "deployment" && st.players === 2 && st.enemies === 3);
        check("the infiltrator is now the scout (no lockpick)", st.infilJob === "scout");
        check("the captive stays cuffed regardless of party arm", st.prisonerBound === true && st.lockGlyphs === 1);
        // The C4 refusal, on the real board: a non-lockpick rescuer is refused — an unlogged
        // no-op that mutates nothing, so the cell holds and the scout party runs the frontal fight.
        const refused = await g.bsEval(`
          const prisoner = s.battle.units.find(u => u.id === "prisoner");
          const scout = s.battle.units.find(u => u.id === "infil"); // no lockpick
          const logBefore = s.battle.log.length;
          s.battle.rescue(prisoner, scout);   // refused — unlogged no-op
          return { stillCuffed: !!prisoner.captured, glyphs: s.captiveMarkers.length, unlogged: s.battle.log.length === logBefore };
        `);
        console.log("• the scout is refused the pick (C4)");
        check("the rescue gate refuses a non-lockpick rescuer — the cell holds", refused.stillCuffed === true);
        check("the refusal keeps the lock glyph and logs nothing", refused.glyphs === 1 && refused.unlogged === true);
        await g.screenshot(path.join(OUT, "02-pick-the-cell-scout.png"));

        // --- The dual-OR finale scenario (D97): the extraction render surface ----
        await g.boot("#scene=prison-assault");
        await sleep(1300);
        const fin = await g.bsEval(`
          const objs = s.loop.staged.objectives;
          const ext = objs.find(o => o.spec.kind === "extraction");
          const prisoners = s.battle.units.filter(u => u.role === "prisoner");
          return {
            phase: s.phase,
            players: s.battle.units.filter(u => u.side === "player" && u.alive && !u.captured).length,
            enemies: s.battle.units.filter(u => u.side === "enemy").length,
            prisoners: prisoners.length,
            cuffed: prisoners.filter(p => p.captured && p.release && p.release.kind === "lockpick").length,
            lockGlyphs: s.captiveMarkers.length,
            goals: objs.map(o => o.spec.kind).sort().join(","),
            exitZone: !!s.exitZoneGfx,
            exitSpan: ext ? (ext.spec.span || []).length : 0,
            legendHasExit: s.legendStrip.list.some(o => typeof o.text === "string" && /extract here/i.test(o.text)),
            objectiveLabels: s.objectiveObjects.filter(o => typeof o.text === "string").map(o => o.text),
            infilJob: (() => { const u = s.battle.units.find(u => u.id === "infil"); return u ? u.primaryJob : null; })(),
          };
        `);
        console.log("• #scene=prison-assault boots the dual-OR finale board (D97)");
        check("the finale renders a deployment board", fin.phase === "deployment");
        check("the infiltration party is fielded (two bodies)", fin.players === 2);
        check("the garrison is on the board (3 enemies)", fin.enemies === 3);
        check("two cuffed cells are staged (lockpick)", fin.prisoners === 2 && fin.cuffed === 2);
        check("both cells show a lock glyph on boot", fin.lockGlyphs === 2);
        check("the two OR'd goals are staged (eliminate-all + extraction)", fin.goals === "eliminate-all,extraction");
        check("the exit-span zone is painted", fin.exitZone === true && fin.exitSpan > 0);
        check("the board key explains the exit band (legend entry, D97)", fin.legendHasExit === true);
        check("the extraction objective row renders in the check-list", fin.objectiveLabels.some((t) => /escort them to the exit/i.test(t)));
        check("the default arm is the infiltration thief", fin.infilJob === "thief");
        await g.screenshot(path.join(OUT, "04-prison-assault-deploy.png"));

        // The extraction payoff in the real scene: the Thief picks BOTH cells and the
        // prisoners are walked to the exit → the extraction goal reads met — a win WITHOUT
        // touching the garrison (the OR'd second win-path, D97). Then re-render the check-list.
        const extract = await g.bsEval(`
          const thief = s.battle.units.find(u => u.id === "infil");
          const prisoners = s.battle.units.filter(u => u.role === "prisoner");
          const ext = s.loop.staged.objectives.find(o => o.spec.kind === "extraction");
          const exit = ext.spec.span;
          prisoners.forEach((p, i) => { s.battle.rescue(p, thief); p.pos = { col: exit[i].col, row: exit[i].row }; });
          s.refreshObjectives();
          return {
            freed: prisoners.every(p => !p.captured),
            glyphsGone: s.captiveMarkers.length === 0,
            extractionMet: ext.status() === "met",
            garrisonUp: s.battle.units.some(u => u.side === "enemy" && u.alive),
          };
        `);
        console.log("• the Thief extracts the prisoners (the extraction win-path, D97)");
        check("the Thief picks both cells — the prisoners are freed", extract.freed === true);
        check("the freed prisoners drop their lock glyphs", extract.glyphsGone === true);
        check("escorting both to the exit marks the extraction goal met (✓)", extract.extractionMet === true);
        check("…a win with the garrison still standing (OR'd)", extract.garrisonUp === true);
        await g.screenshot(path.join(OUT, "04b-prison-assault-extracted.png"));

        // The frontal arm (no lockpick): the cells hold — it must storm the garrison (C4).
        await g.boot("#scene=prison-assault?party=frontal");
        await sleep(1300);
        const front = await g.bsEval(`
          const prisoners = s.battle.units.filter(u => u.role === "prisoner");
          const infil = s.battle.units.find(u => u.id === "infil");
          return {
            infilJob: infil ? infil.primaryJob : null,
            cuffed: prisoners.filter(p => p.captured).length,
            lockGlyphs: s.captiveMarkers.length,
            exitZone: !!s.exitZoneGfx,
          };
        `);
        console.log("• ?party=frontal boots the storm-the-garrison arm (C4)");
        check("the frontal arm has no Thief (infil is a soldier)", front.infilJob === "soldier");
        check("the cells hold for a Thief-less party (still cuffed, glyphs shown)", front.cuffed === 2 && front.lockGlyphs === 2);
        check("the exit route still renders for the frontal arm", front.exitZone === true);
        await g.screenshot(path.join(OUT, "04c-prison-assault-frontal.png"));

        // --- The bare-#scene picker renders without error ------------------------
        await g.boot("#scene");
        await sleep(500);
        const picker = await g.eval(`(() => {
          const scene = window.game.scene.getScene("ScenarioBootScene");
          if (!scene || !scene.scene.isActive("ScenarioBootScene")) return { active: false };
          const texts = scene.children.list.filter(o => o.type === "Text").map(o => o.text);
          return { active: true, texts };
        })()`);
        console.log("• bare #scene renders the picker");
        check("the picker scene is active", picker.active === true);
        check("the picker lists the scenario title", picker.texts.some((t) => /Scenario Harness/.test(t)));
        check("the picker offers the thief + scout arms", picker.texts.some((t) => /thief/.test(t)) && picker.texts.some((t) => /scout/.test(t)));
        await g.screenshot(path.join(OUT, "03-picker.png"));

        assertNoProblems(g.problems);
      } catch (err) {
        await g.screenshot(path.join(OUT, "zz-failure.png")).catch(() => {});
        throw err;
      }
    },
    { hash: "#scene=pick-the-cell" },
  );

  console.log(`\n✓ scenario-harness E2E: ${passed} assertions passed, no page errors`);
  console.log(`  stage screenshots → ${path.relative(ROOT, OUT)}/`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
