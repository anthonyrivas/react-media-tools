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
import type { EditorClip } from "../types";
import { formatClock, formatPrecise } from "../utils";
import { paintWaveform, type WaveformPeaks } from "./waveform";
import {
  MAX_ZOOM,
  MIN_CLIP_MS,
  MIN_ZOOM,
  TRACK_PAD_PX,
  clamp,
  clampZoom,
  clipDuration,
  clipStartMs,
  cutTimes,
  locateClip,
  snapThresholdMs,
  snapValue,
} from "./timelineMath";

export type TimelineSource = {
  id: string;
  name: string;
  durationMs: number;
  thumb?: string;
  peaks?: WaveformPeaks;
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
  onSelect: (id: string) => void;
  onSeek: (ms: number) => void;
  onScrub: (ms: number) => void;
  onTrim: (id: string, inMs: number, outMs: number, edge: "in" | "out") => void;
  onTrimEnd: () => void;
  onReorder: (from: number, to: number) => void;
};

type DragSession = {
  kind: "move" | "in" | "out" | "playhead";
  id: string;
  index: number;
  startX: number;
  originIn: number;
  originOut: number;
  duration: number;
  width: number;
  moved: boolean;
  snapPlayheadMs: number;
};

type HoldLayout = {
  pps: number;
  total: number;
  innerWidth: number;
  scrollLeft: number;
  widths: Record<string, number>;
};

type TrimTip = {
  edge: "in" | "out";
  inMs: number;
  outMs: number;
  x: number;
  y: number;
};

type ZoomAnchor = {
  ms: number;
  viewOffset: number;
};

export const Timeline = forwardRef<TimelineHandle, TimelineProps>(function Timeline(
  {
    clips,
    sources,
    thumbs,
    selectedId,
    playheadMs,
    onSelect,
    onSeek,
    onScrub,
    onTrim,
    onTrimEnd,
    onReorder,
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
  const onReorderRef = useRef(onReorder);
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
  const [playheadLeft, setPlayheadLeft] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewWidth, setViewWidth] = useState(0);
  const [trimTip, setTrimTip] = useState<TrimTip | null>(null);

  clipsRef.current = clips;
  sourcesRef.current = sources;
  onTrimRef.current = onTrim;
  onTrimEndRef.current = onTrimEnd;
  onReorderRef.current = onReorder;
  onScrubRef.current = onScrub;
  onSeekRef.current = onSeek;
  zoomRef.current = zoom;
  playheadMsRef.current = playheadMs;
  holdLayoutRef.current = holdLayout;
  setTrimTipRef.current = setTrimTip;

  const total = useMemo(
    () => clips.reduce((sum, clip) => sum + Math.max(0, clip.outMs - clip.inMs), 0),
    [clips],
  );

  const playhead = useMemo(() => locateClip(clips, playheadMs), [clips, playheadMs]);

  const livePps = useMemo(() => {
    const usable = Math.max(1, viewWidth - TRACK_PAD_PX * 2);
    return total > 0 ? (usable / total) * zoom : 0;
  }, [total, viewWidth, zoom]);

  const pps = holdLayout?.pps ?? livePps;
  ppsRef.current = pps;

  const liveInnerWidth = useMemo(() => {
    if (!clips.length || livePps <= 0) return viewWidth;
    return Math.max(viewWidth, TRACK_PAD_PX * 2 + total * livePps);
  }, [clips.length, livePps, total, viewWidth]);

  const innerWidth = holdLayout?.innerWidth ?? liveInnerWidth;
  const layoutTotal = holdLayout?.total ?? total;

  const captureHoldLayout = useCallback((): HoldLayout => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    const widths: Record<string, number> = {};
    if (track) {
      clipElements(track).forEach((el, i) => {
        const clip = clipsRef.current[i];
        if (clip) widths[clip.id] = el.getBoundingClientRect().width;
      });
    }
    const inner = scroller?.querySelector<HTMLElement>(".rmt-timeline__inner");
    const totalNow = totalFrom(clipsRef.current);
    return {
      pps: ppsRef.current,
      total: totalNow,
      innerWidth: inner?.offsetWidth || Math.max(viewWidth, TRACK_PAD_PX * 2 + totalNow * ppsRef.current),
      scrollLeft: scroller?.scrollLeft ?? 0,
      widths,
    };
  }, [viewWidth]);

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
    setPlayheadLeft(timeToX(track, clips, playheadMs));
  }, [clips, playheadMs, pps, innerWidth]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    const anchor = pendingAnchor.current;
    if (!scroller || !track || !anchor || holdLayoutRef.current) return;
    pendingAnchor.current = null;
    scroller.scrollLeft = timeToX(track, clipsRef.current, anchor.ms) - anchor.viewOffset;
  }, [zoom, innerWidth, pps]);

  useLayoutEffect(() => {
    if (skipFollow.current) {
      skipFollow.current = false;
      return;
    }
    if (holdLayout != null || drag.current || zoom <= 1) return;
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
      clientX != null
        ? (snappedPlayhead(trackRef.current, clipsRef.current, clientX, false) ?? playheadMsRef.current)
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
    if (zoomRef.current === MIN_ZOOM) return;
    pendingAnchor.current = { ms: playheadMsRef.current, viewOffset: (scrollerRef.current?.clientWidth ?? 0) / 2 };
    skipFollow.current = true;
    zoomRef.current = MIN_ZOOM;
    setZoom(MIN_ZOOM);
  }, []);

  useImperativeHandle(ref, () => ({ zoomBy: applyZoom, zoomFit }), [applyZoom, zoomFit]);

  useEffect(() => {
    if (!clips.length && zoomRef.current !== MIN_ZOOM) setZoom(MIN_ZOOM);
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
      if (zoomRef.current <= 1) return;
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
        const ms = snappedPlayhead(trackRef.current, clipsRef.current, event.clientX);
        if (ms != null) onScrubRef.current(ms);
        return;
      }

      if (session.kind === "move") {
        const nextIndex = indexFromClientX(trackRef.current, event.clientX, clipsRef.current.length);
        dropIndexRef.current = nextIndex;
        setDropIndex(nextIndex);
        return;
      }

      const ppsNow = session.duration > 0 ? session.width / session.duration : 0;
      const deltaMs = ppsNow > 0 ? dx / ppsNow : 0;
      const threshold = snapThresholdMs(ppsNow);
      const clip = clipsRef.current.find((item) => item.id === session.id);
      const source = clip ? sourcesRef.current[clip.sourceId] : undefined;
      if (!clip || !source) return;
      const start = clipStartMs(clipsRef.current, session.index);
      const sourceAtPlayhead = session.originIn + (session.snapPlayheadMs - start);
      if (session.kind === "in") {
        const targets = [0];
        if (sourceAtPlayhead > 0 && sourceAtPlayhead < session.originOut - MIN_CLIP_MS) {
          targets.push(sourceAtPlayhead);
        }
        const prev = clipsRef.current[session.index - 1];
        if (prev && prev.sourceId === clip.sourceId) targets.push(prev.outMs);
        const nextIn = clamp(
          snapValue(session.originIn + deltaMs, targets, threshold),
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
        const targets = [source.durationMs];
        if (sourceAtPlayhead > session.originIn + MIN_CLIP_MS) {
          targets.push(sourceAtPlayhead);
        }
        const nextClip = clipsRef.current[session.index + 1];
        if (nextClip && nextClip.sourceId === clip.sourceId) targets.push(nextClip.inMs);
        const nextOut = clamp(
          snapValue(session.originOut + deltaMs, targets, threshold),
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
        onTrimEndRef.current();
      }
      if (session?.kind === "playhead") {
        const ms = snappedPlayhead(trackRef.current, clipsRef.current, event.clientX);
        if (ms != null) onSeekRef.current(ms);
      } else if (session && !session.moved && session.kind === "move") {
        const ms = snappedPlayhead(trackRef.current, clipsRef.current, event.clientX);
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
      duration: total,
      width: trackRef.current?.getBoundingClientRect().width ?? 1,
      moved: false,
      snapPlayheadMs: playheadMs,
    };
    const ms = snappedPlayhead(trackRef.current, clips, event.clientX);
    if (ms != null) onScrub(ms);
  };

  const ticks = useMemo(() => rulerTicks(layoutTotal, pps), [layoutTotal, pps]);

  return (
    <div className="rmt-timeline">
      <div className="rmt-timeline__bar">
        <div className="rmt-timeline__hint">
          {total <= 0
            ? "Drop a video, send a recording, or open a file."
            : `${Math.max(1, Math.round(total / 1000))}s · ←/→ scrub · pinch or ${modKey()}+scroll to zoom`}
        </div>
        <div className="rmt-timeline__zoom" role="group" aria-label="Timeline zoom">
          <button
            type="button"
            className="rmt-btn rmt-btn--icon"
            disabled={zoom <= MIN_ZOOM || !clips.length}
            aria-label="Zoom out"
            aria-keyshortcuts="Minus"
            title="Zoom out (–)"
            onClick={() => applyZoom(1 / 1.25)}
          >
            −
          </button>
          <span className="rmt-timeline__zoom-label" aria-live="polite" aria-atomic="true">
            {formatZoom(zoom)}
          </span>
          <button
            type="button"
            className="rmt-btn rmt-btn--icon"
            disabled={zoom >= MAX_ZOOM || !clips.length}
            aria-label="Zoom in"
            aria-keyshortcuts="Equal"
            title="Zoom in (=)"
            onClick={() => applyZoom(1.25)}
          >
            +
          </button>
          <button
            type="button"
            className="rmt-btn"
            disabled={zoom <= MIN_ZOOM || !clips.length}
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
                style={{ left: TRACK_PAD_PX + tick.ms * pps }}
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
            {clips.map((clip, index) => {
              const source = sources[clip.sourceId];
              const duration = Math.max(1, clip.outMs - clip.inMs);
              const thumb = thumbs?.[clip.id] ?? source?.thumb;
              const locked = holdLayout != null;
              const trimming = locked && drag.current?.id === clip.id;
              const width = holdLayout?.widths[clip.id] ?? Math.max(36, duration * pps);
              return (
                <div
                  key={clip.id}
                  role="group"
                  aria-label={`${source?.name ?? "Clip"}, ${formatLength(clip.outMs - clip.inMs)}`}
                  aria-current={selectedId === clip.id ? "true" : undefined}
                  className={[
                    "rmt-clip",
                    selectedId === clip.id ? "is-selected" : "",
                    dropIndex === index ? "is-drop-target" : "",
                    trimming ? "is-trimming" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    flexGrow: 0,
                    flexShrink: 0,
                    flexBasis: `${width}px`,
                    width,
                    minWidth: 36,
                  }}
                  onPointerDown={(event) => {
                    if ((event.target as HTMLElement).closest(".rmt-clip__trim")) return;
                    event.stopPropagation();
                    onSelect(clip.id);
                    drag.current = {
                      kind: "move",
                      id: clip.id,
                      index,
                      startX: event.clientX,
                      originIn: clip.inMs,
                      originOut: clip.outMs,
                      duration,
                      width: event.currentTarget.getBoundingClientRect().width,
                      moved: false,
                      snapPlayheadMs: playheadMs,
                    };
                  }}
                >
                  <button
                    type="button"
                    className="rmt-clip__trim rmt-clip__trim--in"
                    tabIndex={-1}
                    aria-label="Trim start"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onSelect(clip.id);
                      const host = event.currentTarget.parentElement;
                      const hostWidth = host?.getBoundingClientRect().width ?? 1;
                      drag.current = {
                        kind: "in",
                        id: clip.id,
                        index,
                        startX: event.clientX,
                        originIn: clip.inMs,
                        originOut: clip.outMs,
                        duration,
                        width: hostWidth,
                        moved: false,
                        snapPlayheadMs: playheadMs,
                      };
                      skipFollow.current = true;
                      setHoldLayout(captureHoldLayout());
                      setTrimTip({
                        edge: "in",
                        inMs: clip.inMs,
                        outMs: clip.outMs,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  />
                  <div className="rmt-clip__body">
                    {thumb && <img src={thumb} alt="" draggable={false} />}
                    {source?.peaks && (
                      <ClipWaveform peaks={source.peaks} inMs={clip.inMs} outMs={clip.outMs} />
                    )}
                    <span className="rmt-clip__name">{source?.name ?? "Clip"}</span>
                    <span className="rmt-clip__length">{formatLength(clip.outMs - clip.inMs)}</span>
                    <span className="rmt-clip__range">
                      {formatPrecise(clip.inMs)}–{formatPrecise(clip.outMs)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rmt-clip__trim rmt-clip__trim--out"
                    tabIndex={-1}
                    aria-label="Trim end"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onSelect(clip.id);
                      const host = event.currentTarget.parentElement;
                      const hostWidth = host?.getBoundingClientRect().width ?? 1;
                      drag.current = {
                        kind: "out",
                        id: clip.id,
                        index,
                        startX: event.clientX,
                        originIn: clip.inMs,
                        originOut: clip.outMs,
                        duration,
                        width: hostWidth,
                        moved: false,
                        snapPlayheadMs: playheadMs,
                      };
                      skipFollow.current = true;
                      setHoldLayout(captureHoldLayout());
                      setTrimTip({
                        edge: "out",
                        inMs: clip.inMs,
                        outMs: clip.outMs,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  />
                </div>
              );
            })}
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

function playheadLeftRef(scroller: HTMLDivElement | null): number {
  if (!scroller) return 0;
  const playhead = scroller.querySelector<HTMLElement>(".rmt-timeline__playhead");
  if (!playhead) return scroller.clientWidth / 2;
  return playhead.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
}

function clipElements(track: HTMLDivElement | null): HTMLElement[] {
  if (!track) return [];
  return [...track.querySelectorAll<HTMLElement>(".rmt-clip")];
}

function timeToX(track: HTMLDivElement | null, clips: EditorClip[], ms: number): number {
  if (!track || !clips.length) return TRACK_PAD_PX;
  const hit = locateClip(clips, ms);
  const el = hit ? clipElements(track)[hit.index] : null;
  if (!hit || !el) return TRACK_PAD_PX;
  const duration = Math.max(1, clipDuration(hit.clip));
  return el.offsetLeft + (hit.offsetMs / duration) * el.offsetWidth;
}

function timeFromClientX(
  track: HTMLDivElement | null,
  clips: EditorClip[],
  clientX: number,
): number | null {
  if (!track || !clips.length) return null;
  const elements = clipElements(track);
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    const el = elements[i];
    if (!clip || !el) continue;
    const rect = el.getBoundingClientRect();
    const isLast = i === clips.length - 1;
    if (clientX < rect.right || isLast) {
      const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
      return clipStartMs(clips, i) + ratio * clipDuration(clip);
    }
  }
  return totalFrom(clips);
}

function snappedPlayhead(
  track: HTMLDivElement | null,
  clips: EditorClip[],
  clientX: number,
  snap = true,
): number | null {
  const ms = timeFromClientX(track, clips, clientX);
  if (ms == null) return null;
  if (!snap) return ms;
  const total = totalFrom(clips);
  const width = track?.getBoundingClientRect().width ?? 1;
  const threshold = snapThresholdMs(width / Math.max(total, 1));
  return snapValue(ms, cutTimes(clips), threshold);
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
  return clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
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
