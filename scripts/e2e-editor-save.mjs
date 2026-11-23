// E2E: the editor's **Game Levels** block — Open level (load a shipped level) and Save to game (write
// the draft into the levels folder through the dev server, level-save-plugin.ts). Real browser, real
// dev server, real file writes, real page reload.
//
// The writes go to a temporary folder (CAMPFIRE_LEVELS_DIR), never to src/content/levels, so a test run
// can't touch the shipped levels; the last check proves that.
//
// Run:  npm run test:e2e:editor:save   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, readdir, rm, access } from "node:fs/promises";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-editor-save");
const SAVE_DIR = await mkdtemp(path.join(os.tmpdir(), "campfire-levels-"));
process.env.CAMPFIRE_LEVELS_DIR = SAVE_DIR; // read by the plugin when withGame starts the dev server
const NEW_ID = "e2e-saved-level";

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const SC = `window.game.scene.getScene("EditorScene")`;
const STATE = `(() => {
  const s = ${SC};
  const d = s?.draft ?? {};
  const btn = document.querySelector('button[data-role="save-to-game"]');
  return {
    active: !!(s && s.scene.isActive("EditorScene")),
    id: d.id ?? null,
    walls: d.blocked?.length ?? null,
    enemies: d.enemies?.length ?? null,
    status: document.querySelector('[data-role="valid"]')?.textContent ?? s?.validLine?.textContent ?? "",
    tab: s?.activeTab ?? null,
    saveText: btn?.textContent ?? null,
    armed: btn?.dataset.armed === "1",
    options: [...document.querySelectorAll('select[data-role="open-level"] option')].map((o) => o.value),
  };
})()`;

const fileExists = (f) => access(f).then(() => true, () => false);

async function main() {
  await withGame(
    async (g) => {
      try {
        const boot = async () => { await g.boot("#editor"); await g.waitForScene("EditorScene", ["draft"]); await sleep(600); };
        const openScenario = async () => { await g.eval(`document.querySelector('button[data-tab="Scenario"]').click()`); await sleep(80); };
        const clickSave = () => g.eval(`document.querySelector('button[data-role="save-to-game"]').click()`);
        // A successful save reloads the page; wait for that reload and the editor to come back.
        const saveAndReload = async () => {
          await Promise.all([g.page.waitForNavigation({ waitUntil: "load", timeout: 30000 }), clickSave()]);
          await g.page.waitForSelector("canvas", { timeout: 15000 });
          await g.waitForScene("EditorScene", ["draft"]);
          await sleep(600);
        };
        const waitFor = async (pred, what, ms = 5000) => {
          const t0 = Date.now();
          for (;;) {
            const st = await g.eval(STATE);
            if (pred(st)) return st;
            if (Date.now() - t0 > ms) throw new Error(`✗ timed out waiting for ${what} — last state ${JSON.stringify(st)}`);
            await sleep(60);
          }
        };

        await sleep(600);
        await g.eval(`try { localStorage.clear(); sessionStorage.clear(); } catch {}`);
        await boot();
        await openScenario();

        // ── Open level ──
        console.log("• Open level loads a shipped level into the editor");
        let st = await g.eval(STATE);
        check("the Open level list offers the shipped levels", st.options.includes("prison-wagon") && st.options.includes("the-rescue"));
        await g.eval(`(() => { const p = document.querySelector('select[data-role="open-level"]'); p.value = "prison-wagon"; document.querySelector('button[data-role="open-level-btn"]').click(); })()`);
        st = await waitFor((s) => s.id === "prison-wagon", "the opened level");
        check("Open loaded prison-wagon (its enemies are on the board)", st.enemies > 0);
        check("the status line names the file it opened", st.status.includes("prison-wagon.json"));
        await g.screenshot(path.join(OUT, "01-opened.png"));

        await openScenario();
        await g.eval(`(() => { const p = document.querySelector('select[data-role="open-level"]'); p.value = "outer-yard"; document.querySelector('button[data-role="open-level-btn"]').click(); })()`);
        st = await waitFor((s) => s.status.includes("can't open"), "the refusal");
        check("a level the editor can't edit yet says why and leaves the draft alone", st.id === "prison-wagon" && st.status.includes("outer-yard"));

        // ── Save to game: a new level ──
        console.log("• Save to game writes a new level file, reloads, and confirms");
        await g.eval(`(() => { const s = ${SC}; s.draft.id = ${JSON.stringify(NEW_ID)}; s.updateExport(); })()`);
        const wallsBefore = (await g.eval(STATE)).walls;
        await saveAndReload();
        st = await g.eval(STATE);
        const file = path.join(SAVE_DIR, `${NEW_ID}.json`);
        check("the file was written to the levels folder", await fileExists(file));
        const saved = JSON.parse(await readFile(file, "utf8"));
        check("it holds the draft (id, walls, enemies)", saved.id === NEW_ID && saved.blocked.length === wallsBefore && saved.enemies.length === st.enemies);
        check("after the reload the editor is back on the same draft", st.active && st.id === NEW_ID);
        check("…on the Scenario tab, with a confirmation naming the file", st.tab === "Scenario" && st.status.includes(`${NEW_ID}.json`));
        await g.screenshot(path.join(OUT, "02-saved.png"));

        // ── Overwrite is a deliberate second click ──
        console.log("• saving over an existing file needs a second click");
        const textBefore = await readFile(file, "utf8");
        await clickSave();
        st = await waitFor((s) => s.armed, "the overwrite prompt");
        check("the first click only arms it (Overwrite …?)", st.saveText.includes("Overwrite") && st.saveText.includes(`${NEW_ID}.json`));
        check("…and the file is untouched", (await readFile(file, "utf8")) === textBefore);
        await g.eval(`(() => { const s = ${SC}; s.draft.blocked.push({ col: 0, row: 0 }); s.updateExport(); })()`);
        st = await g.eval(STATE);
        check("editing the draft disarms the overwrite", !st.armed && st.saveText === "Save to game");
        await clickSave();
        await waitFor((s) => s.armed, "the overwrite prompt again");
        await saveAndReload();
        const replaced = JSON.parse(await readFile(file, "utf8"));
        check("the second click replaced the file with the edited draft", replaced.blocked.length === wallsBefore + 1);
        st = await g.eval(STATE);
        check("the confirmation says it replaced the file", st.status.includes("replaced"));

        // ── Refusals never write ──
        console.log("• a bad id or an invalid level is refused without writing");
        await openScenario();
        await g.eval(`(() => { const s = ${SC}; s.draft.id = "Bad Id"; s.updateExport(); })()`);
        await clickSave();
        st = await waitFor((s) => s.status.includes("can't save"), "the id refusal");
        check("an id that can't be a file name is refused", st.status.includes("file name"));
        await g.eval(`(() => { const s = ${SC}; s.draft.id = "e2e-invalid"; s.draft.playerSpawns = []; s.updateExport(); })()`);
        await clickSave();
        st = await waitFor((s) => s.status.includes("can't save"), "the validation refusal");
        check("an invalid level is refused with the validator's reason", !(await fileExists(path.join(SAVE_DIR, "e2e-invalid.json"))));
        await g.screenshot(path.join(OUT, "03-refused.png"));

        const shipped = await readdir(path.join(ROOT, "src", "content", "levels"));
        check("nothing was written to the shipped levels folder", !shipped.some((f) => f.startsWith("e2e-")));

        assertNoProblems(g.problems);
      } catch (err) {
        await g.screenshot(path.join(OUT, "zz-failure.png")).catch(() => {});
        throw err;
      }
    },
    { hash: "#editor" },
  );
  console.log(`\n✓ editor save E2E: ${passed} assertions passed, no page errors`);
}

main()
  .catch((e) => { console.error(`\n${e.message ?? e}`); process.exitCode = 1; })
  .finally(() => rm(SAVE_DIR, { recursive: true, force: true }));
