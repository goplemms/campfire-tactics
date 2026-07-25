// E2E: the guard-doctrine harness (D108/D117, M4) — boot `#scene=doctrine-harness` and prove the garrison
// door-drive RENDERS without a freeze. This is the surface only a real render catches (CLAUDE.md / D92 /
// #168 cautionary tale): the core suite + sim never render a garrison door-fight, so a scene-render
// exception on the seal-key-open surface would read as a *freeze*, not a stack trace. The walker drives the
// Warden's turn through the model (`runPolicyTurn`, the established #scene pattern) and asserts the seal
// opens / stays shut in the live scene with zero page errors. The *behavioral* proofs (in-combat gate, the
// free-casualty ceiling) are deterministic headless tests — this walker owns the freeze/render guard.
//
// Run:  npm run test:e2e:doctrine   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-doctrine");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// A compact snapshot of the staged doctrine board.
const SNAP = `return {
  phase: s.phase,
  players: s.battle.units.filter(u => u.side === "player" && u.alive && !u.captured).length,
  enemies: s.battle.units.filter(u => u.side === "enemy").length,
  garrison: s.battle.units.filter(u => u.side === "enemy" && u.tags.includes("garrison")).length,
  wardenIsKeyholder: (() => { const w = s.battle.units.find(u => u.id === "warden"); const g = s.battle.gates.find(g => g.id === "seal"); return !!(w && g); })(),
  sealLocked: (() => { const g = s.battle.gates.find(g => g.id === "seal"); return g ? g.locked : null; })(),
  sealTileWalkable: s.grid.isWalkable({ col: 3, row: 1 }),
  gateGlyphs: s.gateMarkers.length,
  leverGlyphs: s.leverMarkers.length,
  infilAtControlRoom: (() => { const u = s.battle.units.find(u => u.id === "infil"); return u ? (u.pos.col === 2 && u.pos.row === 0) : null; })(),
};`;

async function main() {
  await withGame(
    async (g) => {
      const snap = () => g.bsEval(SNAP);
      try {
        // --- The two-mouth board boots and RENDERS (the freeze-catch) -------------
        await sleep(1300); // ScenarioBootScene → BattleScene: stage → enterDeploy → first turn
        let st = await snap();
        console.log("• #scene=doctrine-harness boots the guard-doctrine board");
        check("the harness renders — phase is deployment (no freeze on the new surface)", st.phase === "deployment");
        check("the two-mouth party is fielded (infiltrator + anchor)", st.players === 2);
        check("the whole garrison is on the board (Warden + guard, both tagged)", st.enemies === 2 && st.garrison === 2);
        check("the infiltrator deploys on the control-room side (D99 side door)", st.infilAtControlRoom === true);
        check("the control-room seal renders locked (a gate glyph, blocking its tile)", st.sealLocked === true && st.gateGlyphs >= 1 && st.sealTileWalkable === false);
        check("the lever renders (the re-seal control, Decision G)", st.leverGlyphs >= 1);
        await g.screenshot(path.join(OUT, "01-doctrine-deploy.png"));
        assertNoProblems(g.problems);

        // --- The door-drive keys the seal OPEN in the live scene ------------------
        // The critical render surface: the Warden drives to the seal and turns his key; the scene must
        // re-render the gate transitioning locked→open (the D92 `showStoryScreen`-style crash risk) with
        // no page error. Drive it through the model (the #scene walker pattern), read the live scene back.
        const keyed = await g.bsEval(`
          const warden = s.battle.units.find(u => u.id === "warden");
          const seal = s.battle.gates.find(g => g.id === "seal");
          const plan = s.battle.runPolicyTurn(warden); // !in-combat → drives past the infiltrator + keys
          return { gateAct: plan.gateAct, keptTarget: !!plan.target, sealLocked: seal.locked, walkable: s.grid.isWalkable({ col: 3, row: 1 }) };
        `);
        console.log("• the Warden keys the seal open (the door-drive render surface)");
        check("the un-engaged Warden drives to the seal and keys it (not attacks)", keyed.gateAct === "key" && keyed.keptTarget === false);
        check("the seal opens in the live scene — its tile unblocks", keyed.sealLocked === false && keyed.walkable === true);
        await g.screenshot(path.join(OUT, "02-doctrine-keyed.png"));
        assertNoProblems(g.problems); // the seal-open re-render did not freeze — the whole point of M4

        // --- Pinned: a struck Warden STOPS and fights, the seal stays shut --------
        // Re-boot a fresh board; stage a real exchange (the infiltrator strikes the Warden), then drive
        // him: `in-combat` (read off the live event log) flips the drive off — he fights, the seal holds.
        await g.boot("#scene=doctrine-harness");
        await sleep(1300);
        const pinned = await g.bsEval(`
          const warden = s.battle.units.find(u => u.id === "warden");
          const infil = s.battle.units.find(u => u.id === "infil");
          const seal = s.battle.gates.find(g => g.id === "seal");
          infil.pos = { col: 1, row: 0 };        // step adjacent to the Warden at (1,1)
          const dealt = s.battle.attack(infil, warden); // a logged strike → in-combat this window
          const plan = s.battle.runPolicyTurn(warden);
          return { dealt, targetId: plan.target && plan.target.id, gateAct: plan.gateAct, sealLocked: seal.locked };
        `);
        console.log("• a pinned Warden stops and fights — the seal stays shut");
        check("the infiltrator's strike lands (a real logged exchange)", pinned.dealt > 0);
        check("the pinned Warden attacks the engager, does NOT key", pinned.targetId === "infil" && !pinned.gateAct);
        check("the seal stays shut while the Warden is engaged", pinned.sealLocked === true);
        await g.screenshot(path.join(OUT, "03-doctrine-pinned.png"));
        assertNoProblems(g.problems);

        // --- The bare-#scene picker lists the harness ----------------------------
        await g.boot("#scene");
        await sleep(500);
        const picker = await g.eval(`(() => {
          const scene = window.game.scene.getScene("ScenarioBootScene");
          if (!scene || !scene.scene.isActive("ScenarioBootScene")) return { active: false };
          const texts = scene.children.list.filter(o => o.type === "Text").map(o => o.text);
          return { active: true, texts };
        })()`);
        console.log("• bare #scene lists the doctrine harness in the picker");
        check("the picker scene is active", picker.active === true);
        check("the picker lists the harness title", picker.texts.some((t) => /Guard Doctrine Harness/.test(t)));
        check("the picker offers the thief + scout arms", picker.texts.some((t) => /thief/.test(t)) && picker.texts.some((t) => /scout/.test(t)));
        await g.screenshot(path.join(OUT, "04-picker.png"));

        assertNoProblems(g.problems);
      } catch (err) {
        await g.screenshot(path.join(OUT, "zz-failure.png")).catch(() => {});
        throw err;
      }
    },
    { hash: "#scene=doctrine-harness" },
  );

  console.log(`\n✓ doctrine-harness E2E: ${passed} assertions passed, no page errors`);
  console.log(`  stage screenshots → ${path.relative(ROOT, OUT)}/`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
