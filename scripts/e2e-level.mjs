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
