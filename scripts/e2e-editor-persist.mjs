// E2E: editor **local persistence** (D-editor). Boots `#editor`, proves the working draft
// autosaves + restores across a real page reload, and that the named library survives a reload
// (Save → reload → Load → Delete). Reload is a genuine fresh document (harness `g.boot`), so
// this exercises the localStorage round-trip, not just in-memory state. No page errors = no freeze.
//
// Run:  npm run test:e2e:editor:persist   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-editor-persist");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const setBrush = (b) => `document.querySelector('button[data-brush="${b}"]').click()`;
const STATE = `(() => {
  const sc = window.game.scene.getScene("EditorScene");
  const d = sc?.draft ?? {};
  return {
    active: !!(sc && sc.scene.isActive("EditorScene")),
    walls: d.blocked?.length ?? null,
    id: d.id ?? null,
    libRows: document.querySelectorAll("[data-lib-row]").length,
  };
})()`;

async function boot(g) {
  await g.boot("#editor");
  await g.waitForScene("EditorScene", ["draft"]);
  await sleep(700);
}
const openScenario = (g) => g.eval(`document.querySelector('button[data-tab="Scenario"]').click()`);

async function main() {
  await withGame(
    async (g) => {
      try {
        // Fresh browser profile ⇒ empty localStorage. Start clean so the run is deterministic.
        await sleep(700);
        await g.eval(`try { localStorage.clear(); } catch {}`);
        await boot(g);
        const tileScreen = (col, row) =>
          g.eval(`(() => { const p = window.game.scene.getScene("EditorScene").view.tileToWorld({col:${col},row:${row}}); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
        const clickTile = async (col, row) => { const p = await tileScreen(col, row); await g.clickScene(p.x, p.y); await sleep(90); };

        let st = await g.eval(STATE);
        check("a fresh profile boots an empty draft", st.active && st.walls === 0);

        // ── Autosave + restore across a real reload ──
        console.log("• autosave restores the working draft across a page reload");
        await g.eval(setBrush("wall"));
        for (const [c, r] of [[2, 2], [3, 2], [4, 2]]) await clickTile(c, r);
        check("painted three walls", (await g.eval(STATE)).walls === 3);
        await boot(g); // full page reload (fresh document) — only localStorage survives
        st = await g.eval(STATE);
        check("after reload the three walls were restored from autosave", st.active && st.walls === 3);
        await g.screenshot(path.join(OUT, "01-restored.png"));

        // ── Named library: Save → reload → Load → Delete ──
        console.log("• the named library survives a reload (Save → reload → Load → Delete)");
        await openScenario(g);
        await sleep(80);
        // Name it, then Save into the library.
        await g.eval(`window.game.scene.getScene("EditorScene").draft.id = "attempt-a"; window.game.scene.getScene("EditorScene").updateExport();`);
        await g.eval(`document.querySelector('button[data-role="lib-save"]').click()`);
        await sleep(120);
        st = await g.eval(STATE);
        check("Save added a row to the library list", st.libRows === 1);

        // New blank map — working draft becomes empty (and autosaves empty), library keeps the entry.
        await g.eval(`document.querySelector('button[data-role="lib-new"]').click()`);
        await sleep(150);
        await openScenario(g); await sleep(60);
        st = await g.eval(STATE);
        check("New blanked the working draft", st.walls === 0);
        check("the saved map is still listed after New", st.libRows === 1);

        // Reload: working draft is now the blank (New autosaved), but the library entry persists.
        await boot(g);
        await openScenario(g); await sleep(80);
        st = await g.eval(STATE);
        check("after reload the working draft is blank (New was autosaved)", st.walls === 0);
        check("the library entry survived the reload", st.libRows === 1);

        // Load the saved attempt → the three walls come back.
        await g.eval(`document.querySelector('[data-lib-row="attempt-a"] button[data-role="lib-load"]').click()`);
        await sleep(200);
        st = await g.eval(STATE);
        check("Load restored the saved map (three walls, id attempt-a)", st.walls === 3 && st.id === "attempt-a");
        await g.screenshot(path.join(OUT, "02-loaded.png"));

        // Loading is undoable (mirrors import) — Ctrl+Z returns to the pre-load (blank) draft.
        await g.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
        await g.page.keyboard.down("Control"); await g.page.keyboard.press("KeyZ"); await g.page.keyboard.up("Control"); await sleep(150);
        check("Ctrl+Z undoes a library Load", (await g.eval(STATE)).walls === 0);
        await g.page.keyboard.down("Control"); await g.page.keyboard.down("Shift"); await g.page.keyboard.press("KeyZ"); await g.page.keyboard.up("Shift"); await g.page.keyboard.up("Control"); await sleep(150);
        check("Ctrl+Shift+Z redoes the Load", (await g.eval(STATE)).walls === 3);

        // Delete removes it from the list.
        await openScenario(g); await sleep(60);
        await g.eval(`document.querySelector('[data-lib-row="attempt-a"] button[data-role="lib-del"]').click()`);
        await sleep(120);
        check("Delete removed the map from the library", (await g.eval(STATE)).libRows === 0);

        // ── Corrupt-store resilience: a garbage working blob must not wedge the editor ──
        console.log("• a corrupt localStorage blob degrades to a blank draft (no freeze)");
        await g.eval(`try { localStorage.setItem("campfire-editor-working", "{not valid json"); localStorage.setItem("campfire-editor-maps", "garbage"); } catch {}`);
        await boot(g);
        st = await g.eval(STATE);
        check("a corrupt store falls back to a blank, active editor", st.active && st.walls === 0);

        assertNoProblems(g.problems);
      } catch (err) {
        await g.screenshot(path.join(OUT, "zz-failure.png")).catch(() => {});
        throw err;
      }
    },
    { hash: "#editor" },
  );
  console.log(`\n✓ editor persistence E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
