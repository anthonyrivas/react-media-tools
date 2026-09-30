import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserCapabilities } from "../../types";
import { requestCamera, requestDisplay } from "../shared/composerCapture";
import { MediaComposer } from "./MediaComposer";

const { fakeStream } = vi.hoisted(() => {
  function fakeTrack(kind: "video" | "audio", id: string) {
    return {
      kind,
      id,
      readyState: "live",
      enabled: true,
      stop: vi.fn(),
      clone() {
        return this;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }

  function fakeStream(id: string): MediaStream {
    const video = fakeTrack("video", `${id}-video`);
    const tracks = [video];
    return {
      getTracks: () => tracks,
      getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
      getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    } as unknown as MediaStream;
  }

  return { fakeStream };
});

vi.mock("./composerVideo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./composerVideo")>();
  return {
    ...actual,
    playVideo: vi.fn(async () => undefined),
  };
});

vi.mock("../shared/composerCapture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/composerCapture")>();
  return {
    ...actual,
    requestCamera: vi.fn(async () => fakeStream("camera")),
    requestDisplay: vi.fn(async () => fakeStream("screen")),
    mixCaptureStream: vi.fn((capture: MediaStream) => capture),
    hintMotion: vi.fn(),
  };
});

function canvas(): HTMLCanvasElement {
  const node = document.createElement("canvas");
  return node;
}

class FakeMediaRecorder {
  state = "inactive";
  mimeType: string;
  stream: MediaStream;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType || "video/webm";
  }

  static isTypeSupported(): boolean {
    return true;
  }

  addEventListener(type: string, fn: EventListener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: EventListener): void {
    this.listeners.get(type)?.delete(fn);
  }

  start(): void {
    this.state = "recording";
  }

  pause(): void {
    this.state = "paused";
  }

  resume(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.listeners.get("stop")?.forEach((fn) => fn(new Event("stop")));
  }
}

const capable: BrowserCapabilities = {
  mediaDevices: true,
  camera: true,
  microphone: true,
  screen: true,
  systemAudio: true,
  mediaRecorder: true,
  canvasCapture: true,
  mimeType: "video/webm",
  notes: {},
};

describe("MediaComposer", () => {
  it("throws when a 2D context is unavailable", () => {
    const node = document.createElement("canvas");
    node.getContext = () => null;
    expect(() => new MediaComposer(node)).toThrow(/2D canvas context/);
  });

  it("clamps overlay updates and notifies subscribers", () => {
    const composer = new MediaComposer(canvas());
    const listener = vi.fn();
    const unsub = composer.subscribe(listener);
    composer.setOverlay({ x: -2, y: 4, width: 0.01 });
    expect(composer.overlay.width).toBe(0.1);
    expect(composer.overlay.x).toBe(0);
    expect(listener).toHaveBeenCalled();
    unsub();
    composer.destroy();
  });

  it("refuses to record when the browser cannot capture", async () => {
    const composer = new MediaComposer(canvas());
    await expect(composer.startRecording()).rejects.toThrow(/not supported/);
    composer.destroy();
  });

  it("keeps source videos in the document so camera frames keep decoding", () => {
    const stage = document.createElement("div");
    const node = canvas();
    stage.appendChild(node);
    document.body.appendChild(stage);
    const composer = new MediaComposer(node);
    expect(stage.querySelectorAll("video.rmt-recorder__source-video")).toHaveLength(2);
    composer.destroy();
    expect(stage.querySelectorAll("video")).toHaveLength(0);
    stage.remove();
  });

  it("releases screen capture when recording stops", async () => {
    const composer = new MediaComposer(canvas());
    const stopTrack = vi.fn();
    const inner = composer as unknown as {
      recorder: {
        state: string;
        mimeType: string;
        addEventListener: (type: string, fn: EventListener) => void;
        removeEventListener: () => void;
        stop: () => void;
      } | null;
      screenStream: MediaStream | null;
      chunks: Blob[];
    };
    const listeners = new Set<EventListener>();
    inner.recorder = {
      state: "recording",
      mimeType: "video/webm",
      addEventListener(type, fn) {
        if (type === "stop") listeners.add(fn);
      },
      removeEventListener() {
        listeners.clear();
      },
      stop() {
        this.state = "inactive";
        listeners.forEach((fn) => fn(new Event("stop")));
      },
    };
    inner.chunks = [new Blob(["take"])];
    inner.screenStream = {
      getTracks: () => [{ stop: stopTrack, readyState: "live" }],
      getVideoTracks: () => [{ stop: stopTrack, readyState: "live", addEventListener: vi.fn() }],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
    composer.screen = true;
    composer.status = "recording";

    await composer.stopRecording();

    expect(stopTrack).toHaveBeenCalled();
    expect(composer.screen).toBe(false);
    expect(composer.status).toBe("idle");
    composer.destroy();
  });
});

class FakeMediaStream {
  tracks: Array<{ kind: string }>;
  constructor(tracks: Array<{ kind: string }> = []) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}

describe("MediaComposer recording session", () => {
  const previousRecorder = globalThis.MediaRecorder;
  const previousStream = (globalThis as { MediaStream?: unknown }).MediaStream;

  function installRecorder() {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("MediaStream", FakeMediaStream);
  }

  afterEach(() => {
    vi.mocked(requestCamera).mockClear();
    vi.mocked(requestDisplay).mockClear();
    if (previousRecorder) vi.stubGlobal("MediaRecorder", previousRecorder);
    else Reflect.deleteProperty(globalThis, "MediaRecorder");
    if (previousStream) vi.stubGlobal("MediaStream", previousStream);
    else Reflect.deleteProperty(globalThis, "MediaStream");
  });

  it("starts with a fake camera track, then pauses and resumes", async () => {
    installRecorder();
    const composer = new MediaComposer(canvas());
    composer.capabilities = { ...capable };

    await composer.startRecording();

    expect(requestCamera).toHaveBeenCalled();
    expect(composer.camera).toBe(true);
    expect(composer.status).toBe("recording");
    expect(composer.sizeLocked).toBe(true);
    const recorder = (composer as unknown as { recorder: FakeMediaRecorder | null }).recorder;
    expect(recorder?.state).toBe("recording");

    composer.pauseRecording();
    expect(composer.status).toBe("paused");
    expect(recorder?.state).toBe("paused");

    composer.resumeRecording();
    expect(composer.status).toBe("recording");
    expect(recorder?.state).toBe("recording");

    composer.destroy();
  });

  it("resumes from startRecording while paused instead of opening a new take", async () => {
    installRecorder();
    const composer = new MediaComposer(canvas());
    composer.capabilities = { ...capable };

    await composer.startRecording();
    const first = (composer as unknown as { recorder: FakeMediaRecorder | null }).recorder;
    composer.pauseRecording();
    await composer.startRecording();

    expect(composer.status).toBe("recording");
    expect((composer as unknown as { recorder: FakeMediaRecorder | null }).recorder).toBe(first);
    expect(first?.state).toBe("recording");
    expect(requestCamera).toHaveBeenCalledTimes(1);

    composer.destroy();
  });

  it("starts from a screen track without opening the camera", async () => {
    installRecorder();
    const composer = new MediaComposer(canvas());
    composer.capabilities = { ...capable };

    await composer.setSource("screen", true);
    expect(requestDisplay).toHaveBeenCalled();
    expect(composer.screen).toBe(true);
    expect(composer.camera).toBe(false);

    await composer.startRecording();
    expect(requestCamera).not.toHaveBeenCalled();
    expect(composer.status).toBe("recording");
    expect(composer.screen).toBe(true);

    composer.destroy();
  });
});
