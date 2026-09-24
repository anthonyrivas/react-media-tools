import { describe, expect, it, vi } from "vitest";
import { MediaComposer } from "./MediaComposer";

function canvas(): HTMLCanvasElement {
  const node = document.createElement("canvas");
  return node;
}

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
