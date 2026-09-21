import { describe, expect, it } from "vitest";
import { AudioCapture, waveformBarIndex, waveformColumnCount } from "./AudioCapture";

function canvas(): HTMLCanvasElement {
  return document.createElement("canvas");
}

describe("AudioCapture", () => {
  it("throws when a 2D context is unavailable", () => {
    const node = document.createElement("canvas");
    node.getContext = () => null;
    expect(() => new AudioCapture(node)).toThrow(/2D canvas context/);
  });

  it("refuses to record when the browser cannot capture audio", async () => {
    const capture = new AudioCapture(canvas());
    await expect(capture.startRecording()).rejects.toThrow(/not (available|supported)/i);
    capture.destroy();
  });

  it("keeps one waveform bar per column on a wide stage", () => {
    const wide = waveformColumnCount(2000, 2);
    expect(wide.columns).toBeGreaterThan(160);
    expect(wide.columns * (wide.step + wide.gap)).toBeLessThanOrEqual(2000);
  });

  it("maps the newest sample to the rightmost visible bar", () => {
    const length = 400;
    const visible = 400;
    const historyIndex = 200;
    expect(waveformBarIndex(historyIndex, visible, visible - 1, length)).toBe(historyIndex - 1);
    expect(waveformBarIndex(historyIndex, visible, 0, length)).toBe((historyIndex - visible + length) % length);
  });
});
