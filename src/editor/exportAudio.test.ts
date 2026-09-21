import { describe, expect, it } from "vitest";
import { exportAudioTimeline, measureClipPeak } from "./exportAudio";

describe("exportAudioTimeline", () => {
  it("refuses an empty timeline", async () => {
    await expect(exportAudioTimeline({ clips: [] })).rejects.toThrow(/at least one clip/);
  });
});

describe("measureClipPeak", () => {
  it("returns 0 when the blob has no decodable audio", async () => {
    await expect(measureClipPeak(new Blob(["not audio"]), 0, 1000)).resolves.toBe(0);
  });
});
