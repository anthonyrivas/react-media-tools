import { describe, expect, it, vi } from "vitest";
import { paintComposerFrame } from "./composerDraw";

function fakeCtx() {
  return {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
  };
}

describe("paintComposerFrame", () => {
  it("fills the stage, then draws screen with a camera pip", () => {
    const ctx = fakeCtx();
    const canvas = { width: 1000, height: 500 } as HTMLCanvasElement;
    const screen = { id: "screen" } as unknown as CanvasImageSource;
    const camera = { id: "camera" } as unknown as CanvasImageSource;
    paintComposerFrame(ctx as unknown as CanvasRenderingContext2D, canvas, {
      screen: true,
      screenSource: screen,
      cameraSource: camera,
      overlay: { x: 0.1, y: 0.2, width: 0.25 },
      cameraAspect: 2,
    });
    expect(ctx.fillStyle).toBe("#0c0d12");
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1000, 500);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, screen, 0, 0, 1000, 500);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.clip).toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, camera, 100, 100, 250, 125);
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("draws camera full-frame when there is no screen", () => {
    const ctx = fakeCtx();
    const canvas = { width: 640, height: 360 } as HTMLCanvasElement;
    const camera = { id: "camera" } as unknown as CanvasImageSource;
    paintComposerFrame(ctx as unknown as CanvasRenderingContext2D, canvas, {
      screen: false,
      screenSource: null,
      cameraSource: camera,
      overlay: { x: 0.74, y: 0.7, width: 0.22 },
      cameraAspect: 16 / 9,
    });
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledWith(camera, 0, 0, 640, 360);
    expect(ctx.clip).not.toHaveBeenCalled();
  });
});
