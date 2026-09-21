import { describe, expect, it } from "vitest";
import type { EditorClip } from "../types";
import {
  MAX_ZOOM,
  MIN_CLIP_MS,
  MIN_ZOOM,
  clamp,
  clampZoom,
  clipDuration,
  clipStartMs,
  cutTimes,
  locateClip,
  snapThresholdMs,
  snapValue,
  totalDuration,
} from "./timelineMath";

function clip(id: string, inMs: number, outMs: number, sourceId = "src"): EditorClip {
  return { id, sourceId, inMs, outMs };
}

describe("timelineMath", () => {
  it("clamps zoom to the supported range", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(4)).toBe(4);
  });

  it("treats clip duration as out minus in, never negative", () => {
    expect(clipDuration(clip("a", 200, 800))).toBe(600);
    expect(clipDuration(clip("a", 800, 200))).toBe(0);
  });

  it("sums clip durations on the timeline", () => {
    const clips = [clip("a", 0, 1000), clip("b", 200, 700)];
    expect(totalDuration(clips)).toBe(1500);
    expect(clipStartMs(clips, 0)).toBe(0);
    expect(clipStartMs(clips, 1)).toBe(1000);
    expect(cutTimes(clips)).toEqual([0, 1000, 1500]);
  });

  it("places a split point on the right-hand clip (half-open ranges)", () => {
    const clips = [clip("a", 0, 1000), clip("b", 0, 1000)];
    expect(locateClip(clips, 0)?.clip.id).toBe("a");
    expect(locateClip(clips, 999)?.clip.id).toBe("a");
    expect(locateClip(clips, 1000)?.clip.id).toBe("b");
    expect(locateClip(clips, 1500)?.clip.id).toBe("b");
    expect(locateClip(clips, 2000)?.clip.id).toBe("b");
    expect(locateClip([], 0)).toBeNull();
  });

  it("snaps to the nearest cut within the threshold", () => {
    expect(snapValue(108, [0, 100, 400], 20)).toBe(100);
    expect(snapValue(150, [0, 100, 400], 20)).toBe(150);
    expect(snapThresholdMs(1)).toBe(40);
    expect(snapThresholdMs(0.01)).toBe(220);
    expect(MIN_CLIP_MS).toBe(120);
    expect(clamp(5, 0, 3)).toBe(3);
  });
});
