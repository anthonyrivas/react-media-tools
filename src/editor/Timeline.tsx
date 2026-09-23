import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconButton } from "../IconButton";
import { IconMinus, IconPlus } from "../icons";
import type { EditorClip } from "../types";
import { formatClock, formatPrecise } from "../utils";
import { paintWaveform, type WaveformPeaks } from "./waveform";
import { clampFades } from "./audioGain";
import {
  MAX_ZOOM,
  MIN_CLIP_MS,
  MIN_ZOOM,
  FIT_ZOOM,
  TRACK_PAD_PX,
  clamp,
  clampZoom,
  clipDuration,
  clipStartMs,
  cutTimes,
  locateClip,
  playheadX,
  snapThresholdMs,
  snapValue,
  audioClipStart,
  audioTrackClips,
  canSnapTrimToHovered,
  hasDetachedAudio,
  hoveredTrimSourceTimes,
  hoveredTrimUsesBothEdges,
  isAudioClip,
  packAudioLanes,
  timelineDuration,
  timelineInnerWidth,
  timelineMsAtX,
  timelinePps,
  videoTrackClips,
} from "./timelineMath";

export type TimelineSource = {
  id: string;
  name: string;
  durationMs: number;
  thumb?: string;
  peaks?: WaveformPeaks;
  hasAudio?: boolean;
};

export type TimelineHandle = {
  zoomBy: (factor: number) => void;
  zoomFit: () => void;
};

type TimelineProps = {
  clips: EditorClip[];
  sources: Record<string, TimelineSource>;
  thumbs?: Record<string, string>;
  selectedId: string | null;
  playheadMs: number;
  emptyHint?: string;
  showFades?: boolean;
  onSelect: (id: string) => void;
  onSeek: (ms: number) => void;
  onScrub: (ms: number) => void;
  onTrim: (id: string, inMs: number, outMs: number, edge: "in" | "out") => void;
  onTrimEnd: () => void;
  onFade?: (id: string, fadeInMs: number, fadeOutMs: number) => void;
  onFadeEnd?: () => void;
  onReorder: (from: number, to: number) => void;
  showAudioTrack?: boolean;
  onMoveAudio?: (id: string, startMs: number) => void;
  onMoveAudioEnd?: () => void;
};

type DragSession = {
  kind: "move" | "in" | "out" | "playhead" | "fadeIn" | "fadeOut" | "audioMove";
  id: string;
  index: number;
  startX: number;
  originIn: number;
  originOut: number;
  originFadeIn: number;
  originFadeOut: number;
  originStart: number;
  duration: number;
  width: number;
  moved: boolean;
  snapPlayheadMs: number;
  grabOffsetMs?: number;
};

type HoldLayout = {
  pps: number;
  total: number;
  innerWidth: number;
  scrollLeft: number;
  originLeft: number;
  widths: Record<string, number>;
  lefts: Record<string, number>;
  starts: Record<string, number>;
  durations: Record<string, number>;
};

type TrimTip = {
  edge: "in" | "out";
  inMs: number;
  outMs: number;
  x: number;
  y: number;
};

type FadeTip = {
  edge: "in" | "out";
  ms: number;
  x: number;
  y: number;
};

type ZoomAnchor = {
  ms: number;
  viewOffset: number;
};

function innerOriginLeft(scroller: HTMLElement | null): number {
  const inner = scroller?.querySelector<HTMLElement>(".rmt-timeline__inner");
  return (inner ?? scroller)?.getBoundingClientRect().left ?? 0;
}

function heldClipBox(
  hold: HoldLayout | null,
  id: string,
  liveStart: number,
  liveDuration: number,
  pps: number,
): { left: number; width: number } {
  return {
    left: hold?.lefts[id] ?? liveStart * pps,
    width: hold?.widths[id] ?? Math.max(36, liveDuration * pps),
  };
}

function draggingHandleLeft(
  session: DragSession | null,
  clip: EditorClip,
  edge: "in" | "out",
  pps: number,
): number | null {
  if (!session || session.id !== clip.id || session.kind !== edge) return null;
  if (edge === "in") return (clip.inMs - session.originIn) * pps;
  return (clip.outMs - session.originIn) * pps - 24;
}

function hoveredTrimHandle(
  x: number,
  y: number,
  trimmingId: string,
  clips: EditorClip[],
  showAudioTrack: boolean,
): { clip: EditorClip; edge: "in" | "out" } | null {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof Element)) continue;
    const handle = node.closest(".rmt-clip__trim");
    if (!handle) continue;
    const host = handle.closest("[data-clip-id]");
    const id = host?.getAttribute("data-clip-id");
    if (!id || id === trimmingId) continue;
    const hovered = clips.find((item) => item.id === id);
    const trimming = clips.find((item) => item.id === trimmingId);
    if (!hovered || !trimming) return null;
    if (!canSnapTrimToHovered(trimming, hovered, showAudioTrack)) return null;
    const edge = handle.getAttribute("data-trim-edge") === "in" || handle.classList.contains("rmt-clip__trim--in")
      ? "in"
      : "out";
    return { clip: hovered, edge };
  }
  return null;
}

function hoveredTrimClip(
  x: number,
  y: number,
  trimmingId: string,
  clips: EditorClip[],
  showAudioTrack: boolean,
): EditorClip | null {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof Element)) continue;
    const host = node.closest("[data-clip-id]");
    const id = host?.getAttribute("data-clip-id");
    if (!id || id === trimmingId) continue;
    const hovered = clips.find((item) => item.id === id);
    const trimming = clips.find((item) => item.id === trimmingId);
    if (!hovered || !trimming) return null;
    if (!canSnapTrimToHovered(trimming, hovered, showAudioTrack)) return null;
    return hovered;
  }
  return null;
}

export const Timeline = forwardRef<TimelineHandle, TimelineProps>(function Timeline(
  {
    clips,
    sources,
    thumbs,
    selectedId,
    playheadMs,
    emptyHint = "Drop a video, send a recording, or open a file.",
    showFades = false,
    onSelect,
    onSeek,
    onScrub,
    onTrim,
    onTrimEnd,
    onFade,
    onFadeEnd,
    onReorder,
    showAudioTrack = false,
    onMoveAudio,
    onMoveAudioEnd,
  },
  ref,
) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dropIndexRef = useRef<number | null>(null);
  const drag = useRef<DragSession | null>(null);
  const clipsRef = useRef(clips);
  const sourcesRef = useRef(sources);
  const onTrimRef = useRef(onTrim);
  const onTrimEndRef = useRef(onTrimEnd);
  const onFadeRef = useRef(onFade);
  const onFadeEndRef = useRef(onFadeEnd);
  const onReorderRef = useRef(onReorder);
  const onMoveAudioRef = useRef(onMoveAudio);
  const onMoveAudioEndRef = useRef(onMoveAudioEnd);
  const onScrubRef = useRef(onScrub);
  const onSeekRef = useRef(onSeek);
  const moveRaf = useRef(0);
  const pendingMove = useRef<PointerEvent | null>(null);
  const zoomRef = useRef(1);
  const ppsRef = useRef(0);
  const playheadMsRef = useRef(playheadMs);
  const pendingAnchor = useRef<ZoomAnchor | null>(null);
  const skipFollow = useRef(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [holdLayout, setHoldLayout] = useState<HoldLayout | null>(null);
  const holdLayoutRef = useRef<HoldLayout | null>(null);
  const setTrimTipRef = useRef<(tip: TrimTip | null) => void>(() => undefined);
  const setFadeTipRef = useRef<(tip: FadeTip | null) => void>(() => undefined);
  const [playheadLeft, setPlayheadLeft] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewWidth, setViewWidth] = useState(0);
  const [trimTip, setTrimTip] = useState<TrimTip | null>(null);
  const [fadeTip, setFadeTip] = useState<FadeTip | null>(null);
  const [snapTrimId, setSnapTrimId] = useState<string | null>(null);
  const showAudioTrackRef = useRef(showAudioTrack);
  const setSnapTrimIdRef = useRef<(id: string | null) => void>(() => undefined);
  const audioLanesRef = useRef<Map<string, number>>(new Map());

  clipsRef.current = clips;
  sourcesRef.current = sources;
  onTrimRef.current = onTrim;
  onTrimEndRef.current = onTrimEnd;
  onFadeRef.current = onFade;
  onFadeEndRef.current = onFadeEnd;
  onReorderRef.current = onReorder;
  onMoveAudioRef.current = onMoveAudio;
  onMoveAudioEndRef.current = onMoveAudioEnd;
  onScrubRef.current = onScrub;
  onSeekRef.current = onSeek;
  zoomRef.current = zoom;
  playheadMsRef.current = playheadMs;
  holdLayoutRef.current = holdLayout;
  showAudioTrackRef.current = showAudioTrack;
  setTrimTipRef.current = setTrimTip;
  setFadeTipRef.current = setFadeTip;
  setSnapTrimIdRef.current = setSnapTrimId;

  const videoClips = useMemo(() => videoTrackClips(clips), [clips]);
  const extraAudio = useMemo(() => audioTrackClips(clips), [clips]);
  const audioPack = useMemo(() => {
    const packed = packAudioLanes(extraAudio, audioLanesRef.current);
    audioLanesRef.current = packed.rowById;
    return packed;
  }, [extraAudio]);
  const audioRowCount = showAudioTrack ? Math.max(1, audioPack.rowCount) : 0;
  const total = useMemo(() => timelineDuration(clips), [clips]);

  const playhead = useMemo(() => locateClip(clips, playheadMs), [clips, playheadMs]);

  const livePps = useMemo(
    () => timelinePps(viewWidth, total, zoom),
    [total, viewWidth, zoom],
  );

  const pps = holdLayout?.pps ?? livePps;
  ppsRef.current = pps;

  const liveInnerWidth = useMemo(
    () => timelineInnerWidth(viewWidth, total, livePps),
    [livePps, total, viewWidth],
  );

  const innerWidth = holdLayout?.innerWidth ?? liveInnerWidth;
  const layoutTotal = holdLayout?.total ?? total;

  const captureHoldLayout = useCallback((originLeft?: number): HoldLayout => {
    const scroller = scrollerRef.current;
    const clipsNow = clipsRef.current;
    const ppsNow = ppsRef.current;
    const starts: Record<string, number> = {};
    const lefts: Record<string, number> = {};
    const widths: Record<string, number> = {};
    const durations: Record<string, number> = {};
    clipsNow.forEach((item, index) => {
      const start = clipStartMs(clipsNow, index);
      const duration = clipDuration(item);
      starts[item.id] = start;
      durations[item.id] = duration;
      lefts[item.id] = start * ppsNow;
      widths[item.id] = Math.max(36, duration * ppsNow);
    });
    const inner = scroller?.querySelector<HTMLElement>(".rmt-timeline__inner");
    const totalNow = totalFrom(clipsNow);
    return {
      pps: ppsNow,
      total: totalNow,
      innerWidth: inner?.offsetWidth || Math.max(viewWidth, TRACK_PAD_PX * 2 + totalNow * ppsNow),
      scrollLeft: scroller?.scrollLeft ?? 0,
      originLeft: originLeft ?? innerOriginLeft(scroller),
      starts,
      lefts,
      widths,
      durations,
    };
  }, [viewWidth]);

  const beginTrim = (
    event: React.PointerEvent,
    kind: "in" | "out",
    clip: EditorClip,
    index: number,
    start: number,
    duration: number,
    fades: { fadeInMs: number; fadeOutMs: number },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(clip.id);
    const ppsNow = ppsRef.current;
    const originLeft = innerOriginLeft(scrollerRef.current);
    const originEdge = kind === "in" ? start : start + duration;
    const host = event.currentTarget.parentElement;
    drag.current = {
      kind,
      id: clip.id,
      index,
      startX: event.clientX,
      originIn: clip.inMs,
      originOut: clip.outMs,
      originFadeIn: fades.fadeInMs,
      originFadeOut: fades.fadeOutMs,
      originStart: start,
      duration,
      width: host?.getBoundingClientRect().width ?? 1,
      moved: false,
      snapPlayheadMs: playheadMs,
      grabOffsetMs: timelineMsAtX(event.clientX, originLeft, TRACK_PAD_PX, ppsNow) - originEdge,
    };
    skipFollow.current = true;
    const held = captureHoldLayout(originLeft);
    holdLayoutRef.current = held;
    setHoldLayout(held);
    setTrimTip({
      edge: kind,
      inMs: clip.inMs,
      outMs: clip.outMs,
      x: event.clientX,
      y: event.clientY,
    });
  };

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => setViewWidth(scroller.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || !clips.length) {
      setPlayheadLeft(0);
      return;
    }
    const session = drag.current;
    const hold = holdLayoutRef.current;
    if (hold && session && (session.kind === "in" || session.kind === "out")) {
      const clip = clips.find((item) => item.id === session.id);
      const start = hold.starts[session.id] ?? session.originStart;
      const edge =
        !clip || session.kind === "in"
          ? start + ((clip?.inMs ?? session.originIn) - session.originIn)
          : start + ((clip?.outMs ?? session.originOut) - session.originIn);
      setPlayheadLeft(edge * pps);
      return;
    }
    setPlayheadLeft(playheadX(playheadMs, pps));
  }, [clips, playheadMs, pps, innerWidth, holdLayout]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    const anchor = pendingAnchor.current;
    if (!scroller || !track || !anchor || holdLayoutRef.current) return;
    pendingAnchor.current = null;
    scroller.scrollLeft = playheadX(anchor.ms, pps) - anchor.viewOffset;
  }, [zoom, innerWidth, pps]);

  useLayoutEffect(() => {
    if (skipFollow.current) {
      skipFollow.current = false;
      return;
    }
    if (holdLayout != null || drag.current || zoom <= FIT_ZOOM) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const left = scroller.scrollLeft;
    const right = left + scroller.clientWidth;
    const margin = 40;
    if (playheadLeft >= left + margin && playheadLeft <= right - margin) return;
    scroller.scrollLeft = clamp(playheadLeft - scroller.clientWidth * 0.35, 0, scroller.scrollWidth);
  }, [holdLayout, playheadLeft, zoom]);

  const applyZoom = useCallback((factor: number, clientX?: number) => {
    const scroller = scrollerRef.current;
    const next = clampZoom(zoomRef.current * factor);
    if (next === zoomRef.current) return;
    const viewLeft = scroller?.getBoundingClientRect().left ?? 0;
    const viewOffset =
      clientX != null ? clientX - viewLeft : playheadLeftRef(scroller) - (scroller?.scrollLeft ?? 0);
    const ms =
      clientX != null && ppsRef.current > 0
        ? playheadFromPointer(clientX, clipsRef.current, ppsRef.current, scroller, false)
        : playheadMsRef.current;
    pendingAnchor.current = {
      ms,
      viewOffset: Number.isFinite(viewOffset) ? viewOffset : (scroller?.clientWidth ?? 0) / 2,
    };
    skipFollow.current = true;
    zoomRef.current = next;
    setZoom(next);
  }, []);

  const zoomFit = useCallback(() => {
    if (zoomRef.current === FIT_ZOOM) return;
    pendingAnchor.current = { ms: playheadMsRef.current, viewOffset: (scrollerRef.current?.clientWidth ?? 0) / 2 };
    skipFollow.current = true;
    zoomRef.current = FIT_ZOOM;
    setZoom(FIT_ZOOM);
  }, []);

  useImperativeHandle(ref, () => ({ zoomBy: applyZoom, zoomFit }), [applyZoom, zoomFit]);

  useEffect(() => {
    if (!clips.length && zoomRef.current !== FIT_ZOOM) setZoom(FIT_ZOOM);
  }, [clips.length]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !holdLayout) return;
    const locked = holdLayout.scrollLeft;
    scroller.scrollLeft = locked;
    const keep = () => {
      if (scroller.scrollLeft !== locked) scroller.scrollLeft = locked;
    };
    scroller.addEventListener("scroll", keep);
    return () => scroller.removeEventListener("scroll", keep);
  }, [holdLayout]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        applyZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX);
        return;
      }
      if (zoomRef.current <= FIT_ZOOM) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY;
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  useEffect(() => {
    const flushMove = () => {
      moveRaf.current = 0;
      const event = pendingMove.current;
      pendingMove.current = null;
      const session = drag.current;
      if (!event || !session) return;
      const dx = event.clientX - session.startX;
      if (Math.abs(dx) > 2) session.moved = true;

      if (session.kind === "playhead") {
        const ms = playheadFromPointer(event.clientX, clipsRef.current, ppsRef.current, scrollerRef.current);
        if (ms != null) onScrubRef.current(ms);
        return;
      }

      if (session.kind === "move") {
        const nextIndex = indexFromClientX(
          trackRef.current,
          event.clientX,
          videoTrackClips(clipsRef.current).length,
        );
        dropIndexRef.current = nextIndex;
        setDropIndex(nextIndex);
        return;
      }

      const ppsNow = ppsRef.current > 0 ? ppsRef.current : session.duration > 0 ? session.width / session.duration : 0;
      const deltaMs = ppsNow > 0 ? dx / ppsNow : 0;

      if (session.kind === "audioMove") {
        const nextStart = Math.max(0, session.originStart + deltaMs);
        const threshold = snapThresholdMs(ppsNow);
        const snapped = snapValue(nextStart, cutTimes(clipsRef.current), threshold);
        onMoveAudioRef.current?.(session.id, snapped);
        return;
      }

      if (session.kind === "fadeIn" || session.kind === "fadeOut") {
        const maxFade = session.duration / 2;
        const nextFadeIn =
          session.kind === "fadeIn"
            ? clamp(session.originFadeIn + deltaMs, 0, maxFade)
            : session.originFadeIn;
        const nextFadeOut =
          session.kind === "fadeOut"
            ? clamp(session.originFadeOut - deltaMs, 0, maxFade)
            : session.originFadeOut;
        onFadeRef.current?.(session.id, nextFadeIn, nextFadeOut);
        setFadeTipRef.current({
          edge: session.kind === "fadeIn" ? "in" : "out",
          ms: session.kind === "fadeIn" ? nextFadeIn : nextFadeOut,
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }

      const threshold = snapThresholdMs(ppsNow);
      const clip = clipsRef.current.find((item) => item.id === session.id);
      const source = clip ? sourcesRef.current[clip.sourceId] : undefined;
      if (!clip || !source) return;
      const track = isAudioClip(clip) ? audioTrackClips(clipsRef.current) : videoTrackClips(clipsRef.current);
      const trackIndex = track.findIndex((item) => item.id === clip.id);
      const hold = holdLayoutRef.current;
      const start = session.originStart;
      const originLeft = hold?.originLeft ?? innerOriginLeft(scrollerRef.current);
      const cursorMs =
        timelineMsAtX(event.clientX, originLeft, TRACK_PAD_PX, ppsNow) - (session.grabOffsetMs ?? 0);
      const proposedSource = session.originIn + (cursorMs - start);
      const sourceAtPlayhead = session.originIn + (session.snapPlayheadMs - start);
      const frozenStart = (id: string) => {
        if (hold?.starts[id] != null) return hold.starts[id]!;
        const index = clipsRef.current.findIndex((item) => item.id === id);
        return clipStartMs(clipsRef.current, index);
      };
      const frozenEnd = (item: EditorClip) =>
        frozenStart(item.id) + (hold?.durations[item.id] ?? clipDuration(item));
      const hoveredHandle = hoveredTrimHandle(
        event.clientX,
        event.clientY,
        session.id,
        clipsRef.current,
        showAudioTrackRef.current,
      );
      const hovered =
        hoveredHandle?.clip ??
        hoveredTrimClip(
          event.clientX,
          event.clientY,
          session.id,
          clipsRef.current,
          showAudioTrackRef.current,
        );
      setSnapTrimIdRef.current(hovered?.id ?? null);
      let hoverTargets: number[] = [];
      if (hoveredHandle && (session.kind === "in" || session.kind === "out")) {
        const hoveredTime = hoveredHandle.edge === "in" ? frozenStart(hoveredHandle.clip.id) : frozenEnd(hoveredHandle.clip);
        hoverTargets.push(session.originIn + (hoveredTime - start));
      } else if (hovered && (session.kind === "in" || session.kind === "out")) {
        hoverTargets = hoveredTrimSourceTimes({
          edge: session.kind,
          originIn: session.originIn,
          clipStartMs: start,
          hoveredStartMs: frozenStart(hovered.id),
          hoveredEndMs: frozenEnd(hovered),
          bothEdges: hoveredTrimUsesBothEdges(clip, hovered),
        });
      }
      if (session.kind === "in") {
        const targets = [0, ...hoverTargets];
        if (sourceAtPlayhead > 0 && sourceAtPlayhead < session.originOut - MIN_CLIP_MS) {
          targets.push(sourceAtPlayhead);
        }
        const prev = track[trackIndex - 1];
        if (prev && prev.sourceId === clip.sourceId) targets.push(prev.outMs);
        const nextIn = clamp(
          snapValue(proposedSource, targets, threshold),
          0,
          session.originOut - MIN_CLIP_MS,
        );
        onTrimRef.current(session.id, nextIn, session.originOut, "in");
        setTrimTipRef.current({
          edge: "in",
          inMs: nextIn,
          outMs: session.originOut,
          x: event.clientX,
          y: event.clientY,
        });
      } else {
        const targets = [source.durationMs, ...hoverTargets];
        if (sourceAtPlayhead > session.originIn + MIN_CLIP_MS) {
          targets.push(sourceAtPlayhead);
        }
        const nextClip = track[trackIndex + 1];
        if (nextClip && nextClip.sourceId === clip.sourceId) targets.push(nextClip.inMs);
        const nextOut = clamp(
          snapValue(proposedSource, targets, threshold),
          session.originIn + MIN_CLIP_MS,
          source.durationMs,
        );
        onTrimRef.current(session.id, session.originIn, nextOut, "out");
        setTrimTipRef.current({
          edge: "out",
          inMs: session.originIn,
          outMs: nextOut,
          x: event.clientX,
          y: event.clientY,
        });
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!drag.current) return;
      pendingMove.current = event;
      if (!moveRaf.current) moveRaf.current = requestAnimationFrame(flushMove);
    };

    const onUp = (event: PointerEvent) => {
      const session = drag.current;
      if (moveRaf.current) {
        cancelAnimationFrame(moveRaf.current);
        moveRaf.current = 0;
        pendingMove.current = event;
        flushMove();
      }
      const dropAt = dropIndexRef.current;
      if (session?.kind === "move" && session.moved && dropAt != null) {
        const target = dropAt > session.index ? dropAt - 1 : dropAt;
        if (target !== session.index) onReorderRef.current(session.index, target);
      }
      if (session?.kind === "in" || session?.kind === "out") {
        skipFollow.current = true;
        setHoldLayout(null);
        setTrimTip(null);
        setSnapTrimId(null);
        onTrimEndRef.current();
      }
      if (session?.kind === "fadeIn" || session?.kind === "fadeOut") {
        setFadeTip(null);
        onFadeEndRef.current?.();
      }
      if (session?.kind === "audioMove") {
        onMoveAudioEndRef.current?.();
      }
      if (session?.kind === "playhead") {
        const ms = playheadFromPointer(event.clientX, clipsRef.current, ppsRef.current, scrollerRef.current);
        if (ms != null) onSeekRef.current(ms);
      } else if (session && !session.moved && (session.kind === "move" || session.kind === "audioMove")) {
        const ms = playheadFromPointer(event.clientX, clipsRef.current, ppsRef.current, scrollerRef.current);
        if (ms != null) onSeekRef.current(ms);
      }
      drag.current = null;
      dropIndexRef.current = null;
      setDropIndex(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
    };
  }, []);

  const beginScrub = (event: React.PointerEvent) => {
    if (!clips.length) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = {
      kind: "playhead",
      id: playhead?.clip.id ?? "",
      index: playhead?.index ?? 0,
      startX: event.clientX,
      originIn: 0,
      originOut: 0,
      originFadeIn: 0,
      originFadeOut: 0,
      originStart: 0,
      duration: total,
      width: trackRef.current?.getBoundingClientRect().width ?? 1,
      moved: false,
      snapPlayheadMs: playheadMs,
    };
    const ms = playheadFromPointer(event.clientX, clips, pps, scrollerRef.current);
    if (ms != null) onScrub(ms);
  };

  const ticks = useMemo(() => rulerTicks(layoutTotal, pps), [layoutTotal, pps]);

  return (
    <div className="rmt-timeline">
      <div className="rmt-timeline__bar">
        <div className="rmt-timeline__hint">
          {total <= 0
            ? emptyHint
            : `${Math.max(1, Math.round(layoutTotal / 1000))}s · ←/→ scrub · pinch or ${modKey()}+scroll to zoom`}
        </div>
        <div className="rmt-timeline__zoom" role="group" aria-label="Timeline zoom">
          <IconButton
            label="Zoom out"
            keyshortcuts="Minus"
            disabled={zoom <= MIN_ZOOM || !clips.length}
            title="Zoom out (–)"
            onClick={() => applyZoom(1 / 1.25)}
          >
            <IconMinus />
          </IconButton>
          <span className="rmt-timeline__zoom-label" aria-live="polite" aria-atomic="true">
            {formatZoom(zoom)}
          </span>
          <IconButton
            label="Zoom in"
            keyshortcuts="Equal"
            disabled={zoom >= MAX_ZOOM || !clips.length}
            title="Zoom in (=)"
            onClick={() => applyZoom(1.25)}
          >
            <IconPlus />
          </IconButton>
          <button
            type="button"
            className="rmt-btn"
            disabled={zoom === FIT_ZOOM || !clips.length}
            aria-keyshortcuts="Digit0"
            onClick={zoomFit}
            title="Fit timeline (0)"
          >
            Fit
          </button>
        </div>
      </div>
      <div className="rmt-timeline__scroller" ref={scrollerRef}>
        <div className="rmt-timeline__inner" style={{ width: innerWidth || "100%" }}>
          <div className="rmt-timeline__ruler" onPointerDown={beginScrub} aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.ms}
                className="rmt-timeline__tick"
                style={{ left: tick.ms * pps }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          <div
            className="rmt-timeline__track"
            ref={trackRef}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) beginScrub(event);
            }}
          >
            <div
              className="rmt-timeline__lane rmt-timeline__lane--video"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) beginScrub(event);
              }}
            >
            {videoClips.map((clip, index) => {
              const source = sources[clip.sourceId];
              const duration = Math.max(1, clip.outMs - clip.inMs);
              const start = clipStartMs(clips, clips.findIndex((item) => item.id === clip.id));
              const thumb = thumbs?.[clip.id] ?? source?.thumb;
              const locked = holdLayout != null;
              const trimming = locked && drag.current?.id === clip.id;
              const draggingTrim =
                trimming && (drag.current?.kind === "in" || drag.current?.kind === "out");
              const left = holdLayout?.lefts[clip.id] ?? start * pps;
              const width = holdLayout?.widths[clip.id] ?? Math.max(36, duration * pps);
              const originIn = drag.current?.originIn ?? clip.inMs;
              const inHandleLeft = draggingTrim && drag.current?.kind === "in" ? (clip.inMs - originIn) * pps : null;
              const outHandleLeft =
                draggingTrim && drag.current?.kind === "out" ? (clip.outMs - originIn) * pps - 24 : null;
              const displayDuration = holdLayout?.durations[clip.id] ?? duration;
              const fades = clampFades(clip);
              const fadeInPct = (fades.fadeInMs / displayDuration) * 100;
              const fadeOutPct = (fades.fadeOutMs / displayDuration) * 100;
              const detached = hasDetachedAudio(clips, clip.id);
              const playableAudio = source?.hasAudio !== false && !detached;
              return (
                <div
                  key={clip.id}
                  data-clip-id={clip.id}
                  role="group"
                  aria-label={`${source?.name ?? "Clip"}, ${formatLength(clip.outMs - clip.inMs)}`}
                  aria-current={selectedId === clip.id ? "true" : undefined}
                  className={[
                    "rmt-clip",
                    "rmt-clip--video",
                    selectedId === clip.id ? "is-selected" : "",
                    dropIndex === index ? "is-drop-target" : "",
                    trimming ? "is-trimming" : "",
                    snapTrimId === clip.id ? "is-trim-snap" : "",
                    clip.muted && !detached ? "is-muted" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    left,
                    width,
                    minWidth: 36,
                  }}
                  onPointerDown={(event) => {
                    if ((event.target as HTMLElement).closest(".rmt-clip__trim, .rmt-clip__fade-handle")) {
                      return;
                    }
                    event.stopPropagation();
                    onSelect(clip.id);
                    drag.current = {
                      kind: "move",
                      id: clip.id,
                      index,
                      startX: event.clientX,
                      originIn: clip.inMs,
                      originOut: clip.outMs,
                      originFadeIn: fades.fadeInMs,
                      originFadeOut: fades.fadeOutMs,
                      originStart: 0,
                      duration,
                      width: event.currentTarget.getBoundingClientRect().width,
                      moved: false,
                      snapPlayheadMs: playheadMs,
                    };
                  }}
                >
                  <button
                    type="button"
                    className={["rmt-clip__trim", "rmt-clip__trim--in", inHandleLeft != null ? "is-dragging" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    data-trim-edge="in"
                    tabIndex={-1}
                    aria-label="Trim start"
                    style={
                      inHandleLeft != null
                        ? { position: "absolute", top: 0, bottom: 0, left: inHandleLeft }
                        : undefined
                    }
                    onPointerDown={(event) => {
                      beginTrim(event, "in", clip, index, start, duration, fades);
                    }}
                  />
                  {draggingTrim && drag.current?.kind === "in" && (
                    <div
                      className="rmt-clip__trim-away"
                      style={{ left: 0, width: Math.max(0, (clip.inMs - originIn) * pps) }}
                    />
                  )}
                  {draggingTrim && drag.current?.kind === "out" && (
                    <div
                      className="rmt-clip__trim-away"
                      style={{ left: Math.max(0, (clip.outMs - originIn) * pps), right: 0 }}
                    />
                  )}
                  <div className="rmt-clip__body">
                    {thumb && <img src={thumb} alt="" draggable={false} />}
                    {source?.peaks && !clip.muted && playableAudio && (
                      <ClipWaveform
                        peaks={source.peaks}
                        inMs={draggingTrim ? originIn : clip.inMs}
                        outMs={draggingTrim ? (drag.current?.originOut ?? clip.outMs) : clip.outMs}
                      />
                    )}
                    <span className="rmt-clip__name">{source?.name ?? "Clip"}</span>
                    <span className="rmt-clip__length">{formatLength(displayDuration)}</span>
                    <span className="rmt-clip__range">
                      {formatPrecise(clip.inMs)}–{formatPrecise(clip.outMs)}
                    </span>
                  </div>
                  {showFades && onFade && playableAudio && (
                    <>
                      {fades.fadeInMs > 0 && (
                        <div
                          className="rmt-clip__fade rmt-clip__fade--in"
                          style={{ width: `${fadeInPct}%` }}
                          aria-hidden="true"
                        />
                      )}
                      {fades.fadeOutMs > 0 && (
                        <div
                          className="rmt-clip__fade rmt-clip__fade--out"
                          style={{ width: `${fadeOutPct}%` }}
                          aria-hidden="true"
                        />
                      )}
                      <button
                        type="button"
                        className="rmt-clip__fade-handle rmt-clip__fade-handle--in"
                        tabIndex={-1}
                        aria-label="Fade in"
                        style={{ left: `max(28px, ${fadeInPct}%)` }}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelect(clip.id);
                          const host = event.currentTarget.parentElement;
                          drag.current = {
                            kind: "fadeIn",
                            id: clip.id,
                            index,
                            startX: event.clientX,
                            originIn: clip.inMs,
                            originOut: clip.outMs,
                            originFadeIn: fades.fadeInMs,
                            originFadeOut: fades.fadeOutMs,
                      originStart: 0,
                            duration,
                            width: host?.getBoundingClientRect().width ?? 1,
                            moved: false,
                            snapPlayheadMs: playheadMs,
                          };
                          setFadeTip({
                            edge: "in",
                            ms: fades.fadeInMs,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="rmt-clip__fade-handle rmt-clip__fade-handle--out"
                        tabIndex={-1}
                        aria-label="Fade out"
                        style={{ right: `max(28px, ${fadeOutPct}%)` }}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelect(clip.id);
                          const host = event.currentTarget.parentElement;
                          drag.current = {
                            kind: "fadeOut",
                            id: clip.id,
                            index,
                            startX: event.clientX,
                            originIn: clip.inMs,
                            originOut: clip.outMs,
                            originFadeIn: fades.fadeInMs,
                            originFadeOut: fades.fadeOutMs,
                      originStart: 0,
                            duration,
                            width: host?.getBoundingClientRect().width ?? 1,
                            moved: false,
                            snapPlayheadMs: playheadMs,
                          };
                          setFadeTip({
                            edge: "out",
                            ms: fades.fadeOutMs,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                      />
                    </>
                  )}
                  <button
                    type="button"
                    className={["rmt-clip__trim", "rmt-clip__trim--out", outHandleLeft != null ? "is-dragging" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    data-trim-edge="out"
                    tabIndex={-1}
                    aria-label="Trim end"
                    style={
                      outHandleLeft != null
                        ? { position: "absolute", top: 0, bottom: 0, left: outHandleLeft }
                        : undefined
                    }
                    onPointerDown={(event) => {
                      beginTrim(event, "out", clip, index, start, duration, fades);
                    }}
                  />
                </div>
              );
            })}
            </div>
            {showAudioTrack &&
              Array.from({ length: audioRowCount }, (_, row) => (
              <div
                key={`audio-${row}`}
                className="rmt-timeline__lane rmt-timeline__lane--audio"
                data-audio-row={row}
                aria-label={audioRowCount > 1 ? `Audio row ${row + 1}` : "Audio track"}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) beginScrub(event);
                }}
              >
                {extraAudio.length === 0 && (
                  <div className="rmt-timeline__lane-empty">Audio track · drop audio or unlink a clip</div>
                )}
                {extraAudio
                  .filter((clip) => (audioPack.rowById.get(clip.id) ?? 0) === row)
                  .map((clip) => {
                  const source = sources[clip.sourceId];
                  const duration = Math.max(1, clip.outMs - clip.inMs);
                  const start = audioClipStart(clip);
                  const draggingTrim =
                    drag.current?.id === clip.id &&
                    (drag.current?.kind === "in" || drag.current?.kind === "out");
                  const { left, width } = heldClipBox(holdLayout, clip.id, start, duration, pps);
                  const inHandleLeft = draggingHandleLeft(drag.current, clip, "in", pps);
                  const outHandleLeft = draggingHandleLeft(drag.current, clip, "out", pps);
                  const originIn = drag.current?.originIn ?? clip.inMs;
                  const fades = clampFades(clip);
                  const fadeInPct = (fades.fadeInMs / duration) * 100;
                  const fadeOutPct = (fades.fadeOutMs / duration) * 100;
                  const index = clips.findIndex((item) => item.id === clip.id);
                  return (
                    <div
                      key={clip.id}
                      data-clip-id={clip.id}
                      role="group"
                      aria-label={`${source?.name ?? "Audio"}, ${formatLength(duration)}`}
                      aria-current={selectedId === clip.id ? "true" : undefined}
                      className={[
                        "rmt-clip",
                        "rmt-clip--audio",
                        selectedId === clip.id ? "is-selected" : "",
                        snapTrimId === clip.id ? "is-trim-snap" : "",
                        draggingTrim ? "is-trimming" : "",
                        clip.muted ? "is-muted" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{
                        left,
                        width,
                        minWidth: 36,
                      }}
                      onPointerDown={(event) => {
                        if ((event.target as HTMLElement).closest(".rmt-clip__trim, .rmt-clip__fade-handle")) {
                          return;
                        }
                        event.stopPropagation();
                        onSelect(clip.id);
                        drag.current = {
                          kind: "audioMove",
                          id: clip.id,
                          index,
                          startX: event.clientX,
                          originIn: clip.inMs,
                          originOut: clip.outMs,
                          originFadeIn: fades.fadeInMs,
                          originFadeOut: fades.fadeOutMs,
                          originStart: start,
                          duration,
                          width: event.currentTarget.getBoundingClientRect().width,
                          moved: false,
                          snapPlayheadMs: playheadMs,
                        };
                      }}
                    >
                      <button
                        type="button"
                        className={["rmt-clip__trim", "rmt-clip__trim--in", inHandleLeft != null ? "is-dragging" : ""]
                          .filter(Boolean)
                          .join(" ")}
                        data-trim-edge="in"
                        tabIndex={-1}
                        aria-label="Trim start"
                        style={
                          inHandleLeft != null
                            ? { position: "absolute", top: 0, bottom: 0, left: inHandleLeft }
                            : undefined
                        }
                        onPointerDown={(event) => {
                          beginTrim(event, "in", clip, index, start, duration, fades);
                        }}
                      />
                      {draggingTrim && drag.current?.kind === "in" && (
                        <div
                          className="rmt-clip__trim-away"
                          style={{ left: 0, width: Math.max(0, (clip.inMs - originIn) * pps) }}
                        />
                      )}
                      {draggingTrim && drag.current?.kind === "out" && (
                        <div
                          className="rmt-clip__trim-away"
                          style={{ left: Math.max(0, (clip.outMs - originIn) * pps), right: 0 }}
                        />
                      )}
                      <div className="rmt-clip__body">
                        {source?.peaks && (
                          <ClipWaveform
                            peaks={source.peaks}
                            inMs={draggingTrim ? originIn : clip.inMs}
                            outMs={draggingTrim ? (drag.current?.originOut ?? clip.outMs) : clip.outMs}
                          />
                        )}
                        <span className="rmt-clip__name">{source?.name ?? "Audio"}</span>
                        <span className="rmt-clip__length">
                          {formatLength(holdLayout?.durations[clip.id] ?? duration)}
                        </span>
                      </div>
                      {showFades && onFade && (
                        <>
                          {fades.fadeInMs > 0 && (
                            <div
                              className="rmt-clip__fade rmt-clip__fade--in"
                              style={{ width: `${fadeInPct}%` }}
                              aria-hidden="true"
                            />
                          )}
                          {fades.fadeOutMs > 0 && (
                            <div
                              className="rmt-clip__fade rmt-clip__fade--out"
                              style={{ width: `${fadeOutPct}%` }}
                              aria-hidden="true"
                            />
                          )}
                          <button
                            type="button"
                            className="rmt-clip__fade-handle rmt-clip__fade-handle--in"
                            tabIndex={-1}
                            aria-label="Fade in"
                            style={{ left: `max(28px, ${fadeInPct}%)` }}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onSelect(clip.id);
                              const host = event.currentTarget.parentElement;
                              drag.current = {
                                kind: "fadeIn",
                                id: clip.id,
                                index,
                                startX: event.clientX,
                                originIn: clip.inMs,
                                originOut: clip.outMs,
                                originFadeIn: fades.fadeInMs,
                                originFadeOut: fades.fadeOutMs,
                                originStart: start,
                                duration,
                                width: host?.getBoundingClientRect().width ?? 1,
                                moved: false,
                                snapPlayheadMs: playheadMs,
                              };
                              setFadeTip({
                                edge: "in",
                                ms: fades.fadeInMs,
                                x: event.clientX,
                                y: event.clientY,
                              });
                            }}
                          />
                          <button
                            type="button"
                            className="rmt-clip__fade-handle rmt-clip__fade-handle--out"
                            tabIndex={-1}
                            aria-label="Fade out"
                            style={{ right: `max(28px, ${fadeOutPct}%)` }}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onSelect(clip.id);
                              const host = event.currentTarget.parentElement;
                              drag.current = {
                                kind: "fadeOut",
                                id: clip.id,
                                index,
                                startX: event.clientX,
                                originIn: clip.inMs,
                                originOut: clip.outMs,
                                originFadeIn: fades.fadeInMs,
                                originFadeOut: fades.fadeOutMs,
                                originStart: start,
                                duration,
                                width: host?.getBoundingClientRect().width ?? 1,
                                moved: false,
                                snapPlayheadMs: playheadMs,
                              };
                              setFadeTip({
                                edge: "out",
                                ms: fades.fadeOutMs,
                                x: event.clientX,
                                y: event.clientY,
                              });
                            }}
                          />
                        </>
                      )}
                      <button
                        type="button"
                        className={["rmt-clip__trim", "rmt-clip__trim--out", outHandleLeft != null ? "is-dragging" : ""]
                          .filter(Boolean)
                          .join(" ")}
                        data-trim-edge="out"
                        tabIndex={-1}
                        aria-label="Trim end"
                        style={
                          outHandleLeft != null
                            ? { position: "absolute", top: 0, bottom: 0, left: outHandleLeft }
                            : undefined
                        }
                        onPointerDown={(event) => {
                          beginTrim(event, "out", clip, index, start, duration, fades);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              ))}
            {total > 0 && (
              <div
                className="rmt-timeline__playhead"
                role="slider"
                tabIndex={0}
                aria-label="Playhead"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, Math.round(total))}
                aria-valuenow={Math.round(playheadMs)}
                aria-valuetext={`${formatPrecise(playheadMs)} of ${formatPrecise(total)}`}
                style={{ left: playheadLeft }}
                onPointerDown={beginScrub}
              />
            )}
          </div>
        </div>
      </div>
      {trimTip && <TrimTooltip tip={trimTip} />}
      {fadeTip && <FadeTooltip tip={fadeTip} />}
    </div>
  );
});

function ClipWaveform({
  peaks,
  inMs,
  outMs,
}: {
  peaks: WaveformPeaks;
  inMs: number;
  outMs: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paint = useCallback(() => {
    const canvas = ref.current;
    if (canvas) paintWaveform(canvas, peaks, inMs, outMs);
  }, [inMs, outMs, peaks]);

  useLayoutEffect(() => {
    paint();
    const canvas = ref.current;
    if (!canvas) return;
    const resize = new ResizeObserver(paint);
    resize.observe(canvas);
    const theme = new MutationObserver(paint);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
      subtree: true,
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, [paint]);

  return <canvas ref={ref} className="rmt-clip__wave" aria-hidden="true" />;
}

function TrimTooltip({ tip }: { tip: TrimTip }) {
  const below = tip.y < 64;
  const x = clamp(tip.x, 72, window.innerWidth - 72);
  const y = clamp(tip.y, 8, window.innerHeight - 8);
  return (
    <div
      className={["rmt-trim-tip", below ? "is-below" : ""].filter(Boolean).join(" ")}
      style={{ left: x, top: y }}
      role="status"
      aria-hidden="true"
    >
      <strong>{formatPrecise(tip.edge === "in" ? tip.inMs : tip.outMs)}</strong>
      <span>{formatLength(Math.max(0, tip.outMs - tip.inMs))}</span>
    </div>
  );
}

function FadeTooltip({ tip }: { tip: FadeTip }) {
  const below = tip.y < 64;
  const x = clamp(tip.x, 72, window.innerWidth - 72);
  const y = clamp(tip.y, 8, window.innerHeight - 8);
  return (
    <div
      className={["rmt-trim-tip", below ? "is-below" : ""].filter(Boolean).join(" ")}
      style={{ left: x, top: y }}
      role="status"
      aria-hidden="true"
    >
      <strong>{tip.edge === "in" ? "Fade in" : "Fade out"}</strong>
      <span>{formatLength(tip.ms)}</span>
    </div>
  );
}

function playheadLeftRef(scroller: HTMLDivElement | null): number {
  if (!scroller) return 0;
  const playhead = scroller.querySelector<HTMLElement>(".rmt-timeline__playhead");
  if (!playhead) return scroller.clientWidth / 2;
  return playhead.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
}

function clipElements(track: HTMLDivElement | null): HTMLElement[] {
  if (!track) return [];
  return [...track.querySelectorAll<HTMLElement>(".rmt-clip--video")];
}

function playheadFromPointer(
  clientX: number,
  clips: EditorClip[],
  pps: number,
  scroller: HTMLElement | null,
  snap = true,
): number {
  const total = timelineDuration(clips);
  if (total <= 0 || pps <= 0) return 0;
  const ms = clamp(timelineMsAtX(clientX, innerOriginLeft(scroller), TRACK_PAD_PX, pps), 0, total);
  if (!snap) return ms;
  return snapValue(ms, cutTimes(clips), snapThresholdMs(pps));
}

function indexFromClientX(
  track: HTMLDivElement | null,
  clientX: number,
  count: number,
): number {
  const elements = clipElements(track);
  for (let i = 0; i < count; i += 1) {
    const el = elements[i];
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return i;
  }
  return count;
}

function totalFrom(clips: EditorClip[]): number {
  return timelineDuration(clips);
}

function formatLength(ms: number): string {
  const hundredths = Math.floor(Math.max(0, ms) / 10) / 100;
  if (hundredths >= 60) return formatPrecise(ms);
  return `${hundredths.toFixed(2)}s`;
}

function formatZoom(zoom: number): string {
  const rounded = zoom >= 10 ? zoom.toFixed(0) : zoom.toFixed(1);
  return `${rounded}×`;
}

function tickStep(pps: number): number {
  const minPx = 72;
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
  return steps.find((ms) => ms * pps >= minPx) ?? 300000;
}

function rulerTicks(total: number, pps: number): { ms: number; label: string }[] {
  if (total <= 0 || pps <= 0) return [];
  const step = tickStep(pps);
  const ticks: { ms: number; label: string }[] = [];
  for (let ms = 0; ms <= total + 0.5; ms += step) {
    ticks.push({
      ms,
      label: step < 1000 ? formatPrecise(ms) : formatClock(ms),
    });
  }
  return ticks;
}

function modKey(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}
