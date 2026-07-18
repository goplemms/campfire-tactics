// E2E: interactable gates (D103 Phase 2b) — the render + interaction surface a data-only test
// can't catch. Boots `#scene=jailbreak` and proves: locked gates render (▦, blocking their tiles),
// the Thief's **Pick Cell** verb surfaces, lockpicking a cell redraws the board without a freeze,
// and defeating the Warden (keyholder) pops every keyholder cell — each a scene reaction (drawGrid +
// marker teardown + log) that an uncaught exception would turn into a hard freeze. The guard
// CLAUDE.md requires when a new player-facing surface (the gate) lands.
//
// Run:  npm run test:e2e:gates   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-gates");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const SNAP = `return {
  phase: s.phase,
  gates: s.battle.gates.map(g => ({ id: g.id, locked: g.locked, walkable: s.grid.isWalkable(g.pos) })),
  gateMarkers: s.gateMarkers.length,
  gateGlyph: s.gateMarkers.length ? (s.gateMarkers[0].text ?? null) : null,
  boundPrisoners: s.battle.units.filter(u => u.captured).length,
  verbs: s.actionButtons.map(b => b.label && b.label.text).filter(Boolean),
};`;

async function main() {
  await withGame(
    async (g) => {
      const snap = () => g.bsEval(SNAP);
      try {
        await sleep(1300); // ScenarioBootScene → BattleScene: stage → deploy → first turn (infil)
        let st = await snap();
        console.log("• #scene=jailbreak renders locked gates on a deployment board");
        check("the scenario staged into deployment", st.phase === "deployment");
        check("both gates render as locked", st.gates.length === 2 && st.gates.every(x => x.locked));
        check("a locked gate blocks its tile (encloses)", st.gates.every(x => x.walkable === false));
        check("each locked gate shows the ▦ marker", st.gateMarkers === 2 && st.gateGlyph === "▦");
        check("both prisoners start bound behind their gates", st.boundPrisoners === 2);
        check("the Thief's Pick Cell verb surfaces (adjacent to cell-a)", st.verbs.includes("Pick Cell"));
        await g.screenshot(path.join(OUT, "01-locked.png"));

        // Lockpick cell-a via the real openGate path → the scene's gateOpened listener redraws the
        // grid (the tile clears) + drops the marker + logs. A freeze here (a null texture on the
        // recreated grid, a bad marker) would throw — assertNoProblems catches it.
        const picked = await g.bsEval(`
          const gate = s.battle.gates.find(x => x.id === "cell-a");
          const thief = s.battle.units.find(u => u.id === "infil"); // holds Expert Lockpick
          s.battle.openGate(gate, thief);
          return { locked: gate.locked, walkable: s.grid.isWalkable(gate.pos), markers: s.gateMarkers.length };
        `);
        console.log("• the Thief lockpicks cell-a (render redraws, no freeze)");
        check("cell-a unlocked + its tile is now walkable", picked.locked === false && picked.walkable === true);
        check("the opened gate dropped its marker (1 gate still locked)", picked.markers === 1);
        await g.screenshot(path.join(OUT, "02-picked.png"));

        // Defeat the Warden (the keyholder) → every keyholder cell pops automatically.
        const keys = await g.bsEval(`
          const warden = s.battle.units.find(u => u.id === "the-warden");
          const vanguard = s.battle.units.find(u => u.id === "vanguard");
          vanguard.pos = { col: warden.pos.col - 1, row: warden.pos.row }; // step adjacent
          s.battle.attack(vanguard, warden);                               // one-shot (attack 60)
          const b = s.battle.gates.find(x => x.id === "cell-b");
          return { wardenAlive: warden.alive, cellBLocked: b.locked, markers: s.gateMarkers.length };
        `);
        console.log("• defeating the Warden pops the keyholder cell");
        check("the Warden fell", keys.wardenAlive === false);
        check("cell-b (keyholder-only) sprang open on the kill", keys.cellBLocked === false);
        check("no locked-gate markers remain", keys.markers === 0);
        await g.screenshot(path.join(OUT, "03-keyholder.png"));

        assertNoProblems(g.problems);
      } catch (err) {
        await g.screenshot(path.join(OUT, "zz-failure.png")).catch(() => {});
        throw err;
      }
    },
    { hash: "#scene=jailbreak" },
  );
  console.log(`\n✓ gates E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
