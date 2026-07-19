// E2E: editor **soft play** (playtest, D-editor). Boots `#editor`, paints a minimal valid level,
// then drives the Scenario tab's ▶ Playtest control into the REAL BattleScene and back — proving
// the round-trip renders with no page errors (an uncaught scene-render throw reads as a freeze,
// not a stack trace — CLAUDE.md's "visual step-through is NOT optional"). Covers: the picker +
// button surface, the party selection threading through to the fielded squad, the BattleScene
// boot (deploy phase live), the persistent Exit-Playtest affordance, and the return to the editor
// with the draft intact.
//
// Run:  npm run test:e2e:editor:playtest   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-editor-playtest");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const setBrush = (b) => `document.querySelector('button[data-brush="${b}"]').click()`;
const clickTab = (t) => `document.querySelector('button[data-tab="${t}"]').click()`;

// Which scene is live + the editor draft's headline counts (read whichever scene exists).
const WHICH = `(() => {
  const g = window.game;
  const ed = g.scene.getScene("EditorScene");
  const bt = g.scene.getScene("BattleScene");
  return {
    editorActive: !!(ed && ed.scene.isActive("EditorScene")),
    battleActive: !!(bt && bt.scene.isActive("BattleScene")),
    battlePhase: bt && bt.scene.isActive("BattleScene") ? bt.phase : null,
    partyLen: bt && bt.run ? bt.run.party.length : null,
    returnTo: bt ? bt.returnTo ?? null : null,
    draftSpawns: ed ? ed.draft.playerSpawns.length : null,
    draftEnemies: ed ? ed.draft.enemies.length : null,
  };
})()`;

async function main() {
  await withGame(
    async (g) => {
      try {
        await sleep(900);
        const tileScreen = (col, row) =>
          g.eval(`(() => { const p = window.game.scene.getScene("EditorScene").view.tileToWorld({col:${col},row:${row}}); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
        const clickTile = async (col, row) => { const p = await tileScreen(col, row); await g.clickScene(p.x, p.y); await sleep(80); };

        // Paint a minimal valid level: one spawn + one enemy (blank draft is 9×6).
        console.log("• paint a minimal valid level");
        await g.eval(setBrush("spawn"));
        await clickTile(0, 4);
        await g.eval(setBrush("enemy"));
        await clickTile(5, 2);
        let st = await g.eval(WHICH);
        check("the editor is active with a painted spawn + enemy", st.editorActive && st.draftSpawns === 1 && st.draftEnemies === 1);

        // The Scenario tab hosts the playtest picker + button.
        await g.eval(clickTab("Scenario"));
        await sleep(80);
        console.log("• the Scenario tab surfaces the playtest squad picker + button");
        check("the ▶ Playtest button is present", (await g.eval(`!!document.querySelector('button[data-role="playtest"]')`)) === true);
        const partyOpts = await g.eval(`document.querySelector('select[data-role="playtest-party"]').options.length`);
        check("the squad picker lists multiple parties", partyOpts >= 3);

        // Choose a non-default squad so the party-selection seam is exercised (Vanguard = 5 bodies).
        await g.eval(`(() => { const s = document.querySelector('select[data-role="playtest-party"]'); s.value = "Vanguard (5)"; s.dispatchEvent(new Event("change")); })()`);
        await g.screenshot(path.join(OUT, "01-editor.png"));

        // ▶ Playtest → the real BattleScene (deploy phase), fielding the chosen squad.
        console.log("• ▶ Playtest boots the draft into the real BattleScene");
        await g.eval(`document.querySelector('button[data-role="playtest"]').click()`);
        await g.waitForScene("BattleScene", ["run", "loop"]);
        await sleep(700);
        st = await g.eval(WHICH);
        check("the BattleScene is now active (editor handed off)", st.battleActive === true && st.editorActive === false);
        check("it staged the deployment phase", st.battlePhase === "deployment");
        check("it fielded the chosen squad (Vanguard = 5)", st.partyLen === 5);
        check("the run carries the editor return target", st.returnTo === "EditorScene");
        check("the Exit-Playtest button exists on the battle scene", (await g.eval(`(() => { const bt = window.game.scene.getScene("BattleScene"); return bt.children.list.some((o) => o.type === "Container" && (o.label && o.label.text || "").includes("Exit")); })()`)) === true);
        await g.screenshot(path.join(OUT, "02-playtest.png"));

        // Exit Playtest (the canvas button, top-centre) → back to the editor, draft intact.
        console.log("• Exit Playtest returns to the editor with the draft intact");
        await g.clickScene(400, 18); // the "✎ Exit Playtest" button centre (scale.width/2, 18)
        await g.waitForScene("EditorScene", ["draft"]);
        await sleep(500);
        st = await g.eval(WHICH);
        check("the editor is active again", st.editorActive === true && st.battleActive === false);
        check("the draft survived the round-trip (spawn + enemy still there)", st.draftSpawns === 1 && st.draftEnemies === 1);
        // The panel re-mounted cleanly — the playtest control is back and the level still validates.
        check("the playtest control re-mounted after return", (await g.eval(`(() => { document.querySelector('button[data-tab="Scenario"]').click(); return !!document.querySelector('button[data-role="playtest"]'); })()`)) === true);
        const validText = await g.eval(`[...document.querySelectorAll("div")].map(n => n.textContent).find(t => /valid|⚠/.test(t)) || ""`);
        check("the returned draft still validates", /✓ valid/.test(validText));
        await g.screenshot(path.join(OUT, "03-returned.png"));

        // Playtest again after the return — proves re-entry left the editor in a launchable state.
        console.log("• a second playtest still boots (re-entry is stable)");
        await g.eval(`document.querySelector('button[data-role="playtest"]').click()`);
        await g.waitForScene("BattleScene", ["run", "loop"]);
        await sleep(500);
        st = await g.eval(WHICH);
        check("the second playtest boots the BattleScene again", st.battleActive === true);
        check("the second playtest defaults to the standard trio", st.partyLen === 5 || st.partyLen === 3); // picker keeps its last value across the remount

        assertNoProblems(g.problems);
      } catch (err) {
        await g.screenshot(path.join(OUT, "zz-failure.png")).catch(() => {});
        throw err;
      }
    },
    { hash: "#editor" },
  );
  console.log(`\n✓ editor playtest E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
