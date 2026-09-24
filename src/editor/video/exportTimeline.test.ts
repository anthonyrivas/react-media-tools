import { describe, expect, it } from "vitest";
import { exportTimeline, exportTimelineLengthMs, pictureAndExtraClips } from "./exportTimeline";

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

  it("splits picture from extra audio and uses the longer of the two for export length", () => {
    const picture = { file: new Blob(), inMs: 0, outMs: 1000 };
    const extra = { file: new Blob(), inMs: 0, outMs: 500, kind: "audio" as const, startMs: 800 };
    expect(pictureAndExtraClips([picture, extra])).toEqual({ picture: [picture], extras: [extra] });
    expect(pictureAndExtraClips([{ ...picture, kind: "video" }]).extras).toEqual([]);
    expect(exportTimelineLengthMs([picture], [extra])).toBe(1300);
    expect(exportTimelineLengthMs([picture], [])).toBe(1000);
  });
});
