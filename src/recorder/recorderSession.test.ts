import { describe, expect, it, vi } from "vitest";
import { recordingDurationMs, createSerialQueue, pauseMediaRecorder, resumeMediaRecorder, appendRecorderChunk } from "./recorderSession";
import { liveAudioTracks, captureTracks } from "./composerCapture";
import { sourceCanvasSize, DEFAULT_CANVAS, liveVideoImage } from "./composerVideo";

describe("recordingDurationMs", () => {
  it("returns the last take while idle or previewing", () => {
    expect(
      recordingDurationMs({ status: "idle", startedAt: 100, pausedAt: 0, pausedMs: 0, lastDurationMs: 40 }),
    ).toBe(40);
    expect(
      recordingDurationMs({ status: "preview", startedAt: 0, pausedAt: 0, pausedMs: 0 }),
    ).toBe(0);
  });

  it("subtracts paused time while recording", () => {
    expect(
      recordingDurationMs({
        status: "recording",
        startedAt: 1000,
        pausedAt: 0,
        pausedMs: 200,
        now: 1800,
      }),
    ).toBe(600);
  });

  it("includes the open pause interval while paused", () => {
    expect(
      recordingDurationMs({
        status: "paused",
        startedAt: 1000,
        pausedAt: 1500,
        pausedMs: 100,
        now: 1800,
      }),
    ).toBe(400);
  });
});

describe("sourceCanvasSize", () => {
  it("prefers the screen size, then camera, then the default", () => {
    expect(
      sourceCanvasSize({
        screen: true,
        camera: true,
        screenWidth: 1920,
        screenHeight: 1080,
        cameraWidth: 640,
        cameraHeight: 360,
      }),
    ).toEqual({ width: 1920, height: 1080 });
    expect(
      sourceCanvasSize({
        screen: false,
        camera: true,
        screenWidth: 0,
        screenHeight: 0,
        cameraWidth: 640,
        cameraHeight: 360,
      }),
    ).toEqual({ width: 640, height: 360 });
    expect(
      sourceCanvasSize({
        screen: false,
        camera: false,
        screenWidth: 0,
        screenHeight: 0,
        cameraWidth: 0,
        cameraHeight: 0,
      }),
    ).toEqual(DEFAULT_CANVAS);
  });
});

describe("capture mix", () => {
  it("keeps only live audio tracks", () => {
    const live = { kind: "audio", readyState: "live" } as MediaStreamTrack;
    const ended = { kind: "audio", readyState: "ended" } as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [live, ended],
    } as MediaStream;
    expect(liveAudioTracks(stream)).toEqual([live]);
    expect(liveAudioTracks(null)).toEqual([]);
  });

  it("mixes canvas video with optional audio dest tracks", () => {
    const video = { kind: "video" } as MediaStreamTrack;
    const audio = { kind: "audio" } as MediaStreamTrack;
    const capture = { getVideoTracks: () => [video] } as MediaStream;
    const dest = { stream: { getAudioTracks: () => [audio] } } as MediaStreamAudioDestinationNode;
    expect(captureTracks(capture, dest, true)).toEqual([video, audio]);
    expect(captureTracks(capture, dest, false)).toEqual([video]);
  });
});

describe("createSerialQueue", () => {
  it("runs work in order even when the first job is still pending", async () => {
    const { enqueue } = createSerialQueue();
    const order: number[] = [];
    let release!: () => void;
    const first = enqueue(async () => {
      order.push(1);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push(2);
      return "a";
    });
    const second = enqueue(async () => {
      order.push(3);
      return "b";
    });
    await Promise.resolve();
    expect(order).toEqual([1]);
    release();
    await expect(first).resolves.toBe("a");
    await expect(second).resolves.toBe("b");
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("pauseMediaRecorder / resumeMediaRecorder", () => {
  it("no-ops unless a recorder is in the matching state", () => {
    const pause = vi.fn();
    const resume = vi.fn();
    expect(pauseMediaRecorder(null, "recording")).toBeNull();
    expect(pauseMediaRecorder({ pause } as unknown as MediaRecorder, "paused")).toBeNull();
    expect(pauseMediaRecorder({} as MediaRecorder, "recording")).toBeNull();
    expect(resumeMediaRecorder(null, "paused", 10, 0)).toBeNull();
    expect(resumeMediaRecorder({ resume } as unknown as MediaRecorder, "recording", 10, 0)).toBeNull();
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("pauses a live recorder and resumes a paused one", () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const pausedAt = pauseMediaRecorder({ pause, state: "recording" } as unknown as MediaRecorder, "recording");
    expect(pause).toHaveBeenCalled();
    expect(pausedAt).toEqual(expect.any(Number));
    vi.spyOn(performance, "now").mockReturnValue(1080);
    const next = resumeMediaRecorder(
      { resume, state: "paused" } as unknown as MediaRecorder,
      "paused",
      1000,
      50,
    );
    expect(resume).toHaveBeenCalled();
    expect(next).toEqual({ pausedMs: 130 });
    vi.restoreAllMocks();
  });
});

describe("appendRecorderChunk", () => {
  it("skips empty blobs", () => {
    const chunks: Blob[] = [];
    appendRecorderChunk(chunks, { data: new Blob([]) } as BlobEvent);
    appendRecorderChunk(chunks, { data: new Blob(["take"]) } as BlobEvent);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.size).toBeGreaterThan(0);
  });
});

describe("liveVideoImage", () => {
  it("returns the element only when enabled, ready, and sized", () => {
    const video = { readyState: 2, videoWidth: 640 } as HTMLVideoElement;
    expect(liveVideoImage(false, video)).toBeNull();
    expect(liveVideoImage(true, { readyState: 1, videoWidth: 640 } as HTMLVideoElement)).toBeNull();
    expect(liveVideoImage(true, { readyState: 2, videoWidth: 0 } as HTMLVideoElement)).toBeNull();
    expect(liveVideoImage(true, video)).toBe(video);
  });
});
