import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoEditorHandle } from "./VideoEditor";

vi.mock("./probe", () => ({
  probeMedia: vi.fn(async () => ({
    durationMs: 2000,
    width: 640,
    height: 360,
    hasAudio: true,
    hasVideo: true,
  })),
  extractThumbnail: vi.fn(async () => null),
  rasterizeClip: vi.fn(),
  looksLikeAudioFile: (file: Blob) => file.type.startsWith("audio/"),
}));

vi.mock("./waveform", () => ({
  extractPeaks: vi.fn(async () => null),
  paintWaveform: vi.fn(),
}));

const exportTimeline = vi.fn();
const measureClipPeak = vi.fn(async () => 0.5);
vi.mock("./exportTimeline", () => ({
  exportTimeline: (...args: unknown[]) => exportTimeline(...args),
}));
vi.mock("./exportAudio", () => ({
  measureClipPeak: (...args: unknown[]) => measureClipPeak(...args),
}));

import { probeMedia } from "./probe";
import { VideoEditor } from "./VideoEditor";
import { NORMALIZE_PEAK } from "./audioGain";

const exported = {
  blob: new Blob(["edit"]),
  mimeType: "video/mp4",
  filename: "edit.mp4",
  durationMs: 2000,
  width: 640,
  height: 360,
};

describe("VideoEditor", () => {
  afterEach(() => {
    cleanup();
    exportTimeline.mockReset();
    measureClipPeak.mockReset();
    measureClipPeak.mockResolvedValue(0.5);
  });

  it("ingests a source, uses custom export copy, and exports", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const onChange = vi.fn();
    const ref = createRef<VideoEditorHandle>();
    exportTimeline.mockResolvedValue(exported);

    render(
      <VideoEditor
        ref={ref}
        exportLabel="Save video"
        downloadLabel="Get file"
        showDownload
        showOpenFile
        onExport={onExport}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("No clips yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save video" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get file" })).toBeDisabled();

    await ref.current?.addSource({
      file: new Blob(["video"]),
      name: "Take 1",
      durationMs: 2000,
      width: 640,
      height: 360,
    });

    await waitFor(() => expect(screen.getByText("Take 1")).toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save video" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Save video" }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith(exported));
    expect(exportTimeline).toHaveBeenCalled();
  });

  it("splits at the playhead after the editor is focused", async () => {
    const user = userEvent.setup();
    const ref = createRef<VideoEditorHandle>();
    render(<VideoEditor ref={ref} />);

    await ref.current?.addSource({
      file: new Blob(["video"]),
      name: "Take 1",
      durationMs: 2000,
    });
    await waitFor(() => expect(screen.getByText("Take 1")).toBeInTheDocument());

    await user.click(screen.getByRole("region", { name: "Video editor" }));
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await user.keyboard("s");

    await waitFor(() => {
      expect(screen.getAllByText("Take 1")).toHaveLength(2);
    });
  });

  it("mutes the selected clip and normalizes its gain", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const ref = createRef<VideoEditorHandle>();
    render(<VideoEditor ref={ref} onChange={onChange} />);

    await ref.current?.addSource({
      file: new Blob(["video"]),
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

  it("unlinks clip audio onto the extra track for J and L cuts", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const ref = createRef<VideoEditorHandle>();
    render(<VideoEditor ref={ref} onChange={onChange} />);

    await ref.current?.addSource({
      file: new Blob(["video"]),
      name: "Take 1",
      durationMs: 2000,
    });
    await waitFor(() => expect(screen.getByText("Take 1")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Unlink audio" }));
    await waitFor(() => {
      const clips = onChange.mock.calls.at(-1)?.[0] as Array<{
        id: string;
        kind?: string;
        muted?: boolean;
        linkedClipId?: string;
        startMs?: number;
      }>;
      const picture = clips.find((clip) => clip.kind !== "audio");
      const audio = clips.find((clip) => clip.kind === "audio");
      expect(picture?.muted).toBe(true);
      expect(audio).toMatchObject({ kind: "audio", startMs: 0, linkedClipId: picture?.id });
    });
    expect(screen.getByRole("button", { name: "Unlink audio" })).toBeDisabled();
  });

  it("places audio files on the extra audio track", async () => {
    vi.mocked(probeMedia).mockResolvedValueOnce({
      durationMs: 1500,
      width: 0,
      height: 0,
      hasAudio: true,
      hasVideo: false,
    });
    const onChange = vi.fn();
    const ref = createRef<VideoEditorHandle>();
    render(<VideoEditor ref={ref} onChange={onChange} />);

    await ref.current?.addSource({
      file: new Blob(["audio"], { type: "audio/webm" }),
      name: "VO",
      durationMs: 1500,
    });

    await waitFor(() => expect(screen.getByText("VO")).toBeInTheDocument());
    expect(onChange.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({
      kind: "audio",
      startMs: 0,
    });
    expect(screen.getByRole("group", { name: /VO/ })).toHaveClass("rmt-clip--audio");
  });
});
