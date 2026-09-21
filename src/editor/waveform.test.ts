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

  it("paints the preview stage with on-stage color when editor foreground is dark", () => {
    const stops: string[] = [];
    const canvas = document.createElement("canvas");
    canvas.className = "rmt-editor__wave-stage";
    canvas.style.setProperty("--rmt-fg", "#1a1d27");
    canvas.style.setProperty("--rmt-on-stage", "#f3f1eb");
    canvas.style.color = "#f3f1eb";
    Object.defineProperty(canvas, "clientWidth", { value: 200 });
    Object.defineProperty(canvas, "clientHeight", { value: 80 });
    canvas.getContext = () =>
      ({
        clearRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({
          addColorStop: (_stop: number, color: string) => {
            stops.push(color);
          },
        })),
        fill: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
      }) as unknown as CanvasRenderingContext2D;

    paintWaveform(canvas, peaks(Array.from({ length: 80 }, () => 0.8)), 0, 1000);
    expect(stops.some((color) => color.includes("243, 241, 235"))).toBe(true);
    expect(stops.some((color) => color.includes("26, 29, 39"))).toBe(false);
  });

  it("paints clip waveforms with editor foreground", () => {
    const stops: string[] = [];
    const clip = document.createElement("div");
    clip.className = "rmt-clip";
    clip.style.setProperty("--rmt-fg", "#1a1d27");
    clip.style.setProperty("--rmt-on-stage", "#f3f1eb");
    const canvas = document.createElement("canvas");
    clip.append(canvas);
    document.body.append(clip);
    Object.defineProperty(canvas, "clientWidth", { value: 200 });
    Object.defineProperty(canvas, "clientHeight", { value: 40 });
    canvas.getContext = () =>
      ({
        clearRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({
          addColorStop: (_stop: number, color: string) => {
            stops.push(color);
          },
        })),
        fill: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
      }) as unknown as CanvasRenderingContext2D;

    try {
      paintWaveform(canvas, peaks(Array.from({ length: 80 }, () => 0.8)), 0, 1000);
      expect(stops.some((color) => color.includes("26, 29, 39"))).toBe(true);
    } finally {
      clip.remove();
    }
  });
});
