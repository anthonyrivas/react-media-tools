import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioEditorHandle } from "./AudioEditor";

vi.mock("./probe", () => ({
  probeMedia: vi.fn(async () => ({
    durationMs: 2000,
    width: 0,
    height: 0,
    hasAudio: true,
  })),
}));

vi.mock("./waveform", () => ({
  extractPeaks: vi.fn(async () => null),
  paintWaveform: vi.fn(),
}));

const exportAudioTimeline = vi.fn();
const measureClipPeak = vi.fn(async () => 0.5);
vi.mock("./exportAudio", () => ({
  exportAudioTimeline: (...args: unknown[]) => exportAudioTimeline(...args),
  measureClipPeak: (...args: unknown[]) => measureClipPeak(...args),
}));

import { AudioEditor } from "./AudioEditor";
import { NORMALIZE_PEAK } from "./audioGain";

const exported = {
  blob: new Blob(["edit"]),
  mimeType: "audio/mp4",
  filename: "audio.m4a",
  durationMs: 2000,
  width: 0,
  height: 0,
};

describe("AudioEditor", () => {
  afterEach(() => {
    cleanup();
    exportAudioTimeline.mockReset();
    measureClipPeak.mockReset();
    measureClipPeak.mockResolvedValue(0.5);
  });

  it("ingests a source, uses custom export copy, and exports", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const onChange = vi.fn();
    const ref = createRef<AudioEditorHandle>();
    exportAudioTimeline.mockResolvedValue(exported);

    render(
      <AudioEditor
        ref={ref}
        exportLabel="Save audio"
        downloadLabel="Get file"
        showDownload
        showOpenFile
        onExport={onExport}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("No clips yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save audio" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get file" })).toBeDisabled();

    await ref.current?.addSource({
      file: new Blob(["audio"], { type: "audio/webm" }),
      name: "Take 1",
      durationMs: 2000,
    });

    await waitFor(() => expect(screen.getByText("Take 1")).toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save audio" })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "Gain" })).toHaveValue("100");

    await user.click(screen.getByRole("button", { name: "Save audio" }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith(exported));
    expect(exportAudioTimeline).toHaveBeenCalled();
  });

  it("mutes the selected clip and normalizes its gain", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const ref = createRef<AudioEditorHandle>();
    render(<AudioEditor ref={ref} onChange={onChange} />);

    await ref.current?.addSource({
      file: new Blob(["audio"], { type: "audio/webm" }),
      name: "Take 1",
      durationMs: 2000,
    });
    await waitFor(() => expect(screen.getByText("Take 1")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Mute" }));
    expect(screen.getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");
    expect(onChange.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({ muted: true });

    await user.click(screen.getByRole("button", { name: "Normalize" }));
    await waitFor(() => {
      expect(measureClipPeak).toHaveBeenCalled();
      const clips = onChange.mock.calls.at(-1)?.[0] as Array<{ volume?: number; muted?: boolean }>;
      expect(clips[0]?.muted).toBe(false);
      expect(clips[0]?.volume).toBeCloseTo(NORMALIZE_PEAK / 0.5);
    });
  });

  it("splits at the playhead after the editor is focused", async () => {
    const user = userEvent.setup();
    const ref = createRef<AudioEditorHandle>();
    render(<AudioEditor ref={ref} />);

    await ref.current?.addSource({
      file: new Blob(["audio"], { type: "audio/webm" }),
      name: "Take 1",
      durationMs: 2000,
    });
    await waitFor(() => expect(screen.getByText("Take 1")).toBeInTheDocument());

    await user.click(screen.getByRole("region", { name: "Audio editor" }));
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await user.keyboard("s");

    await waitFor(() => {
      expect(screen.getAllByText("Take 1")).toHaveLength(2);
    });
  });
});
