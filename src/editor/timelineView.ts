import type { EditorClip } from "../types";
import { formatClock, formatPrecise } from "../utils";
import {
  MIN_CLIP_MS,
  TRACK_PAD_PX,
  audioTrackClips,
  canSnapTrimToHovered,
  clamp,
  clipDuration,
  clipStartMs,
  cutTimes,
  hoveredTrimSourceTimes,
  hoveredTrimUsesBothEdges,
  isAudioClip,
  snapThresholdMs,
  snapValue,
  timelineDuration,
  timelineMsAtX,
  videoTrackClips,
} from "./timelineMath";

export type DragSession = {
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

export type HoldLayout = {
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

export type TrimTip = {
  edge: "in" | "out";
  inMs: number;
  outMs: number;
  x: number;
  y: number;
};

export type FadeTip = {
  edge: "in" | "out";
  ms: number;
  x: number;
  y: number;
};

export type ZoomAnchor = {
  ms: number;
  viewOffset: number;
};

export function clipDragSession(input: {
  kind: DragSession["kind"];
  clip: EditorClip;
  index: number;
  clientX: number;
  originStart: number;
  duration: number;
  width: number;
  snapPlayheadMs: number;
  fades: { fadeInMs: number; fadeOutMs: number };
  grabOffsetMs?: number;
}): DragSession {
  return {
    kind: input.kind,
    id: input.clip.id,
    index: input.index,
    startX: input.clientX,
    originIn: input.clip.inMs,
    originOut: input.clip.outMs,
    originFadeIn: input.fades.fadeInMs,
    originFadeOut: input.fades.fadeOutMs,
    originStart: input.originStart,
    duration: input.duration,
    width: input.width,
    moved: false,
    snapPlayheadMs: input.snapPlayheadMs,
    grabOffsetMs: input.grabOffsetMs,
  };
}

export function innerOriginLeft(scroller: HTMLElement | null): number {
  const inner = scroller?.querySelector<HTMLElement>(".rmt-timeline__inner");
  return (inner ?? scroller)?.getBoundingClientRect().left ?? 0;
}

export function heldClipBox(
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

export function draggingHandleLeft(
  session: DragSession | null,
  clip: EditorClip,
  edge: "in" | "out",
  pps: number,
): number | null {
  if (!session || session.id !== clip.id || session.kind !== edge) return null;
  if (edge === "in") return (clip.inMs - session.originIn) * pps;
  return (clip.outMs - session.originIn) * pps - 24;
}

export function hoveredTrimHandle(
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
    const edge =
      handle.getAttribute("data-trim-edge") === "in" || handle.classList.contains("rmt-clip__trim--in")
        ? "in"
        : "out";
    return { clip: hovered, edge };
  }
  return null;
}

export function hoveredTrimClip(
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

export function playheadLeftRef(scroller: HTMLDivElement | null): number {
  if (!scroller) return 0;
  const playhead = scroller.querySelector<HTMLElement>(".rmt-timeline__playhead");
  if (!playhead) return scroller.clientWidth / 2;
  return playhead.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
}

export function clipElements(track: HTMLDivElement | null): HTMLElement[] {
  if (!track) return [];
  return [...track.querySelectorAll<HTMLElement>(".rmt-clip--video")];
}

export function playheadFromPointer(
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

export function indexFromClientX(track: HTMLDivElement | null, clientX: number, count: number): number {
  const elements = clipElements(track);
  for (let i = 0; i < count; i += 1) {
    const el = elements[i];
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return i;
  }
  return count;
}

export function formatLength(ms: number): string {
  const hundredths = Math.floor(Math.max(0, ms) / 10) / 100;
  if (hundredths >= 60) return formatPrecise(ms);
  return `${hundredths.toFixed(2)}s`;
}

export function formatZoom(zoom: number): string {
  const rounded = zoom >= 10 ? zoom.toFixed(0) : zoom.toFixed(1);
  return `${rounded}×`;
}

export function tickStep(pps: number): number {
  const minPx = 72;
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
  return steps.find((ms) => ms * pps >= minPx) ?? 300000;
}

export function rulerTicks(total: number, pps: number): { ms: number; label: string }[] {
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

export function frozenStartMs(hold: HoldLayout | null, clips: EditorClip[], id: string): number {
  if (hold?.starts[id] != null) return hold.starts[id]!;
  return clipStartMs(clips, clips.findIndex((item) => item.id === id));
}

export function frozenEndMs(hold: HoldLayout | null, clips: EditorClip[], item: EditorClip): number {
  return frozenStartMs(hold, clips, item.id) + (hold?.durations[item.id] ?? clipDuration(item));
}

export function fadeFromDelta(
  session: DragSession,
  deltaMs: number,
): { fadeInMs: number; fadeOutMs: number; edge: "in" | "out"; ms: number } {
  const maxFade = session.duration / 2;
  const fadeInMs =
    session.kind === "fadeIn" ? clamp(session.originFadeIn + deltaMs, 0, maxFade) : session.originFadeIn;
  const fadeOutMs =
    session.kind === "fadeOut" ? clamp(session.originFadeOut - deltaMs, 0, maxFade) : session.originFadeOut;
  const edge = session.kind === "fadeIn" ? "in" : "out";
  return { fadeInMs, fadeOutMs, edge, ms: edge === "in" ? fadeInMs : fadeOutMs };
}

export function nextTrimFromPointer(input: {
  session: DragSession;
  clip: EditorClip;
  clips: EditorClip[];
  sourceDurationMs: number;
  cursorMs: number;
  pps: number;
  hold: HoldLayout | null;
  hoveredHandle: { clip: EditorClip; edge: "in" | "out" } | null;
  hovered: EditorClip | null;
}): { inMs: number; outMs: number; edge: "in" | "out"; snapId: string | null } | null {
  const { session, clip, clips, sourceDurationMs, cursorMs, pps, hold, hoveredHandle, hovered } = input;
  if (session.kind !== "in" && session.kind !== "out") return null;
  const track = isAudioClip(clip) ? audioTrackClips(clips) : videoTrackClips(clips);
  const trackIndex = track.findIndex((item) => item.id === clip.id);
  const start = session.originStart;
  const proposedSource = session.originIn + (cursorMs - start);
  const sourceAtPlayhead = session.originIn + (session.snapPlayheadMs - start);
  const threshold = snapThresholdMs(pps);
  let hoverTargets: number[] = [];
  if (hoveredHandle) {
    const hoveredTime =
      hoveredHandle.edge === "in"
        ? frozenStartMs(hold, clips, hoveredHandle.clip.id)
        : frozenEndMs(hold, clips, hoveredHandle.clip);
    hoverTargets.push(session.originIn + (hoveredTime - start));
  } else if (hovered) {
    hoverTargets = hoveredTrimSourceTimes({
      edge: session.kind,
      originIn: session.originIn,
      clipStartMs: start,
      hoveredStartMs: frozenStartMs(hold, clips, hovered.id),
      hoveredEndMs: frozenEndMs(hold, clips, hovered),
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
    const nextIn = clamp(snapValue(proposedSource, targets, threshold), 0, session.originOut - MIN_CLIP_MS);
    return { inMs: nextIn, outMs: session.originOut, edge: "in", snapId: hovered?.id ?? null };
  }
  const targets = [sourceDurationMs, ...hoverTargets];
  if (sourceAtPlayhead > session.originIn + MIN_CLIP_MS) {
    targets.push(sourceAtPlayhead);
  }
  const nextClip = track[trackIndex + 1];
  if (nextClip && nextClip.sourceId === clip.sourceId) targets.push(nextClip.inMs);
  const nextOut = clamp(
    snapValue(proposedSource, targets, threshold),
    session.originIn + MIN_CLIP_MS,
    sourceDurationMs,
  );
  return { inMs: session.originIn, outMs: nextOut, edge: "out", snapId: hovered?.id ?? null };
}
