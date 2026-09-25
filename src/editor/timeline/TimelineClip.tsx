import { useCallback, useLayoutEffect, useRef, type MutableRefObject, type PointerEvent } from "react";
import type { EditorClip } from "../../types";
import { formatPrecise } from "../../utils";
import { clamp } from "./timelineMath";
import type { WaveformPeaks } from "../shared/waveform";
import { paintWaveform } from "../shared/waveform";
import { timelineClipView } from "./timelineClipView";
import {
  type DragSession,
  type FadeTip,
  type HoldLayout,
  type TrimTip,
  clipDragSession,
  formatLength,
} from "./timelineView";

export type TimelineClipSource = {
  name?: string;
  peaks?: WaveformPeaks;
  hasAudio?: boolean;
};

type TimelineClipProps = {
  variant: "video" | "audio";
  clip: EditorClip;
  index: number;
  start: number;
  source?: TimelineClipSource;
  thumb?: string;
  selected: boolean;
  dropTarget?: boolean;
  snapTarget: boolean;
  holdLayout: HoldLayout | null;
  drag: MutableRefObject<DragSession | null>;
  pps: number;
  playheadMs: number;
  allowFades: boolean;
  clips: EditorClip[];
  onSelect: (id: string) => void;
  beginTrim: (
    event: PointerEvent<HTMLButtonElement>,
    kind: "in" | "out",
    clip: EditorClip,
    index: number,
    start: number,
    duration: number,
    fades: { fadeInMs: number; fadeOutMs: number },
  ) => void;
  setFadeTip: (tip: FadeTip | null) => void;
};

export function TimelineClip({
  variant,
  clip,
  index,
  start,
  source,
  thumb,
  selected,
  dropTarget,
  snapTarget,
  holdLayout,
  drag,
  pps,
  playheadMs,
  allowFades,
  clips,
  onSelect,
  beginTrim,
  setFadeTip,
}: TimelineClipProps) {
  const view = timelineClipView({
    variant,
    clip,
    start,
    source,
    selected,
    dropTarget,
    snapTarget,
    holdLayout,
    drag: drag.current,
    pps,
    allowFades,
    clips,
  });

  const beginFade = (event: PointerEvent<HTMLButtonElement>, edge: "in" | "out") => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(clip.id);
    const host = event.currentTarget.parentElement;
    drag.current = clipDragSession({
      kind: edge === "in" ? "fadeIn" : "fadeOut",
      clip,
      index,
      clientX: event.clientX,
      originStart: variant === "audio" ? start : 0,
      duration: view.duration,
      width: host?.getBoundingClientRect().width ?? 1,
      snapPlayheadMs: playheadMs,
      fades: view.fades,
    });
    setFadeTip({
      edge,
      ms: edge === "in" ? view.fades.fadeInMs : view.fades.fadeOutMs,
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <div
      data-clip-id={clip.id}
      role="group"
      aria-label={view.ariaLabel}
      aria-current={selected ? "true" : undefined}
      className={view.className}
      style={{ left: view.left, width: view.width, minWidth: 36 }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest(".rmt-clip__trim, .rmt-clip__fade-handle")) {
          return;
        }
        event.stopPropagation();
        onSelect(clip.id);
        drag.current = clipDragSession({
          kind: variant === "video" ? "move" : "audioMove",
          clip,
          index,
          clientX: event.clientX,
          originStart: variant === "audio" ? start : 0,
          duration: view.duration,
          width: event.currentTarget.getBoundingClientRect().width,
          snapPlayheadMs: playheadMs,
          fades: view.fades,
        });
      }}
    >
      <TrimHandle
        edge="in"
        left={view.inHandleLeft}
        onPointerDown={(event) => beginTrim(event, "in", clip, index, start, view.duration, view.fades)}
      />
      {view.showInAway && <div className="rmt-clip__trim-away" style={{ left: 0, width: view.inAwayWidth }} />}
      {view.showOutAway && (
        <div className="rmt-clip__trim-away" style={{ left: view.outAwayLeft, right: 0 }} />
      )}
      <ClipBody
        variant={variant}
        thumb={thumb}
        showWave={view.showWave}
        peaks={source?.peaks}
        waveInMs={view.waveInMs}
        waveOutMs={view.waveOutMs}
        name={source?.name ?? view.fallbackName}
        displayDuration={view.displayDuration}
        inMs={clip.inMs}
        outMs={clip.outMs}
      />
      {view.fadeUi && (
        <ClipFades fadeInPct={view.fadeInPct} fadeOutPct={view.fadeOutPct} fades={view.fades} onBegin={beginFade} />
      )}
      <TrimHandle
        edge="out"
        left={view.outHandleLeft}
        onPointerDown={(event) => beginTrim(event, "out", clip, index, start, view.duration, view.fades)}
      />
    </div>
  );
}

function TrimHandle({
  edge,
  left,
  onPointerDown,
}: {
  edge: "in" | "out";
  left: number | null;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={["rmt-clip__trim", `rmt-clip__trim--${edge}`, left != null ? "is-dragging" : ""]
        .filter(Boolean)
        .join(" ")}
      data-trim-edge={edge}
      tabIndex={-1}
      aria-label={edge === "in" ? "Trim start" : "Trim end"}
      style={left != null ? { position: "absolute", top: 0, bottom: 0, left } : undefined}
      onPointerDown={onPointerDown}
    />
  );
}

function ClipBody({
  variant,
  thumb,
  showWave,
  peaks,
  waveInMs,
  waveOutMs,
  name,
  displayDuration,
  inMs,
  outMs,
}: {
  variant: "video" | "audio";
  thumb?: string;
  showWave: boolean;
  peaks?: WaveformPeaks;
  waveInMs: number;
  waveOutMs: number;
  name: string;
  displayDuration: number;
  inMs: number;
  outMs: number;
}) {
  return (
    <div className="rmt-clip__body">
      {thumb && <img src={thumb} alt="" draggable={false} />}
      {showWave && peaks && <ClipWaveform peaks={peaks} inMs={waveInMs} outMs={waveOutMs} />}
      <span className="rmt-clip__name">{name}</span>
      <span className="rmt-clip__length">{formatLength(displayDuration)}</span>
      {variant === "video" && (
        <span className="rmt-clip__range">
          {formatPrecise(inMs)}–{formatPrecise(outMs)}
        </span>
      )}
    </div>
  );
}

function ClipFades({
  fadeInPct,
  fadeOutPct,
  fades,
  onBegin,
}: {
  fadeInPct: number;
  fadeOutPct: number;
  fades: { fadeInMs: number; fadeOutMs: number };
  onBegin: (event: PointerEvent<HTMLButtonElement>, edge: "in" | "out") => void;
}) {
  return (
    <>
      {fades.fadeInMs > 0 && (
        <div className="rmt-clip__fade rmt-clip__fade--in" style={{ width: `${fadeInPct}%` }} aria-hidden="true" />
      )}
      {fades.fadeOutMs > 0 && (
        <div className="rmt-clip__fade rmt-clip__fade--out" style={{ width: `${fadeOutPct}%` }} aria-hidden="true" />
      )}
      <button
        type="button"
        className="rmt-clip__fade-handle rmt-clip__fade-handle--in"
        tabIndex={-1}
        aria-label="Fade in"
        style={{ left: `max(28px, ${fadeInPct}%)` }}
        onPointerDown={(event) => onBegin(event, "in")}
      />
      <button
        type="button"
        className="rmt-clip__fade-handle rmt-clip__fade-handle--out"
        tabIndex={-1}
        aria-label="Fade out"
        style={{ right: `max(28px, ${fadeOutPct}%)` }}
        onPointerDown={(event) => onBegin(event, "out")}
      />
    </>
  );
}

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

export function TrimTooltip({ tip }: { tip: TrimTip }) {
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

export function FadeTooltip({ tip }: { tip: FadeTip }) {
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
