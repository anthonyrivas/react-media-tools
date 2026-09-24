import type { EditorClip } from "../../types";
import { withClampedAudio } from "./audioGain";
import {
  MIN_CLIP_MS,
  audioClipsAt,
  audioTrackClips,
  clipStartMs,
  duplicateClip,
  hasDetachedAudio,
  isAudioClip,
  locateClip,
  splitAudioClip,
  splitVideoClip,
  videoTrackClips,
} from "../timeline/timelineMath";

export function splitClipsAtPlayhead(
  clips: EditorClip[],
  playhead: number,
  selectedId: string | null,
  allTracks: boolean,
  id: () => string,
): {
  clips: EditorClip[];
  nextSelectedId: string | null;
  videoOldId?: string;
  videoLeft?: EditorClip;
  videoRight?: EditorClip;
} | null {
  const replacements = new Map<string, { left: EditorClip; right: EditorClip }>();

  const takeVideo = () => {
    const hit = locateClip(clips, playhead);
    if (!hit) return;
    const parts = splitVideoClip(hit.clip, hit.offsetMs, id);
    if (parts) replacements.set(hit.clip.id, { left: parts[0], right: parts[1] });
  };

  const takeAudio = (clip: EditorClip) => {
    const parts = splitAudioClip(clip, playhead, id);
    if (parts) replacements.set(clip.id, { left: parts[0], right: parts[1] });
  };

  if (allTracks) {
    takeVideo();
    audioClipsAt(clips, playhead).forEach(takeAudio);
  } else {
    const selected = clips.find((clip) => clip.id === selectedId);
    if (selected && isAudioClip(selected)) takeAudio(selected);
    else takeVideo();
  }

  if (!replacements.size) return null;

  for (const { left, right } of replacements.values()) {
    if (!isAudioClip(left) || !left.linkedClipId) continue;
    const parent = replacements.get(left.linkedClipId);
    if (!parent) continue;
    left.linkedClipId = parent.left.id;
    right.linkedClipId = parent.right.id;
  }

  const next: EditorClip[] = [];
  for (const clip of clips) {
    const parts = replacements.get(clip.id);
    if (parts) next.push(parts.left, parts.right);
    else if (clip.linkedClipId && replacements.has(clip.linkedClipId)) {
      const parent = replacements.get(clip.linkedClipId);
      next.push(parent ? { ...clip, linkedClipId: parent.left.id } : clip);
    } else {
      next.push(clip);
    }
  }

  const selectedParts = replacements.get(selectedId ?? "");
  const videoHit = locateClip(clips, playhead);
  const videoParts = videoHit ? replacements.get(videoHit.clip.id) : undefined;
  return {
    clips: next,
    nextSelectedId: selectedParts?.right.id ?? videoParts?.right.id ?? null,
    videoOldId: videoHit?.clip.id,
    videoLeft: videoParts?.left,
    videoRight: videoParts?.right,
  };
}

export function splitMagneticAtPlayhead(
  clips: EditorClip[],
  playhead: number,
  id: () => string,
): { clips: EditorClip[]; right: EditorClip; index: number } | null {
  const hit = locateClip(clips, playhead);
  if (!hit) return null;
  const local = hit.clip.inMs + hit.offsetMs;
  if (local <= hit.clip.inMs + MIN_CLIP_MS || local >= hit.clip.outMs - MIN_CLIP_MS) return null;
  const left = withClampedAudio({ ...hit.clip, id: id(), outMs: local, fadeOutMs: 0 });
  const right = withClampedAudio({ ...hit.clip, id: id(), inMs: local, fadeInMs: 0 });
  return {
    clips: [...clips.slice(0, hit.index), left, right, ...clips.slice(hit.index + 1)],
    right,
    index: hit.index,
  };
}

export function unlinkPictureAudio(
  clips: EditorClip[],
  clipId: string,
  hasAudio: boolean | undefined,
  id: () => string,
): { clips: EditorClip[]; audioId: string; picture: EditorClip } | null {
  const clip = clips.find((item) => item.id === clipId);
  if (!clip || isAudioClip(clip)) return null;
  if (clips.some((item) => item.linkedClipId === clip.id)) return null;
  if (hasAudio === false) return null;
  const index = clips.findIndex((item) => item.id === clip.id);
  const audio = withClampedAudio({
    id: id(),
    sourceId: clip.sourceId,
    inMs: clip.inMs,
    outMs: clip.outMs,
    volume: clip.volume,
    fadeInMs: clip.fadeInMs,
    fadeOutMs: clip.fadeOutMs,
    kind: "audio",
    startMs: clipStartMs(clips, index),
    linkedClipId: clip.id,
    muted: false,
  });
  return {
    clips: clips
      .map((item) => (item.id === clip.id ? withClampedAudio({ ...item, muted: true }) : item))
      .concat(audio),
    audioId: audio.id,
    picture: clip,
  };
}

export function duplicateAfterSelected(
  clips: EditorClip[],
  selectedId: string | null,
  id: string,
): { clips: EditorClip[]; copy: EditorClip; index: number } | null {
  const index = clips.findIndex((clip) => clip.id === selectedId);
  const clip = clips[index];
  if (!clip) return null;
  const copy = withClampedAudio(duplicateClip(clip, id));
  return {
    clips: [...clips.slice(0, index + 1), copy, ...clips.slice(index + 1)],
    copy,
    index,
  };
}

export function removeSelectedClip(
  clips: EditorClip[],
  selectedId: string | null,
): { clips: EditorClip[]; neighbor: EditorClip | null; index: number } | null {
  if (!selectedId) return null;
  const index = clips.findIndex((clip) => clip.id === selectedId);
  if (index < 0) return null;
  const next = clips.filter((clip) => clip.id !== selectedId);
  return {
    clips: next,
    neighbor: next[index] ?? next[index - 1] ?? null,
    index,
  };
}

export function pictureClip(sourceId: string, durationMs: number, id: string): EditorClip {
  return withClampedAudio({ id, sourceId, inMs: 0, outMs: durationMs });
}

export function extraAudioClip(
  sourceId: string,
  durationMs: number,
  startMs: number,
  id: string,
): EditorClip {
  return withClampedAudio({
    id,
    sourceId,
    inMs: 0,
    outMs: durationMs,
    kind: "audio",
    startMs,
  });
}

export function reorderVideoTrack(clips: EditorClip[], from: number, to: number): EditorClip[] | null {
  if (from === to) return null;
  const video = videoTrackClips(clips);
  const audio = audioTrackClips(clips);
  const next = video.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return null;
  next.splice(to, 0, moved);
  return [...next, ...audio];
}

export function reorderMagneticClips(clips: EditorClip[], from: number, to: number): EditorClip[] | null {
  if (from === to) return null;
  const next = clips.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return null;
  next.splice(to, 0, moved);
  return next;
}

export function playheadForTrim(
  start: number,
  duration: number,
  edge: "in" | "out",
): { playhead: number; local: number } {
  return {
    playhead: edge === "in" ? start : start + duration,
    local: edge === "in" ? 0 : Math.max(0, duration - 40),
  };
}

export function seekAfterRemove(
  clips: EditorClip[],
  neighbor: EditorClip | null,
  index: number,
  playhead: number,
): number | null {
  if (!neighbor || !clips.length) return null;
  if (locateClip(clips, playhead)?.clip.id === neighbor.id) return null;
  return clipStartMs(clips, Math.min(index, clips.length - 1));
}

export function clipsForVideoExport(
  clips: EditorClip[],
  files: Record<string, { file?: Blob; width?: number; height?: number }>,
): {
  clips: Array<{
    file: Blob;
    inMs: number;
    outMs: number;
    volume?: number;
    muted: boolean;
    fadeInMs?: number;
    fadeOutMs?: number;
    kind?: EditorClip["kind"];
    startMs?: number;
  }>;
  width: number;
  height: number;
} {
  const picture = videoTrackClips(clips);
  const first = files[picture[0]?.sourceId ?? ""];
  return {
    clips: clips.map((clip) => ({
      file: files[clip.sourceId]?.file ?? new Blob(),
      inMs: clip.inMs,
      outMs: clip.outMs,
      volume: clip.volume,
      muted: Boolean(clip.muted) || hasDetachedAudio(clips, clip.id),
      fadeInMs: clip.fadeInMs,
      fadeOutMs: clip.fadeOutMs,
      kind: clip.kind,
      startMs: clip.startMs,
    })),
    width: first?.width || 1280,
    height: first?.height || 720,
  };
}
