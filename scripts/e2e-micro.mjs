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
  {
    id: "micro-gate-destructible",
    title: "gate · destructible — battering a door down over two hits",
    async run(g) {
      const st = await g.bsEval(`
        const gate = s.battle.gates[0];
        return { locked: gate.locked, hp: gate.hp, maxHp: gate.maxHp, markers: s.gateMarkers.length,
                 verbs: s.actionButtons.map(b => b.label && b.label.text).filter(Boolean) };`);
      check("the door renders locked with its 15/15 durability readout", st.locked === true && st.hp === 15 && st.maxHp === 15 && st.markers === 2);
      check("the Break Gate verb surfaces", st.verbs.includes("Break Gate"));
      // First hit: the door holds (durability drops, still locked → gateDamaged, no freeze).
      const hit1 = await g.bsEval(`
        const gate = s.battle.gates[0]; const breaker = s.battle.units.find(u => u.id === "breaker");
        s.battle.attackGate(gate, breaker); // attack 9 → 15 - 9 = 6
        return { locked: gate.locked, hp: gate.hp, walkable: s.grid.isWalkable(gate.pos) };`);
      check("one hit chips it but the door holds (6 hp, still blocking)", hit1.locked === true && hit1.hp === 6 && hit1.walkable === false);
      // Second hit: it breaks open (gateOpened cause=destroyed → grid redraw, markers clear, no freeze).
      const hit2 = await g.bsEval(`
        const gate = s.battle.gates[0]; const breaker = s.battle.units.find(u => u.id === "breaker");
        s.battle.attackGate(gate, breaker); // 6 - 9 → 0, breaks
        return { locked: gate.locked, hp: gate.hp, walkable: s.grid.isWalkable(gate.pos), markers: s.gateMarkers.length };`);
      check("the second hit smashes it open — tile clears, markers gone (no freeze)", hit2.locked === false && hit2.hp === 0 && hit2.walkable === true && hit2.markers === 0);
    },
  },
  {
    id: "micro-gate-enemy-batter",
    title: "gate · enemy AI — a walled-off guard batters the door down",
    async run(g) {
      const st = await g.bsEval(`return { locked: s.battle.gates[0].locked, hp: s.battle.gates[0].hp, markers: s.gateMarkers.length };`);
      check("the door renders locked with 20/20 durability", st.locked === true && st.hp === 20 && st.markers === 2);
      // One enemy turn: walled off from the party (the door seals the only route) → it plans attackGate.
      const t1 = await g.bsEval(`
        const enemy = s.battle.units.find(u => u.side === "enemy");
        const plan = s.battle.runPolicyTurn(enemy); // plan + apply (fires gateDamaged on the bus → the scene renders)
        return { gateTarget: plan.gateTarget ? plan.gateTarget.id : null, hp: s.battle.gates[0].hp };`);
      check("the guard plans to batter the door (not idle against it)", t1.gateTarget === "door");
      check("the door takes a hit from the enemy — durability drops (no freeze)", t1.hp < 20);
      // Keep battering across turns until the seal breaks.
      const broke = await g.bsEval(`
        const enemy = s.battle.units.find(u => u.side === "enemy");
        for (let i = 0; i < 6 && s.battle.gates[0].locked; i++) s.battle.runPolicyTurn(enemy);
        return { locked: s.battle.gates[0].locked, markers: s.gateMarkers.length };`);
      check("the guard batters it down over several turns — the seal breaks open (no freeze)", broke.locked === false && broke.markers === 0);
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
