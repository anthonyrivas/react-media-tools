import { describe, expect, it } from "vitest";
import type { EditorClip } from "../types";
import {
  clipsForVideoExport,
  duplicateAfterSelected,
  extraAudioClip,
  playheadForTrim,
  removeSelectedClip,
  reorderMagneticClips,
  reorderVideoTrack,
  seekAfterRemove,
  splitClipsAtPlayhead,
  splitMagneticAtPlayhead,
  unlinkPictureAudio,
} from "./editorOps";

function picture(id: string, inMs: number, outMs: number): EditorClip {
  return { id, sourceId: "src", inMs, outMs };
}

describe("editorOps", () => {
  it("splits picture and extra audio at the playhead and relinks halves", () => {
    const clips: EditorClip[] = [
      picture("v", 0, 2000),
      {
        id: "a",
        sourceId: "src",
        inMs: 0,
        outMs: 2000,
        kind: "audio",
        startMs: 0,
        linkedClipId: "v",
      },
    ];
    let n = 0;
    const result = splitClipsAtPlayhead(clips, 800, "v", true, () => `n${++n}`);
    expect(result?.clips).toHaveLength(4);
    const audio = result?.clips.filter((clip) => clip.kind === "audio") ?? [];
    expect(audio[0]?.linkedClipId).toBe(result?.clips[0]?.id);
    expect(audio[1]?.linkedClipId).toBe(result?.clips[1]?.id);
    expect(result?.nextSelectedId).toBe(result?.clips[1]?.id);
    expect(result?.videoLeft?.id).toBe(result?.clips[0]?.id);
    expect(result?.videoRight?.id).toBe(result?.clips[1]?.id);
  });

  it("splits a magnetic clip and zeros fades on the cut", () => {
    const clips: EditorClip[] = [{ id: "a", sourceId: "src", inMs: 0, outMs: 2000, fadeInMs: 80, fadeOutMs: 80 }];
    let n = 0;
    const result = splitMagneticAtPlayhead(clips, 800, () => `n${++n}`);
    expect(result?.clips).toHaveLength(2);
    expect(result?.clips[0]).toMatchObject({ outMs: 800, fadeOutMs: 0, fadeInMs: 80 });
    expect(result?.clips[1]).toMatchObject({ inMs: 800, fadeInMs: 0, fadeOutMs: 80 });
    expect(result?.right.id).toBe("n2");
  });

  it("unlinks picture audio onto the extra track", () => {
    const clips = [picture("v", 0, 1000)];
    const result = unlinkPictureAudio(clips, "v", true, () => "a");
    expect(result?.picture.muted).toBeUndefined();
    expect(result?.clips[0]?.muted).toBe(true);
    expect(result?.clips[1]).toMatchObject({ kind: "audio", linkedClipId: "v", startMs: 0, id: "a" });
  });

  it("inserts a duplicate after the selected clip", () => {
    const clips = [picture("v", 0, 500), picture("w", 0, 500)];
    const result = duplicateAfterSelected(clips, "v", "v2");
    expect(result?.clips.map((clip) => clip.id)).toEqual(["v", "v2", "w"]);
    expect(result?.copy.sourceId).toBe("src");
  });

  it("removes the selected clip and keeps a neighbor", () => {
    const clips = [picture("v", 0, 500), picture("w", 0, 500)];
    const result = removeSelectedClip(clips, "v");
    expect(result?.clips.map((clip) => clip.id)).toEqual(["w"]);
    expect(result?.neighbor?.id).toBe("w");
  });

  it("reorders picture clips and leaves extra audio at the end", () => {
    const clips: EditorClip[] = [
      picture("v", 0, 500),
      picture("w", 0, 500),
      { id: "a", sourceId: "src", inMs: 0, outMs: 400, kind: "audio", startMs: 0 },
    ];
    expect(reorderVideoTrack(clips, 0, 2)?.map((clip) => clip.id)).toEqual(["w", "v", "a"]);
    expect(reorderVideoTrack(clips, 1, 1)).toBeNull();
  });

  it("places the playhead on the trimmed edge", () => {
    expect(playheadForTrim(1000, 500, "in")).toEqual({ playhead: 1000, local: 0 });
    expect(playheadForTrim(1000, 500, "out")).toEqual({ playhead: 1500, local: 460 });
  });

  it("reorders magnetic clips in place", () => {
    const clips = [picture("a", 0, 400), picture("b", 0, 400), picture("c", 0, 400)];
    expect(reorderMagneticClips(clips, 0, 2)?.map((clip) => clip.id)).toEqual(["b", "c", "a"]);
    expect(reorderMagneticClips(clips, 1, 1)).toBeNull();
  });

  it("seeks after delete only when the playhead left the neighbor", () => {
    const remaining = [picture("a", 0, 400), picture("c", 0, 400)];
    expect(seekAfterRemove(remaining, remaining[1] ?? null, 1, 0)).toBe(400);
    expect(seekAfterRemove([picture("w", 0, 500)], picture("w", 0, 500), 0, 0)).toBeNull();
    expect(seekAfterRemove([], remaining[0] ?? null, 0, 0)).toBeNull();
    expect(seekAfterRemove(remaining, null, 0, 800)).toBeNull();
  });

  it("mutes unlinked picture in the export payload and keeps extra audio placed", () => {
    const file = new Blob(["v"]);
    const clips: EditorClip[] = [
      { id: "v", sourceId: "src", inMs: 0, outMs: 1000, muted: true },
      extraAudioClip("src", 800, 200, "a"),
    ];
    clips[1] = { ...clips[1]!, linkedClipId: "v" };
    const payload = clipsForVideoExport(clips, { src: { file, width: 640, height: 360 } });
    expect(payload.width).toBe(640);
    expect(payload.height).toBe(360);
    expect(payload.clips[0]).toMatchObject({ muted: true, inMs: 0, outMs: 1000 });
    expect(payload.clips[1]).toMatchObject({ kind: "audio", startMs: 200, muted: false });
  });
});
