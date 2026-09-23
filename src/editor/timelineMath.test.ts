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
  timelineDuration,
  totalDuration,
  audioClipsAt,
  clipHasPlayableAudio,
  duplicateClip,
  hasDetachedAudio,
  packAudioLanes,
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

  it("keeps audio-track clips off the magnetic video duration", () => {
    const clips: EditorClip[] = [
      clip("v", 0, 1000),
      { id: "a", sourceId: "src", inMs: 0, outMs: 500, kind: "audio", startMs: 800 },
    ];
    expect(totalDuration(clips)).toBe(1000);
    expect(timelineDuration(clips)).toBe(1300);
    expect(locateClip(clips, 900)?.clip.id).toBe("v");
    expect(audioClipsAt(clips, 900).map((item) => item.id)).toEqual(["a"]);
    expect(audioClipsAt(clips, 200)).toEqual([]);
  });

  it("treats unlinked picture audio as detached", () => {
    const clips: EditorClip[] = [
      clip("v", 0, 1000),
      { id: "a", sourceId: "src", inMs: 0, outMs: 1000, kind: "audio", startMs: 0, linkedClipId: "v" },
    ];
    expect(hasDetachedAudio(clips, "v")).toBe(true);
    expect(hasDetachedAudio(clips, "a")).toBe(false);
    expect(clipHasPlayableAudio(clips, clips[0]!)).toBe(false);
    expect(clipHasPlayableAudio(clips, clips[1]!)).toBe(true);
  });

  it("treats silent picture sources as having no mixer audio", () => {
    const picture = clip("v", 0, 1000);
    expect(clipHasPlayableAudio([picture], picture, false)).toBe(false);
    expect(clipHasPlayableAudio([picture], picture, true)).toBe(true);
  });

  it("stacks overlapping extra-audio clips onto extra rows", () => {
    const soundtrack: EditorClip = {
      id: "take",
      sourceId: "src",
      inMs: 0,
      outMs: 6000,
      kind: "audio",
      startMs: 0,
    };
    const vo1: EditorClip = {
      id: "vo1",
      sourceId: "src",
      inMs: 0,
      outMs: 1000,
      kind: "audio",
      startMs: 500,
    };
    const vo2: EditorClip = {
      id: "vo2",
      sourceId: "src",
      inMs: 0,
      outMs: 1000,
      kind: "audio",
      startMs: 1500,
    };
    const adjacent: EditorClip = {
      id: "tail",
      sourceId: "src",
      inMs: 0,
      outMs: 500,
      kind: "audio",
      startMs: 6000,
    };
    const packed = packAudioLanes([clip("v", 0, 6000), soundtrack, vo1, vo2, adjacent]);
    expect(packed.rowCount).toBe(2);
    expect(packed.rowById.get("take")).toBe(0);
    expect(packed.rowById.get("vo1")).toBe(1);
    expect(packed.rowById.get("vo2")).toBe(1);
    expect(packed.rowById.get("tail")).toBe(0);
  });

  it("duplicates a clip without the original unlink pairing", () => {
    const picture = clip("v", 100, 900);
    const copy = duplicateClip(picture, "v2");
    expect(copy).toMatchObject({ id: "v2", sourceId: "src", inMs: 100, outMs: 900 });
    expect(copy.linkedClipId).toBeUndefined();

    const audio: EditorClip = {
      id: "a",
      sourceId: "src",
      inMs: 0,
      outMs: 500,
      kind: "audio",
      startMs: 200,
      linkedClipId: "v",
    };
    expect(duplicateClip(audio, "a2")).toMatchObject({
      id: "a2",
      kind: "audio",
      startMs: 700,
      inMs: 0,
      outMs: 500,
    });
    expect(duplicateClip(audio, "a2").linkedClipId).toBeUndefined();
  });
});
