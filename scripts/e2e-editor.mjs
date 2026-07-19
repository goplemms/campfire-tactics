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
    enemyCards: document.querySelectorAll('button[data-brush="enemy"]').length,
    essentialBrushes: ["wall","line","rect","gate","lever","trap","spawn","exit","enemy","captive","select","erase"].every((b) => !!document.querySelector('button[data-brush="' + b + '"]')),
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
        // A tile's on-screen point from its live board-world coord (recenter- + FIT-safe): the
        // board now centres in the FULL canvas width (D98), so pixel-hardcoded clicks would miss.
        // Valid only at the default camera (scroll 0, zoom 1) — true at boot and after Recenter.
        const tileScreen = (col, row) =>
          g.eval(`(() => { const p = window.game.scene.getScene("EditorScene").view.tileToWorld({col:${col},row:${row}}); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
        const clickTile = async (col, row) => { const p = await tileScreen(col, row); await g.clickScene(p.x, p.y); await sleep(80); };
        let st = await g.eval(STATE);
        console.log("• #editor boots with the brush palette");
        check("the editor scene is active", st.active === true);
        check("the placeable gallery has every essential brush (incl. gate + lever)", st.essentialBrushes === true);
        check("the enemy roster is unrolled into cards (not a dropdown)", st.enemyCards >= 6);
        check("the drawer tab bar is present (5 tabs incl. Objects)", st.tabs === 5);

        // D109 slice 2 — the card tweaks are live, persisted display options (size / tint / captive).
        console.log("• display options: size · enemy tint · captive variants");
        check("the display-options row is present", (await g.eval(`!!document.querySelector('[data-role="editor-options"]')`)) === true);
        const wallW = () => g.eval(`document.querySelector('button[data-brush="wall"]').offsetWidth`);
        await g.eval(`document.querySelector('button[data-opt="size:M"]').click()`); await sleep(80);
        const wM = await wallW();
        await g.eval(`document.querySelector('button[data-opt="size:L"]').click()`); await sleep(120);
        const wL = await wallW();
        check("choosing the Large size option widens the cards", wL > wM);
        await g.eval(`document.querySelector('button[data-opt="size:M"]').click()`); await sleep(80);
        await g.eval(`document.querySelector('button[data-opt="enemy:role"]').click()`); await sleep(100);
        const roleOn = await g.eval(`document.querySelector('button[data-opt="enemy:role"]').style.fontWeight === "700"`);
        check("choosing the role tint option activates it (no freeze)", roleOn === true);
        const captive2 = await g.eval(`(() => { document.querySelector('button[data-opt="captive:2"]').click(); return document.querySelectorAll('button[data-brush="captive"]').length; })()`);
        await sleep(100);
        check("choosing 2 captive variants adds the reach card", captive2 === 2);
        // restore defaults so persisted prefs don't leak into later assertions / runs
        await g.eval(`document.querySelector('button[data-opt="enemy:red"]').click(); document.querySelector('button[data-opt="captive:1"]').click();`); await sleep(80);
        check("the draft starts empty", st.walls === 0 && st.spawns === 0 && st.enemies === 0);
        await g.screenshot(path.join(OUT, "01-empty.png"));

        // D98 placement geometry: the slab dock sits BELOW the canvas, and the FIT-scaled board must
        // never overflow into it — not even on a short viewport (the challenge's clip failure mode).
        console.log("• the slab dock sits below the canvas (no bleed / no clip)");
        const fits = () => g.eval(`(() => {
          const c = document.querySelector("canvas").getBoundingClientRect();
          const dockTop = document.querySelector('[data-role="dock-grip"]').parentElement.getBoundingClientRect().top;
          const app = document.getElementById("app").getBoundingClientRect();
          return { overflow: Math.round(c.bottom - dockTop), inApp: c.bottom <= app.bottom + 1, dockPresent: !!document.querySelector('[data-role="dock-grip"]') };
        })()`);
        let fit = await fits();
        check("the resize grip / dock is present below the board", fit.dockPresent === true);
        check("the board sits above the dock at the default viewport (no bleed)", fit.overflow <= 1 && fit.inApp);
        await g.page.setViewport({ width: 900, height: 600 }); await sleep(300);
        fit = await fits();
        check("the board still fits above the dock on a short viewport (no clip)", fit.overflow <= 1 && fit.inApp);
        await g.page.setViewport({ width: 820, height: 680 }); await sleep(300);

        // Wall brush (default): real clicks place walls. (Blank draft is 9×6 — cols 0-8, rows 0-5.)
        for (const [c, r] of [[2, 2], [3, 2]]) await clickTile(c, r);
        st = await g.eval(STATE);
        check("wall brush + clicks place walls (click-pick works)", st.walls === 2);

        // Drag-to-paint (blank board, so the later import resets it): a plain left drag lays a continuous
        // run, and re-dragging the same run erases it (the first tile's state fixes the whole stroke).
        console.log("• drag-to-paint lays a continuous run; a re-drag erases it");
        const run = [[3, 5], [4, 5], [5, 5], [6, 5]].map(([c, r]) => ({ col: c, row: r }));
        const blockedHas = (tiles) => g.eval(`(() => { const b = window.game.scene.getScene("EditorScene").draft.blocked; return ${JSON.stringify(tiles)}.filter((t) => b.some((c) => c.col === t.col && c.row === t.row)).length; })()`);
        const ra = await tileScreen(3, 5), rz = await tileScreen(6, 5);
        const wPreDrag = (await g.eval(STATE)).walls;
        await g.drag(ra.x, ra.y, rz.x, rz.y); // plain left drag over an empty row → paints
        await sleep(120);
        check("a left drag painted the whole 4-tile run", (await blockedHas(run)) === 4);
        check("the run is a continuous stroke, not one release tile", (await g.eval(STATE)).walls >= wPreDrag + 4);
        await g.drag(ra.x, ra.y, rz.x, rz.y); // re-drag: first tile is now a wall → the stroke removes
        await sleep(120);
        check("re-dragging the painted run clears it", (await blockedHas(run)) === 0);
        check("the original two walls are untouched", (await g.eval(STATE)).walls === wPreDrag);

        // Spawn brush.
        await g.eval(setBrush("spawn"));
        for (const [c, r] of [[0, 4], [1, 4]]) await clickTile(c, r);
        // Enemy brush.
        await g.eval(setBrush("enemy"));
        for (const [c, r] of [[5, 2], [6, 2]]) await clickTile(c, r);
        // Exit brush.
        await g.eval(setBrush("exit"));
        for (const [c, r] of [[8, 0], [8, 1]]) await clickTile(c, r);

        st = await g.eval(STATE);
        console.log("• the palette paints spawns / enemies / exit tiles");
        check("spawns were placed", st.spawns === 2);
        check("enemies were placed", st.enemies === 2);
        check("exit tiles were placed", st.exit === 2);
        check("the live export reflects spawns + enemies", st.expSpawns === 2 && st.expEnemies === 2);
        check("the draft validates as a playable level", st.valid === true);
        await g.screenshot(path.join(OUT, "02-painted.png"));

        // Erase brush removes an entity at a clicked tile (one of the enemies placed above, (5,2)).
        await g.eval(setBrush("erase"));
        await clickTile(5, 2);
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

        // The side drawer (D109 slice 2) — the "edit a placed object" surface (unit list + inspector),
        // opened by the Details toggle; the board stays full-size behind it.
        console.log("• the Details side drawer reveals the edit surface");
        const drawerShown = () => g.eval(`(() => { const d = document.querySelector('[data-role="side-drawer"]'); return d && d.style.transform === "none"; })()`);
        check("the side drawer starts closed", (await drawerShown()) === false);
        check("the Details toggle is present", (await g.eval(`!!document.querySelector('[data-role="details-toggle"]')`)) === true);
        await g.eval(`document.querySelector('[data-role="details-toggle"]').click()`); await sleep(150);
        check("the Details toggle opens the drawer", (await drawerShown()) === true);
        // The unit list lives in the drawer now — it reaches every placed unit (occlusion fix).
        const stU = await g.eval(STATE);
        console.log("• the drawer's unit list lists every placed unit");
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
        // Close the drawer so it stops overlaying the right of the board for the board-click sections below.
        await g.eval(`document.querySelector('[data-role="drawer-close"]').click()`); await sleep(80);

        // Camera controls (large-map fix + QoL): panning is now gated behind Shift so a plain drag
        // stops stealing the gesture from painting — Shift-drag pans, a plain drag does not, and
        // Recenter restores the default framing — so a 20×20 level stays reachable on the fixed canvas.
        console.log("• Shift-drag pans the board; a plain drag does not (pan gated behind Shift)");
        const camBefore = await g.eval(CAM);
        check("camera starts at the default framing", camBefore.sx === 0 && camBefore.sy === 0 && camBefore.zoom === 1);

        // A plain drag (no modifier) must NOT pan — it falls through to a tap. Use the Select brush so
        // that release-tap only (de)selects, never mutating the board's counts.
        await g.eval(setBrush("select"));
        await g.drag(430, 300, 250, 300); // plain drag left over the board
        await sleep(120);
        const camPlain = await g.eval(CAM);
        check("a plain drag does not pan (panning is gated behind Shift)", camPlain.sx === 0 && camPlain.sy === 0 && camPlain.zoom === 1);
        // The release-tap may have selected an entity + opened the drawer — close it so it doesn't overlay later clicks.
        await g.eval(`(() => { const d = document.querySelector('[data-role="side-drawer"]'); if (d && d.style.transform === "none") document.querySelector('[data-role="drawer-close"]').click(); })()`);
        await sleep(60);

        // Holding Shift, the same drag pans the camera (and still does not paint).
        const wallsBeforeDrag = (await g.eval(STATE)).walls;
        await g.eval(setBrush("wall"));
        await g.page.keyboard.down("Shift");
        await g.drag(430, 300, 250, 300); // shift-drag left over the board
        await g.page.keyboard.up("Shift");
        await sleep(120);
        const camAfter = await g.eval(CAM);
        const stDrag = await g.eval(STATE);
        check("shift-dragging scrolled the camera", Math.abs(camAfter.sx) > 30);
        check("a shift-drag pans, it does not paint (pan vs click)", stDrag.walls === wallsBeforeDrag);
        await g.screenshot(path.join(OUT, "05-panned.png"));

        // Recenter resets scroll+zoom; after it a genuine tap still paints (discrimination intact).
        await g.eval(`document.querySelector('button[data-role="recenter"]').click()`);
        await sleep(80);
        const camReset = await g.eval(CAM);
        check("Recenter restored the default framing", camReset.sx === 0 && camReset.sy === 0 && camReset.zoom === 1);
        { const p = await tileScreen(5, 0); await g.clickScene(p.x, p.y); } // a plain tap on the empty tile (5,0)
        await sleep(100);
        const stTap = await g.eval(STATE);
        check("a tap after recenter still paints (walls incremented)", stTap.walls === wallsBeforeDrag + 1);

        // Structural wall tools (M-D): two-click line + rectangle, plus the live coordinate readout.
        // Camera is recentered (scroll 0, zoom 1), so a tile's board-world point equals its screen point.
        console.log("• line / rectangle wall tools + coordinate readout (structural authoring)");
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

        // Objectives editor + reward (M-C): the-rescue imported with 2 objectives — tune label/required,
        // add one, set the reward — the gaps the visual editor couldn't reach before.
        console.log("• objectives editor + reward controls (M-C)");
        await g.eval(clickTab("Scenario")); // objectives are level-wide → the Scenario tab body now (D109 slice 2)
        await sleep(80);
        const objCount = () => g.eval(`document.querySelectorAll('[data-role="objective"]').length`);
        const expObj = () => g.eval(`JSON.parse(document.querySelector("pre").textContent).objectives`);
        check("the imported finale shows its 2 objectives as editable rows", (await objCount()) === 2);

        // Edit the first objective's label + toggle its required flag off (the two fields we explained).
        await g.eval(`(() => {
          const row = document.querySelector('[data-role="objective"]');
          const label = row.querySelector('input:not([type=checkbox])');
          label.value = "Storm the Iron Gaol"; label.dispatchEvent(new Event("input"));
          const req = row.querySelector('input[type=checkbox]');
          req.checked = false; req.dispatchEvent(new Event("change"));
        })()`);
        await sleep(80);
        const o0 = (await expObj())[0];
        check("editing an objective label flows to the export", o0.label === "Storm the Iron Gaol");
        check("toggling required off flows to the export (an optional objective)", o0.required === false);

        // Add an objective → 3 rows, 3 in the export.
        await g.eval(`document.querySelector('button[data-role="add-objective"]').click()`);
        await sleep(80);
        check("＋ add appends an objective row", (await objCount()) === 3);
        check("the added objective reaches the export", (await expObj()).length === 3);

        // Reward control (Scenario drawer).
        await g.eval(clickTab("Scenario"));
        await sleep(60);
        await g.eval(`(() => { const el = document.querySelector('input[data-role="reward-gold"]'); el.value = "500"; el.dispatchEvent(new Event("change")); })()`);
        await sleep(60);
        check("editing the reward gold flows to the export", (await g.eval(`JSON.parse(document.querySelector("pre").textContent).reward.gold`)) === 500);
        check("the level still validates after objective + reward edits", (await g.eval(STATE)).valid === true);
        await g.screenshot(path.join(OUT, "07-objectives.png"));

        // Objects (M-D2): gates + levers as placeable objects in the new Objects tab, edited via the
        // persistent inspector — the last editor↔JSON gap, so the prison is fully paintable.
        console.log("• objects: gate + lever authoring (M-D2)");
        await g.eval(clickTab("Objects"));
        await sleep(60);
        const objExp = () => g.eval(`(() => {
          const e = JSON.parse(document.querySelector("pre").textContent);
          return { gates: (e.gates || []).length, levers: (e.levers || []).length,
                   openBy: e.gates && e.gates[0] ? e.gates[0].openBy.map((c) => c.kind).sort() : [],
                   targets: e.levers && e.levers[0] ? e.levers[0].targets : [] };
        })()`);
        // Place a gate (default lockpick cell) + a lever on empty tiles.
        await g.eval(setBrush("gate"));
        let gp = await tileScreen(1, 3); await g.clickScene(gp.x, gp.y); await sleep(60);
        await g.eval(setBrush("lever"));
        const lp = await tileScreen(1, 5); await g.clickScene(lp.x, lp.y); await sleep(60);
        let oe = await objExp();
        check("a gate lands as a default lockpick cell + a lever lands unwired", oe.gates === 1 && oe.levers === 1 && oe.openBy.join() === "lockpick" && oe.targets.length === 0);

        // Select the gate → inspector; add a destructible condition (a batter-able door). Close the
        // drawer first so we can prove Select auto-reopens it (the board stays full-size behind it).
        await g.eval(`document.querySelector('[data-role="drawer-close"]').click()`); await sleep(80);
        check("the drawer closed via its ✕", (await g.eval(`document.querySelector('[data-role="side-drawer"]').style.transform !== "none"`)) === true);
        await g.eval(setBrush("select"));
        gp = await tileScreen(1, 3); await g.clickScene(gp.x, gp.y); await sleep(120);
        check("selecting a placed object on the board auto-opens the drawer", (await g.eval(`document.querySelector('[data-role="side-drawer"]').style.transform === "none"`)) === true);
        await g.eval(`(() => {
          const insp = document.querySelector('[data-role="inspector"]');
          const box = [...insp.querySelectorAll('input[type=checkbox]')].find((b) => (b.parentElement.textContent || "").includes("destructible"));
          box.checked = true; box.dispatchEvent(new Event("change"));
        })()`);
        await sleep(120);
        oe = await objExp();
        check("the gate inspector adds a destructible condition (lockpick + destructible)", oe.openBy.join() === "destructible,lockpick");

        // Select the lever → inspector; wire it to the gate.
        await g.eval(setBrush("select"));
        await g.clickScene(lp.x, lp.y); await sleep(120);
        await g.eval(`(() => {
          const insp = document.querySelector('[data-role="inspector"]');
          insp.querySelector('input[type=checkbox]').click(); // the first gate in the target checklist
        })()`);
        await sleep(120);
        oe = await objExp();
        check("wiring the lever targets the gate in the export", oe.targets.length === 1);
        check("the level still validates with gates + a lever placed", (await g.eval(STATE)).valid === true);
        await g.screenshot(path.join(OUT, "08-objects.png"));

        // Ctrl-click quick-select (QoL companion to shift-pan): from ANY brush, Ctrl-click picks the
        // object under the cursor into the inspector without switching to the Select tool — and it does
        // NOT run the active brush. Prove it with the Wall brush active over the placed gate at (1,3).
        console.log("• ctrl-click quick-selects an object from any brush (no paint)");
        await g.eval(`document.querySelector('[data-role="drawer-close"]').click()`); await sleep(60);
        const sel = () => g.eval(`window.game.scene.getScene("EditorScene").selection?.kind ?? null`);
        await g.eval(setBrush("wall")); // a non-select brush active
        const wallsBeforeQuickSel = (await g.eval(STATE)).walls;
        const qg = await tileScreen(1, 3); // the gate placed above
        await g.page.keyboard.down("Control");
        await g.clickScene(qg.x, qg.y);
        await g.page.keyboard.up("Control");
        await sleep(120);
        check("ctrl-click selected the gate under the cursor", (await sel()) === "gate");
        check("ctrl-click did not paint a wall (select, not brush)", (await g.eval(STATE)).walls === wallsBeforeQuickSel);
        check("ctrl-click opened the inspector drawer", (await g.eval(`document.querySelector('[data-role="side-drawer"]').style.transform === "none"`)) === true);
        // Ctrl-click an unoccupied tile clears the selection (still no paint). Compute a tile with no
        // enemy/captive/gate/lever from the live draft so this doesn't depend on the-rescue's layout.
        const qe = await g.eval(`(() => {
          const sc = window.game.scene.getScene("EditorScene"), d = sc.draft;
          const occ = (t) => [...d.enemies, ...d.captives, ...d.gates, ...d.levers].some((o) => o.pos.col === t.col && o.pos.row === t.row);
          for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) { const t = { col: c, row: r }; if (!occ(t)) { const p = sc.view.tileToWorld(t); return { x: Math.round(p.x), y: Math.round(p.y) }; } }
          return null;
        })()`);
        await g.page.keyboard.down("Control");
        await g.clickScene(qe.x, qe.y);
        await g.page.keyboard.up("Control");
        await sleep(100);
        check("ctrl-click on an unoccupied tile clears the selection", (await sel()) === null);
        check("ctrl-click on empty still did not paint", (await g.eval(STATE)).walls === wallsBeforeQuickSel);

        // Close the side drawer so it doesn't overlay the right of the board for the gesture tests below.
        const closeDrawerIfOpen = () => g.eval(`(() => { const d = document.querySelector('[data-role="side-drawer"]'); if (d && d.style.transform === "none") document.querySelector('[data-role="drawer-close"]').click(); })()`);
        await closeDrawerIfOpen(); await sleep(60);

        // Alt-click eyedropper: adopt the brush under the cursor from any other brush. Alt-click the gate.
        console.log("• alt-click eyedropper adopts the brush under the cursor");
        const brush = () => g.eval(`window.game.scene.getScene("EditorScene").brush`);
        await g.eval(setBrush("wall"));
        await g.page.keyboard.down("Alt");
        await g.clickScene(qg.x, qg.y); // the gate tile
        await g.page.keyboard.up("Alt");
        await sleep(100);
        check("alt-click over the gate switched the brush to gate", (await brush()) === "gate");
        check("alt-click did not paint a wall", (await g.eval(STATE)).walls === wallsBeforeQuickSel);

        // Right-click / right-drag erases from any brush (no context menu). Erase an enemy with the Wall
        // brush active, then paint a computed-empty run and right-drag it away.
        console.log("• right-click / right-drag erases from any brush");
        await g.eval(setBrush("wall"));
        const enemiesBeforeErase = (await g.eval(STATE)).enemies;
        const et = await g.eval(`(() => { const sc = window.game.scene.getScene("EditorScene"), e = sc.draft.enemies[0], p = sc.view.tileToWorld(e.pos); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
        await g.clickScene(et.x, et.y, { button: "right" });
        await sleep(120);
        check("right-click erased the enemy under the cursor", (await g.eval(STATE)).enemies === enemiesBeforeErase - 1);
        check("right-click did not paint a wall (erase, not brush)", (await g.eval(STATE)).walls === wallsBeforeQuickSel);
        // A computed empty 3-wide run: paint it with a left drag, then right-drag to erase it. The-rescue's
        // board is wider than the 800px canvas, so restrict the scan to tiles whose world point is on-screen
        // (default camera → world == screen); an off-canvas run would sit under the DOM, not the board.
        const er = await g.eval(`(() => {
          const sc = window.game.scene.getScene("EditorScene"), d = sc.draft;
          const occ = (c, r) => [...d.blocked, ...d.playerSpawns, ...d.exit, ...d.traps, ...d.enemies.map((e) => e.pos), ...d.captives.map((x) => x.pos), ...d.gates.map((g) => g.pos), ...d.levers.map((l) => l.pos)].some((p) => p.col === c && p.row === r);
          const on = (p) => p.x > 60 && p.x < 740 && p.y > 60 && p.y < 540;
          for (let r = 0; r < d.rows; r++) for (let c = 0; c + 2 < d.cols; c++) {
            if (occ(c, r) || occ(c + 1, r) || occ(c + 2, r)) continue;
            const a = sc.view.tileToWorld({ col: c, row: r }), z = sc.view.tileToWorld({ col: c + 2, row: r });
            if (!on(a) || !on(z)) continue;
            return { a: { x: Math.round(a.x), y: Math.round(a.y) }, z: { x: Math.round(z.x), y: Math.round(z.y) }, tiles: [[c, r], [c + 1, r], [c + 2, r]].map(([cc, rr]) => ({ col: cc, row: rr })) };
          }
          return null;
        })()`);
        await g.eval(setBrush("wall"));
        await g.drag(er.a.x, er.a.y, er.z.x, er.z.y); // left drag paints the run
        await sleep(120);
        check("a left drag painted the empty run", (await blockedHas(er.tiles)) === 3);
        await g.drag(er.a.x, er.a.y, er.z.x, er.z.y, 10, { button: "right" }); // right drag erases it
        await sleep(120);
        check("a right-drag erased the whole run", (await blockedHas(er.tiles)) === 0);

        // Keyboard: brush hotkeys (input-focus-safe) + their home-tab jump.
        console.log("• keyboard: brush hotkeys · esc · undo / redo");
        await g.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
        await g.eval(setBrush("wall"));
        await g.page.keyboard.press("KeyG");
        check("hotkey G selects the gate brush", (await brush()) === "gate");
        await g.page.keyboard.press("KeyN");
        check("hotkey N selects enemy and jumps to its Units tab", (await brush()) === "enemy" && (await g.eval(`window.game.scene.getScene("EditorScene").activeTab`)) === "Units");
        await g.page.keyboard.press("KeyW");
        check("hotkey W selects the wall brush", (await brush()) === "wall");
        // Hotkeys are suppressed while a text field is focused (typing an id must not switch brush). The
        // import box lives in the Scenario tab — show it first so the focus actually lands (a hidden
        // element can't be focused).
        await g.eval(clickTab("Scenario")); await sleep(60);
        await g.eval(`document.querySelector('textarea[data-role="import"]').focus()`);
        check("the import box is focused", (await g.eval(`document.activeElement.tagName`)) === "TEXTAREA");
        await g.page.keyboard.press("KeyG");
        check("a hotkey is ignored while a text field is focused", (await brush()) === "wall");
        await g.eval(`document.activeElement.blur()`);

        // Esc cancels a pending shape anchor and clears the selection.
        const anchor = () => g.eval(`window.game.scene.getScene("EditorScene").shapeAnchor`);
        await g.eval(setBrush("line"));
        const st00 = await tileScreen(0, 0);
        await g.clickScene(st00.x, st00.y); await sleep(80);
        check("a line click sets a pending shape anchor", (await anchor()) !== null);
        await g.page.keyboard.press("Escape");
        check("esc clears the pending shape anchor", (await anchor()) === null);
        await g.eval(setBrush("select"));
        const en0 = await g.eval(`(() => { const sc = window.game.scene.getScene("EditorScene"), e = sc.draft.enemies[0], p = sc.view.tileToWorld(e.pos); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
        await g.clickScene(en0.x, en0.y); await sleep(80);
        check("selecting an enemy sets the selection", (await sel()) === "enemy");
        await g.page.keyboard.press("Escape");
        check("esc clears the selection", (await sel()) === null);

        // Undo / redo (Ctrl+Z · Ctrl+Shift+Z · the buttons) reverses a board edit.
        await closeDrawerIfOpen(); await sleep(60); // the select above reopened the drawer
        await g.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
        await g.eval(setBrush("wall"));
        const wUndo = (await g.eval(STATE)).walls;
        const emptyT = await g.eval(`(() => {
          const sc = window.game.scene.getScene("EditorScene"), d = sc.draft;
          const occ = (c, r) => [...d.blocked, ...d.playerSpawns, ...d.exit, ...d.traps, ...d.enemies.map((e) => e.pos), ...d.captives.map((x) => x.pos), ...d.gates.map((g) => g.pos), ...d.levers.map((l) => l.pos)].some((p) => p.col === c && p.row === r);
          for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) if (!occ(c, r)) { const p = sc.view.tileToWorld({ col: c, row: r }); if (p.x > 60 && p.x < 740 && p.y > 60 && p.y < 540) return { x: Math.round(p.x), y: Math.round(p.y) }; }
          return null;
        })()`);
        await g.clickScene(emptyT.x, emptyT.y); await sleep(100);
        check("painting adds a wall", (await g.eval(STATE)).walls === wUndo + 1);
        await g.page.keyboard.down("Control"); await g.page.keyboard.press("KeyZ"); await g.page.keyboard.up("Control"); await sleep(100);
        check("Ctrl+Z undoes the paint", (await g.eval(STATE)).walls === wUndo);
        await g.page.keyboard.down("Control"); await g.page.keyboard.down("Shift"); await g.page.keyboard.press("KeyZ"); await g.page.keyboard.up("Shift"); await g.page.keyboard.up("Control"); await sleep(100);
        check("Ctrl+Shift+Z redoes the paint", (await g.eval(STATE)).walls === wUndo + 1);
        await g.eval(`document.querySelector('button[data-role="undo"]').click()`); await sleep(100);
        check("the Undo button reverses the paint too", (await g.eval(STATE)).walls === wUndo);
        await g.screenshot(path.join(OUT, "09-gestures.png"));

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
