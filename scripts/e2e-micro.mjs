// E2E: the micro-interaction harness (D103/D104). Walks a set of MINIMAL single-mechanic scenes in
// ONE Chrome session (via g.boot, far cheaper than a browser per case) and proves each interaction
// RENDERS + drives without a freeze — the middle rung between the vitest microtests (logic only) and
// the full-encounter click-throughs (integrated flow). Each mechanic's render guard is one tiny
// fixture (src/core/scenarios/micro.ts) + one block below; the fixtures double as a clickable gallery.
//
// Run:  npm run test:e2e:micro   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-micro");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`    ✓ ${name}`);
}

/**
 * Each micro: `{ id, title, run(g) }`. The walker boots `#scene=<id>` (deployment), then `run` drives
 * the single interaction via bsEval and asserts the VISIBLE effect; a freeze surfaces as a page error
 * caught by assertNoProblems after each case.
 */
const MICROS = [
  {
    id: "micro-gate-lockpick",
    title: "gate · lockpick — the Thief opens an adjacent cell",
    async run(g) {
      const st = await g.bsEval(`
        const gate = s.battle.gates[0];
        return {
          locked: gate.locked, walkable: s.grid.isWalkable(gate.pos),
          markers: s.gateMarkers.length, glyph: s.gateMarkers.length ? (s.gateMarkers[0].text ?? null) : null,
          verbs: s.actionButtons.map(b => b.label && b.label.text).filter(Boolean),
        };`);
      check("the cell renders locked + blocking its tile (▦)", st.locked === true && st.walkable === false && st.markers === 1 && st.glyph === "▦");
      check("the Thief's Pick Cell verb surfaces", st.verbs.includes("Pick Cell"));
      const after = await g.bsEval(`
        const gate = s.battle.gates[0];
        const thief = s.battle.units.find(u => u.id === "infil");
        s.battle.openGate(gate, thief);
        return { locked: gate.locked, walkable: s.grid.isWalkable(gate.pos), markers: s.gateMarkers.length };`);
      check("lockpicking opens it — the tile clears + the marker drops (no freeze)", after.locked === false && after.walkable === true && after.markers === 0);
    },
  },
  {
    id: "micro-gate-keyholder",
    title: "gate · keyholder — felling the warden pops the cell",
    async run(g) {
      const st = await g.bsEval(`return { locked: s.battle.gates[0].locked, markers: s.gateMarkers.length };`);
      check("the cell renders locked", st.locked === true && st.markers === 1);
      const after = await g.bsEval(`
        const warden = s.battle.units.find(u => u.id === "warden");
        const striker = s.battle.units.find(u => u.id === "striker");
        s.battle.attack(striker, warden); // adjacent at spawn; attack 60 one-shots the thug-warden
        return { wardenAlive: warden.alive, locked: s.battle.gates[0].locked, markers: s.gateMarkers.length };`);
      check("the warden fell", after.wardenAlive === false);
      check("the keyholder cell sprang open — the marker cleared (no freeze)", after.locked === false && after.markers === 0);
    },
  },
];

async function main() {
  await withGame(
    async (g) => {
      for (const m of MICROS) {
        console.log(`• ${m.title}`);
        await g.boot(`#scene=${m.id}`);
        await sleep(1200); // ScenarioBootScene → BattleScene: stage → deploy → first turn
        try {
          await m.run(g);
          await g.screenshot(path.join(OUT, `${m.id}.png`));
        } catch (err) {
          await g.screenshot(path.join(OUT, `zz-${m.id}-failure.png`)).catch(() => {});
          throw err;
        }
        assertNoProblems(g.problems); // catch a freeze from THIS interaction (cumulative → fail-fast)
      }
    },
    { hash: "#scene" }, // boot the bare picker first; the loop re-boots each fixture
  );
  console.log(`\n✓ micro-interaction E2E: ${passed} assertions across ${MICROS.length} micro-interactions, no page errors`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
