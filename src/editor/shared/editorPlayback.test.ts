import { describe, expect, it, vi } from "vitest";
import type { EditorClip } from "../../types";
import {
  applyExtraAudioElement,
  attachElementGraph,
  clearMediaElement,
  cueMediaClip,
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
    expect(extraAudioAtPlayhead({ ...extra, muted: true }, 900)).toMatchObject({ inRange: true, gain: 0 });
  });

  it("plays extra-track audio in range and pauses it when the playhead leaves", () => {
    const el = document.createElement("audio");
    let paused = true;
    Object.defineProperty(el, "paused", { configurable: true, get: () => paused });
    const play = vi.spyOn(el, "play").mockImplementation(async () => {
      paused = false;
    });
    const pause = vi.spyOn(el, "pause").mockImplementation(() => {
      paused = true;
    });
    const source = { id: "src", url: "blob:audio" };
    applyExtraAudioElement(el, extraAudioAtPlayhead(extraClip(), 900), source, undefined, true);
    expect(el.dataset.sourceId).toBe("src");
    expect(el.src).toContain("blob:audio");
    expect(play).toHaveBeenCalled();
    applyExtraAudioElement(el, extraAudioAtPlayhead(extraClip(), 200), source, undefined, true);
    expect(pause).toHaveBeenCalled();
    expect(el.volume).toBe(0);
  });

  it("routes extra-audio gain through a Web Audio node when one is attached", () => {
    const el = document.createElement("audio");
    const gainNode = { gain: { value: 0 } } as unknown as GainNode;
    applyExtraAudioElement(
      el,
      extraAudioAtPlayhead(extraClip(), 900),
      { id: "src", url: "blob:audio" },
      gainNode,
      false,
    );
    expect(gainNode.gain.value).toBe(1);
  });

  it("cues a media element, seeks, and plays", async () => {
    const media = document.createElement("video");
    vi.spyOn(media, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(media, "pause");
    const loaded = { current: null as string | null };
    const cue = cueMediaClip({
      media,
      sourceId: "src",
      url: "blob:take",
      targetSeconds: 0.4,
      autoplay: true,
      gen: 1,
      syncGen: () => 1,
      loadedSourceIdRef: loaded,
      connectGraph: vi.fn(),
    });
    await Promise.resolve();
    media.dispatchEvent(new Event("loadeddata"));
    media.dispatchEvent(new Event("seeked"));
    await cue;
    expect(loaded.current).toBe("src");
    expect(media.src).toContain("blob:take");

    await cueMediaClip({
      media,
      sourceId: "src",
      url: "blob:take",
      targetSeconds: 0.4,
      autoplay: false,
      gen: 2,
      syncGen: () => 2,
      loadedSourceIdRef: loaded,
      connectGraph: vi.fn(),
    });
    expect(pause).toHaveBeenCalled();
  });

  it("skips attaching a graph when Web Audio is unavailable, and clears a media element", () => {
    const media = document.createElement("audio");
    const pause = vi.spyOn(media, "pause");
    const load = vi.spyOn(media, "load");
    attachElementGraph(media, {
      audioCtxRef: { current: null },
      gainNodeRef: { current: null },
      mediaSourceRef: { current: null },
    });
    clearMediaElement(media);
    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(media.getAttribute("src")).toBeNull();
    clearMediaElement(null);
  });
});

function extraClip(): EditorClip {
  return {
    id: "a",
    sourceId: "src",
    inMs: 100,
    outMs: 600,
    kind: "audio",
    startMs: 800,
  };
}
