import Phaser from "phaser";

/** A held key that arms grab-and-drag panning — see {@link BoardCameraOptions.panModifier}. */
export type PanModifier = "shift" | "alt" | "ctrl";

/** The DOM event flag each modifier sets — the authoritative gate, read off the live pointer event. */
const MOD_FLAG: Record<PanModifier, "shiftKey" | "altKey" | "ctrlKey"> = {
  shift: "shiftKey",
  alt: "altKey",
  ctrl: "ctrlKey",
};
/** The Phaser key-event suffix for each modifier — drives the cursor-affordance listeners only. */
const MOD_KEY: Record<PanModifier, string> = { shift: "SHIFT", alt: "ALT", ctrl: "CTRL" };

/** Tuning + the tap callback for {@link BoardCamera}. */
export interface BoardCameraOptions {
  /**
   * Fired on a genuine **tap** — a press released with negligible movement — never
   * after a drag. This is where a scene does its click-picking (paint a tile, select
   * a unit): the camera swallows drags so a grab-and-move never also paints.
   */
  onTap?: (pointer: Phaser.Input.Pointer) => void;
  /** Zoom clamp (default 0.35–2). Below 1 shrinks the board to survey a big map. */
  minZoom?: number;
  maxZoom?: number;
  /** Pixels of travel before a press becomes a drag (and suppresses the tap). Default 6. */
  dragThreshold?: number;
  /** Wire scroll-wheel zoom-around-cursor (default true). */
  wheelZoom?: boolean;
  /**
   * Gate grab-and-drag panning behind a held modifier key. When set, a plain drag no
   * longer pans — it falls through to a {@link onTap} at release — and panning engages
   * only while this key is held. Lets a paint-heavy surface (the editor) keep the whole
   * board as its click target without a stray drag stealing the gesture as a pan; the
   * cursor shows {@link idleCursor} and flips to the grab hand only while the key is down.
   * Unset (default) → any drag pans, as before.
   */
  panModifier?: PanModifier;
  /**
   * The resting cursor when a press won't pan — i.e. always when {@link panModifier} is
   * set and its key isn't held. Default "grab" (the whole board is grabbable). The editor
   * passes "crosshair" since its primary gesture is painting a tile, not panning.
   */
  idleCursor?: string;
}

const DEFAULTS = { minZoom: 0.35, maxZoom: 2, dragThreshold: 6, wheelZoom: true, idleCursor: "grab" } as const;

/**
 * **Grab-and-drag panning + wheel zoom** for a board scene — the shared "the map is
 * bigger than the viewport" control. Large boards (a 20×20 editor level, a future
 * sprawling battle) overrun the fixed 800×600 canvas; this lets you drag the board
 * to reach any corner and scroll to zoom out and survey the whole thing.
 *
 * It pans the scene **camera's scroll** (and zooms the camera) rather than moving the
 * board's draw origin — so `pointer.worldX/worldY`, and therefore every tile pick
 * ({@link CombatView.worldToTile}), stay correct for free, with no per-frame board
 * redraw. It distinguishes a **click from a drag**, so a tap still paints/selects
 * while a drag only moves the camera ({@link BoardCameraOptions.onTap}).
 *
 * Reusable across surfaces: the editor drives its brush from `onTap`; the battle
 * board can adopt the same control so a player pans/zooms a large field. Caveat for
 * adopters: camera scroll/zoom moves **everything** the camera renders — a scene with
 * on-canvas HUD wants that HUD on a second (fixed) camera. The editor keeps its
 * chrome in the DOM panel, so its whole scene is board content and pans cleanly.
 */
export class BoardCamera {
  private readonly cfg: Required<Omit<BoardCameraOptions, "onTap" | "panModifier">> &
    Pick<BoardCameraOptions, "onTap" | "panModifier">;

  private pressed = false;
  private dragging = false;
  private downX = 0;
  private downY = 0;
  private scrollX0 = 0;
  private scrollY0 = 0;
  /** Live modifier-key state — drives the cursor affordance only; the pan gate reads the pointer event. */
  private modifierHeld = false;

  // Bound handlers, kept so {@link destroy} can detach them.
  private readonly hDown = (p: Phaser.Input.Pointer) => this.onDown(p);
  private readonly hMove = (p: Phaser.Input.Pointer) => this.onMove(p);
  private readonly hUp = (p: Phaser.Input.Pointer) => this.onUp(p);
  private readonly hUpOutside = () => this.cancel();
  private readonly hModDown = () => this.setModifier(true);
  private readonly hModUp = () => this.setModifier(false);
  private readonly hWheel = (
    p: Phaser.Input.Pointer,
    _over: Phaser.GameObjects.GameObject[],
    _dx: number,
    dy: number,
  ) => this.onWheel(p, dy);

  constructor(private readonly scene: Phaser.Scene, options: BoardCameraOptions = {}) {
    this.cfg = { ...DEFAULTS, ...options };
    const input = scene.input;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.hDown);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.hMove);
    input.on(Phaser.Input.Events.POINTER_UP, this.hUp);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.hUpOutside);
    if (this.cfg.wheelZoom) input.on(Phaser.Input.Events.POINTER_WHEEL, this.hWheel);
    // When panning is gated behind a modifier, track its key so the cursor can flip to the
    // grab hand while it's held (a plain hover then reads as "click to paint", not "grab").
    const mod = this.cfg.panModifier;
    if (mod && input.keyboard) {
      input.keyboard.on(`keydown-${MOD_KEY[mod]}`, this.hModDown);
      input.keyboard.on(`keyup-${MOD_KEY[mod]}`, this.hModUp);
    }
    input.setDefaultCursor(this.restCursor());
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());
  }

  /** Whether a drag right now would pan: no modifier is required, or its key is held (per the pointer event). */
  private panArmed(pointer?: Phaser.Input.Pointer): boolean {
    const mod = this.cfg.panModifier;
    if (!mod) return true;
    if (pointer) {
      const ev = pointer.event as (Event & { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean }) | undefined;
      return !!ev?.[MOD_FLAG[mod]];
    }
    return this.modifierHeld;
  }

  /** The resting cursor: the grab hand when panning is armed, else the configured idle cursor. */
  private restCursor(): string {
    return this.panArmed() ? "grab" : this.cfg.idleCursor;
  }

  /** Modifier keydown/keyup → keep the resting cursor honest (only when not mid-press). */
  private setModifier(held: boolean): void {
    this.modifierHeld = held;
    if (!this.pressed) this.scene.input.setDefaultCursor(this.restCursor());
  }

  /** Whether the current press has crossed the drag threshold (a scene can gate hover FX on this). */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** Reset the view to the authored default: zoom 1, scroll (0,0) — the board's centred framing. */
  recenter(): void {
    const cam = this.scene.cameras.main;
    cam.setZoom(1);
    cam.setScroll(0, 0);
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    this.pressed = true;
    this.dragging = false;
    this.downX = pointer.x;
    this.downY = pointer.y;
    const cam = this.scene.cameras.main;
    this.scrollX0 = cam.scrollX;
    this.scrollY0 = cam.scrollY;
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    if (!this.pressed) return;
    if (!this.dragging) {
      if (Math.hypot(pointer.x - this.downX, pointer.y - this.downY) < this.cfg.dragThreshold) return;
      // Threshold crossed. A drag only pans when panning is armed; without the modifier the
      // press stays a (moved) tap, so a paint-heavy surface can sweep freely without panning.
      if (!this.panArmed(pointer)) return;
      this.beginDrag(pointer);
    }
    // One screen pixel spans 1/zoom world units — so the grabbed point tracks the cursor.
    const cam = this.scene.cameras.main;
    cam.setScroll(this.scrollX0 - (pointer.x - this.downX) / cam.zoom, this.scrollY0 - (pointer.y - this.downY) / cam.zoom);
  }

  /** Enter the pan gesture, re-anchoring to *here* so it starts smoothly (no threshold jump, no mid-gesture lurch). */
  private beginDrag(pointer: Phaser.Input.Pointer): void {
    this.dragging = true;
    this.downX = pointer.x;
    this.downY = pointer.y;
    const cam = this.scene.cameras.main;
    this.scrollX0 = cam.scrollX;
    this.scrollY0 = cam.scrollY;
    this.scene.input.setDefaultCursor("grabbing");
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.scene.input.setDefaultCursor(this.restCursor());
    if (!this.dragging) this.cfg.onTap?.(pointer);
    this.dragging = false;
  }

  /** A press that ended off-canvas (or was interrupted): end the gesture, fire no tap. */
  private cancel(): void {
    this.pressed = false;
    this.dragging = false;
    this.scene.input.setDefaultCursor(this.restCursor());
  }

  private onWheel(pointer: Phaser.Input.Pointer, deltaY: number): void {
    const cam = this.scene.cameras.main;
    // Keep the world point under the cursor fixed while zooming (anchored zoom).
    const before = cam.getWorldPoint(pointer.x, pointer.y);
    const bx = before.x;
    const by = before.y;
    const factor = deltaY > 0 ? 0.9 : 1.1;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, this.cfg.minZoom, this.cfg.maxZoom));
    const after = cam.getWorldPoint(pointer.x, pointer.y);
    cam.setScroll(cam.scrollX + (bx - after.x), cam.scrollY + (by - after.y));
  }

  /** Detach every input listener + restore the cursor (idempotent). Called on scene teardown. */
  destroy(): void {
    const input = this.scene.input;
    if (!input) return;
    input.off(Phaser.Input.Events.POINTER_DOWN, this.hDown);
    input.off(Phaser.Input.Events.POINTER_MOVE, this.hMove);
    input.off(Phaser.Input.Events.POINTER_UP, this.hUp);
    input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.hUpOutside);
    input.off(Phaser.Input.Events.POINTER_WHEEL, this.hWheel);
    const mod = this.cfg.panModifier;
    if (mod && input.keyboard) {
      input.keyboard.off(`keydown-${MOD_KEY[mod]}`, this.hModDown);
      input.keyboard.off(`keyup-${MOD_KEY[mod]}`, this.hModUp);
    }
    input.setDefaultCursor("default");
  }
}
