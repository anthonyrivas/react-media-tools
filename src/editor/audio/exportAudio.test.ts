import { describe, expect, it, vi } from "vitest";

vi.mock("mediabunny", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mediabunny")>();
  class FakeOutput {
    state = "pending";
    addAudioTrack(): void {}
    async start() {
      this.state = "started";
    }
    async finalize() {
      this.state = "finalized";
    }
    async cancel() {
      this.state = "canceled";
    }
  }
  return {
    ...actual,
    Quality: class {
      constructor(public q: string) {}
    },
    Mp4OutputFormat: class {
      mimeType = "audio/mp4";
      getSupportedAudioCodecs() {
        return ["aac"];
      }
    },
    WebMOutputFormat: class {
      mimeType = "audio/webm";
      getSupportedAudioCodecs() {
        return ["opus"];
      }
    },
    BufferTarget: class {
      buffer = new Uint8Array([9, 8, 7]).buffer;
    },
    Output: FakeOutput,
    AudioBufferSource: class {
      async add() {}
      close() {}
    },
    getFirstEncodableAudioCodec: async (_codecs: string[]) => _codecs[0] ?? null,
  };
});

import { conformAudioBuffer, exportAudioTimeline, measureClipPeak } from "./exportAudio";

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

function mono(samples: number[], sampleRate = 48000): AudioBuffer {
  const audio = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate });
  audio.getChannelData(0).set(samples);
  return audio;
}

describe("exportAudioTimeline", () => {
  it("refuses an empty timeline", async () => {
    await expect(exportAudioTimeline({ clips: [] })).rejects.toThrow(/at least one clip/);
  });

  it("pads silence when a clip has no decodable audio", async () => {
    const progress = vi.fn();
    const result = await exportAudioTimeline({
      clips: [{ id: "a", sourceId: "src", inMs: 0, outMs: 250, file: new Blob(["not audio"]) }],
      onProgress: progress,
    });
    expect(result.mimeType).toMatch(/^audio\//);
    expect(result.filename).toMatch(/^audio-/);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(progress).toHaveBeenCalledWith(1);
  });

  it("skips decode for a muted clip and still writes a pad", async () => {
    const result = await exportAudioTimeline({
      clips: [{ id: "a", sourceId: "src", inMs: 0, outMs: 120, muted: true, file: new Blob(["not audio"]) }],
    });
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("aborts before mixing clips", async () => {
    await expect(
      exportAudioTimeline({
        clips: [{ id: "a", sourceId: "src", inMs: 0, outMs: 200, file: new Blob(["x"]) }],
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("measureClipPeak", () => {
  it("returns 0 when the blob has no decodable audio", async () => {
    await expect(measureClipPeak(new Blob(["not audio"]), 0, 1000)).resolves.toBe(0);
  });
});

describe("conformAudioBuffer", () => {
  it("upmixes mono 48 kHz to stereo without changing the samples", () => {
    const src = mono([0.1, 0.2, 0.3, 0.4]);
    const out = conformAudioBuffer(src);
    expect(out).not.toBe(src);
    expect(out.numberOfChannels).toBe(2);
    expect(out.sampleRate).toBe(48000);
    for (const channel of [0, 1] as const) {
      const data = out.getChannelData(channel);
      expect(data[0]).toBeCloseTo(0.1);
      expect(data[1]).toBeCloseTo(0.2);
      expect(data[2]).toBeCloseTo(0.3);
      expect(data[3]).toBeCloseTo(0.4);
    }
  });

  it("returns the same buffer when it is already stereo 48 kHz", () => {
    const src = new AudioBuffer({ length: 2, numberOfChannels: 2, sampleRate: 48000 });
    expect(conformAudioBuffer(src)).toBe(src);
  });

  it("resamples to 48 kHz so a slower source still matches the encoder layout", () => {
    const src = mono([1, -1], 24000);
    const out = conformAudioBuffer(src);
    expect(out.sampleRate).toBe(48000);
    expect(out.numberOfChannels).toBe(2);
    expect(out.length).toBe(4);
    expect(out.getChannelData(0)[0]).toBeCloseTo(1);
    expect(out.getChannelData(0)[out.length - 1]).toBeCloseTo(-1);
  });
});
