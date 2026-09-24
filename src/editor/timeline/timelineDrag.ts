import type { MutableRefObject } from "react";
import type { EditorClip } from "../../types";
import {
  TRACK_PAD_PX,
  cutTimes,
  snapThresholdMs,
  snapValue,
  timelineMsAtX,
  videoTrackClips,
} from "./timelineMath";
import {
  type DragSession,
  type FadeTip,
  type HoldLayout,
  type TrimTip,
  fadeFromDelta,
  hoveredTrimClip,
  hoveredTrimHandle,
  indexFromClientX,
  innerOriginLeft,
  nextTrimFromPointer,
  playheadFromPointer,
} from "./timelineView";

export type TimelineDragMoveCtx = {
  clips: EditorClip[];
  sources: Record<string, { durationMs: number }>;
  pps: number;
  scroller: HTMLElement | null;
  track: HTMLDivElement | null;
  hold: HoldLayout | null;
  showAudioTrack: boolean;
  dropIndexRef: MutableRefObject<number | null>;
  onScrub: (ms: number) => void;
  onMoveAudio?: (id: string, startMs: number) => void;
  onFade?: (id: string, fadeInMs: number, fadeOutMs: number) => void;
  onTrim: (id: string, inMs: number, outMs: number, edge: "in" | "out") => void;
  setDropIndex: (index: number | null) => void;
  setFadeTip: (tip: FadeTip | null) => void;
  setTrimTip: (tip: TrimTip | null) => void;
  setSnapTrimId: (id: string | null) => void;
};

export function applyTimelineDragMove(session: DragSession, event: PointerEvent, ctx: TimelineDragMoveCtx): void {
  const dx = event.clientX - session.startX;
  if (Math.abs(dx) > 2) session.moved = true;
  if (session.kind === "playhead") {
    applyPlayheadDrag(session, event, ctx);
    return;
  }
  if (session.kind === "move") {
    applyReorderDrag(session, event, ctx);
    return;
  }
  const ppsNow = ctx.pps > 0 ? ctx.pps : session.duration > 0 ? session.width / session.duration : 0;
  const deltaMs = ppsNow > 0 ? dx / ppsNow : 0;
  if (session.kind === "audioMove") {
    applyAudioMoveDrag(session, deltaMs, ppsNow, ctx);
    return;
  }
  if (session.kind === "fadeIn" || session.kind === "fadeOut") {
    applyFadeDrag(session, event, deltaMs, ctx);
    return;
  }
  applyTrimDrag(session, event, ppsNow, ctx);
}

function applyPlayheadDrag(_session: DragSession, event: PointerEvent, ctx: TimelineDragMoveCtx): void {
  const ms = playheadFromPointer(event.clientX, ctx.clips, ctx.pps, ctx.scroller);
  if (ms != null) ctx.onScrub(ms);
}

function applyReorderDrag(_session: DragSession, event: PointerEvent, ctx: TimelineDragMoveCtx): void {
  const nextIndex = indexFromClientX(ctx.track, event.clientX, videoTrackClips(ctx.clips).length);
  ctx.dropIndexRef.current = nextIndex;
  ctx.setDropIndex(nextIndex);
}

function applyAudioMoveDrag(
  session: DragSession,
  deltaMs: number,
  ppsNow: number,
  ctx: TimelineDragMoveCtx,
): void {
  const nextStart = Math.max(0, session.originStart + deltaMs);
  const snapped = snapValue(nextStart, cutTimes(ctx.clips), snapThresholdMs(ppsNow));
  ctx.onMoveAudio?.(session.id, snapped);
}

function applyFadeDrag(
  session: DragSession,
  event: PointerEvent,
  deltaMs: number,
  ctx: TimelineDragMoveCtx,
): void {
  const next = fadeFromDelta(session, deltaMs);
  ctx.onFade?.(session.id, next.fadeInMs, next.fadeOutMs);
  ctx.setFadeTip({
    edge: next.edge,
    ms: next.ms,
    x: event.clientX,
    y: event.clientY,
  });
}

function applyTrimDrag(session: DragSession, event: PointerEvent, ppsNow: number, ctx: TimelineDragMoveCtx): void {
  const clip = ctx.clips.find((item) => item.id === session.id);
  const source = clip ? ctx.sources[clip.sourceId] : undefined;
  if (!clip || !source) return;
  const originLeft = ctx.hold?.originLeft ?? innerOriginLeft(ctx.scroller);
  const cursorMs = timelineMsAtX(event.clientX, originLeft, TRACK_PAD_PX, ppsNow) - (session.grabOffsetMs ?? 0);
  const hoveredHandle = hoveredTrimHandle(event.clientX, event.clientY, session.id, ctx.clips, ctx.showAudioTrack);
  const hovered =
    hoveredHandle?.clip ??
    hoveredTrimClip(event.clientX, event.clientY, session.id, ctx.clips, ctx.showAudioTrack);
  const next = nextTrimFromPointer({
    session,
    clip,
    clips: ctx.clips,
    sourceDurationMs: source.durationMs,
    cursorMs,
    pps: ppsNow,
    hold: ctx.hold,
    hoveredHandle,
    hovered,
  });
  if (!next) return;
  ctx.setSnapTrimId(next.snapId);
  ctx.onTrim(session.id, next.inMs, next.outMs, next.edge);
  ctx.setTrimTip({
    edge: next.edge,
    inMs: next.inMs,
    outMs: next.outMs,
    x: event.clientX,
    y: event.clientY,
  });
}

export type TimelineDragEndCtx = {
  clips: EditorClip[];
  pps: number;
  scroller: HTMLElement | null;
  dropAt: number | null;
  skipFollow: MutableRefObject<boolean>;
  onReorder: (from: number, to: number) => void;
  onTrimEnd: () => void;
  onFadeEnd?: () => void;
  onMoveAudioEnd?: () => void;
  onSeek: (ms: number) => void;
  setHoldLayout: (hold: HoldLayout | null) => void;
  setTrimTip: (tip: TrimTip | null) => void;
  setSnapTrimId: (id: string | null) => void;
  setFadeTip: (tip: FadeTip | null) => void;
};

export function finishTimelineDrag(
  session: DragSession | null,
  event: PointerEvent,
  ctx: TimelineDragEndCtx,
): void {
  if (session?.kind === "move" && session.moved && ctx.dropAt != null) {
    const target = ctx.dropAt > session.index ? ctx.dropAt - 1 : ctx.dropAt;
    if (target !== session.index) ctx.onReorder(session.index, target);
  }
  if (session?.kind === "in" || session?.kind === "out") {
    ctx.skipFollow.current = true;
    ctx.setHoldLayout(null);
    ctx.setTrimTip(null);
    ctx.setSnapTrimId(null);
    ctx.onTrimEnd();
  }
  if (session?.kind === "fadeIn" || session?.kind === "fadeOut") {
    ctx.setFadeTip(null);
    ctx.onFadeEnd?.();
  }
  if (session?.kind === "audioMove") {
    ctx.onMoveAudioEnd?.();
  }
  if (session?.kind === "playhead") {
    const ms = playheadFromPointer(event.clientX, ctx.clips, ctx.pps, ctx.scroller);
    if (ms != null) ctx.onSeek(ms);
    return;
  }
  if (session && !session.moved && (session.kind === "move" || session.kind === "audioMove")) {
    const ms = playheadFromPointer(event.clientX, ctx.clips, ctx.pps, ctx.scroller);
    if (ms != null) ctx.onSeek(ms);
  }
}
