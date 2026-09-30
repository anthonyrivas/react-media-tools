import { describe, expect, it, vi } from "vitest";
import {
  MAX_OVERLAY_WIDTH,
  MIN_OVERLAY_WIDTH,
  clampOverlay,
  defaultOverlay,
  overlayHeightFrac,
  overlayPixels,
  pathRoundedRect,
  pipCornerRadius,
} from "./overlay";

describe("overlay math", () => {
  it("keeps pip width inside 10–70% and on-canvas", () => {
    expect(clampOverlay({ x: -1, y: -1, width: 0.01 }, 1280, 720, 16 / 9).width).toBe(MIN_OVERLAY_WIDTH);
    expect(clampOverlay({ x: 2, y: 2, width: 0.9 }, 1280, 720, 16 / 9).width).toBe(MAX_OVERLAY_WIDTH);
    const clamped = clampOverlay({ x: 0.95, y: 0.95, width: 0.3 }, 1280, 720, 16 / 9);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(1);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
  });

  it("places the default pip in the bottom-right corner", () => {
    const overlay = defaultOverlay(1280, 720, 16 / 9);
    expect(overlay.width).toBeCloseTo(0.22);
    expect(overlay.x).toBeGreaterThan(0.5);
    expect(overlay.y).toBeGreaterThan(0.5);
  });

  it("converts fractional overlay to pixels using camera aspect", () => {
    const overlay = { x: 0.1, y: 0.2, width: 0.25 };
    const pixels = overlayPixels(overlay, 1000, 500, 2);
    expect(pixels).toEqual({ x: 100, y: 100, width: 250, height: 125 });
    expect(overlayHeightFrac(overlay, 1000, 500, 2)).toBeCloseTo(0.25);
    expect(pipCornerRadius(40, 40)).toBe(10);
    expect(pipCornerRadius(8, 8)).toBe(4);
  });

  it("draws a rounded rect path", () => {
    const ctx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
    };
    pathRoundedRect(ctx, 0, 0, 100, 50, 8);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.closePath).toHaveBeenCalled();
    expect(ctx.arcTo).toHaveBeenCalledTimes(4);
  });
});
