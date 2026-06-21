// E2E: click through the Deployment → Battle stages in a *real* headless browser
// and assert on outcomes — the coverage the pure-core suite can't reach (the
// BattleScene's turn flow, undo wiring, and phase transitions live in the render
// layer). Drives the scene the way a player does: real tile clicks, real key
// presses (Space / Escape), and the action-row handlers the buttons call.
//
// Run:  npm run test:e2e   (needs Chrome — see scripts/harness.mjs)

import assert from "node:assert/strict";
import { withGame, navTo, sleep, assertNoProblems } from "./harness.mjs";

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// A compact, serializable snapshot of the BattleScene's deploy/battle state.
const SNAP = `return {
  phase: s.phase,
  actorId: s.deployActor ? s.deployActor.id : null,
  pos: s.deployActor ? { col: s.deployActor.pos.col, row: s.deployActor.pos.row } : null,
  dugIn: s.deployActor ? !!s.deployActor.dugIn : false,
  canUndo: s.battle.canUndo(),
  logLen: s.battle.log.length,
  lastLog: s.battle.log.length ? s.battle.log[s.battle.log.length - 1].kind : null,
  waiting: !!s.waitingFor,
  players: s.battle.units.filter(u => u.side === "player").length,
  enemies: s.battle.units.filter(u => u.side === "enemy").length,
};`;

// First empty, walkable, in-range neighbour of the active deploy unit (a click target).
const NEIGHBOR = `return (() => {
  const a = s.deployActor; if (!a) return null;
  for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const t = { col: a.pos.col + dc, row: a.pos.row + dr };
    if (s.grid.inBounds(t) && s.grid.isWalkable(t) &&
        !s.battle.units.some(u => u.alive && u.pos.col === t.col && u.pos.row === t.row)) return t;
  }
  return null;
})();`;

async function main() {
  await withGame(async (g) => {
    const snap = () => g.bsEval(SNAP);

    // --- Stage: reach a combat node and open Deployment -----------------------
    await g.eval(navTo("e1"));
    await sleep(1300); // the BattleScene boots: stage encounter → enterDeploy → first turn
    await g.bsEval(`s.turnSpeed = 4;`); // speed up move tweens for a snappy, stable run

    let st = await snap();
    console.log("• Deployment opens");
    check("phase is deployment", st.phase === "deployment");
    check("a unit has the first deploy turn", st.actorId !== null);
    check("both sides are on the board", st.players >= 1 && st.enemies >= 1);
    check("undo starts empty (armed, nothing to take back)", st.canUndo === false);

    const startPos = st.pos;

    // --- Stage: a real tile click repositions the unit (and arms undo) --------
    const tile = await g.bsEval(NEIGHBOR);
    check("found an empty tile to move to", tile !== null);
    await g.clickTile(tile);
    await sleep(500); // let the move tween + its busy flag settle
    st = await snap();
    console.log("• Real tile click → reposition");
    check("the unit moved to the clicked tile", st.pos.col === tile.col && st.pos.row === tile.row);
    check("the move was logged as a deployMove", st.lastLog === "deployMove");
    check("undo is now available", st.canUndo === true);

    // --- Stage: a real Escape press undoes the deploy turn --------------------
    await g.key("Escape");
    await sleep(200);
    st = await snap();
    console.log("• Real Escape → undo");
    check("the unit is back where it started", st.pos.col === startPos.col && st.pos.row === startPos.row);
    check("there's nothing left to undo", st.canUndo === false);

    // --- Stage: Dig In (the action-row handler) then undo it ------------------
    await g.bsEval(`s.digIn();`); // exactly what the "Dig In" button's onClick calls
    await sleep(120);
    st = await snap();
    console.log("• Dig In → undo");
    check("the unit is dug in", st.dugIn === true);
    check("dig-in was logged", st.lastLog === "digIn");
    check("undo is available after dig-in", st.canUndo === true);
    await g.key("Escape");
    await sleep(150);
    st = await snap();
    check("dig-in was taken back", st.dugIn === false);

    // --- Stage: commit to Battle ---------------------------------------------
    await g.bsEval(`s.startBattle();`); // the "Start Battle" button's onClick
    await sleep(300);
    st = await snap();
    console.log("• Start Battle");
    check("phase advanced to battle", st.phase === "battle");

    // --- Stage: drive the CT clock; a player turn opens and can be ended ------
    let sawPlayerTurn = false;
    let reachedResolution = false;
    for (let i = 0; i < 30; i++) {
      const cur = await snap();
      if (cur.phase === "resolution") { reachedResolution = true; break; }
      if (cur.waiting) {
        sawPlayerTurn = true;
        await g.key(" "); // Space = End Turn while a player unit is active (D60)
      } else {
        await g.key(" "); // Space = Advance Clock to the next actor
      }
      await sleep(260);
    }
    console.log("• Drive the battle clock");
    check("the clock surfaced a player turn (End Turn worked)", sawPlayerTurn);
    const end = await snap();
    check("the battle progressed without wedging", end.phase === "battle" || reachedResolution);

    assertNoProblems(g.problems);
  });

  console.log(`\n✓ deploy→battle E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
