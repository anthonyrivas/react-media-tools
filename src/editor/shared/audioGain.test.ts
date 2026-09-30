import { describe, expect, it, vi } from "vitest";
import type { EditorClip } from "../../types";
import {
  MAX_GAIN,
  NORMALIZE_PEAK,
  UNITY_GAIN,
  applyEnvelopeToBuffer,
  clampFades,
  clipGain,
  envelopeAt,
  normalizedVolume,
  peakOfBuffer,
  withClampedAudio,
} from "./audioGain";

class TestAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  private channels: Float32Array[];

  constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
    this.length = options.length;
    this.numberOfChannels = options.numberOfChannels;
    this.sampleRate = options.sampleRate;
    this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
  }

  getChannelData(channel: number) {
    return this.channels[channel] ?? new Float32Array(this.length);
  }
}

if (typeof AudioBuffer === "undefined") {
  vi.stubGlobal("AudioBuffer", TestAudioBuffer);
}

function clip(extra: Partial<EditorClip> = {}): EditorClip {
  return { id: "c", sourceId: "s", inMs: 0, outMs: 1000, ...extra };
}

function bufferFrom(samples: number[], sampleRate = 4): AudioBuffer {
  const audio = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate });
  audio.getChannelData(0).set(samples);
  return audio;
}

describe("audioGain", () => {
  it("treats omitted volume as unity and mute as silence", () => {
    expect(clipGain(clip())).toBe(UNITY_GAIN);
    expect(clipGain(clip({ volume: 1.5 }))).toBe(1.5);
    expect(clipGain(clip({ volume: 9 }))).toBe(MAX_GAIN);
    expect(clipGain(clip({ volume: 1.5, muted: true }))).toBe(0);
  });

  it("clamps fades to half the clip so they cannot overlap", () => {
    expect(clampFades(clip({ fadeInMs: 800, fadeOutMs: 800 }))).toEqual({
      fadeInMs: 500,
      fadeOutMs: 500,
    });
    expect(clampFades(clip({ fadeInMs: -10, fadeOutMs: 80 }))).toEqual({
      fadeInMs: 0,
      fadeOutMs: 80,
    });
  });

  it("ramps linear fade in and out around clip volume", () => {
    const faded = clip({ volume: 0.8, fadeInMs: 200, fadeOutMs: 200 });
    expect(envelopeAt(faded, 0)).toBe(0);
    expect(envelopeAt(faded, 100)).toBeCloseTo(0.4);
    expect(envelopeAt(faded, 500)).toBeCloseTo(0.8);
    expect(envelopeAt(faded, 900)).toBeCloseTo(0.4);
    expect(envelopeAt(faded, 1000)).toBe(0);
    expect(envelopeAt(clip({ muted: true, fadeInMs: 200 }), 100)).toBe(0);
  });

  it("applies the envelope to a copied AudioBuffer", () => {
    const source = bufferFrom([1, 1, 1, 1], 4);
    const faded = clip({ outMs: 1000, fadeInMs: 500, fadeOutMs: 0 });
    const out = applyEnvelopeToBuffer(source, faded, 0);
    expect(out).not.toBe(source);
    expect([...out.getChannelData(0)].map((n) => Number(n.toFixed(2)))).toEqual([0, 0.5, 1, 1]);
    expect(peakOfBuffer(out)).toBe(1);
  });

  it("picks a volume that hits the normalize peak without exceeding max gain", () => {
    expect(normalizedVolume(0.5)).toBeCloseTo(NORMALIZE_PEAK / 0.5);
    expect(normalizedVolume(0)).toBe(UNITY_GAIN);
    expect(normalizedVolume(0.01)).toBe(MAX_GAIN);
  });

  it("fills omitted audio fields when clamping a clip", () => {
    expect(withClampedAudio(clip())).toMatchObject({
      volume: 1,
      muted: false,
      fadeInMs: 0,
      fadeOutMs: 0,
    });
  });
});
