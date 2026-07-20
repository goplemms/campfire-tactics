import { describe, it, expect } from "vitest";
import { COLOR, cssHex, cssRgba } from "./theme";

// The DOM-overlay bridge (cssHex/cssRgba): the editor chrome + debug menus render real HTML controls
// and can't take a Phaser 0xRRGGBB, so they pull CSS strings straight from the numeric COLOR ladder.
// These lock the conversion so a refactor can't silently drift the editor's palette off the game's.
describe("theme CSS bridge", () => {
  it("cssHex zero-pads a 6-digit hex string", () => {
    expect(cssHex(COLOR.accent)).toBe("#f2b65a");
    expect(cssHex(COLOR.surfaceRaised)).toBe("#271e16");
    expect(cssHex(0x000000)).toBe("#000000"); // leading zeros kept (not "#0")
    expect(cssHex(0x0a0b0c)).toBe("#0a0b0c");
  });

  it("cssRgba splits the channels and appends the alpha", () => {
    expect(cssRgba(COLOR.accent, 0.22)).toBe("rgba(242, 182, 90, 0.22)");
    expect(cssRgba(0x000000, 1)).toBe("rgba(0, 0, 0, 1)");
    expect(cssRgba(0xffffff, 0)).toBe("rgba(255, 255, 255, 0)");
  });
});
