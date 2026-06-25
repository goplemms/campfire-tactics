// E2E: click through the Deployment → Battle stages in a *real* headless browser
// and assert on outcomes — the coverage the pure-core suite can't reach (the
// BattleScene's turn flow, undo wiring, and phase transitions live in the render
// layer). Drives the scene the way a player does: real tile clicks, real key
// presses (Space / Escape), and the action-row handlers the buttons call.
//
// Run:  npm run test:e2e   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { withGame, navTo, sleep, assertNoProblems, ROOT } from "./harness.mjs";

// Stage screenshots land here (gitignored, like the shots-*.mjs output) — a visual
// record of each asserted stage, plus a capture of the board if an assertion fails.
const OUT = path.join(ROOT, "screenshots", "e2e-deploy-battle");

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
    // Drop a numbered stage screenshot (a visual record next to the assertions).
    let seq = 0;
    const shot = (name) => g.screenshot(path.join(OUT, `${String(++seq).padStart(2, "0")}-${name}.png`));

    try {
      // --- Stage: reach a combat node and open Deployment ---------------------
      await g.eval(navTo("e1"));
      await sleep(1300); // the BattleScene boots: stage encounter → enterDeploy → first turn
      await g.bsEval(`s.turnSpeed = 4;`); // speed up move tweens for a snappy, stable run

      let st = await snap();
      console.log("• Deployment opens");
      check("phase is deployment", st.phase === "deployment");
      check("a unit has the first deploy turn", st.actorId !== null);
      check("both sides are on the board", st.players >= 1 && st.enemies >= 1);
      check("undo starts empty (armed, nothing to take back)", st.canUndo === false);
      // D12 — the foe is pre-positioned but veiled during staging: every living enemy
      // token is concealed (its container invisible) until the battle opens.
      const foeHiddenInDeploy = await g.bsEval(
        `return [...s.view.views.values()].filter(v => v.unit.side === "enemy" && v.unit.alive).every(v => v.container.visible === false);`,
      );
      check("enemy tokens are concealed during deployment", foeHiddenInDeploy === true);
      // Deploy hover preview: a walkable tile reports its capture risk + zone band.
      const dep = await g.bsEval(`
        const a = s.deployActor; if (!a) return null;
        s.deployHoverTile = { col: a.pos.col, row: a.pos.row }; // the spawn tile (protected core)
        s.refreshPreviewCard();
        return { visible: s.previewCard.visible };
      `);
      check("deploy hover shows the capture-risk preview", dep && dep.visible === true);
      await g.bsEval(`s.deployHoverTile = null; s.refreshPreviewCard();`); // clear so it doesn't bleed into later stages
      await shot("deploy-opens");

      const startPos = st.pos;

      // --- Stage: a real tile click repositions the unit (and arms undo) ------
      const tile = await g.bsEval(NEIGHBOR);
      check("found an empty tile to move to", tile !== null);
      await g.clickTile(tile);
      await sleep(500); // let the move tween + its busy flag settle
      st = await snap();
      console.log("• Real tile click → reposition");
      check("the unit moved to the clicked tile", st.pos.col === tile.col && st.pos.row === tile.row);
      check("the move was logged as a deployMove", st.lastLog === "deployMove");
      check("undo is now available", st.canUndo === true);
      await shot("tile-click-move");

      // --- Stage: a real Escape press undoes the deploy turn ------------------
      await g.key("Escape");
      await sleep(200);
      st = await snap();
      console.log("• Real Escape → undo");
      check("the unit is back where it started", st.pos.col === startPos.col && st.pos.row === startPos.row);
      check("there's nothing left to undo", st.canUndo === false);
      await shot("escape-undo");

      // --- Stage: Dig In (the action-row handler) then undo it ----------------
      await g.bsEval(`s.digIn();`); // exactly what the "Dig In" button's onClick calls
      await sleep(120);
      st = await snap();
      console.log("• Dig In → undo");
      check("the unit is dug in", st.dugIn === true);
      check("dig-in was logged", st.lastLog === "digIn");
      check("undo is available after dig-in", st.canUndo === true);
      await shot("dig-in");
      await g.key("Escape");
      await sleep(150);
      st = await snap();
      check("dig-in was taken back", st.dugIn === false);

      // --- Stage: commit to Battle -------------------------------------------
      await g.bsEval(`s.startBattle();`); // the "Start Battle" button's onClick
      await sleep(300);
      st = await snap();
      console.log("• Start Battle");
      check("phase advanced to battle", st.phase === "battle");
      // D12 — the veil lifts when the net closes: enemy tokens resolve into view.
      const foeShownInBattle = await g.bsEval(
        `return [...s.view.views.values()].filter(v => v.unit.side === "enemy" && v.unit.alive).some(v => v.container.visible === true);`,
      );
      check("enemy tokens are revealed once the battle opens", foeShownInBattle === true);
      await shot("battle-start");

      // --- Stage: drive the CT clock; a player turn opens and can be ended ----
      let sawPlayerTurn = false;
      let reachedResolution = false;
      for (let i = 0; i < 30; i++) {
        const cur = await snap();
        if (cur.phase === "resolution") { reachedResolution = true; break; }
        if (cur.waiting) {
          if (!sawPlayerTurn) {
            await shot("battle-player-turn"); // action row + focus card, live
            // Hover preview card: an enemy reads as deal/hits-back; a reachable tile as tiles-left.
            const atk = await g.bsEval(`
              const foe = s.battle.units.find(u => u.side === "enemy" && u.alive && !u.hidden);
              if (!foe) return null;
              s.hoverFoe = foe; s.hoverTile = null; s.drawPreview();
              const rows = s.attackPreviewRows(s.waitingFor, foe);
              const back = rows.find(r => r.label === "Hits back");
              return { visible: s.previewCard.visible, labels: rows.map(r => r.label), deal: rows[0].value, back: back && back.value };
            `);
            check("preview card shows on enemy hover", atk && atk.visible === true);
            check("enemy preview has Deal + Hits back rows", atk && atk.labels.includes("Deal") && atk.labels.includes("Hits back"));
            check("enemy preview reports a concrete Deal figure", atk && /\d/.test(String(atk.deal)));
            check("hits-back is 0 with no auto-counter mechanic", atk && String(atk.back) === "0");
            const mv = await g.bsEval(`
              const r = s.reach.find(x => x.path.length > 0);
              if (!r) return { skip: true }; // immobilized/surrounded — no move tile to preview
              s.hoverFoe = null; s.hoverTile = r.tile; s.drawPreview();
              return { visible: s.previewCard.visible };
            `);
            check("preview card shows tiles-left on a move-tile hover", mv && (mv.skip || mv.visible === true));
            // Click-ahead (micro-movement): a board click that lands mid-step is queued and
            // replayed once the step finishes, so rapid tile-by-tile clicking never drops.
            const qb = await g.bsEval(`
              const a = s.waitingFor; const d = s.reach.find(r => r.path.length > 0);
              if (!a || !d) return { skip: true };
              const from = { col: a.pos.col, row: a.pos.row };
              s.queuedTile = { col: d.tile.col, row: d.tile.row }; // a click that arrived mid-step
              s.processQueuedClick(a);                              // replay it now the step finished
              return { from, queuedCleared: s.queuedTile === null };
            `);
            check("a click-ahead clears the queue when replayed", qb && (qb.skip || qb.queuedCleared));
            if (qb && !qb.skip) {
              await sleep(300); // let the replayed step animate
              const moved = await g.bsEval(`const a = s.waitingFor; return a ? (a.pos.col !== ${qb.from.col} || a.pos.row !== ${qb.from.row}) : false;`);
              check("a click-ahead replays and moves the unit", moved === true);
            }
            // Re-hover the foe so the captured frame shows the headline deal / hits-back read.
            await g.bsEval(`
              const foe = s.battle.units.find(u => u.side === "enemy" && u.alive && !u.hidden);
              if (foe) { s.hoverFoe = foe; s.hoverTile = null; s.drawPreview(); }
            `);
            await shot("battle-hover-preview");
          }
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
      await shot("battle-driven");

      // --- Stage: the initiative rail expands past its collapsed cap -----------
      const collapsed = await g.bsEval(`return s.view.ctChips.filter(c => c.bg.visible).length;`);
      await g.bsEval(`s.railExpanded = true; s.refreshHud();`);
      await sleep(120);
      const expanded = await g.bsEval(`return s.view.ctChips.filter(c => c.bg.visible).length;`);
      console.log("• Initiative rail expand/collapse");
      check("collapsed rail caps the visible chips", collapsed <= 3);
      check("expanding reveals more chips", expanded > collapsed);
      await shot("battle-rail-expanded");

      assertNoProblems(g.problems);
    } catch (err) {
      // Capture the board at the point of failure to make the break diagnosable.
      await g.screenshot(path.join(OUT, "zz-failure.png")).catch(() => {});
      throw err;
    }
  });

  console.log(`\n✓ deploy→battle E2E: ${passed} assertions passed, no page errors`);
  console.log(`  stage screenshots → ${path.relative(ROOT, OUT)}/`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
