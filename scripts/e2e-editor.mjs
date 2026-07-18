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

// The board camera's live scroll/zoom — proves drag-pans / wheel-zooms / Recenter reset.
const CAM = `(() => {
  const c = window.game.scene.getScene("EditorScene").cameras.main;
  return { sx: Math.round(c.scrollX), sy: Math.round(c.scrollY), zoom: +c.zoom.toFixed(3) };
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
        check("the brush palette is present (10 brushes incl. select + line/rect)", st.brushButtons === 10);
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
        check("import loaded the-rescue's 8 enemies", st3.enemies === 8);
        check("import loaded the-rescue's 3 captives", st3.captives === 3);
        check("import loaded the 7-tile exit span", st3.exit === 7);
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
        check("the unit list shows all 11 units (8 enemies + 3 captives)", stU.unitRows === 11);

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

        // Camera controls (large-map fix): drag pans the board, a drag does NOT paint, and
        // Recenter restores the default framing — so a 20×20 level is reachable on the fixed canvas.
        console.log("• grab-and-drag pans the board (large-map reachability)");
        const camBefore = await g.eval(CAM);
        check("camera starts at the default framing", camBefore.sx === 0 && camBefore.sy === 0 && camBefore.zoom === 1);
        const wallsBeforeDrag = (await g.eval(STATE)).walls;
        await g.eval(setBrush("wall"));
        await g.drag(430, 300, 250, 300); // drag left over the board
        await sleep(120);
        const camAfter = await g.eval(CAM);
        const stDrag = await g.eval(STATE);
        check("dragging scrolled the camera", Math.abs(camAfter.sx) > 30);
        check("a drag did not paint a tile (click vs drag)", stDrag.walls === wallsBeforeDrag);
        await g.screenshot(path.join(OUT, "05-panned.png"));

        // Recenter resets scroll+zoom; after it a genuine tap still paints (discrimination intact).
        await g.eval(`document.querySelector('button[data-role="recenter"]').click()`);
        await sleep(80);
        const camReset = await g.eval(CAM);
        check("Recenter restored the default framing", camReset.sx === 0 && camReset.sy === 0 && camReset.zoom === 1);
        await g.clickScene(448, 262); // a plain tap on the empty tile (5,0)
        await sleep(100);
        const stTap = await g.eval(STATE);
        check("a tap after recenter still paints (walls incremented)", stTap.walls === wallsBeforeDrag + 1);

        // Structural wall tools (M-D): two-click line + rectangle, plus the live coordinate readout.
        // Camera is recentered (scroll 0, zoom 1), so a tile's board-world point equals its screen point.
        console.log("• line / rectangle wall tools + coordinate readout (structural authoring)");
        const tileScreen = (col, row) =>
          g.eval(`(() => { const p = window.game.scene.getScene("EditorScene").view.tileToWorld({col:${col},row:${row}}); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
        const coordText = () => g.eval(`document.querySelector('[data-role="coord"]').textContent`);
        const blocked = async () => (await g.eval(STATE)).walls;

        // The coordinate readout tracks the hovered tile.
        const hb = await tileScreen(2, 0);
        await g.hover(hb.x, hb.y);
        await sleep(60);
        check("the coordinate readout shows the hovered tile", (await coordText()).includes("(2,0)"));
        check("the rect outline/fill mode toggle is present", (await g.eval(`!!document.querySelector('button[data-role="rect-mode"]')`)) === true);

        // Line tool: anchor (2,0) → far (2,3) lays a 4-tile vertical wall run in two clicks.
        const b0 = await blocked();
        await g.eval(setBrush("line"));
        let p = await tileScreen(2, 0); await g.clickScene(p.x, p.y); await sleep(60);
        p = await tileScreen(2, 3); await g.clickScene(p.x, p.y); await sleep(60);
        check("line tool laid a 4-tile wall run (two clicks)", (await blocked()) === b0 + 4);

        // Rectangle outline: corners (4,5)–(6,6) → a 6-tile wall ring (a cell/room outline).
        const b1 = await blocked();
        await g.eval(setBrush("rect"));
        p = await tileScreen(4, 5); await g.clickScene(p.x, p.y); await sleep(60);
        p = await tileScreen(6, 6); await g.clickScene(p.x, p.y); await sleep(60);
        check("rect outline laid a 6-tile wall ring", (await blocked()) === b1 + 6);
        check("the level still validates after the shape tools", (await g.eval(STATE)).valid === true);
        await g.screenshot(path.join(OUT, "06-shapes.png"));

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
