import { describe, expect, it } from "vitest";
import { exportTimeline } from "./exportTimeline";

describe("exportTimeline", () => {
  it("refuses an empty timeline", async () => {
    await expect(exportTimeline({ clips: [], width: 640, height: 360 })).rejects.toThrow(
      /at least one clip/,
    );
  });
});
