import { useCallback, useLayoutEffect, useRef, type MutableRefObject, type PointerEvent } from "react";
import type { EditorClip } from "../../types";
import { formatPrecise } from "../../utils";
import { clampFades } from "../shared/audioGain";
import { clamp, hasDetachedAudio } from "./timelineMath";
import type { WaveformPeaks } from "../shared/waveform";
import { paintWaveform } from "../shared/waveform";
import {
  type DragSession,
  type FadeTip,
  type HoldLayout,
  type TrimTip,
  clipDragSession,
  draggingHandleLeft,
  formatLength,
  heldClipBox,
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
  const duration = Math.max(1, clip.outMs - clip.inMs);
  const locked = holdLayout != null;
  const draggingTrim =
    drag.current?.id === clip.id && (drag.current?.kind === "in" || drag.current?.kind === "out");
  const trimming = variant === "video" ? locked && drag.current?.id === clip.id : draggingTrim;
  const { left, width } = heldClipBox(holdLayout, clip.id, start, duration, pps);
  const inHandleLeft = draggingHandleLeft(drag.current, clip, "in", pps);
  const outHandleLeft = draggingHandleLeft(drag.current, clip, "out", pps);
  const originIn = drag.current?.originIn ?? clip.inMs;
  const displayDuration = holdLayout?.durations[clip.id] ?? duration;
  const fades = clampFades(clip);
  const fadeBase = variant === "video" ? displayDuration : duration;
  const fadeInPct = (fades.fadeInMs / fadeBase) * 100;
  const fadeOutPct = (fades.fadeOutMs / fadeBase) * 100;
  const detached = variant === "video" && hasDetachedAudio(clips, clip.id);
  const playableAudio = source?.hasAudio !== false && !detached;
  const fadeUi = allowFades && (variant === "audio" || playableAudio);
  const fallbackName = variant === "video" ? "Clip" : "Audio";
  const showWave =
    variant === "audio" ? Boolean(source?.peaks) : Boolean(source?.peaks && !clip.muted && playableAudio);

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
      duration,
      width: host?.getBoundingClientRect().width ?? 1,
      snapPlayheadMs: playheadMs,
      fades,
    });
    setFadeTip({
      edge,
      ms: edge === "in" ? fades.fadeInMs : fades.fadeOutMs,
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <div
      data-clip-id={clip.id}
      role="group"
      aria-label={`${source?.name ?? fallbackName}, ${formatLength(variant === "video" ? clip.outMs - clip.inMs : duration)}`}
      aria-current={selected ? "true" : undefined}
      className={[
        "rmt-clip",
        variant === "video" ? "rmt-clip--video" : "rmt-clip--audio",
        selected ? "is-selected" : "",
        dropTarget ? "is-drop-target" : "",
        trimming ? "is-trimming" : "",
        snapTarget ? "is-trim-snap" : "",
        clip.muted && (variant === "audio" || !detached) ? "is-muted" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ left, width, minWidth: 36 }}
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
          duration,
          width: event.currentTarget.getBoundingClientRect().width,
          snapPlayheadMs: playheadMs,
          fades,
        });
      }}
    >
      <TrimHandle
        edge="in"
        left={inHandleLeft}
        onPointerDown={(event) => beginTrim(event, "in", clip, index, start, duration, fades)}
      />
      {draggingTrim && drag.current?.kind === "in" && (
        <div className="rmt-clip__trim-away" style={{ left: 0, width: Math.max(0, (clip.inMs - originIn) * pps) }} />
      )}
      {draggingTrim && drag.current?.kind === "out" && (
        <div
          className="rmt-clip__trim-away"
          style={{ left: Math.max(0, (clip.outMs - originIn) * pps), right: 0 }}
        />
      )}
      <div className="rmt-clip__body">
        {thumb && <img src={thumb} alt="" draggable={false} />}
        {showWave && source?.peaks && (
          <ClipWaveform
            peaks={source.peaks}
            inMs={draggingTrim ? originIn : clip.inMs}
            outMs={draggingTrim ? (drag.current?.originOut ?? clip.outMs) : clip.outMs}
          />
        )}
        <span className="rmt-clip__name">{source?.name ?? fallbackName}</span>
        <span className="rmt-clip__length">{formatLength(displayDuration)}</span>
        {variant === "video" && (
          <span className="rmt-clip__range">
            {formatPrecise(clip.inMs)}–{formatPrecise(clip.outMs)}
          </span>
        )}
      </div>
      {fadeUi && (
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
            onPointerDown={(event) => beginFade(event, "in")}
          />
          <button
            type="button"
            className="rmt-clip__fade-handle rmt-clip__fade-handle--out"
            tabIndex={-1}
            aria-label="Fade out"
            style={{ right: `max(28px, ${fadeOutPct}%)` }}
            onPointerDown={(event) => beginFade(event, "out")}
          />
        </>
      )}
      <TrimHandle
        edge="out"
        left={outHandleLeft}
        onPointerDown={(event) => beginTrim(event, "out", clip, index, start, duration, fades)}
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
