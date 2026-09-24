import { describe, expect, it, vi } from "vitest";

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

vi.mock("../shared/probe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/probe")>();
  return { ...actual, rasterizeClip: vi.fn(async () => 0) };
});

vi.mock("mediabunny", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mediabunny")>();

  class FakeOutput {
    state = "pending";
    addVideoTrack(): void {}
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
      mimeType = "video/mp4";
      getSupportedVideoCodecs() {
        return ["avc"];
      }
      getSupportedAudioCodecs() {
        return ["aac"];
      }
    },
    WebMOutputFormat: class {
      mimeType = "video/webm";
      getSupportedVideoCodecs() {
        return ["vp9"];
      }
      getSupportedAudioCodecs() {
        return ["opus"];
      }
    },
    BufferTarget: class {
      buffer = new Uint8Array([1, 2, 3]).buffer;
    },
    Output: FakeOutput,
    CanvasSource: class {
      async add() {}
      close() {}
    },
    AudioBufferSource: class {
      async add() {}
      close() {}
    },
    getFirstEncodableVideoCodec: async (_codecs: string[]) => _codecs[0] ?? null,
    getFirstEncodableAudioCodec: async (_codecs: string[]) => _codecs[0] ?? null,
  };
});

import { exportTimeline, exportTimelineLengthMs, pictureAndExtraClips } from "./exportTimeline";

function picture(extra: { inMs?: number; outMs?: number; muted?: boolean } = {}) {
  return { file: new Blob(["not media"]), inMs: extra.inMs ?? 0, outMs: extra.outMs ?? 200, muted: extra.muted };
}

describe("exportTimeline", () => {
  it("refuses an empty timeline", async () => {
    await expect(exportTimeline({ clips: [], width: 640, height: 360 })).rejects.toThrow(
      /at least one clip/,
    );
  });

  it("refuses extra audio without a picture clip", async () => {
    await expect(
      exportTimeline({
        clips: [{ file: new Blob(), inMs: 0, outMs: 1000, kind: "audio", startMs: 0 }],
        width: 640,
        height: 360,
      }),
    ).rejects.toThrow(/at least one clip/);
  });

  it("splits picture from extra audio and uses the longer of the two for export length", () => {
    const clip = { file: new Blob(), inMs: 0, outMs: 1000 };
    const extra = { file: new Blob(), inMs: 0, outMs: 500, kind: "audio" as const, startMs: 800 };
    expect(pictureAndExtraClips([clip, extra])).toEqual({ picture: [clip], extras: [extra] });
    expect(pictureAndExtraClips([{ ...clip, kind: "video" }]).extras).toEqual([]);
    expect(exportTimelineLengthMs([clip], [extra])).toBe(1300);
    expect(exportTimelineLengthMs([clip], [])).toBe(1000);
  });

  it("writes black frames and a muxed file when the clip cannot decode", async () => {
    const progress = vi.fn();
    const result = await exportTimeline({
      clips: [picture()],
      width: 64,
      height: 36,
      onProgress: progress,
    });
    expect(result.mimeType).toMatch(/video\//);
    expect(result.filename).toMatch(/^edit-/);
    expect(result.width).toBe(64);
    expect(result.height).toBe(36);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(progress).toHaveBeenCalledWith(1);
  });

  it("pads the picture track when extra audio runs longer", async () => {
    const result = await exportTimeline({
      clips: [
        picture({ outMs: 200 }),
        { file: new Blob(["not audio"]), inMs: 0, outMs: 400, kind: "audio", startMs: 300 },
      ],
      width: 32,
      height: 18,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(700);
  });

  it("aborts before writing clips", async () => {
    const signal = AbortSignal.abort();
    await expect(exportTimeline({ clips: [picture()], width: 32, height: 18, signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
