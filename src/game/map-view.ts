/**
 * The **overworld map view** (D22/D24/D48/D80) — the seeded, branching node DAG and its
 * pinned **intel card**. It draws the layered graph, tints/glyphs each node by kind + event,
 * fogs nodes out of intel reach, rings combat nodes with a segmented intel meter, and — on
 * hover — pins a structured intel card for the last-inspected node (sticky across redraws).
 *
 * **Data in / intent out** (the {@link "./party-dossier-view".PartyDossierView} line): the run
 * comes in through the context accessors; the view never mutates it. Hovering a reachable node
 * **inspects** it (pins the card, internal); clicking one fires the `onChoose` intent so the host
 * advances the run (`enterCamp`). The read-only Route-map review passes `interactive: false`, which
 * previews-on-hover but blocks the commit click. The caravan **readout row** and the screen title
 * stay the host's (the readout tiles are the camp panel's data); the view calls back for the row so
 * it clears with the board.
 */

import Phaser from "phaser";
import { COLOR, FONT, INK } from "./theme";
import { clearLayer } from "./ui";
import { ICON, legendLine, placeIcon, type IconKey } from "./icons";
import {
  previewNode,
  scoutedTier,
  MAX_TIER,
  visibleNodes,
  eventForNode,
  influenceTier,
  type RunState,
  type MapNode,
  type NodeKind,
  type NodePreview,
  type EventKind,
} from "../core";

/**
 * The **node-kind presentation table** — one total record (word + header ink) per
 * {@link NodeKind}. Read by the intel card here and the host's reachable-target labels /
 * forecast summary. The last-layer "Final" override stays a caller concern (a layer fact,
 * not a kind).
 */
export const NODE_KIND_VISUALS: Record<NodeKind, { word: string; ink: string }> = {
  combat: { word: "Combat", ink: INK.danger },
  rest: { word: "Clearing", ink: INK.success },
  event: { word: "Event", ink: INK.gold },
};

/** The host wiring: run data in, and the two intents out (inspect on hover, choose on click). */
export interface MapViewContext {
  /** The live run to draw. */
  getRun: () => RunState;
  /** The currently reachable nodes (from the run loop). */
  reachable: () => MapNode[];
  /** Intent: the player committed to a reachable node (the host advances the run / makes camp). */
  onChoose: (node: MapNode) => void;
  /** The resting-hint sink. */
  setHint: (text: string) => void;
  /** Render the caravan-state readout row into the board layer (its tiles are the camp panel's data). */
  renderReadouts: (layer: Phaser.GameObjects.GameObject[]) => void;
}

export class MapView {
  private scene: Phaser.Scene;
  private ctx: MapViewContext;

  /** The board layer — nodes, edges, legend, fog, meters, and the readout row (all cleared together). */
  private board: Phaser.GameObjects.GameObject[] = [];
  /** The pinned intel card (its own layer, redrawn without touching the board). */
  private intelObjects: Phaser.GameObjects.GameObject[] = [];
  private graph?: Phaser.GameObjects.Graphics;
  private nodePos = new Map<string, { x: number; y: number }>();
  /** What the pinned card is showing (sticky until the player inspects another). */
  private inspectedNodeId?: string;

  constructor(scene: Phaser.Scene, ctx: MapViewContext) {
    this.scene = scene;
    this.ctx = ctx;
  }

  // --- Map drawing ----------------------------------------------------------

  draw(interactive = true): void {
    clearLayer(this.board);
    this.graph?.destroy();
    this.graph = undefined;
    this.nodePos.clear();
    const s = this.scene;
    const run = this.ctx.getRun();
    // The map has no action column to sit beside, so the caravan's figures ride a horizontal
    // **readout-tile row** across the top here — the same tile grammar the camp/survey beats
    // stack on the right, so the two surfaces speak one visual language (was an inline HUD line).
    this.ctx.renderReadouts(this.board);

    const map = run.map;
    const reachableIds = new Set(this.ctx.reachable().map((n) => n.id));
    const onPath = new Set(run.path);
    // Overworld fog (D48): only nodes within intel reach are drawn in full; the
    // rest are silhouettes. Immediate choices are always visible (never stuck).
    const visibleIds = new Set(visibleNodes(run).map((n) => n.id));

    // Layout: layers left→right, nodes spread vertically within each layer.
    const marginX = 80;
    const usableW = s.scale.width - 2 * marginX;
    const centerY = s.scale.height / 2 - 20;
    const byLayer = new Map<number, MapNode[]>();
    for (const id of map.order) {
      const node = map.nodes[id];
      byLayer.set(node.layer, [...(byLayer.get(node.layer) ?? []), node]);
    }
    for (const [layer, nodes] of byLayer) {
      const x = map.layers > 1 ? marginX + (layer * usableW) / (map.layers - 1) : s.scale.width / 2;
      const rowGap = 84;
      nodes.forEach((node, i) => {
        const y = centerY + (i - (nodes.length - 1) / 2) * rowGap;
        this.nodePos.set(node.id, { x, y });
      });
    }

    // Edges underneath the nodes — only between visible endpoints (fog, D48).
    this.graph = s.add.graphics().setDepth(0);
    for (const id of map.order) {
      const from = this.nodePos.get(id)!;
      for (const e of map.nodes[id].edges) {
        if (!visibleIds.has(id) || !visibleIds.has(e)) continue; // hide fogged edges
        const to = this.nodePos.get(e)!;
        const live = run.mapNodeId === id; // edges out of the current node
        this.graph.lineStyle(live ? 3 : 1.5, live ? COLOR.accent : COLOR.border, live ? 0.9 : 0.5);
        this.graph.lineBetween(from.x, from.y, to.x, to.y);
      }
    }

    // Nodes on top.
    for (const id of map.order) {
      const node = map.nodes[id];
      const pos = this.nodePos.get(id)!;
      const reachable = reachableIds.has(id);
      const current = run.mapNodeId === id;
      const visited = onPath.has(id) && !current;
      if (!visibleIds.has(id)) this.drawFogged(pos);
      else this.drawNode(node, pos, { reachable, current, visited }, interactive);
    }

    // A compact, always-on key in the corner — replaces the glyph dump that used to
    // crowd the hint bar (D58); the hint now carries action guidance only.
    this.drawMapLegend();
    this.ctx.setHint("Click a node to preview it; click again to camp there. Deeper nodes are fogged — raise intel to see farther.");
    // The pinned intel card, re-shown for the last-inspected node (sticky across map redraws).
    this.renderIntelCardSticky();
  }

  /**
   * A small, muted key pinned to the map's bottom-left (D58) — **generated from the
   * {@link ICON} registry** (D59), so it can never drift from the board, and rendered
   * in the UI font (the glyphs are verified safe there). Clears with the map.
   */
  private drawMapLegend(): void {
    const s = this.scene;
    const key = legendLine(["combat", "rest", "goal", "thief", "shop", "recruiter", "story", "toll", "fogged"]);
    const legend = s.add
      .text(20, s.scale.height - 30, key, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption })
      .setOrigin(0, 0.5)
      .setDepth(3);
    this.board.push(legend);
  }

  /**
   * Icon key + circle tint per event kind (M11) — a **total** map so a new event
   * kind can't silently inherit the thief glyph: adding one to {@link EventKind}
   * fails to compile until it has a visual here. (Colours stay render-side; the
   * core record carries no presentation.)
   */
  private static readonly EVENT_VISUALS: Record<EventKind, { key: IconKey; color: number }> = {
    thief: { key: "thief", color: COLOR.captive },
    shop: { key: "shop", color: COLOR.gold },
    recruiter: { key: "recruiter", color: COLOR.info },
    story: { key: "story", color: COLOR.captive },
    toll: { key: "toll", color: COLOR.gold },
    patron: { key: "patron", color: COLOR.gold },
    // Authored Hollow Mill event nodes (D52) — the pick-one camp + the Merchant town.
    provision: { key: "shop", color: COLOR.gold },
    town: { key: "recruiter", color: COLOR.gold },
  };

  /** Icon key + circle tint for an event node, keyed by which event it runs (M11). */
  private eventVisual(node: MapNode): { key: IconKey; color: number } {
    const run = this.ctx.getRun();
    return MapView.EVENT_VISUALS[eventForNode(run.seed, node, influenceTier(run.overworld.influence)).kind];
  }

  /** A fogged node (D48): a dim silhouette with no contents — out of intel reach. */
  private drawFogged(pos: { x: number; y: number }): void {
    const s = this.scene;
    const circle = s.add.circle(pos.x, pos.y, 13, COLOR.tileDark, 0.5).setDepth(1);
    circle.setStrokeStyle(1, COLOR.border, 0.4);
    // ◌ (not "?", which now means a story event) — disambiguated via the registry.
    const label = placeIcon(s, pos.x, pos.y, "fogged", { color: INK.disabled }).setDepth(2);
    this.board.push(circle, label);
  }

  private drawNode(node: MapNode, pos: { x: number; y: number }, state: { reachable: boolean; current: boolean; visited: boolean }, interactive = true): void {
    const s = this.scene;
    const run = this.ctx.getRun();
    const isFinal = node.layer === run.map.layers - 1;
    const event = node.kind === "event" ? this.eventVisual(node) : undefined;
    const baseColor =
      node.kind === "rest" ? COLOR.success : event ? event.color : isFinal ? COLOR.gold : COLOR.danger;
    const radius = isFinal ? 20 : 15;

    let alpha = 0.32;
    if (state.current) alpha = 1;
    else if (state.reachable) alpha = 1;
    else if (state.visited) alpha = 0.6;

    const circle = s.add.circle(pos.x, pos.y, radius, baseColor, alpha).setDepth(1);
    if (state.current) circle.setStrokeStyle(3, COLOR.white, 1);
    else if (state.reachable) circle.setStrokeStyle(3, COLOR.accent, 1);
    else circle.setStrokeStyle(1, COLOR.tileDark, 0.8);
    this.board.push(circle);

    // Kind glyph, from the registry (event nodes carry a per-event icon, M11). Routed
    // through placeIcon so a future atlas swaps in without touching this call (D59).
    const iconKey: IconKey = node.kind === "rest" ? "rest" : event ? event.key : isFinal ? "goal" : "combat";
    const label = placeIcon(s, pos.x, pos.y, iconKey, { color: INK.onLight, size: isFinal ? FONT.heading : FONT.body }).setDepth(2);
    this.board.push(label);

    if (state.visited) {
      const tick = s.add.text(pos.x + radius - 2, pos.y - radius + 2, ICON.check.glyph, { color: INK.success, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0.5).setDepth(2);
      this.board.push(tick);
    }

    // Intel meter (D80): a segmented ring around a combat node — one arc per intel tier, filled as
    // your knowledge of it deepens (party Intelligence floor + Survey scouting). A glance shows which
    // nodes are still mysteries and which you've learned all they'll tell you (a full ring = "done").
    if (node.kind === "combat" && !state.visited) {
      // Depth-capped (D86): the ring shows the node's *own* depth in arcs, filled to the
      // read — a shallow node reads as "less to learn" and fills sooner.
      const p = previewNode(run, node.id, scoutedTier(run.overworld, node.id));
      this.drawIntelMeter(pos, radius + 6, p.intel?.tier ?? 0, p.intelDepth ?? MAX_TIER);
    }

    if (state.reachable) {
      // Hover always previews; the commit click is gated so the read-only Route-map
      // review can show the same board without letting you re-choose a node (D58).
      circle.setInteractive({ useHandCursor: interactive });
      circle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.inspect(node));
      if (interactive) circle.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.ctx.onChoose(node));
    }
  }

  /**
   * The **intel meter** (D80/D86) — a segmented ring around a node, **one arc per tier of
   * the node's own intel depth**, filled (bright) up to the current read and dim beyond. A
   * full ring means you've learned everything this node will tell; a shallow node draws
   * fewer arcs, so it reads as "less to learn" and completes sooner. Cream fill reads as
   * "knowledge marks", distinct from the warm state ring.
   */
  private drawIntelMeter(pos: { x: number; y: number }, r: number, tier: number, depth = MAX_TIER): void {
    const g = this.scene.add.graphics().setDepth(2);
    const segs = Math.max(1, depth);
    const gap = Phaser.Math.DegToRad(26);
    const seg = (Math.PI * 2) / segs - gap;
    let a = -Math.PI / 2 + gap / 2; // start near the top, clockwise
    for (let i = 0; i < segs; i++) {
      const filled = tier >= i + 1;
      // A visible dim **track** under every segment, then the bright cream fill up to the tier — so
      // an empty ring still reads as "3 to learn" and the fill stands out on it.
      g.lineStyle(3, filled ? COLOR.net : COLOR.borderSoft, filled ? 1 : 0.7);
      g.beginPath();
      g.arc(pos.x, pos.y, r, a, a + seg, false);
      g.strokePath();
      a += seg + gap;
    }
    this.board.push(g);
  }

  // --- Selection / preview (D24) --------------------------------------------

  /** Inspect a node — pin its intel card (sticky until the player inspects another). */
  inspect(node: MapNode): void {
    this.inspectedNodeId = node.id;
    this.renderIntelCard(node);
  }

  /** The pinned intel card, re-shown for the last-inspected node (or a prompt) on each map draw. */
  private renderIntelCardSticky(): void {
    const run = this.ctx.getRun();
    const id = this.inspectedNodeId;
    const node = id ? run.map.nodes[id] : undefined;
    if (node && visibleNodes(run).some((n) => n.id === id)) this.renderIntelCard(node);
    else this.renderIntelCardPrompt();
  }

  /** Geometry for the pinned card, above the legend. */
  private intelCardGeom() {
    const w = 680;
    return { w, cx: this.scene.scale.width / 2, top: this.scene.scale.height - 150, left: this.scene.scale.width / 2 - w / 2 + 18 };
  }

  private renderIntelCardPrompt(): void {
    const s = this.scene;
    clearLayer(this.intelObjects);
    const { w, cx, top } = this.intelCardGeom();
    const h = 72;
    this.intelObjects.push(
      s.add.rectangle(cx, top + h / 2, w, h, COLOR.surface, 0.97).setStrokeStyle(1, COLOR.borderSoft).setDepth(9),
      s.add.text(cx, top + h / 2, "Hover a node to inspect it — its kind, intel, and what waits on the road.", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0.5).setDepth(10),
    );
  }

  /** A player-facing kind word + its ink for the intel card header. */
  private nodeKindWord(node: MapNode): string {
    if (node.layer === this.ctx.getRun().map.layers - 1) return "Final";
    return NODE_KIND_VISUALS[node.kind].word;
  }
  private nodeKindInk(node: MapNode): string {
    if (node.layer === this.ctx.getRun().map.layers - 1) return INK.gold;
    return NODE_KIND_VISUALS[node.kind].ink;
  }

  /**
   * The intel fields (label · value · ink) for a node's preview — gated by what the player knows.
   * A field intel *would* reveal but hasn't yet reads **`???`** (dim), so the reveal loop is legible:
   * scout the node (Survey) or raise Intelligence and the `???` fills in.
   */
  private intelFields(p: NodePreview): { label: string; value: string; ink: string }[] {
    const HIDDEN = "???";
    const hide = (v: string | undefined, ink: string) => (v ? { value: v, ink } : { value: HIDDEN, ink: INK.disabled });
    if (p.kind === "rest") return [{ label: "Recovery", ...hide(p.restHint, INK.success) }];
    if (p.kind === "event") return [{ label: "Event", ...hide(p.eventHint, INK.gold) }];
    const enemies = p.intel?.types ? p.intel.types.join(", ") + (p.intel.count !== undefined ? ` ×${p.intel.count}` : "") : undefined;
    const fields = [
      { label: "Enemies", ...hide(enemies, INK.secondary) },
      { label: "Hazards", ...this.hazardField(p) },
      { label: "Reward", ...hide(p.rewardHint, INK.gold) },
    ];
    // An authored node has no procedural *shape* to ever reveal (D85), so the Type
    // lane would read a permanent `???` — omit it rather than dangle phantom intel.
    if (!p.authored) fields.unshift({ label: "Type", ...hide(p.encounterType, INK.secondary) });
    return fields;
  }

  /**
   * The trap-lane read (D83) as a card value: `???` below the presence tier (shown on
   * EVERY combat node, so the row's presence never leaks what tier 0 hides), then
   * presence → count → the careless marks.
   */
  private hazardField(p: NodePreview): { value: string; ink: string } {
    const t = p.intel?.traps;
    if (!t) return { value: "???", ink: INK.disabled };
    if (!t.present) return { value: "none sensed", ink: INK.muted };
    if (t.count === undefined) return { value: "the ground is worked", ink: INK.danger };
    const marks = t.marked === undefined ? "" : t.marked > 0 ? ` · ${t.marked} marked` : " · none marked";
    return { value: `${t.count} snare${t.count === 1 ? "" : "s"}${marks}`, ink: INK.danger };
  }

  /**
   * The pinned **intel card** for a node (D80 map pass) — a structured readout in the card language:
   * a kind + depth header (in the kind's colour), a row of label · value intel fields (gated by what
   * you know — "unknown" reads dim), a "scouted" tag, and an "on the road" line when surveyed.
   * Replaces the old run-on preview text; held sticky until the player inspects another node.
   */
  private renderIntelCard(node: MapNode): void {
    const s = this.scene;
    const run = this.ctx.getRun();
    clearLayer(this.intelObjects);
    const p = previewNode(run, node.id, scoutedTier(run.overworld, node.id));
    const { w, cx, top, left } = this.intelCardGeom();

    // Header: kind + depth, in the kind's colour.
    this.intelObjects.push(s.add.text(left, top + 18, `${this.nodeKindWord(node)}  ·  Layer ${node.layer}`, { color: this.nodeKindInk(node), fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(10));
    // A "scouted" tag on the right when Survey sharpened this node (D80).
    if (scoutedTier(run.overworld, node.id) > 0) {
      this.intelObjects.push(s.add.text(cx + w / 2 - 18, top + 18, `${ICON.scouted.glyph} scouted`, { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(1, 0.5).setDepth(10));
    }

    // Intel fields, laid left→right: a muted label + a coloured value ("unknown" reads dim).
    let fx = left;
    const fieldY = top + 44;
    for (const f of this.intelFields(p)) {
      const lbl = s.add.text(fx, fieldY, f.label.toUpperCase(), { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(10);
      const val = s.add.text(fx + Math.ceil(lbl.width) + 6, fieldY, f.value, { color: f.ink, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(10);
      this.intelObjects.push(lbl, val);
      fx += Math.ceil(lbl.width) + 6 + Math.ceil(val.width) + 22;
    }

    // Variable-height rows stack below the fields; the surface is sized after.
    let y = top + 58;

    // The early event on the road in, revealed by Survey (D80, effect B).
    if (p.earlyEventHint) {
      const lbl = s.add.text(left, y + 3, "ON THE ROAD", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0).setDepth(10);
      const txt = s.add.text(left + Math.ceil(lbl.width) + 6, y, p.earlyEventHint, { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.label, wordWrap: { width: w - Math.ceil(lbl.width) - 44 } }).setOrigin(0, 0).setDepth(10);
      this.intelObjects.push(lbl, txt);
      y += Math.max(txt.height, lbl.height) + 6;
    }

    // The info box (D83): the node's rumor lines — free-form intel mirroring the
    // structured lanes. `rumors[i]` unlocks at tier i+1; locked lines read ???.
    if (p.intel?.notesTotal) {
      const lbl = s.add.text(left, y + 3, "RUMORS", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0).setDepth(10);
      this.intelObjects.push(lbl);
      const rx = left + Math.ceil(lbl.width) + 6;
      for (let i = 0; i < p.intel.notesTotal; i++) {
        const line = p.intel.notes?.[i];
        const txt = s.add.text(rx, y, line ?? "???", { color: line ? INK.secondary : INK.disabled, fontFamily: FONT.family, fontSize: FONT.label, wordWrap: { width: w - (rx - left) - 24 } }).setOrigin(0, 0).setDepth(10);
        this.intelObjects.push(txt);
        y += txt.height + 4;
      }
      y += 2;
    }

    // The terminal (D85): once the node is read to the deepest tier, a "nothing more to
    // find" line tells the player to stop spending scout resources — the ??? placeholders
    // are all resolved, and the intel meter ring reads full.
    if (p.intelComplete) {
      const done = s.add.text(left, y, "✓ No new intel to find", { color: INK.success, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0).setDepth(10);
      this.intelObjects.push(done);
      y += done.height + 4;
    }

    // The surface, sized to the stacked content (min height keeps short cards tidy).
    const h = Math.max(72, y - top + 10);
    // A tall card (road line + rumors) must never run off the canvas: lift the whole
    // stack so the bottom edge stays on-screen — the card grows UPWARD past its dock.
    const lift = Math.max(0, top + h - (s.scale.height - 12));
    if (lift > 0) for (const o of this.intelObjects) (o as unknown as { y: number }).y -= lift;
    this.intelObjects.push(s.add.rectangle(cx, top - lift + h / 2, w, h, COLOR.surface, 0.97).setStrokeStyle(1, COLOR.borderSoft).setDepth(9));
  }

  /** Tear down the whole map (board + graph + pinned intel card). The inspected node id
   *  persists so the sticky card returns for the same node when the map is next drawn. */
  clear(): void {
    clearLayer(this.board);
    this.graph?.destroy();
    this.graph = undefined;
    clearLayer(this.intelObjects); // the pinned intel card is map-screen UI (its node id persists)
  }
}
