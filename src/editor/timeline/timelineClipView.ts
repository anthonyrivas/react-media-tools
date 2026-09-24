import type { EditorClip } from "../../types";
import { clampFades } from "../shared/audioGain";
import { hasDetachedAudio } from "./timelineMath";
import {
  type DragSession,
  type HoldLayout,
  draggingHandleLeft,
  formatLength,
  heldClipBox,
} from "./timelineView";

export type TimelineClipView = {
  duration: number;
  trimming: boolean;
  draggingTrim: boolean;
  left: number;
  width: number;
  inHandleLeft: number | null;
  outHandleLeft: number | null;
  originIn: number;
  originOut: number;
  displayDuration: number;
  fades: { fadeInMs: number; fadeOutMs: number };
  fadeInPct: number;
  fadeOutPct: number;
  fadeUi: boolean;
  fallbackName: string;
  showWave: boolean;
  waveInMs: number;
  waveOutMs: number;
  className: string;
  ariaLabel: string;
  showInAway: boolean;
  showOutAway: boolean;
  inAwayWidth: number;
  outAwayLeft: number;
};

export function timelineClipView(options: {
  variant: "video" | "audio";
  clip: EditorClip;
  start: number;
  source?: { name?: string; peaks?: unknown; hasAudio?: boolean };
  selected: boolean;
  dropTarget?: boolean;
  snapTarget: boolean;
  holdLayout: HoldLayout | null;
  drag: DragSession | null;
  pps: number;
  allowFades: boolean;
  clips: EditorClip[];
}): TimelineClipView {
  const { variant, clip, start, source, selected, dropTarget, snapTarget, holdLayout, drag, pps, allowFades, clips } =
    options;
  const duration = Math.max(1, clip.outMs - clip.inMs);
  const locked = holdLayout != null;
  const draggingTrim = drag?.id === clip.id && (drag.kind === "in" || drag.kind === "out");
  const trimming = variant === "video" ? locked && drag?.id === clip.id : draggingTrim;
  const { left, width } = heldClipBox(holdLayout, clip.id, start, duration, pps);
  const originIn = drag?.originIn ?? clip.inMs;
  const originOut = drag?.originOut ?? clip.outMs;
  const displayDuration = holdLayout?.durations[clip.id] ?? duration;
  const fades = clampFades(clip);
  const fadeBase = variant === "video" ? displayDuration : duration;
  const detached = variant === "video" && hasDetachedAudio(clips, clip.id);
  const playableAudio = source?.hasAudio !== false && !detached;
  const fadeUi = allowFades && (variant === "audio" || playableAudio);
  const fallbackName = variant === "video" ? "Clip" : "Audio";
  const showWave =
    variant === "audio" ? Boolean(source?.peaks) : Boolean(source?.peaks && !clip.muted && playableAudio);

  return {
    duration,
    trimming,
    draggingTrim,
    left,
    width,
    inHandleLeft: draggingHandleLeft(drag, clip, "in", pps),
    outHandleLeft: draggingHandleLeft(drag, clip, "out", pps),
    originIn,
    originOut,
    displayDuration,
    fades,
    fadeInPct: (fades.fadeInMs / fadeBase) * 100,
    fadeOutPct: (fades.fadeOutMs / fadeBase) * 100,
    fadeUi,
    fallbackName,
    showWave,
    waveInMs: draggingTrim ? originIn : clip.inMs,
    waveOutMs: draggingTrim ? originOut : clip.outMs,
    className: timelineClipClassName({
      variant,
      selected,
      dropTarget,
      trimming,
      snapTarget,
      muted: Boolean(clip.muted && (variant === "audio" || !detached)),
    }),
    ariaLabel: `${source?.name ?? fallbackName}, ${formatLength(variant === "video" ? clip.outMs - clip.inMs : duration)}`,
    showInAway: draggingTrim && drag?.kind === "in",
    showOutAway: draggingTrim && drag?.kind === "out",
    inAwayWidth: Math.max(0, (clip.inMs - originIn) * pps),
    outAwayLeft: Math.max(0, (clip.outMs - originIn) * pps),
  };
}

function timelineClipClassName(options: {
  variant: "video" | "audio";
  selected: boolean;
  dropTarget?: boolean;
  trimming: boolean;
  snapTarget: boolean;
  muted: boolean;
}): string {
  return [
    "rmt-clip",
    options.variant === "video" ? "rmt-clip--video" : "rmt-clip--audio",
    options.selected ? "is-selected" : "",
    options.dropTarget ? "is-drop-target" : "",
    options.trimming ? "is-trimming" : "",
    options.snapTarget ? "is-trim-snap" : "",
    options.muted ? "is-muted" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
