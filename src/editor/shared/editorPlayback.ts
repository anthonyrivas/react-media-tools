import type { MutableRefObject } from "react";
import type { EditorClip } from "../../types";
import { waitForEvent } from "../../utils";
import { envelopeAt } from "./audioGain";
import { seekTo } from "./editorDom";
import {
  audioClipEnd,
  audioClipStart,
  clamp,
  clipDuration,
  clipStartMs,
} from "../timeline/timelineMath";

export function sameSourceCutContinues(
  prev: EditorClip | undefined,
  next: EditorClip,
  loadedSourceId: string | null,
  mediaTimeMs: number,
): boolean {
  if (!prev) return false;
  return (
    prev.sourceId === next.sourceId &&
    loadedSourceId === next.sourceId &&
    mediaTimeMs < next.outMs &&
    next.inMs - mediaTimeMs < 500
  );
}

export function playheadFromClipTime(clips: EditorClip[], index: number, sourceTimeMs: number): number | null {
  const clip = clips[index];
  if (!clip || sourceTimeMs < clip.inMs) return null;
  return clipStartMs(clips, index) + (sourceTimeMs - clip.inMs);
}

export function extraAudioAtPlayhead(
  clip: EditorClip,
  ms: number,
): { inRange: boolean; local: number; gain: number; targetSeconds: number } {
  const start = audioClipStart(clip);
  const end = audioClipEnd(clip);
  const inRange = ms >= start && ms < end;
  const local = clamp(ms - start, 0, clipDuration(clip));
  const gain = inRange ? envelopeAt(clip, local) : 0;
  return { inRange, local, gain, targetSeconds: (clip.inMs + local) / 1000 };
}

export function applyExtraAudioElement(
  el: HTMLAudioElement,
  frame: { inRange: boolean; gain: number; targetSeconds: number },
  source: { id: string; url: string },
  gainNode: GainNode | undefined,
  autoplay: boolean,
): void {
  el.muted = false;
  if (gainNode) gainNode.gain.value = frame.gain;
  else el.volume = Math.min(1, Math.max(0, frame.gain));
  if (el.dataset.sourceId !== source.id) {
    el.src = source.url;
    el.dataset.sourceId = source.id;
  }
  if (!frame.inRange || frame.gain <= 0) {
    if (!el.paused) el.pause();
    return;
  }
  if (Math.abs(el.currentTime - frame.targetSeconds) > 0.08) el.currentTime = frame.targetSeconds;
  if (autoplay) {
    if (el.paused) void el.play().catch(() => undefined);
  } else if (!el.paused) {
    el.pause();
  }
}

export function clearMediaElement(media: HTMLMediaElement | null): void {
  if (!media) return;
  media.pause();
  media.removeAttribute("src");
  media.load();
}

type GraphRefs = {
  audioCtxRef: MutableRefObject<AudioContext | null>;
  gainNodeRef: MutableRefObject<GainNode | null>;
  mediaSourceRef: MutableRefObject<MediaElementAudioSourceNode | null>;
};

export function webAudioContext(): typeof AudioContext | undefined {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

export function attachElementGraph(
  media: HTMLMediaElement,
  refs: GraphRefs,
  options?: { initialGain?: number; resume?: boolean },
): void {
  if (refs.mediaSourceRef.current) {
    if (options?.resume) void refs.audioCtxRef.current?.resume();
    return;
  }
  const AudioCtx = webAudioContext();
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const gain = ctx.createGain();
    const source = ctx.createMediaElementSource(media);
    source.connect(gain);
    gain.connect(ctx.destination);
    refs.audioCtxRef.current = ctx;
    refs.gainNodeRef.current = gain;
    refs.mediaSourceRef.current = source;
    if (options?.initialGain != null) gain.gain.value = options.initialGain;
    if (options?.resume) void ctx.resume();
  } catch {
    refs.mediaSourceRef.current = null;
  }
}

export async function cueMediaClip(input: {
  media: HTMLMediaElement;
  sourceId: string;
  url: string;
  targetSeconds: number;
  autoplay: boolean;
  gen: number;
  syncGen: () => number;
  loadedSourceIdRef: MutableRefObject<string | null>;
  connectGraph: () => void;
  afterConnect?: () => void;
  resume?: () => void;
}): Promise<void> {
  const {
    media,
    sourceId,
    url,
    targetSeconds,
    autoplay,
    gen,
    syncGen,
    loadedSourceIdRef,
    connectGraph,
    afterConnect,
    resume,
  } = input;
  try {
    connectGraph();
    afterConnect?.();
    if (autoplay) resume?.();
    if (loadedSourceIdRef.current !== sourceId) {
      media.src = url;
      loadedSourceIdRef.current = sourceId;
      await waitForEvent(media, "loadeddata", 5000);
    }
    if (gen !== syncGen()) return;
    if (Math.abs(media.currentTime - targetSeconds) > 0.08) {
      await seekTo(media, targetSeconds);
    }
    if (gen !== syncGen()) return;
    if (autoplay) {
      if (media.paused) await media.play();
    } else {
      media.pause();
    }
  } catch {
    if (gen === syncGen() && !autoplay) media.pause();
  }
}
