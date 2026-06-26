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

      // --- Stage: the L1 Cook is a bound on-board captive (D52) ----------------
      // Pip starts the Skirmish as a player-side, *bound* token guarded by the corner
      // cutthroat (col 7,row 0): reaching him is the flank. A captive is NOT a concealed
      // enemy, so — unlike the veiled foe above — his grey token is VISIBLE during
      // deployment, he's off the initiative clock (the deploy actor set excludes him), and
      // he's not yet in the party. The captive-recruit seam this asserts is what replaced
      // the old silent post-win grant.
      const captive = await g.bsEval(`
        const pip = s.battle.units.find(u => u.id === "pip");
        if (!pip) return null;
        const v = s.view.views.get("pip");
        return {
          side: pip.side, captured: !!pip.captured, pos: { col: pip.pos.col, row: pip.pos.row },
          visible: v ? v.container.visible : false,        // a captive is shown in deployment…
          tint: v ? v.body.fillColor : null,               // …grey-tinted (COLOR.captive)
          inParty: s.run.party.some(u => u.id === "pip"),   // not recruited until freed/won
          offClock: s.deployActor ? s.deployActor.id !== "pip" : true,
        };
      `);
      console.log("• L1 Cook is a bound on-board captive");
      check("Pip is on the board, player-side and bound", captive && captive.side === "player" && captive.captured === true);
      check("Pip is bound in the captor's corner (col 7,row 1)", captive && captive.pos.col === 7 && captive.pos.row === 1);
      check("the captive token is VISIBLE during deployment (not a concealed foe)", captive && captive.visible === true);
      check("the captive token reads grey/bound (COLOR.captive)", captive && captive.tint === 0x9a6bd0);
      check("Pip is not in the party yet (introduced AT L1, freed/won)", captive && captive.inParty === false);
      check("the bound captive is off the deploy clock", captive && captive.offClock === true);
      await shot("captive-bound");

      // …and he can be freed by the **rescue Act** — the `Battle.rescue` verb BattleScene's
      // playerRescue calls. It frees the captive and emits the `unitRescued` bus event; the
      // wireBattleFx listener owns the reaction: re-tint the token to an ally, flash, and write
      // a combat-log line. So freeing a new unit registers as a real rescue *event*, not a
      // silent state poke (the full reach-then-Free + win-recruit are headless in
      // hollow-mill.test.ts). The post-win auto-free is a separate resolution tally, not this.
      const freeOut = await g.bsEval(`
        const pip = s.battle.units.find(u => u.id === "pip");
        if (!pip) return null;
        const by = s.battle.units.find(u => u.side === "player" && !u.captured && u.id !== "pip");
        const logBefore = s.view.logBuffer.length;
        s.battle.rescue(pip, by);            // the rescue Act → emits unitRescued
        const v = s.view.views.get("pip");
        const last = s.view.logBuffer[s.view.logBuffer.length - 1];
        return {
          captured: !!pip.captured,
          tint: v ? v.body.fillColor : null,
          logged: s.view.logBuffer.length > logBefore,
          logText: last ? last.text : "",
        };
      `);
      check("the rescue Act clears the bound state (controllable)", freeOut && freeOut.captured === false);
      check("the unitRescued listener re-tints the freed token to an ally", freeOut && freeOut.tint !== 0x9a6bd0);
      check("the rescue emits a combat-log event line", freeOut && freeOut.logged && /free/i.test(freeOut.logText));
      await shot("captive-freed");
      // Re-bind + clear the log so the later stages (which assert log growth) start clean.
      await g.bsEval(`
        const pip = s.battle.units.find(u => u.id === "pip");
        if (pip) { pip.captured = true; pip.ct = 0; s.tintCaptured(pip, true); }
        s.view.clearLog();
      `);

      // --- Stage: combat FX fire in deployment too (feel parity) --------------
      // Deployment ↔ combat parity: a unit that takes an HP hit during *deployment* (a
      // sprung concealed trap) must float its damage and write the combat log, exactly as
      // mid-battle. The FX bus is wired up front now (wireBattleFx at node start), not only
      // at startBattle. Drive a real unitDamaged through the encounter bus (no source, so it
      // can't perturb the XP tally) and confirm the render responded *once*. Also fire a
      // turnStart and confirm the per-turn header stays combat-only — its listener still
      // lives in startBattle. On the pre-increment build the damage hit was silent here.
      const fx = await g.bsEval(`
        const a = s.deployActor; if (!a) return { skip: true };
        let floated = 0, headers = 0;
        const of = s.view.floatDamage.bind(s.view); s.view.floatDamage = (u, amt) => { floated += 1; return of(u, amt); };
        const ot = s.view.logTurn.bind(s.view); s.view.logTurn = (u) => { headers += 1; return ot(u); };
        const beforeLog = s.view.logBuffer.length;
        s.battle.bus.emit("unitDamaged", { unit: a, amount: 3 });
        s.battle.bus.emit("turnStart", { unit: a });
        s.view.floatDamage = of; s.view.logTurn = ot;
        const last = s.view.logBuffer[s.view.logBuffer.length - 1];
        const out = { phase: s.phase, floated, headers, logGrew: s.view.logBuffer.length > beforeLog,
          logText: last ? last.text : "", noted: s.view.lastHit.get(a.id) };
        s.view.lastHit.delete(a.id); s.view.clearLog(); // un-pollute the test's synthetic hit
        return out;
      `);
      console.log("• Combat FX in deployment");
      check("FX fire while phase is deployment", !fx.skip && fx.phase === "deployment");
      check("a deployment HP hit floats damage exactly once", fx.skip || fx.floated === 1);
      check("a deployment HP hit writes a combat-log line", fx.skip || (fx.logGrew && /3/.test(fx.logText)));
      check("a deployment HP hit registers the impact (noteDamage)", fx.skip || fx.noted === 3);
      check("the per-turn header stays combat-only in deployment", fx.skip || fx.headers === 0);
      await shot("deploy-trap-fx");

      // --- Stage: reach wash + lit hover path in deployment (feel parity) ------
      // The deploy turn now reads like a battle turn: the actor's reachable tiles light for
      // its remaining move budget and a hover lights the route — but the strike telegraph /
      // enemy intents stay off (engagement is combat-only; the deploy preview must never
      // offer a strike). Assert the reach graphic painted, a hover adds a lit path on top,
      // and no strike-forecast badge appears.
      const reach = await g.bsEval(`
        const a = s.deployActor; if (!a) return { skip: true };
        s.deployHoverTile = null; s.drawDeployReach();             // wash only (no hover)
        const reachCount = s.reachByKey.size;
        const washCmds = s.deployReachGfx ? s.deployReachGfx.commandBuffer.length : 0;
        const r = [...s.reachByKey.values()].find(x => x.path && x.path.length > 0);
        let pathLit = false, washWithHover = washCmds, badges = s.view.forecastLabels.size;
        if (r) {
          s.deployHoverTile = { col: r.tile.col, row: r.tile.row };
          s.drawDeployReach();
          washWithHover = s.deployReachGfx.commandBuffer.length;
          pathLit = true;
          badges = s.view.forecastLabels.size;
          s.drawDeployReach(); // leave the route lit so the screenshot shows wash + path
        }
        return { budget: s.moveBudget, reachCount, washCmds, washWithHover, pathLit, badges };
      `);
      console.log("• Reach wash + hover path in deployment");
      check("the deploy actor has a move budget to light", reach.skip || reach.budget > 0);
      check("deployment paints the reachable tiles (reach wash)", reach.skip || (reach.reachCount > 0 && reach.washCmds > 0));
      check("a deploy hover lights the route to the tile", reach.skip || (reach.pathLit && reach.washWithHover > reach.washCmds));
      check("no strike telegraph in deployment (engagement is combat-only)", reach.skip || reach.badges === 0);
      await shot("deploy-reach-wash"); // wash + lit hover path layered over the zone washes
      await g.bsEval(`s.deployHoverTile = null; s.drawDeployReach();`); // reset to the plain wash

      const startPos = st.pos;

      // --- Stage: a real tile click repositions the unit (and arms undo) ------
      const tile = await g.bsEval(NEIGHBOR);
      check("found an empty tile to move to", tile !== null);
      await g.clickTile(tile);
      await sleep(500); // let the move tween + its busy flag settle
      st = await snap();
      console.log("• Real tile click → reposition");
      check("the unit moved to the clicked tile", st.pos.col === tile.col && st.pos.row === tile.row);
      check("the reposition was logged as a move (the one verb, D67)", st.lastLog === "move");
      check("undo is now available", st.canUndo === true);
      await shot("tile-click-move");

      // --- Stage: a SECOND move in the same deploy turn (micro-movement) ------
      const firstActor = st.actorId;
      const budgetBefore = await g.bsEval(`return s.moveBudget;`);
      const tile2 = await g.bsEval(NEIGHBOR); // a neighbour of the unit's NEW position
      check("found a second tile to step to", tile2 !== null);
      await g.clickTile(tile2);
      await sleep(500);
      st = await snap();
      console.log("• Second move in the same deploy turn");
      check("the unit moved again — a move can follow a move", st.pos.col === tile2.col && st.pos.row === tile2.row);
      check("still the same unit's deploy turn", st.actorId === firstActor);
      const budgetAfter = await g.bsEval(`return s.moveBudget;`);
      check("the deploy move budget decreased with the second step", budgetAfter < budgetBefore);
      await shot("deploy-second-move");

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
      // The deploy→battle handoff runs off a single bus event (D67): the seam is wired up
      // front (wireBattleFx), and firing it tears down the staging visuals (veil + overlays).
      const beganWired = await g.bsEval(`return s.battle.bus.listenerCount("battleBegan");`);
      check("the battleBegan transition seam is wired before commit", beganWired === 1);
      await g.bsEval(`s.startBattle();`); // the "Start Battle" button's onClick
      await sleep(300);
      st = await snap();
      console.log("• Start Battle");
      check("phase advanced to battle", st.phase === "battle");
      // The transition event retired the deploy zone / reach overlays (cleared graphics).
      const overlays = await g.bsEval(`return {
        safe: s.safeZoneGfx ? s.safeZoneGfx.commandBuffer.length : 0,
        danger: s.dangerZoneGfx ? s.dangerZoneGfx.commandBuffer.length : 0,
        reach: s.deployReachGfx ? s.deployReachGfx.commandBuffer.length : 0,
      };`);
      check("the transition event tore down the deploy overlays", overlays.safe === 0 && overlays.danger === 0 && overlays.reach === 0);
      // No double-fire: the damage FX listener moved to node start and the old startBattle
      // block was removed, so the view floats a battle hit exactly *once* (a leftover
      // re-attach would float twice). The per-turn header, combat-only, now wires here.
      const fxB = await g.bsEval(`
        const u = s.battle.units.find(x => x.alive); if (!u) return { skip: true };
        let floated = 0, headers = 0;
        const of = s.view.floatDamage.bind(s.view); s.view.floatDamage = (x, amt) => { floated += 1; return of(x, amt); };
        const ot = s.view.logTurn.bind(s.view); s.view.logTurn = (x) => { headers += 1; return ot(x); };
        s.battle.bus.emit("unitDamaged", { unit: u, amount: 2 });
        s.battle.bus.emit("turnStart", { unit: u });
        s.view.floatDamage = of; s.view.logTurn = ot;
        s.view.lastHit.delete(u.id); s.view.clearLog();
        return { floated, headers };
      `);
      check("battle floats a damage hit exactly once (no double-fire)", fxB.skip || fxB.floated === 1);
      check("the per-turn header wires once in battle", fxB.skip || fxB.headers === 1);
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
              s.processQueuedClick(a, "battle");                    // replay it now the step finished
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
