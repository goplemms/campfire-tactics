import Phaser from "phaser";
import { projectDossier, type RunState } from "../../core";
import { PartyDossierView, type DossierMode } from "../party-dossier-view";

/**
 * Handoff into the dossier. It reads the **live** run (the same object the
 * overworld holds, so its numbers are current) and remembers which scene to wake
 * on close.
 */
export interface DossierHandoff {
  run: RunState;
  /** "page" (default) covers + pauses the caller; "overlay" floats over a live scene. */
  mode?: DossierMode;
  /** Scene to resume when the dossier closes. Defaults to the overworld. */
  returnScene?: string;
}

/**
 * The party-dossier host (D-info-surfacing). A deliberately **thin** scene: it owns
 * no layout — it just mounts the bounds-driven {@link PartyDossierView} full-screen
 * and wires the close intent back to whoever launched it.
 *
 * **Page vs. overlay is one launch flag.** The caller `scene.launch`es this and, in
 * page mode, `scene.pause`s itself; on close we `stop` here and `resume` the caller.
 * The launch mechanism is identical for an overlay — only the backdrop (handled by
 * the view via `mode`) and whether the caller pauses differ — so the future
 * "camp hero walks over, dossier floats in" gimmick is additive, not a rewrite.
 */
export class PartyDossierScene extends Phaser.Scene {
  private handoff!: DossierHandoff;
  private view?: PartyDossierView;

  constructor() {
    super("PartyDossier");
  }

  init(data: DossierHandoff): void {
    this.handoff = data;
  }

  create(): void {
    const { width, height } = this.scale;
    const returnScene = this.handoff.returnScene ?? "OverworldScene";
    const close = () => {
      this.view?.destroy();
      this.scene.stop();
      this.scene.resume(returnScene);
    };
    this.view = new PartyDossierView(this, {
      bounds: new Phaser.Geom.Rectangle(0, 0, width, height),
      mode: this.handoff.mode ?? "page",
      data: projectDossier(this.handoff.run),
      onClose: close,
    });
    // Esc is the universal "back" for a full-screen panel.
    this.input.keyboard?.once("keydown-ESC", close);
  }
}
