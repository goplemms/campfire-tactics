/**
 * Debug "jump to node" menu (render layer) — the **clickable front-end** over the
 * jump tooling.
 *
 * A dev-only, `position:fixed` DOM overlay (only ever mounted by the `#debug` boot —
 * {@link "./boot/debug".DebugBootScene}) that lists the expedition's nodes and lets
 * a developer boot the game straight into a node in a **plausible previous state**:
 * the best / average / worst-survivor arrival from the population sampler, an exact
 * route, or the default first-enumerated route. Clicking a row hands off to
 * {@link "./boot/debug".jumpToArrival}, which builds the arrival and starts the
 * destination scene.
 *
 * Style mirrors {@link "./playtest-log-ui".installPlaytestLogUI}: inline object-assign
 * styles (no CSS framework), idempotent install, **no-ops when `document` is
 * undefined** (headless-safe), and the heavy work stays in core — this file only
 * formats {@link arrivalDigest}s and wires DOM. The overlay is intentionally a DOM
 * sibling of the canvas, so a Phaser `scene.start` (which the jumps trigger) never
 * tears it down: you can jump repeatedly.
 */
import Phaser from "phaser";
import {
  THE_HOLLOW_MILL,
  getNode,
  getExpedition,
  resolveAuthored,
  enumeratePaths,
  traverseRoute,
  samplePopulation,
  pickRepresentatives,
  arrivalDigest,
  type Sample,
  type ArrivalDigest,
} from "../core";
import { jumpToArrival, type JumpParams } from "./boot/debug";

/** Stable DOM ids the harness (and a dev) target. */
export const DEBUG_MENU_TOGGLE_ID = "debug-jump-toggle";
export const DEBUG_MENU_PANEL_ID = "debug-jump-panel";
export const DEBUG_MENU_NODES_ID = "debug-jump-nodes";
export const DEBUG_MENU_PICKS_ID = "debug-jump-picks";
export const DEBUG_MENU_INTO_ID = "debug-jump-into";
export const DEBUG_MENU_ROUTE_ID = "debug-jump-route";
export const DEBUG_MENU_SALT_ID = "debug-jump-salt";

/** A row id for a node in the node list (`debug-jump-node-<id>`), so the harness can click one. */
export const nodeRowId = (nodeId: string): string => `debug-jump-node-${nodeId}`;
/** A row id for a percentile/route pick (`debug-jump-pick-<kind>`). */
export const pickRowId = (kind: string): string => `debug-jump-pick-${kind}`;

interface DebugMenuWindow extends Window {
  campfireDebugMenu?: { game: Phaser.Game };
}

/** Object-assign a style block (mirrors playtest-log-ui's pattern). */
function style(el: HTMLElement, s: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, s);
}

/** A human-ish name for a node, from its bound authored encounter (no `MapNode.name` exists). */
function nodeDisplayName(nodeId: string): string | undefined {
  const node = getNode(THE_HOLLOW_MILL.map, nodeId);
  if (node.authoredId) {
    const exp = getExpedition(THE_HOLLOW_MILL.id);
    const enc = exp && resolveAuthored(exp, node.authoredId);
    if (enc?.name) return enc.name;
  }
  return undefined;
}

/** `id · kind · <name>` label for a node-list row. */
function nodeLabel(nodeId: string): string {
  const node = getNode(THE_HOLLOW_MILL.map, nodeId);
  const name = nodeDisplayName(nodeId);
  return name ? `${node.id} · ${node.kind} · ${name}` : `${node.id} · ${node.kind}`;
}

/** Format a digest into a compact, legible one-line suffix. */
function digestLine(d: ArrivalDigest): string {
  const flags = d.flags.length ? ` · [${d.flags.join(", ")}]` : "";
  return `Lv ${d.levelTotal} · HP ${d.avgHpPct}% · ${d.gold}g · ${d.rosterIds.length} units${flags}`;
}

/**
 * Mount the debug-jump overlay for `game`. Idempotent: a second call (e.g. another
 * scene re-mounting it) just re-points the parked `game` reference and re-wires the
 * live game on the existing DOM — the panel and any selection survive. No-ops with no
 * DOM (headless).
 */
export function installDebugMenu(game: Phaser.Game): void {
  if (typeof document === "undefined") return;

  const win = window as DebugMenuWindow;
  win.campfireDebugMenu = { game };

  // Already mounted? Re-point at the live game (the closures below read `liveGame()`).
  if (document.getElementById(DEBUG_MENU_TOGGLE_ID)) return;

  const liveGame = (): Phaser.Game => (window as DebugMenuWindow).campfireDebugMenu!.game;

  // --- Toggle button (styled like the playtest-log button, parked top-left) ---
  const toggle = document.createElement("button");
  toggle.id = DEBUG_MENU_TOGGLE_ID;
  toggle.textContent = "≡ Debug Jump";
  toggle.title = "Dev: jump to any Hollow Mill node in a plausible arrival state";
  style(toggle, {
    position: "fixed",
    left: "12px",
    top: "12px",
    zIndex: "10000",
    padding: "6px 12px",
    background: "#2f6b46",
    color: "#eafff0",
    border: "1px solid #57b07a",
    borderRadius: "4px",
    font: "12px monospace",
    cursor: "pointer",
  });
  document.body.appendChild(toggle);

  // --- The panel ------------------------------------------------------------
  const panel = document.createElement("div");
  panel.id = DEBUG_MENU_PANEL_ID;
  style(panel, {
    position: "fixed",
    left: "12px",
    top: "48px",
    zIndex: "10000",
    width: "360px",
    maxHeight: "80vh",
    overflowY: "auto",
    display: "none",
    padding: "10px",
    background: "#161b22",
    color: "#c9d1d9",
    border: "1px solid #57b07a",
    borderRadius: "6px",
    font: "12px monospace",
    boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
  });
  document.body.appendChild(panel);

  toggle.onclick = () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  };

  // --- Controls: into toggle + custom route/salt ----------------------------
  const controls = document.createElement("div");
  style(controls, { marginBottom: "8px", display: "grid", gap: "6px" });

  const intoWrap = document.createElement("label");
  intoWrap.textContent = "into ";
  style(intoWrap, { display: "flex", gap: "6px", alignItems: "center" });
  const into = document.createElement("select");
  into.id = DEBUG_MENU_INTO_ID;
  for (const [value, label] of [
    ["auto", "auto (by node kind)"],
    ["battle", "battle"],
    ["overworld", "overworld"],
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    into.appendChild(opt);
  }
  style(into, { flex: "1", background: "#0d1117", color: "#c9d1d9", border: "1px solid #3d4b6e", borderRadius: "4px", padding: "3px", font: "inherit" });
  intoWrap.appendChild(into);
  controls.appendChild(intoWrap);

  const route = document.createElement("input");
  route.id = DEBUG_MENU_ROUTE_ID;
  route.type = "text";
  route.placeholder = "custom route (comma ids, optional)";
  style(route, { background: "#0d1117", color: "#c9d1d9", border: "1px solid #3d4b6e", borderRadius: "4px", padding: "4px", font: "inherit" });
  controls.appendChild(route);

  const salt = document.createElement("input");
  salt.id = DEBUG_MENU_SALT_ID;
  salt.type = "text";
  salt.placeholder = "salt (number, optional)";
  style(salt, { background: "#0d1117", color: "#c9d1d9", border: "1px solid #3d4b6e", borderRadius: "4px", padding: "4px", font: "inherit" });
  controls.appendChild(salt);

  panel.appendChild(controls);

  // --- Node list ------------------------------------------------------------
  const nodesHeading = document.createElement("div");
  nodesHeading.textContent = "Nodes";
  style(nodesHeading, { fontWeight: "bold", margin: "4px 0", color: "#9fe3b5" });
  panel.appendChild(nodesHeading);

  const nodes = document.createElement("div");
  nodes.id = DEBUG_MENU_NODES_ID;
  style(nodes, { display: "grid", gap: "3px", marginBottom: "8px" });
  panel.appendChild(nodes);

  // --- Picks area (populated lazily when a node is selected) -----------------
  const picks = document.createElement("div");
  picks.id = DEBUG_MENU_PICKS_ID;
  style(picks, { display: "grid", gap: "4px" });
  panel.appendChild(picks);

  /** Read the shared controls into the JumpParams overrides a row uses. */
  function controlOverrides(): { into?: JumpParams["into"]; route?: string[]; salt?: number } {
    const intoVal = into.value === "battle" || into.value === "overworld" ? into.value : undefined;
    const routeIds = route.value.trim()
      ? route.value.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : undefined;
    const saltNum = salt.value.trim() !== "" && !Number.isNaN(Number(salt.value)) ? Number(salt.value) : undefined;
    return { into: intoVal, route: routeIds, salt: saltNum };
  }

  /** Build a clickable pick row; clicking boots the game via jumpToArrival. */
  function pickRow(kind: string, label: string, params: JumpParams, enabled: boolean): HTMLButtonElement {
    const row = document.createElement("button");
    row.id = pickRowId(kind);
    row.textContent = label;
    style(row, {
      textAlign: "left",
      padding: "5px 8px",
      background: enabled ? "#1b2030" : "#15171c",
      color: enabled ? "#e8eefc" : "#6b7280",
      border: `1px solid ${enabled ? "#3d4b6e" : "#2a2f3a"}`,
      borderRadius: "4px",
      font: "inherit",
      cursor: enabled ? "pointer" : "default",
      whiteSpace: "normal",
    });
    if (enabled) {
      row.onclick = () => jumpToArrival(liveGame(), params);
    } else {
      row.disabled = true;
    }
    return row;
  }

  /** Lazily sample + render the best/average/worst (+ default route) rows for a node. */
  function selectNode(nodeId: string): void {
    picks.textContent = "";
    const head = document.createElement("div");
    head.textContent = `${nodeLabel(nodeId)} — sampling…`;
    style(head, { fontWeight: "bold", margin: "4px 0", color: "#9fe3b5" });
    picks.appendChild(head);

    // Defer the heavy sampling one frame so the "sampling…" state actually paints.
    setTimeout(() => {
      const overrides = controlOverrides();
      // (1) Percentile picks (best/average/worst) from the population sampler.
      const population = samplePopulation(THE_HOLLOW_MILL, nodeId);
      const reps = pickRepresentatives(population);
      head.textContent =
        `${nodeLabel(nodeId)} — ${reps.stats.survived}/${reps.stats.sampled} survived`;

      const order: Array<["best" | "average" | "worst", Sample | undefined]> = [
        ["best", reps.best],
        ["average", reps.average],
        ["worst", reps.worst],
      ];
      for (const [kind, sample] of order) {
        if (!sample) {
          // No survivors for this pick — grey it with the reason.
          const reason = reps.stats.survived === 0
            ? `no survivors (all ${reps.stats.sampled} wiped)`
            : "no representative";
          picks.appendChild(
            pickRow(kind, `${kind} · ${reason}`, { node: nodeId }, false),
          );
          continue;
        }
        const { run } = traverseRoute(THE_HOLLOW_MILL, sample.descriptor.route, {
          seedSalt: sample.descriptor.seedSalt,
        });
        const d = arrivalDigest(run);
        const label = `${kind} · ${digestLine(d)}\n    ${sample.descriptor.route.join(" → ")}`;
        const params: JumpParams = {
          node: nodeId,
          arrival: kind,
          into: overrides.into,
        };
        picks.appendChild(pickRow(kind, label, params, true));
      }

      // (2) Default-route row — the first enumerated simple path to the node.
      const defaultRoute = enumeratePaths(THE_HOLLOW_MILL.map, nodeId)[0];
      if (defaultRoute) {
        const { run } = traverseRoute(THE_HOLLOW_MILL, defaultRoute);
        const d = arrivalDigest(run);
        const label = `default route · ${digestLine(d)}\n    ${defaultRoute.join(" → ")}`;
        picks.appendChild(
          pickRow("default", label, { node: nodeId, route: defaultRoute, into: overrides.into }, true),
        );
      }

      // (3) Custom route/salt row (only when the power-user fields are filled).
      if (overrides.route || overrides.salt !== undefined) {
        const params: JumpParams = {
          node: nodeId,
          route: overrides.route,
          salt: overrides.salt,
          into: overrides.into,
        };
        const desc = [overrides.route ? overrides.route.join(" → ") : "(sampled)", overrides.salt !== undefined ? `salt ${overrides.salt}` : ""].filter(Boolean).join(" · ");
        picks.appendChild(pickRow("custom", `custom · ${desc}`, params, true));
      }
    }, 0);
  }

  // Build the node list (skip the start node).
  for (const nodeId of THE_HOLLOW_MILL.map.order) {
    if (nodeId === THE_HOLLOW_MILL.map.startId) continue;
    const row = document.createElement("button");
    row.id = nodeRowId(nodeId);
    row.textContent = nodeLabel(nodeId);
    style(row, {
      textAlign: "left",
      padding: "4px 8px",
      background: "#1b2030",
      color: "#e8eefc",
      border: "1px solid #3d4b6e",
      borderRadius: "4px",
      font: "inherit",
      cursor: "pointer",
    });
    row.onclick = () => selectNode(nodeId);
    nodes.appendChild(row);
  }
}
