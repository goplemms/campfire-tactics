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

        // A **converted arc body** (D122): the Thieves' Den moved from a TS const in
        // `core/hollow-mill.ts` to `content/levels/thieves-den.json`. It is now a content level
        // like any other, so `#level=thieves-den` renders it — the freeze-catcher for the
        // conversion itself (a body that loads and validates headlessly can still throw in the
        // scene, and an uncaught scene exception reads as a freeze, not a stack trace).
        await g.boot("#level=thieves-den");
        await sleep(1300);
        const den = await g.bsEval(`return {
          phase: s.phase,
          cols: s.grid.cols, rows: s.grid.rows,
          enemies: s.battle.units.filter(u => u.side === "enemy").length,
          thieves: s.battle.units.filter(u => u.side === "enemy" && u.thief).length,
          blocked: [{c:3,r:0},{c:5,r:5},{c:6,r:2}].every(t => !s.grid.isWalkable({ col: t.c, row: t.r })),
        };`);
        console.log("• #level=thieves-den boots the arc body that became JSON (D122)");
        check("thieves-den renders a deployment board", den.phase === "deployment");
        check("it is the authored 9x6 board", den.cols === 9 && den.rows === 6);
        check("its four bodies are staged, two of them thieves", den.enemies === 4 && den.thieves === 2);
        check("the authored walls are stamped into the grid", den.blocked === true);
        await g.screenshot(path.join(OUT, "06-thieves-den.png"));

        // Conversion 2 (D122): the Mill Yard skirmish — the arc's node 1 — is now
        // `content/levels/e1-skirmish.json`. It is the first converted body carrying an
        // **on-board captive**, so this also renders the bound-Pip token (a captive that fails
        // to stage is a TypeError mid-boot, i.e. a freeze, not a stack trace).
        await g.boot("#level=e1-skirmish");
        await sleep(1300);
        const e1 = await g.bsEval(`return {
          phase: s.phase,
          cols: s.grid.cols, rows: s.grid.rows,
          enemies: s.battle.units.filter(u => u.side === "enemy").length,
          pip: (() => { const p = s.battle.units.find(u => u.id === "pip"); return p ? { captured: p.captured, col: p.pos.col, row: p.pos.row } : null; })(),
          blocked: [{c:4,r:1},{c:4,r:4}].every(t => !s.grid.isWalkable({ col: t.c, row: t.r })),
        };`);
        console.log("• #level=e1-skirmish boots the arc body that became JSON (D122)");
        check("e1-skirmish renders a deployment board", e1.phase === "deployment");
        check("it is the authored 8x6 board", e1.cols === 8 && e1.rows === 6);
        check("its three bandits are staged", e1.enemies === 3);
        check("Pip is on the board, bound, in the captor's corner",
          e1.pip !== null && e1.pip.captured === true && e1.pip.col === 7 && e1.pip.row === 1);
        check("the authored walls are stamped into the grid", e1.blocked === true);
        await g.screenshot(path.join(OUT, "07-e1-skirmish.png"));

        // Conversion 3 (D122): the Prison Wagon — the sustain arm's elite fight. The body carries
        // enemy **overrides** (the softened lieutenant) and a `grants.recruit` UnitSpec, both of
        // which the scene has to stage from data rather than from a TS const.
        await g.boot("#level=prison-wagon");
        await sleep(1300);
        const wagon = await g.bsEval(`return {
          phase: s.phase,
          cols: s.grid.cols, rows: s.grid.rows,
          enemies: s.battle.units.filter(u => u.side === "enemy").length,
          lieutenant: (() => { const l = s.battle.units.find(u => u.id === "slaver-lieutenant"); return l ? { maxHp: l.maxHp, attack: l.attack, defense: l.defense } : null; })(),
          blocked: [{c:4,r:2},{c:4,r:3}].every(t => !s.grid.isWalkable({ col: t.c, row: t.r })),
        };`);
        console.log("• #level=prison-wagon boots the arc body that became JSON (D122)");
        check("prison-wagon renders a deployment board", wagon.phase === "deployment");
        check("it is the authored 9x6 board", wagon.cols === 9 && wagon.rows === 6);
        check("its four-body escort is staged", wagon.enemies === 4);
        check("the lieutenant carries his authored overrides (softened captain)",
          wagon.lieutenant !== null && wagon.lieutenant.maxHp === 34 && wagon.lieutenant.attack === 10 && wagon.lieutenant.defense === 3);
        check("the authored walls are stamped into the grid", wagon.blocked === true);
        await g.screenshot(path.join(OUT, "08-prison-wagon.png"));

        // Conversion 4 (D122): the Cuffed Cell — the D90 lockpick taste. Its captive is
        // `release: lockpick`, so this renders a **bound, capability-gated** token: the scene has
        // to stage the captive from data (a missing/mis-placed one is a TypeError mid-boot).
        await g.boot("#level=cuffed-cell");
        await sleep(1300);
        const cell = await g.bsEval(`return {
          phase: s.phase,
          cols: s.grid.cols, rows: s.grid.rows,
          enemies: s.battle.units.filter(u => u.side === "enemy").length,
          prisoner: (() => { const p = s.battle.units.find(u => u.id === "cell-prisoner"); return p ? { captured: p.captured, col: p.pos.col, row: p.pos.row, release: p.release && p.release.kind } : null; })(),
          blocked: !s.grid.isWalkable({ col: 4, row: 2 }),
        };`);
        console.log("• #level=cuffed-cell boots the arc body that became JSON (D122)");
        check("cuffed-cell renders a deployment board", cell.phase === "deployment");
        check("it is the authored 8x6 board", cell.cols === 8 && cell.rows === 6);
        check("its three guards are staged", cell.enemies === 3);
        check("the bound prisoner is cuffed in the corner, lockpick-gated",
          cell.prisoner !== null && cell.prisoner.captured === true &&
          cell.prisoner.col === 7 && cell.prisoner.row === 1 && cell.prisoner.release === "lockpick");
        check("the authored wall is stamped into the grid", cell.blocked === true);
        await g.screenshot(path.join(OUT, "09-cuffed-cell.png"));

        // Conversion 5 (D122): the Sapper's Snares — the body whose *design is its numbers*. Its
        // five concealed traps are **field entities** the scene stages and draws, and its lone
        // straggler carries the only enemy `standingOrder` in shipped content; both left tsc's
        // reach when the body became data, so render them for real.
        await g.boot("#level=snares-trapfield");
        await sleep(1300);
        const snares = await g.bsEval(`return {
          phase: s.phase,
          cols: s.grid.cols, rows: s.grid.rows,
          enemies: s.battle.units.filter(u => u.side === "enemy").length,
          traps: s.battle.entities.all().filter(e => e.concealment !== undefined && e.revealed !== undefined).length,
          concealed: s.battle.entities.all().filter(e => e.concealment !== undefined && e.revealed !== undefined).every(t => !t.revealed && !t.sprung),
          straggler: (() => { const t = s.battle.units.find(u => u.id === "lone-straggler"); return t ? { order: t.standingOrder, col: t.pos.col, row: t.pos.row } : null; })(),
        };`);
        console.log("• #level=snares-trapfield boots the arc body that became JSON (D122)");
        check("snares-trapfield renders a deployment board", snares.phase === "deployment");
        check("it is the authored 9x6 board", snares.cols === 9 && snares.rows === 6);
        check("exactly one body holds the field", snares.enemies === 1);
        check("its five snares are staged, all still concealed", snares.traps === 5 && snares.concealed === true);
        check("the straggler holds his east-edge post on `hold-skittish`",
          snares.straggler !== null && snares.straggler.order === "hold-skittish" &&
          snares.straggler.col === 8 && snares.straggler.row === 2);
        await g.screenshot(path.join(OUT, "10-snares-trapfield.png"));

        // Conversion 6 (D122): the Outer Yard — the last arc body to become JSON. The garrison's
        // own snares are staged as field entities and every body carries a raised `awareness`
        // override, so this renders both halves of the "watched, mined approach".
        await g.boot("#level=outer-yard");
        await sleep(1300);
        const yard = await g.bsEval(`return {
          phase: s.phase,
          cols: s.grid.cols, rows: s.grid.rows,
          enemies: s.battle.units.filter(u => u.side === "enemy").length,
          traps: s.battle.entities.all().filter(e => e.concealment !== undefined && e.revealed !== undefined).length,
          unmarked: s.battle.entities.all().filter(e => e.concealment !== undefined && e.revealed !== undefined).every(t => !t.revealed),
          sergeant: (() => { const c = s.battle.units.find(u => u.id === "yard-sergeant"); return c ? { maxHp: c.maxHp, awareness: c.awareness } : null; })(),
        };`);
        console.log("• #level=outer-yard boots the arc body that became JSON (D122)");
        check("outer-yard renders a deployment board", yard.phase === "deployment");
        check("it is the authored 9x6 board", yard.cols === 9 && yard.rows === 6);
        check("its three-body alert detail is staged", yard.enemies === 3);
        check("the garrison's three snares are staged, none markable from afar",
          yard.traps === 3 && yard.unmarked === true);
        check("the watch-sergeant is softened but alert",
          yard.sergeant !== null && yard.sergeant.maxHp === 34 && yard.sergeant.awareness === 6);
        await g.screenshot(path.join(OUT, "11-outer-yard.png"));

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
