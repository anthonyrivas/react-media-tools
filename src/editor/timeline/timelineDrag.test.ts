import { describe, expect, it, vi } from "vitest";
import type { EditorClip } from "../../types";
import { applyTimelineDragMove, finishTimelineDrag, type TimelineDragEndCtx, type TimelineDragMoveCtx } from "./timelineDrag";
import type { DragSession } from "./timelineView";

function clip(id: string, extra: Partial<EditorClip> = {}): EditorClip {
  return { id, sourceId: "src", inMs: 0, outMs: 1000, ...extra };
}

function session(partial: Partial<DragSession> & Pick<DragSession, "kind">): DragSession {
  return {
    id: "a",
    index: 0,
    startX: 0,
    originIn: 0,
    originOut: 1000,
    originFadeIn: 40,
    originFadeOut: 80,
    originStart: 500,
    duration: 1000,
    width: 1000,
    moved: false,
    snapPlayheadMs: 0,
    ...partial,
  };
}

function pointer(clientX: number, clientY = 0): PointerEvent {
  return { clientX, clientY } as PointerEvent;
}

function moveCtx(partial: Partial<TimelineDragMoveCtx> = {}): TimelineDragMoveCtx {
  return {
    clips: [clip("a")],
    sources: { src: { durationMs: 5000 } },
    pps: 1,
    scroller: null,
    track: null,
    hold: null,
    showAudioTrack: false,
    dropIndexRef: { current: null },
    onScrub: vi.fn(),
    onMoveAudio: vi.fn(),
    onFade: vi.fn(),
    onTrim: vi.fn(),
    setDropIndex: vi.fn(),
    setFadeTip: vi.fn(),
    setTrimTip: vi.fn(),
    setSnapTrimId: vi.fn(),
    ...partial,
  };
}

function endCtx(partial: Partial<TimelineDragEndCtx> = {}): TimelineDragEndCtx {
  return {
    clips: [clip("a")],
    pps: 1,
    scroller: null,
    dropAt: null,
    skipFollow: { current: false },
    onReorder: vi.fn(),
    onTrimEnd: vi.fn(),
    onFadeEnd: vi.fn(),
    onMoveAudioEnd: vi.fn(),
    onSeek: vi.fn(),
    setHoldLayout: vi.fn(),
    setTrimTip: vi.fn(),
    setSnapTrimId: vi.fn(),
    setFadeTip: vi.fn(),
    ...partial,
  };
}

describe("applyTimelineDragMove", () => {
  it("scrubs playhead drags and marks the session moved past 2px", () => {
    const ctx = moveCtx();
    const drag = session({ kind: "playhead" });
    applyTimelineDragMove(drag, pointer(108), ctx);
    expect(drag.moved).toBe(true);
    expect(ctx.onScrub).toHaveBeenCalledWith(100);
  });

  it("updates the drop index while reordering picture clips", () => {
    const ctx = moveCtx({ clips: [clip("a"), clip("b")] });
    applyTimelineDragMove(session({ kind: "move" }), pointer(40), ctx);
    expect(ctx.dropIndexRef.current).toBe(2);
    expect(ctx.setDropIndex).toHaveBeenCalledWith(2);
  });

  it("slips extra audio from the origin start", () => {
    const ctx = moveCtx();
    applyTimelineDragMove(session({ kind: "audioMove" }), pointer(100), ctx);
    expect(ctx.onMoveAudio).toHaveBeenCalledWith("a", 600);
  });

  it("updates fade envelopes from pointer delta", () => {
    const ctx = moveCtx();
    applyTimelineDragMove(session({ kind: "fadeIn" }), pointer(80), ctx);
    expect(ctx.onFade).toHaveBeenCalledWith("a", 120, 80);
    expect(ctx.setFadeTip).toHaveBeenCalledWith(expect.objectContaining({ edge: "in", ms: 120, x: 80 }));
  });

  it("trims from the pointer when the source duration is known", () => {
    const ctx = moveCtx();
    applyTimelineDragMove(session({ kind: "out", id: "a", originOut: 1000, originStart: 0 }), pointer(800), ctx);
    expect(ctx.onTrim).toHaveBeenCalledWith("a", 0, expect.any(Number), "out");
    expect(ctx.setTrimTip).toHaveBeenCalled();
  });
});

describe("finishTimelineDrag", () => {
  it("reorders when a moved clip is dropped on a new index", () => {
    const ctx = endCtx({ dropAt: 3 });
    finishTimelineDrag(session({ kind: "move", moved: true, index: 0 }), pointer(0), ctx);
    expect(ctx.onReorder).toHaveBeenCalledWith(0, 2);
    expect(ctx.onSeek).not.toHaveBeenCalled();
  });

  it("clears trim chrome and skips playhead follow after a trim", () => {
    const ctx = endCtx();
    finishTimelineDrag(session({ kind: "out" }), pointer(0), ctx);
    expect(ctx.skipFollow.current).toBe(true);
    expect(ctx.setHoldLayout).toHaveBeenCalledWith(null);
    expect(ctx.setTrimTip).toHaveBeenCalledWith(null);
    expect(ctx.setSnapTrimId).toHaveBeenCalledWith(null);
    expect(ctx.onTrimEnd).toHaveBeenCalled();
  });

  it("clears the fade tip and seeks a playhead release", () => {
    const fade = endCtx();
    finishTimelineDrag(session({ kind: "fadeOut" }), pointer(0), fade);
    expect(fade.setFadeTip).toHaveBeenCalledWith(null);
    expect(fade.onFadeEnd).toHaveBeenCalled();

    const head = endCtx();
    finishTimelineDrag(session({ kind: "playhead" }), pointer(108), head);
    expect(head.onSeek).toHaveBeenCalledWith(100);
  });

  it("seeks when a clip click did not move, and still ends an audio slip", () => {
    const click = endCtx();
    finishTimelineDrag(session({ kind: "move", moved: false }), pointer(108), click);
    expect(click.onSeek).toHaveBeenCalledWith(100);

    const slip = endCtx();
    finishTimelineDrag(session({ kind: "audioMove", moved: true }), pointer(108), slip);
    expect(slip.onMoveAudioEnd).toHaveBeenCalled();
    expect(slip.onSeek).not.toHaveBeenCalled();
  });
});
