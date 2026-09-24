import { describe, expect, it } from "vitest";
import type { EditorClip } from "../types";
import {
  type DragSession,
  draggingHandleLeft,
  fadeFromDelta,
  formatLength,
  formatZoom,
  heldClipBox,
  nextTrimFromPointer,
  playheadFromPointer,
  rulerTicks,
  tickStep,
} from "./timelineView";

function clip(id: string, inMs: number, outMs: number, sourceId = "src"): EditorClip {
  return { id, sourceId, inMs, outMs };
}

function session(partial: Partial<DragSession> & Pick<DragSession, "kind">): DragSession {
  return {
    id: "a",
    index: 0,
    startX: 0,
    originIn: 0,
    originOut: 1000,
    originFadeIn: 0,
    originFadeOut: 80,
    originStart: 0,
    duration: 1000,
    width: 1000,
    moved: true,
    snapPlayheadMs: 0,
    ...partial,
  };
}

describe("timelineView", () => {
  it("formats clip length and zoom labels", () => {
    expect(formatLength(1500)).toBe("1.50s");
    expect(formatLength(61_000)).toBe("01:01.00");
    expect(formatZoom(1)).toBe("1.0×");
    expect(formatZoom(12)).toBe("12×");
  });

  it("picks ruler ticks that stay readable", () => {
    expect(tickStep(1)).toBe(100);
    expect(rulerTicks(1000, 1).map((tick) => tick.ms)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(rulerTicks(0, 1)).toEqual([]);
  });

  it("keeps frozen clip boxes while a trim is held", () => {
    expect(heldClipBox({ lefts: { a: 40 }, widths: { a: 80 } } as never, "a", 0, 1000, 0.5)).toEqual({
      left: 40,
      width: 80,
    });
    expect(heldClipBox(null, "a", 200, 400, 0.5)).toEqual({ left: 100, width: 200 });
  });

  it("moves only the dragged trim handle", () => {
    const drag = {
      kind: "out" as const,
      id: "a",
      originIn: 0,
    };
    expect(draggingHandleLeft(drag as never, clip("a", 0, 800), "out", 1)).toBe(800 - 24);
    expect(draggingHandleLeft(drag as never, clip("b", 0, 800), "out", 1)).toBeNull();
  });

  it("maps pointer x onto the full timeline duration", () => {
    const clips = [clip("v", 0, 1000), { id: "a", sourceId: "src", inMs: 0, outMs: 500, kind: "audio" as const, startMs: 800 }];
    expect(playheadFromPointer(108, clips, 1, null, false)).toBe(100);
    expect(playheadFromPointer(0, clips, 0, null)).toBe(0);
  });

  it("grows fade in and shrinks fade out from pointer delta", () => {
    expect(fadeFromDelta(session({ kind: "fadeIn", originFadeIn: 40, duration: 1000 }), 80)).toMatchObject({
      fadeInMs: 120,
      fadeOutMs: 80,
      edge: "in",
      ms: 120,
    });
    expect(fadeFromDelta(session({ kind: "fadeOut", originFadeOut: 200, duration: 1000 }), 50)).toMatchObject({
      fadeInMs: 0,
      fadeOutMs: 150,
      edge: "out",
      ms: 150,
    });
  });

  it("snaps an in-trim to the previous same-source cut", () => {
    const a = clip("a", 0, 400);
    const b = clip("b", 400, 1400);
    const result = nextTrimFromPointer({
      session: session({ kind: "in", id: "b", index: 1, originIn: 400, originOut: 1400, originStart: 400 }),
      clip: b,
      clips: [a, b],
      sourceDurationMs: 2000,
      cursorMs: 405,
      pps: 1,
      hold: null,
      hoveredHandle: null,
      hovered: null,
    });
    expect(result).toMatchObject({ inMs: 400, outMs: 1400, edge: "in" });
  });

  it("snaps an in-trim to a hovered extra-audio start", () => {
    const picture = clip("v", 0, 1000);
    const extra: EditorClip = { id: "a", sourceId: "src", inMs: 0, outMs: 500, kind: "audio", startMs: 800 };
    const result = nextTrimFromPointer({
      session: session({ kind: "in", id: "v", originOut: 1000, originStart: 0, snapPlayheadMs: 0 }),
      clip: picture,
      clips: [picture, extra],
      sourceDurationMs: 2000,
      cursorMs: 795,
      pps: 1,
      hold: null,
      hoveredHandle: null,
      hovered: extra,
    });
    expect(result).toMatchObject({ inMs: 800, outMs: 1000, edge: "in", snapId: "a" });
  });

  it("snaps an out-trim to a hovered handle edge", () => {
    const picture = clip("v", 0, 1000);
    const extra: EditorClip = { id: "a", sourceId: "src", inMs: 0, outMs: 500, kind: "audio", startMs: 800 };
    const result = nextTrimFromPointer({
      session: session({ kind: "out", id: "v", originOut: 1000, originStart: 0, snapPlayheadMs: 0 }),
      clip: picture,
      clips: [picture, extra],
      sourceDurationMs: 2000,
      cursorMs: 795,
      pps: 1,
      hold: null,
      hoveredHandle: { clip: extra, edge: "in" },
      hovered: extra,
    });
    expect(result).toMatchObject({ inMs: 0, outMs: 800, edge: "out", snapId: "a" });
  });
});
