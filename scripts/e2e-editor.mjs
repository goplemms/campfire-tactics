// E2E: the visual level editor (D98). Boots `#editor`, drives the brush palette + real
// tile clicks, and asserts the paint → render → export loop produces a valid level with no
// page errors. The guard CLAUDE.md requires when a new scene surface is added.
//
// Run:  npm run test:e2e:editor   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import fs from "node:fs";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

// The real shipped finale — imported through the editor's paste box to prove a load→edit→save
// round-trip renders without a freeze (M-A). Read from disk, injected into the page.
const RESCUE_JSON = fs.readFileSync(path.join(ROOT, "src", "content", "levels", "the-rescue.json"), "utf8");

const OUT = path.join(ROOT, "screenshots", "e2e-editor");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Read the editor's draft counts + the live-export/validation state.
const STATE = `(() => {
  const sc = window.game.scene.getScene("EditorScene");
  const d = sc?.draft ?? {};
  const pre = document.querySelector("pre");
  const exp = (() => { try { return JSON.parse(pre.textContent); } catch { return null; } })();
  const validText = [...document.querySelectorAll("div")].map(n => n.textContent).find(t => /valid|⚠/.test(t)) || "";
  return {
    active: !!(sc && sc.scene.isActive("EditorScene")),
    brushButtons: document.querySelectorAll("button[data-brush]").length,
    tabs: document.querySelectorAll("button[data-tab]").length,
    unitRows: document.querySelectorAll("[data-unit-row]").length,
    walls: d.blocked?.length ?? null,
    spawns: d.playerSpawns?.length ?? null,
    enemies: d.enemies?.length ?? null,
    exit: d.exit?.length ?? null,
    captives: d.captives?.length ?? null,
    wardenRole: (d.enemies ?? []).find((e) => e.id === "the-warden")?.role ?? null,
    expCaptiveIds: (exp?.captives ?? []).map((c) => c.spec?.id).join(","),
    expExtractLabel: (exp?.objectives ?? []).find((o) => o.kind === "extraction")?.label ?? null,
    expReward: exp?.reward?.gold ?? null,
    importBox: !!document.querySelector('textarea[data-role="import"]'),
    wardenEditedHp: (exp?.enemies ?? []).find((e) => e.id === "the-warden-2")?.overrides?.maxHp ?? null,
    expSpawns: exp?.playerSpawns?.length ?? null,
    expEnemies: exp?.enemies?.length ?? null,
    valid: /✓ valid/.test(validText),
  };
})()`;

const clickTab = (t) => `document.querySelector('button[data-tab="${t}"]').click()`;

// Select the warden by clicking its UNIT-LIST row (the occlusion fix — no board pixel-hunt), then
// edit its id + maxHp through the inspector (M-B/M-UI — the new panel surfaces).
const EDIT = `(() => {
  const rows = [...document.querySelectorAll("[data-unit-row]")];
  const wardenRow = rows.find((r) => (r.textContent || "").includes("the-warden"));
  wardenRow.click();
  const insp = document.querySelector('[data-role="inspector"]');
  const idInput = insp.querySelector("input");
  idInput.value = "the-warden-2";
  idInput.dispatchEvent(new Event("input"));
  const hp = document.querySelector('input[data-stat="maxHp"]');
  hp.value = "99";
  hp.dispatchEvent(new Event("change"));
  return { statInputs: document.querySelectorAll("input[data-stat]").length, clickedRow: !!wardenRow };
})()`;

// Paste the-rescue's JSON into the import box and click Import.
const IMPORT = `(() => {
  const ta = document.querySelector('textarea[data-role="import"]');
  ta.value = ${JSON.stringify(RESCUE_JSON)};
  document.querySelector('button[data-role="import-btn"]').click();
  return true;
})()`;
const setBrush = (b) => `document.querySelector('button[data-brush="${b}"]').click()`;

async function main() {
  await withGame(
    async (g) => {
      try {
        await sleep(900);
        let st = await g.eval(STATE);
        console.log("• #editor boots with the brush palette");
        check("the editor scene is active", st.active === true);
        check("the brush palette is present (8 brushes incl. select)", st.brushButtons === 8);
        check("the drawer tab bar is present (4 tabs)", st.tabs === 4);
        check("the draft starts empty", st.walls === 0 && st.spawns === 0 && st.enemies === 0);
        await g.screenshot(path.join(OUT, "01-empty.png"));

        // Wall brush (default): real clicks place walls.
        for (const [x, y] of [[200, 300], [250, 320]]) { await g.clickScene(x, y); await sleep(80); }
        st = await g.eval(STATE);
        check("wall brush + clicks place walls (click-pick works)", st.walls === 2);

        // Spawn brush.
        await g.eval(setBrush("spawn"));
        for (const [x, y] of [[120, 280], [120, 320]]) { await g.clickScene(x, y); await sleep(80); }
        // Enemy brush.
        await g.eval(setBrush("enemy"));
        for (const [x, y] of [[340, 300], [380, 320]]) { await g.clickScene(x, y); await sleep(80); }
        // Exit brush.
        await g.eval(setBrush("exit"));
        for (const [x, y] of [[100, 260], [100, 300]]) { await g.clickScene(x, y); await sleep(80); }

        st = await g.eval(STATE);
        console.log("• the palette paints spawns / enemies / exit tiles");
        check("spawns were placed", st.spawns === 2);
        check("enemies were placed", st.enemies === 2);
        check("exit tiles were placed", st.exit === 2);
        check("the live export reflects spawns + enemies", st.expSpawns === 2 && st.expEnemies === 2);
        check("the draft validates as a playable level", st.valid === true);
        await g.screenshot(path.join(OUT, "02-painted.png"));

        // Erase brush removes an entity at a clicked tile.
        await g.eval(setBrush("erase"));
        await g.clickScene(340, 300); await sleep(80);
        const st2 = await g.eval(STATE);
        console.log("• erase brush removes a placed entity");
        check("erasing an enemy tile decrements the enemies", st2.enemies === 1);
        check("the import box is present", st2.importBox === true);

        // Import the shipped finale through the paste box — the M-A round-trip inverse, in the real scene.
        await g.eval(IMPORT);
        await sleep(200);
        const st3 = await g.eval(STATE);
        console.log("• importing the-rescue.json loads it into the draft (no freeze)");
        check("import loaded the-rescue's 5 enemies", st3.enemies === 5);
        check("import loaded the-rescue's 3 captives", st3.captives === 3);
        check("import loaded the 6-tile exit span", st3.exit === 6);
        check("import carried the named captive ids (not clobbered)", st3.expCaptiveIds === "wren,cass,bram");
        check("import carried the custom extraction label", st3.expExtractLabel === "Free the captives and escort them to the exit");
        check("import carried the authored reward (260g, not the 50g default)", st3.expReward === 260);
        check("import carried the warden's role tag", st3.wardenRole === "captain");
        check("the imported finale validates", st3.valid === true);
        await g.screenshot(path.join(OUT, "03-imported.png"));

        // Switch to the Units drawer — the list reaches every placed unit (occlusion fix).
        await g.eval(clickTab("Units"));
        await sleep(120);
        const stU = await g.eval(STATE);
        console.log("• the Units drawer lists every placed unit");
        check("the unit list shows all 8 units (5 enemies + 3 captives)", stU.unitRows === 8);

        // Inspector: select the warden via its list row, rename it + bump its maxHp (freeze-catch).
        const ed = await g.eval(EDIT);
        await sleep(150);
        const st4 = await g.eval(STATE);
        console.log("• unit-list select → inspector edits an entity's identity + stats (no freeze)");
        check("selection came from clicking the warden's list row", ed.clickedRow === true);
        check("the inspector rendered the 7-field stat grid", ed.statInputs === 7);
        check("the id rename + maxHp override flow to the export", st4.wardenEditedHp === 99);
        check("the level still validates after the edit", st4.valid === true);
        await g.screenshot(path.join(OUT, "04-inspected.png"));

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
