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
      // Second hit: it smashes to a PERMANENT remnant (D106) — tile clears, the ▦/HP readout gives way to
      // the passable ▨ remnant marker (gateOpened cause=destroyed → grid redraw + remark, no freeze).
      const hit2 = await g.bsEval(`
        const gate = s.battle.gates[0]; const breaker = s.battle.units.find(u => u.id === "breaker");
        s.battle.attackGate(gate, breaker); // 6 - 9 → 0, breaks
        return { locked: gate.locked, broken: gate.broken, hp: gate.hp, walkable: s.grid.isWalkable(gate.pos),
                 markers: s.gateMarkers.length, glyph: s.gateMarkers.length ? (s.gateMarkers[0].text ?? null) : null };`);
      check("the second hit smashes it to a passable remnant (▨, permanent, no freeze)",
        hit2.locked === false && hit2.broken === true && hit2.hp === 0 && hit2.walkable === true && hit2.markers === 1 && hit2.glyph === "▨");
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
      // Keep battering across turns until the seal is smashed to a permanent remnant (D106).
      const broke = await g.bsEval(`
        const enemy = s.battle.units.find(u => u.side === "enemy");
        for (let i = 0; i < 6 && s.battle.gates[0].locked; i++) s.battle.runPolicyTurn(enemy);
        const gate = s.battle.gates[0];
        return { locked: gate.locked, broken: gate.broken, markers: s.gateMarkers.length,
                 glyph: s.gateMarkers.length ? (s.gateMarkers[0].text ?? null) : null };`);
      check("the guard batters it down over several turns — the seal smashes to a remnant (▨, no freeze)",
        broke.locked === false && broke.broken === true && broke.markers === 1 && broke.glyph === "▨");
    },
  },
  {
    id: "micro-lever-seal",
    title: "lever · seal — the infiltrator slams a control-room door shut",
    async run(g) {
      const st = await g.bsEval(`
        const door = s.battle.gates[0];
        return { locked: door.locked, walkable: s.grid.isWalkable(door.pos), gateMarkers: s.gateMarkers.length,
                 leverMarkers: s.leverMarkers.length, verbs: s.actionButtons.map(b => b.label && b.label.text).filter(Boolean) };`);
      check("the door starts open (walkable, no gate marker)", st.locked === false && st.walkable === true && st.gateMarkers === 0);
      check("the lever renders (⎇)", st.leverMarkers === 1);
      check("the Pull Lever verb surfaces", st.verbs.includes("Pull Lever"));
      // Pull the lever → the open door slams shut + re-blocks its tile (gateLocked → the scene redraws).
      const after = await g.bsEval(`
        const lever = s.battle.levers[0]; const infil = s.battle.units.find(u => u.id === "infil");
        s.battle.pullLever(lever, infil);
        const door = s.battle.gates[0];
        return { locked: door.locked, walkable: s.grid.isWalkable(door.pos), hp: door.hp, gateMarkers: s.gateMarkers.length };`);
      check("pulling the lever slams the door shut — tile re-blocks, marker appears (no freeze)", after.locked === true && after.walkable === false && after.gateMarkers === 2);
      check("the sealed door is whole (full durability — ready for the guards to batter)", after.hp === 20);
    },
  },
  {
    id: "micro-gate-remnant",
    title: "gate · remnant — a smashed door is a permanent breach the lever can't re-seal",
    async run(g) {
      const st = await g.bsEval(`
        const door = s.battle.gates[0];
        return { locked: door.locked, hp: door.hp, leverMarkers: s.leverMarkers.length };`);
      check("the destructible seal renders locked (15 hp) with its lever", st.locked === true && st.hp === 15 && st.leverMarkers === 1);
      // Smash it down: two hits from the adjacent breaker → a permanent passable remnant.
      const smashed = await g.bsEval(`
        const door = s.battle.gates[0]; const breaker = s.battle.units.find(u => u.id === "breaker");
        s.battle.attackGate(door, breaker); s.battle.attackGate(door, breaker); // 15 → 6 → 0
        return { broken: door.broken, walkable: s.grid.isWalkable(door.pos), markers: s.gateMarkers.length,
                 glyph: s.gateMarkers.length ? (s.gateMarkers[0].text ?? null) : null };`);
      check("the breaker smashes it to a passable remnant (▨, walkable)",
        smashed.broken === true && smashed.walkable === true && smashed.markers === 1 && smashed.glyph === "▨");
      // Pull the lever aimed at the smashed door: it must NOT re-seal — the breach is permanent (D106).
      const pulled = await g.bsEval(`
        const lever = s.battle.levers[0]; const breaker = s.battle.units.find(u => u.id === "breaker");
        s.battle.pullLever(lever, breaker);
        const door = s.battle.gates[0];
        return { broken: door.broken, locked: door.locked, walkable: s.grid.isWalkable(door.pos), markers: s.gateMarkers.length };`);
      check("the lever can't re-seal the smashed door — it stays a walkable remnant (no freeze)",
        pulled.broken === true && pulled.locked === false && pulled.walkable === true && pulled.markers === 1);
    },
  },
  {
    id: "micro-gate-reseal",
    title: "gate · re-seal — the lever keeps a battered door's damage (no top-up, D107)",
    async run(g) {
      // hpText reads the durability readout under the ▦ (gateMarkers[1] when the door is locked).
      const st = await g.bsEval(`
        const door = s.battle.gates[0];
        return { locked: door.locked, hp: door.hp,
                 hpText: s.gateMarkers.length > 1 ? (s.gateMarkers[1].text ?? null) : null };`);
      check("the seal renders locked with a full 20/20 readout", st.locked === true && st.hp === 20 && st.hpText === "20/20");
      // Batter it once → it holds at 11, and the readout drops with it.
      const hit = await g.bsEval(`
        const door = s.battle.gates[0]; const breaker = s.battle.units.find(u => u.id === "breaker");
        s.battle.attackGate(door, breaker); // 20 - 9 = 11
        return { hp: door.hp, hpText: s.gateMarkers.length > 1 ? (s.gateMarkers[1].text ?? null) : null };`);
      check("one hit chips it to 11/20 (holds)", hit.hp === 11 && hit.hpText === "11/20");
      // Pull the lever (door locked → opens): the marker drops (an open doorway).
      const opened = await g.bsEval(`
        const lever = s.battle.levers[0]; const breaker = s.battle.units.find(u => u.id === "breaker");
        s.battle.pullLever(lever, breaker);
        const door = s.battle.gates[0];
        return { locked: door.locked, hp: door.hp, walkable: s.grid.isWalkable(door.pos), markers: s.gateMarkers.length };`);
      check("pulling the lever opens the damaged door (hp unchanged, marker drops)",
        opened.locked === false && opened.hp === 11 && opened.walkable === true && opened.markers === 0);
      // Pull again (door open → re-seals): it must re-block AND still read 11/20 — NOT a restored 20/20.
      const resealed = await g.bsEval(`
        const lever = s.battle.levers[0]; const breaker = s.battle.units.find(u => u.id === "breaker");
        s.battle.pullLever(lever, breaker);
        const door = s.battle.gates[0];
        return { locked: door.locked, hp: door.hp, walkable: s.grid.isWalkable(door.pos),
                 hpText: s.gateMarkers.length > 1 ? (s.gateMarkers[1].text ?? null) : null };`);
      check("re-sealing keeps the damage — the readout stays 11/20, no free top-up (no freeze)",
        resealed.locked === true && resealed.hp === 11 && resealed.walkable === false && resealed.hpText === "11/20");
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
