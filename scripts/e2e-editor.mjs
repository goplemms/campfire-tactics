// E2E: the visual level editor (D98) — boot `#editor`, click tiles for real, and
// assert the render → click-pick → mutate → export loop works with no page errors.
// This is the guard CLAUDE.md requires when a new scene surface is added.
//
// Run:  npm run test:e2e:editor   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-editor");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const STATE = `(() => {
  const sc = window.game.scene.getScene("EditorScene");
  const pre = document.querySelector("pre");
  return {
    active: !!(sc && sc.scene.isActive("EditorScene")),
    blocked: sc?.draft?.blocked?.length ?? null,
    exportBlocked: (() => { try { return JSON.parse(pre.textContent).blocked.length; } catch { return null; } })(),
    hasPanel: !!pre,
  };
})()`;

async function main() {
  await withGame(
    async (g) => {
      try {
        await sleep(900);
        let st = await g.eval(STATE);
        console.log("• #editor boots the level editor");
        check("the editor scene is active", st.active === true);
        check("the export panel is mounted", st.hasPanel === true);
        check("the draft starts with no walls", st.blocked === 0);
        await g.screenshot(path.join(OUT, "01-empty.png"));

        // Real clicks on the board — exercise onPointerDown → worldToTile → place wall.
        const points = [[400, 300], [360, 285], [440, 320], [400, 260], [470, 300]];
        for (const [x, y] of points) { await g.clickScene(x, y); await sleep(100); }
        st = await g.eval(STATE);
        console.log("• clicking tiles paints walls into the draft");
        check("real clicks placed walls (click-pick works)", st.blocked > 0);
        check("the live export reflects the walls", st.exportBlocked === st.blocked);
        await g.screenshot(path.join(OUT, "02-walls-placed.png"));

        // Clicking the same tile again toggles the wall back off.
        await g.clickScene(400, 300); await sleep(100);
        const st2 = await g.eval(STATE);
        console.log("• clicking a wall again removes it (toggle)");
        check("toggling a wall off decrements the draft", st2.blocked === st.blocked - 1);

        assertNoProblems(g.problems);
      } catch (err) {
        await g.screenshot(path.join(OUT, "zz-failure.png")).catch(() => {});
        throw err;
      }
    },
    { hash: "#editor" },
  );
  console.log(`\n✓ editor E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
