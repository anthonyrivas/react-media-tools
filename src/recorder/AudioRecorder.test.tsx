import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioCaptureSnapshot } from "./audio/AudioCapture";
import type { AudioRecorderHandle } from "./AudioRecorder";

const { capture, resetCapture } = vi.hoisted(() => {
  const capable: AudioCaptureSnapshot = {
    status: "idle",
    error: null,
    durationMs: 0,
    hasRecording: false,
    capabilities: {
      microphone: true,
      mediaRecorder: true,
      mimeType: "audio/webm;codecs=opus",
      notes: {},
    },
  };

  const listeners = new Set<(snap: AudioCaptureSnapshot) => void>();
  let state = { ...capable };
  const recording = {
    blob: new Blob(["take"], { type: "audio/webm" }),
    mimeType: "audio/webm",
    filename: "audio.webm",
    durationMs: 2100,
  };

  const emit = (patch: Partial<AudioCaptureSnapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  };

  const capture = {
    lastRecording: null as typeof recording | null,
    subscribe(listener: (snap: AudioCaptureSnapshot) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    destroy: vi.fn(),
    startRecording: vi.fn(async () => {
      emit({ status: "recording" });
    }),
    stopRecording: vi.fn(async () => {
      capture.lastRecording = recording;
      emit({ status: "idle", hasRecording: true, durationMs: recording.durationMs });
      return recording;
    }),
    pauseRecording: vi.fn(() => emit({ status: "paused" })),
    resumeRecording: vi.fn(() => emit({ status: "recording" })),
  };

  return {
    capture,
    resetCapture() {
      listeners.clear();
      state = { ...capable };
      capture.lastRecording = null;
      capture.destroy.mockClear();
      capture.startRecording.mockClear();
      capture.stopRecording.mockClear();
      capture.pauseRecording.mockClear();
      capture.resumeRecording.mockClear();
    },
  };
});

vi.mock("./audio/AudioCapture", () => ({
  AudioCapture: vi.fn(function AudioCapture() {
    return capture;
  }),
}));

import { AudioRecorder } from "./AudioRecorder";

describe("AudioRecorder", () => {
  afterEach(() => {
    cleanup();
    resetCapture();
  });

  beforeEach(() => {
    resetCapture();
  });

  it("records a microphone take through the handle", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onStop = vi.fn();
    const ref = createRef<AudioRecorderHandle>();
    render(
      <AudioRecorder ref={ref} onRecordingStart={onStart} onRecordingStop={onStop} className="host" />,
    );

    expect(screen.getByRole("region", { name: "Audio recorder" })).toHaveClass("host");
    expect(screen.getByRole("region", { name: "Audio recorder" })).toHaveClass("rmt-recorder--audio");
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Camera" })).not.toBeInTheDocument();

    await ref.current?.start();
    expect(onStart).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(onStop).toHaveBeenCalledWith(expect.objectContaining({ filename: "audio.webm" })));
    expect(ref.current?.getLastRecording()?.durationMs).toBe(2100);
    expect(ref.current?.getLastRecording()).not.toHaveProperty("width");
  });

  it("hides built-in controls and shows download when asked", () => {
    const { rerender } = render(<AudioRecorder showControls={false} />);
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    rerender(<AudioRecorder showDownload />);
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
  });

  it("surfaces capture errors", async () => {
    const onError = vi.fn();
    capture.startRecording.mockRejectedValueOnce(new Error("Permission denied"));
    const ref = createRef<AudioRecorderHandle>();
    render(<AudioRecorder ref={ref} onError={onError} />);
    await ref.current?.start();
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Permission denied" })));
  });
});
