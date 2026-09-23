import { describe, expect, it } from "vitest";
import type { EditorClip } from "../types";
import {
  MAX_ZOOM,
  MIN_CLIP_MS,
  MIN_ZOOM,
  FIT_ZOOM,
  END_PAD_PX,
  TRACK_PAD_PX,
  clamp,
  clampZoom,
  clipDuration,
  clipStartMs,
  cutTimes,
  isPastPicture,
  locateClip,
  playheadX,
  snapThresholdMs,
  snapValue,
  timelineDuration,
  timelineInnerWidth,
  timelineMsAtX,
  timelinePps,
  totalDuration,
  audioClipsAt,
  clipHasPlayableAudio,
  duplicateClip,
  hasDetachedAudio,
  packAudioLanes,
  canSnapTrimToHovered,
  clampTrimIn,
  clampTrimOut,
  hoveredTrimSourceTimes,
  hoveredTrimUsesBothEdges,
  trimToTimelineMs,
} from "./timelineMath";

function clip(id: string, inMs: number, outMs: number, sourceId = "src"): EditorClip {
  return { id, sourceId, inMs, outMs };
}

describe("timelineMath", () => {
  it("clamps zoom to tenths between 0.5× and 24×", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(4)).toBe(4);
    expect(clampZoom(1.14)).toBe(1.1);
    expect(FIT_ZOOM).toBe(1);
  });

  it("leaves end pad at 1× so clips can trim longer", () => {
    const pps = timelinePps(800, 10_000, 1);
    const inner = timelineInnerWidth(800, 10_000, pps);
    expect(inner).toBeCloseTo(800, 5);
    expect(TRACK_PAD_PX * 2 + 10_000 * pps).toBeCloseTo(800 - END_PAD_PX, 5);
    expect(timelinePps(800, 10_000, 0.5)).toBeCloseTo(pps / 2, 8);
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
    expect(snapThresholdMs(1)).toBe(10);
    expect(snapThresholdMs(0.5)).toBe(20);
    expect(snapThresholdMs(2)).toBe(5);
    expect(MIN_CLIP_MS).toBe(120);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(timelineMsAtX(108, 0, 8, 1)).toBe(100);
    expect(timelineMsAtX(50, 0, 8, 0.5)).toBe(84);
    expect(timelineMsAtX(0, 0, 8, 1)).toBe(0);
  });

  it("keeps audio-track clips off the magnetic video duration", () => {
    const clips: EditorClip[] = [
      clip("v", 0, 1000),
      { id: "a", sourceId: "src", inMs: 0, outMs: 500, kind: "audio", startMs: 800 },
    ];
    expect(totalDuration(clips)).toBe(1000);
    expect(timelineDuration(clips)).toBe(1300);
    expect(isPastPicture(clips, 999)).toBe(false);
    expect(isPastPicture(clips, 1000)).toBe(true);
    expect(playheadX(1300, 0.5)).toBe(650);
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

  it("keeps extra-audio row order by insertion, not duration", () => {
    const short: EditorClip = { id: "short", sourceId: "src", inMs: 0, outMs: 400, kind: "audio", startMs: 0 };
    const long: EditorClip = { id: "long", sourceId: "src", inMs: 0, outMs: 4000, kind: "audio", startMs: 0 };
    const packed = packAudioLanes([clip("v", 0, 4000), short, long]);
    expect(packed.rowById.get("short")).toBe(0);
    expect(packed.rowById.get("long")).toBe(1);
  });

  it("keeps extra-audio rows after a trim opens space on an earlier lane", () => {
    const lead: EditorClip = { id: "lead", sourceId: "src", inMs: 0, outMs: 4000, kind: "audio", startMs: 0 };
    const vo: EditorClip = { id: "vo", sourceId: "src", inMs: 0, outMs: 1000, kind: "audio", startMs: 500 };
    const first = packAudioLanes([clip("v", 0, 4000), lead, vo]);
    expect(first.rowById.get("lead")).toBe(0);
    expect(first.rowById.get("vo")).toBe(1);

    const trimmed: EditorClip = { ...lead, outMs: 200 };
    const next = packAudioLanes([clip("v", 0, 4000), trimmed, vo], first.rowById);
    expect(next.rowById.get("lead")).toBe(0);
    expect(next.rowById.get("vo")).toBe(1);
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

  it("snaps a trim handle to a hovered clip's matching edge", () => {
    expect(
      hoveredTrimSourceTimes({
        edge: "out",
        originIn: 0,
        clipStartMs: 0,
        hoveredStartMs: 200,
        hoveredEndMs: 2500,
      }),
    ).toEqual([2500]);

    expect(
      hoveredTrimSourceTimes({
        edge: "in",
        originIn: 0,
        clipStartMs: 0,
        hoveredStartMs: 800,
        hoveredEndMs: 2500,
      }),
    ).toEqual([800]);
  });

  it("lets side-by-side extra audio snap to the shared edge instead of jumping to the far end", () => {
    const audio: EditorClip = { id: "a", sourceId: "src", inMs: 0, outMs: 1000, kind: "audio", startMs: 0 };
    const neighbor: EditorClip = { id: "b", sourceId: "src", inMs: 0, outMs: 1000, kind: "audio", startMs: 1000 };
    expect(hoveredTrimUsesBothEdges(audio, neighbor)).toBe(true);
    expect(hoveredTrimUsesBothEdges(audio, clip("v", 0, 1000))).toBe(false);

    const targets = hoveredTrimSourceTimes({
      edge: "out",
      originIn: 0,
      clipStartMs: 0,
      hoveredStartMs: 1000,
      hoveredEndMs: 2000,
      bothEdges: true,
    });
    expect(targets).toEqual([1000, 2000]);
    expect(snapValue(1000, targets, 80)).toBe(1000);
    expect(snapValue(1950, targets, 80)).toBe(2000);
    expect(snapValue(1000, [2000], 80)).toBe(1000);
  });

  it("clamps hovered trim snaps to min length and source bounds", () => {
    expect(clampTrimOut(4000, 0, 800)).toBe(800);
    expect(clampTrimOut(50, 0, 4000)).toBe(MIN_CLIP_MS);
    expect(clampTrimIn(-400, 1000)).toBe(0);
    expect(clampTrimIn(980, 1000)).toBe(1000 - MIN_CLIP_MS);
  });

  it("snaps to the hovered handle's edge even when the drag is far from it", () => {
    expect(
      trimToTimelineMs({
        edge: "out",
        originIn: 0,
        originOut: 5000,
        clipStartMs: 0,
        sourceDurationMs: 8000,
        timelineMs: 2000,
      }),
    ).toEqual({ inMs: 0, outMs: 2000 });

    expect(
      trimToTimelineMs({
        edge: "in",
        originIn: 0,
        originOut: 3000,
        clipStartMs: 0,
        sourceDurationMs: 8000,
        timelineMs: 800,
      }),
    ).toEqual({ inMs: 800, outMs: 3000 });

    expect(
      trimToTimelineMs({
        edge: "out",
        originIn: 0,
        originOut: 500,
        clipStartMs: 0,
        sourceDurationMs: 800,
        timelineMs: 4000,
      }),
    ).toEqual({ inMs: 0, outMs: 800 });
  });

  it("only snap-trims extra audio and cross-track pairs", () => {
    const videoA = clip("v1", 0, 1000);
    const videoB = clip("v2", 0, 1000);
    const audio: EditorClip = { id: "a", sourceId: "src", inMs: 0, outMs: 500, kind: "audio", startMs: 200 };
    const otherAudio: EditorClip = { id: "b", sourceId: "src", inMs: 0, outMs: 500, kind: "audio", startMs: 800 };
    expect(canSnapTrimToHovered(videoA, videoB, true)).toBe(false);
    expect(canSnapTrimToHovered(videoA, audio, true)).toBe(true);
    expect(canSnapTrimToHovered(audio, videoA, true)).toBe(true);
    expect(canSnapTrimToHovered(audio, otherAudio, true)).toBe(true);
    expect(canSnapTrimToHovered(audio, otherAudio, false)).toBe(false);
    expect(canSnapTrimToHovered(audio, audio, true)).toBe(false);
  });
});
