import type { EditorClip } from "../types";

export const UNITY_GAIN = 1;
export const MAX_GAIN = 2;
/** Target peak for Normalize, about −1 dBFS. */
export const NORMALIZE_PEAK = 10 ** (-1 / 20);

export function clipGain(clip: Pick<EditorClip, "volume" | "muted">): number {
  if (clip.muted) return 0;
  const volume = clip.volume ?? UNITY_GAIN;
  if (!Number.isFinite(volume)) return UNITY_GAIN;
  return Math.min(MAX_GAIN, Math.max(0, volume));
}

export function clipLengthMs(clip: Pick<EditorClip, "inMs" | "outMs">): number {
  return Math.max(0, clip.outMs - clip.inMs);
}

export function clampFades(
  clip: Pick<EditorClip, "inMs" | "outMs" | "fadeInMs" | "fadeOutMs">,
): { fadeInMs: number; fadeOutMs: number } {
  const duration = clipLengthMs(clip);
  if (duration <= 0) return { fadeInMs: 0, fadeOutMs: 0 };
  const maxEach = duration / 2;
  return {
    fadeInMs: Math.min(maxEach, Math.max(0, clip.fadeInMs ?? 0)),
    fadeOutMs: Math.min(maxEach, Math.max(0, clip.fadeOutMs ?? 0)),
  };
}

/** Gain at `localMs` from the clip in-point, including mute, volume, and linear fades. */
export function envelopeAt(clip: EditorClip, localMs: number): number {
  const duration = clipLengthMs(clip);
  const gain = clipGain(clip);
  if (gain === 0 || duration <= 0) return 0;
  const { fadeInMs, fadeOutMs } = clampFades(clip);
  const t = Math.min(duration, Math.max(0, localMs));
  let env = 1;
  if (fadeInMs > 0 && t < fadeInMs) env *= t / fadeInMs;
  const remaining = duration - t;
  if (fadeOutMs > 0 && remaining < fadeOutMs) env *= remaining / fadeOutMs;
  return gain * env;
}

export function applyEnvelopeToBuffer(
  buffer: AudioBuffer,
  clip: EditorClip,
  bufferStartLocalMs: number,
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const out = new AudioBuffer({
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const src = buffer.getChannelData(channel);
    const dst = out.getChannelData(channel);
    for (let i = 0; i < src.length; i += 1) {
      const localMs = bufferStartLocalMs + (i / sampleRate) * 1000;
      dst[i] = (src[i] ?? 0) * envelopeAt(clip, localMs);
    }
  }
  return out;
}

export function peakOfBuffer(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const amp = Math.abs(data[i] ?? 0);
      if (amp > peak) peak = amp;
    }
  }
  return peak;
}

/** Volume that brings `peak` (pre-gain sample peak in 0–1) to `target`. */
export function normalizedVolume(peak: number, target = NORMALIZE_PEAK): number {
  if (!(peak > 0)) return UNITY_GAIN;
  return Math.min(MAX_GAIN, Math.max(0, target / peak));
}

export function withClampedAudio(clip: EditorClip): EditorClip {
  const fades = clampFades(clip);
  return {
    ...clip,
    volume: clipGain({ volume: clip.volume, muted: false }),
    muted: Boolean(clip.muted),
    fadeInMs: fades.fadeInMs,
    fadeOutMs: fades.fadeOutMs,
  };
}
