import { describe, expect, it } from "vitest";
import type { EditorClip } from "../../types";
import { timelineClipView } from "./timelineClipView";
import type { DragSession } from "./timelineView";

function clip(id: string, extra: Partial<EditorClip> = {}): EditorClip {
  return { id, sourceId: "src", inMs: 0, outMs: 2000, ...extra };
}

function drag(partial: Partial<DragSession> & Pick<DragSession, "kind" | "id">): DragSession {
  return {
    index: 0,
    startX: 0,
    originIn: 0,
    originOut: 2000,
    originFadeIn: 0,
    originFadeOut: 0,
    originStart: 0,
    duration: 2000,
    width: 200,
    moved: true,
    snapPlayheadMs: 0,
    ...partial,
  };
}

describe("timelineClipView", () => {
  it("marks a muted video clip and hides its waveform when audio is detached", () => {
    const picture = clip("v", { muted: true });
    const view = timelineClipView({
      variant: "video",
      clip: picture,
      start: 0,
      source: { name: "Take", peaks: { durationMs: 2000, peaks: new Float32Array(4) }, hasAudio: true },
      selected: true,
      snapTarget: false,
      holdLayout: null,
      drag: null,
      pps: 0.1,
      allowFades: true,
      clips: [picture, { id: "a", sourceId: "src", inMs: 0, outMs: 2000, kind: "audio", linkedClipId: "v" }],
    });
    expect(view.className).toContain("rmt-clip--video");
    expect(view.className).toContain("is-selected");
    expect(view.className).not.toContain("is-muted");
    expect(view.showWave).toBe(false);
    expect(view.fadeUi).toBe(false);
    expect(view.ariaLabel).toContain("Take");
  });

  it("shows trim-away overlays while an in-handle drag is active", () => {
    const picture = clip("v", { inMs: 400, outMs: 2000 });
    const view = timelineClipView({
      variant: "video",
      clip: picture,
      start: 0,
      selected: false,
      snapTarget: true,
      holdLayout: null,
      drag: drag({ kind: "in", id: "v", originIn: 0, originOut: 2000 }),
      pps: 1,
      allowFades: false,
      clips: [picture],
    });
    expect(view.draggingTrim).toBe(true);
    expect(view.showInAway).toBe(true);
    expect(view.inAwayWidth).toBe(400);
    expect(view.className).toContain("is-trim-snap");
  });

  it("marks muted extra audio, drop targets, and out-trim overlays", () => {
    const extra = clip("a", { kind: "audio", muted: true, startMs: 200 });
    const view = timelineClipView({
      variant: "audio",
      clip: extra,
      start: 200,
      source: { name: "Mic", peaks: { durationMs: 2000, peaks: new Float32Array(4) } },
      selected: false,
      dropTarget: true,
      snapTarget: false,
      holdLayout: {
        pps: 1,
        total: 2000,
        innerWidth: 400,
        scrollLeft: 0,
        originLeft: 0,
        widths: { a: 180 },
        lefts: { a: 200 },
        starts: { a: 200 },
        durations: { a: 2000 },
      },
      drag: drag({ kind: "out", id: "a", originIn: 0, originOut: 2000 }),
      pps: 1,
      allowFades: true,
      clips: [extra],
    });
    expect(view.className).toContain("rmt-clip--audio");
    expect(view.className).toContain("is-muted");
    expect(view.className).toContain("is-drop-target");
    expect(view.showWave).toBe(true);
    expect(view.fadeUi).toBe(true);
    expect(view.showOutAway).toBe(true);
    expect(view.left).toBe(200);
    expect(view.width).toBe(180);
  });
});
