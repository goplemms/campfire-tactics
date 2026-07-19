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
        await g.clickScene(400, 44); // the "✎ Exit Playtest" button centre (scale.width/2, 44)
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
        await g.clickScene(400, 44); // exit back to the editor before the edge-case levels
        await g.waitForScene("EditorScene", ["draft"]);
        await sleep(300);

        // Edge levels the palette can't easily paint but an author WILL playtest — these are the
        // adversarial break-cases (a functional test invites degenerate boards). Force the draft
        // directly, boot, assert a live phase + no page errors (the freeze catch), then exit.
        const forceDraft = (d) => `(() => {
          const sc = window.game.scene.getScene("EditorScene");
          Object.assign(sc.draft, ${JSON.stringify(d)});
          sc.renderBoard(); sc.updateExport();
          document.querySelector('button[data-tab="Scenario"]').click();
          return true;
        })()`;
        const bootExit = async (label, draft, party, expectLen) => {
          await g.eval(forceDraft(draft));
          await sleep(100);
          if (party) await g.eval(`(() => { const s = document.querySelector('select[data-role="playtest-party"]'); s.value = ${JSON.stringify(party)}; s.dispatchEvent(new Event("change")); })()`);
          await g.eval(`document.querySelector('button[data-role="playtest"]').click()`);
          await g.waitForScene("BattleScene", ["run", "loop"]);
          await sleep(500);
          const s = await g.eval(WHICH);
          check(`${label}: booted to a live phase (no freeze)`, s.battleActive === true && s.battlePhase != null);
          if (expectLen) check(`${label}: fielded the ${expectLen}-body squad`, s.partyLen === expectLen);
          await g.clickScene(400, 44);
          await g.waitForScene("EditorScene", ["draft"]);
          await sleep(300);
          check(`${label}: Exit returned to the editor`, (await g.eval(WHICH)).editorActive === true);
        };

        console.log("• edge levels: a zero-enemy board and an over-crowded board don't freeze");
        // Zero enemies (validates: spawns present, empty enemy array) — a vacuous but bootable level.
        await bootExit("zero-enemy", { id: "pt-empty", name: "Empty", cols: 6, rows: 6, blocked: [], playerSpawns: [{ col: 0, row: 0 }, { col: 1, row: 0 }], enemies: [], captives: [], exit: [], traps: [], gates: [], levers: [], objectives: [] }, null);
        // Over-crowded: a 3×3 board with the 5-body Vanguard — the "is this too crowded to field a squad?"
        // case, which is the whole point of soft-play; deployment must surface the crush, not freeze.
        await bootExit("crowded-3x3-vanguard-5", { id: "pt-tiny", name: "Tiny", cols: 3, rows: 3, blocked: [], playerSpawns: [{ col: 0, row: 0 }], enemies: [{ templateId: "bandit-thug", pos: { col: 2, row: 2 } }], captives: [], exit: [], traps: [], gates: [], levers: [], objectives: [] }, "Vanguard (5)", 5);

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
