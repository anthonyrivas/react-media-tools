import { describe, expect, it, vi } from "vitest";
import { MediaComposer } from "./MediaComposer";

function canvas(): HTMLCanvasElement {
  const node = document.createElement("canvas");
  return node;
}

describe("MediaComposer", () => {
  it("throws when a 2D context is unavailable", () => {
    const node = document.createElement("canvas");
    node.getContext = () => null;
    expect(() => new MediaComposer(node)).toThrow(/2D canvas context/);
  });

  it("clamps overlay updates and notifies subscribers", () => {
    const composer = new MediaComposer(canvas());
    const listener = vi.fn();
    const unsub = composer.subscribe(listener);
    composer.setOverlay({ x: -2, y: 4, width: 0.01 });
    expect(composer.overlay.width).toBe(0.1);
    expect(composer.overlay.x).toBe(0);
    expect(listener).toHaveBeenCalled();
    unsub();
    composer.destroy();
  });

  it("refuses to record when the browser cannot capture", async () => {
    const composer = new MediaComposer(canvas());
    await expect(composer.startRecording()).rejects.toThrow(/not supported/);
    composer.destroy();
  });
});
