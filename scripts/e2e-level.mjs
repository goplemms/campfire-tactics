// E2E: the JSON content-level pipeline (D98) — boot a glob-loaded level from
// `content/levels/` via `#level=<id>` and assert it renders a real deployment board
// (the "location the game pulls from" actually plays), plus the bare `#level` picker.
//
// Run:  npm run test:e2e:level   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-level");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const SNAP = `return {
  phase: s.phase,
  players: s.battle.units.filter(u => u.side === "player" && u.alive && !u.captured).length,
  enemies: s.battle.units.filter(u => u.side === "enemy").length,
};`;

async function main() {
  await withGame(
    async (g) => {
      try {
        // A glob-loaded JSON level boots straight into a real board.
        await sleep(1300);
        const st = await g.bsEval(SNAP);
        console.log("• #level=sample-skirmish boots the JSON level");
        check("the level renders a deployment board", st.phase === "deployment");
        check("the test party is fielded", st.players === 3);
        check("the authored enemies are on the board", st.enemies === 2);
        await g.screenshot(path.join(OUT, "01-sample-skirmish.png"));

        // A second content level — the dual-OR finale variant — renders too.
        await g.boot("#level=prison-break");
        await sleep(1300);
        const pb = await g.bsEval(`return {
          phase: s.phase,
          enemies: s.battle.units.filter(u => u.side === "enemy").length,
          prisoners: s.battle.units.filter(u => u.role === "prisoner").length,
          goals: s.loop.staged.objectives.map(o => o.spec.kind).sort().join(","),
        };`);
        console.log("• #level=prison-break boots the dual-OR finale variant");
        check("prison-break renders a deployment board", pb.phase === "deployment");
        check("its garrison + prisoners are staged", pb.enemies === 5 && pb.prisoners === 2);
        check("it carries the two OR'd goals", pb.goals === "eliminate-all,extraction");
        await g.screenshot(path.join(OUT, "03-prison-break.png"));

        // The rescue finale — the v4 concentric prison (issue #204 B): a 20x20 board, a tagged
        // garrison, 3 named prisoners, six gates (two lever-toggled destructible seals) and four
        // levers, on the two OR'd goals. Every one of those is a *rendered* thing — gates, levers,
        // the exit-span tint and the (much larger) board are all board objects the scene draws, so
        // this is the freeze-catcher for the layout (CLAUDE.md: a render throw reads as a freeze).
        await g.boot("#level=the-rescue");
        await sleep(1600);
        const tr = await g.bsEval(`return {
          phase: s.phase,
          cols: s.grid.cols, rows: s.grid.rows,
          enemies: s.battle.units.filter(u => u.side === "enemy").length,
          garrison: s.battle.units.filter(u => u.tags.includes("garrison")).length,
          prisoners: s.battle.units.filter(u => u.role === "prisoner").length,
          nonCombatants: s.battle.units.filter(u => u.tags.includes("non-combatant")).length,
          gates: s.battle.gates.map(x => x.id).sort().join(","),
          sealsOpen: s.battle.gates.filter(x => /^seal-/.test(x.id)).every(x => !x.locked),
          sealHp: s.battle.gates.find(x => x.id === "seal-inner").hp,
          levers: s.battle.levers.map(x => x.id).sort().join(","),
          exitSpan: s.loop.staged.objectives.find(o => o.spec.kind === "extraction").spec.span.length,
          goals: s.loop.staged.objectives.map(o => o.spec.kind).sort().join(","),
          zones: s.battle.spawnZones.map(z => z.id).join(","),
          atFrontGate: s.battle.units.filter(u => u.side === "player" && !u.captured).every(u => u.pos.row >= 17),
        };`);
        console.log("• #level=the-rescue boots the v4 concentric prison");
        check("the-rescue renders a deployment board", tr.phase === "deployment");
        check("it is the 20x20 v4 board", tr.cols === 20 && tr.rows === 20);
        check("its garrison + 3 prisoners are staged", tr.enemies === 10 && tr.prisoners === 3);
        check("every enemy carries the `garrison` tag (D117 door-doctrine)", tr.garrison === tr.enemies);
        check("every captive carries the `non-combatant` tag (D117 R3)", tr.nonCombatants === 3);
        check("the three cells, the hall door and the two seals are armed",
          tr.gates === "cell-bram,cell-cass,cell-wren,hall-gate,seal-inner,seal-outer");
        check("both seals start OPEN and carry head-start durability", tr.sealsOpen === true && tr.sealHp === 64);
        check("the four winches are armed", tr.levers === "winch-control,winch-hall,winch-staging,winch-wall");
        check("the exit span is the union of both mouths (6 tiles)", tr.exitSpan === 6);
        check("it carries the two OR'd goals", tr.goals === "eliminate-all,extraction");
        // D119 graceful degradation, rendered: `#level` boots with no run flags, so the
        // flag-gated side door is never unioned in and the party stages at the front gate.
        check("with no intel flag only the front-gate zone stages", tr.zones === "front-gate");
        check("the whole party stages at the front gate (nobody stranded at the side door)", tr.atFrontGate === true);
        await g.screenshot(path.join(OUT, "04-the-rescue.png"));

        // Drive the load-bearing surface: the infiltrator's turn-1 lever slam. Pulling `winch-wall`
        // must re-lock `seal-inner` AND re-block its tile through the real scene's lever path — the
        // one interaction the whole split-force design keys off (C2 / checklist B6).
        // NB: the probe used to find the infiltrator by `pos.col >= 15`, which only worked because
        // `placeParty` index-mapped party[0] onto the side spawn — the defect D119 removed. Booting
        // via `#level` carries no run flags, so the side-door zone is (correctly) never unioned in
        // and the whole party stages at the front gate. The doctrine under test is the seal slam.
        const slam = await g.bsEval(`
          const lever = s.battle.levers.find(l => l.id === "winch-wall");
          const infil = s.battle.units.find(u => u.side === "player" && !u.captured);
          if (!infil) return { err: "no player body to send through the side door" };
          infil.pos = { col: lever.pos.col, row: lever.pos.row };
          s.battle.pullLever(lever, infil);
          const seal = s.battle.gates.find(g => g.id === "seal-inner");
          return { locked: seal.locked, blocked: !s.grid.isWalkable(seal.pos) };
        `);
        console.log("• the turn-1 seal slam drives through the real scene");
        check("pulling winch-wall re-locks seal-inner", slam.locked === true);
        check("the slammed seal re-blocks its tile (the garrison must batter through)", slam.blocked === true);
        await g.screenshot(path.join(OUT, "05-the-rescue-sealed.png"));

        // The bare #level picker lists the loaded content levels.
        await g.boot("#level");
        await sleep(500);
        const picker = await g.eval(`(() => {
          const sc = window.game.scene.getScene("LevelBootScene");
          if (!sc || !sc.scene.isActive("LevelBootScene")) return { active: false };
          return { active: true, texts: sc.children.list.filter(o => o.type === "Text").map(o => o.text) };
        })()`);
        console.log("• bare #level lists the content levels");
        check("the picker is active", picker.active === true);
        check("the picker lists the sample level", picker.texts.some((t) => /sample-skirmish/.test(t)));
        await g.screenshot(path.join(OUT, "02-picker.png"));

        assertNoProblems(g.problems);
      } catch (err) {
        await g.screenshot(path.join(OUT, "zz-failure.png")).catch(() => {});
        throw err;
      }
    },
    { hash: "#level=sample-skirmish" },
  );
  console.log(`\n✓ level E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
