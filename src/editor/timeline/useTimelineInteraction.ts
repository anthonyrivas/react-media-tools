import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { EditorClip } from "../../types";
import {
  FIT_ZOOM,
  TRACK_PAD_PX,
  clamp,
  clampZoom,
  clipDuration,
  clipStartMs,
  locateClip,
  playheadX,
  timelineDuration,
  timelineInnerWidth,
  timelineMsAtX,
  timelinePps,
} from "./timelineMath";
import {
  type DragSession,
  type FadeTip,
  type HoldLayout,
  type TrimTip,
  type ZoomAnchor,
  clipDragSession,
  innerOriginLeft,
  playheadFromPointer,
  playheadLeftRef,
} from "./timelineView";
import { applyTimelineDragMove, finishTimelineDrag } from "./timelineDrag";

type TimelineSourceDuration = { durationMs: number };

type TimelineInteraction = {
  clips: EditorClip[];
  sources: Record<string, TimelineSourceDuration>;
  playheadMs: number;
  showAudioTrack: boolean;
  onSelect: (id: string) => void;
  onSeek: (ms: number) => void;
  onScrub: (ms: number) => void;
  onTrim: (id: string, inMs: number, outMs: number, edge: "in" | "out") => void;
  onTrimEnd: () => void;
  onFade?: (id: string, fadeInMs: number, fadeOutMs: number) => void;
  onFadeEnd?: () => void;
  onReorder: (from: number, to: number) => void;
  onMoveAudio?: (id: string, startMs: number) => void;
  onMoveAudioEnd?: () => void;
};

export function useTimelineInteraction({
  clips,
  sources,
  playheadMs,
  showAudioTrack,
  onSelect,
  onSeek,
  onScrub,
  onTrim,
  onTrimEnd,
  onFade,
  onFadeEnd,
  onReorder,
  onMoveAudio,
  onMoveAudioEnd,
}: TimelineInteraction) {
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

  const total = useMemo(() => timelineDuration(clips), [clips]);
  const playhead = useMemo(() => locateClip(clips, playheadMs), [clips, playheadMs]);
  const livePps = useMemo(() => timelinePps(viewWidth, total, zoom), [total, viewWidth, zoom]);
  const pps = holdLayout?.pps ?? livePps;
  ppsRef.current = pps;
  const liveInnerWidth = useMemo(
    () => timelineInnerWidth(viewWidth, total, livePps),
    [livePps, total, viewWidth],
  );
  const innerWidth = holdLayout?.innerWidth ?? liveInnerWidth;
  const layoutTotal = holdLayout?.total ?? total;

  const captureHoldLayout = useCallback(
    (originLeft?: number): HoldLayout => {
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
      const totalNow = timelineDuration(clipsNow);
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
    },
    [viewWidth],
  );

  const beginTrim = (
    event: ReactPointerEvent,
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
    drag.current = clipDragSession({
      kind,
      clip,
      index,
      clientX: event.clientX,
      originStart: start,
      duration,
      width: host?.getBoundingClientRect().width ?? 1,
      snapPlayheadMs: playheadMs,
      fades,
      grabOffsetMs: timelineMsAtX(event.clientX, originLeft, TRACK_PAD_PX, ppsNow) - originEdge,
    });
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
      applyTimelineDragMove(session, event, {
        clips: clipsRef.current,
        sources: sourcesRef.current,
        pps: ppsRef.current,
        scroller: scrollerRef.current,
        track: trackRef.current,
        hold: holdLayoutRef.current,
        showAudioTrack: showAudioTrackRef.current,
        dropIndexRef,
        onScrub: onScrubRef.current,
        onMoveAudio: onMoveAudioRef.current,
        onFade: onFadeRef.current,
        onTrim: onTrimRef.current,
        setDropIndex,
        setFadeTip: setFadeTipRef.current,
        setTrimTip: setTrimTipRef.current,
        setSnapTrimId: setSnapTrimIdRef.current,
      });
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
      finishTimelineDrag(session, event, {
        clips: clipsRef.current,
        pps: ppsRef.current,
        scroller: scrollerRef.current,
        dropAt: dropIndexRef.current,
        skipFollow,
        onReorder: onReorderRef.current,
        onTrimEnd: onTrimEndRef.current,
        onFadeEnd: onFadeEndRef.current,
        onMoveAudioEnd: onMoveAudioEndRef.current,
        onSeek: onSeekRef.current,
        setHoldLayout,
        setTrimTip,
        setSnapTrimId,
        setFadeTip,
      });
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

  const beginScrub = (event: ReactPointerEvent) => {
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

  return {
    scrollerRef: scrollerRef as RefObject<HTMLDivElement>,
    trackRef: trackRef as RefObject<HTMLDivElement>,
    drag,
    zoom,
    applyZoom,
    zoomFit,
    pps,
    innerWidth,
    layoutTotal,
    total,
    holdLayout,
    playheadLeft,
    dropIndex,
    snapTrimId,
    trimTip,
    fadeTip,
    setFadeTip,
    beginTrim,
    beginScrub,
  };
}
