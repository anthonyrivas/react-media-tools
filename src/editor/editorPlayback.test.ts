import { describe, expect, it } from "vitest";
import type { EditorClip } from "../types";
import {
  extraAudioAtPlayhead,
  playheadFromClipTime,
  sameSourceCutContinues,
} from "./editorPlayback";

function clip(id: string, inMs: number, outMs: number, sourceId = "src"): EditorClip {
  return { id, sourceId, inMs, outMs };
}

describe("editorPlayback", () => {
  it("keeps playing across a same-file split without seeking", () => {
    const left = clip("a", 0, 1000);
    const right = clip("b", 1000, 2000);
    expect(sameSourceCutContinues(left, right, "src", 1000)).toBe(true);
    expect(sameSourceCutContinues(left, right, "src", 400)).toBe(false);
    expect(sameSourceCutContinues(left, clip("c", 1000, 2000, "other"), "src", 1000)).toBe(false);
    expect(sameSourceCutContinues(undefined, right, "src", 1000)).toBe(false);
  });

  it("maps source time onto the magnetic playhead", () => {
    const clips = [clip("a", 200, 800), clip("b", 0, 500)];
    expect(playheadFromClipTime(clips, 0, 350)).toBe(150);
    expect(playheadFromClipTime(clips, 1, 100)).toBe(600 + 100);
    expect(playheadFromClipTime(clips, 0, 100)).toBeNull();
  });

  it("drives extra-track audio only while the playhead is in range", () => {
    const extra: EditorClip = {
      id: "a",
      sourceId: "src",
      inMs: 100,
      outMs: 600,
      kind: "audio",
      startMs: 800,
    };
    expect(extraAudioAtPlayhead(extra, 700)).toMatchObject({ inRange: false, gain: 0 });
    expect(extraAudioAtPlayhead(extra, 900)).toMatchObject({
      inRange: true,
      local: 100,
      targetSeconds: 0.2,
    });
    expect(extraAudioAtPlayhead(extra, 1300).inRange).toBe(false);
  });
});
