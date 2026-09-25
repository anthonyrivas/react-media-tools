import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerSnapshot } from "./video/MediaComposer";
import type { VideoRecorderHandle } from "./VideoRecorder";

const { composer, resetComposer } = vi.hoisted(() => {
  const capable: ComposerSnapshot = {
    status: "idle",
    camera: false,
    screen: false,
    microphone: false,
    systemAudio: false,
    systemAudioTrack: false,
    error: null,
    durationMs: 0,
    canvasWidth: 1280,
    canvasHeight: 720,
    overlay: { x: 0.74, y: 0.7, width: 0.22 },
    cameraAspect: 16 / 9,
    capabilities: {
      mediaDevices: true,
      camera: true,
      microphone: true,
      screen: true,
      systemAudio: true,
      mediaRecorder: true,
      canvasCapture: true,
      mimeType: "video/webm",
      notes: {},
    },
    sizeLocked: false,
    hasRecording: false,
  };

  const listeners = new Set<(snap: ComposerSnapshot) => void>();
  let state = { ...capable };
  const recording = {
    blob: new Blob(["take"]),
    mimeType: "video/webm",
    filename: "recording.webm",
    durationMs: 1500,
    width: 1280,
    height: 720,
  };

  const emit = (patch: Partial<ComposerSnapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  };

  const composer = {
    lastRecording: null as typeof recording | null,
    subscribe(listener: (snap: ComposerSnapshot) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    destroy: vi.fn(),
    setSource: vi.fn(async (name: "camera" | "screen" | "microphone" | "systemAudio", enabled: boolean) => {
      emit({
        [name]: enabled,
        status: enabled || state.camera || state.screen ? "preview" : "idle",
      } as Partial<ComposerSnapshot>);
    }),
    startRecording: vi.fn(async () => {
      emit({ status: "recording", camera: true, sizeLocked: true });
    }),
    stopRecording: vi.fn(async () => {
      composer.lastRecording = recording;
      emit({ status: "idle", hasRecording: true, sizeLocked: false });
      return recording;
    }),
    pauseRecording: vi.fn(() => emit({ status: "paused" })),
    resumeRecording: vi.fn(() => emit({ status: "recording" })),
    setOverlay: vi.fn(),
  };

  return {
    composer,
    resetComposer() {
      listeners.clear();
      state = { ...capable };
      composer.lastRecording = null;
      composer.destroy.mockClear();
      composer.setSource.mockClear();
      composer.startRecording.mockClear();
      composer.stopRecording.mockClear();
    },
  };
});

vi.mock("./video/MediaComposer", () => ({
  MediaComposer: vi.fn(function MediaComposer() {
    return composer;
  }),
}));

import { VideoRecorder } from "./VideoRecorder";

describe("VideoRecorder", () => {
  afterEach(() => {
    cleanup();
    resetComposer();
  });

  beforeEach(() => {
    resetComposer();
  });

  it("renders capture controls and starts a take through the handle", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onStop = vi.fn();
    const ref = createRef<VideoRecorderHandle>();
    render(
      <VideoRecorder ref={ref} onRecordingStart={onStart} onRecordingStop={onStop} className="host" />,
    );

    expect(screen.getByRole("region", { name: "Video recorder" })).toHaveClass("host");
    expect(screen.getByRole("button", { name: "Camera" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Camera" }));
    expect(composer.setSource).toHaveBeenCalledWith("camera", true);

    await ref.current?.start();
    expect(onStart).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(onStop).toHaveBeenCalledWith(expect.objectContaining({ filename: "recording.webm" })));
    expect(ref.current?.getLastRecording()?.durationMs).toBe(1500);
  });

  it("hides built-in controls and shows download when asked", () => {
    const { rerender } = render(<VideoRecorder showControls={false} />);
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    rerender(<VideoRecorder showDownload />);
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
  });

  it("surfaces composer errors", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    composer.setSource.mockRejectedValueOnce(new Error("Permission denied"));
    render(<VideoRecorder onError={onError} />);
    await user.click(screen.getByRole("button", { name: "Camera" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Permission denied" })));
  });
});
