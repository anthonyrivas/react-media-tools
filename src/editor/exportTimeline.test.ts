import { describe, expect, it } from "vitest";
import { exportTimeline } from "./exportTimeline";

describe("exportTimeline", () => {
  it("refuses an empty timeline", async () => {
    await expect(exportTimeline({ clips: [], width: 640, height: 360 })).rejects.toThrow(
      /at least one clip/,
    );
  });

  it("refuses extra audio without a picture clip", async () => {
    await expect(
      exportTimeline({
        clips: [{ file: new Blob(), inMs: 0, outMs: 1000, kind: "audio", startMs: 0 }],
        width: 640,
        height: 360,
      }),
    ).rejects.toThrow(/at least one clip/);
  });
});
