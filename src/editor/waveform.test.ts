import { describe, expect, it, vi } from "vitest";
import { extractPeaks, paintWaveform, type WaveformPeaks } from "./waveform";

function peaks(values: number[], durationMs = 1000): WaveformPeaks {
  return { durationMs, peaks: Float32Array.from(values) };
}

describe("waveform", () => {
  it("returns null when a blob has no decodable audio", async () => {
    await expect(extractPeaks(new Blob(["not a video"]))).resolves.toBeNull();
  });

  it("paints bars from the in/out window onto the canvas", () => {
    const fill = vi.fn();
    const clearRect = vi.fn();
    const createLinearGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 200 });
    Object.defineProperty(canvas, "clientHeight", { value: 40 });
    canvas.getContext = () =>
      ({
        clearRect,
        createLinearGradient,
        fill,
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        moveTo: vi.fn(),
        arcTo: vi.fn(),
        closePath: vi.fn(),
      }) as unknown as CanvasRenderingContext2D;

    paintWaveform(canvas, peaks(Array.from({ length: 80 }, () => 0.8)), 0, 1000);
    expect(clearRect).toHaveBeenCalled();
    expect(createLinearGradient).toHaveBeenCalled();
    expect(fill).toHaveBeenCalled();
  });

  it("skips near-silent bins", () => {
    const fill = vi.fn();
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 80 });
    Object.defineProperty(canvas, "clientHeight", { value: 40 });
    canvas.getContext = () =>
      ({
        clearRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        fill,
        beginPath: vi.fn(),
        roundRect: vi.fn(),
      }) as unknown as CanvasRenderingContext2D;

    paintWaveform(canvas, peaks(Array.from({ length: 40 }, () => 0.01)), 0, 1000);
    expect(fill).not.toHaveBeenCalled();
  });
});
