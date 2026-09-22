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
    const pictureClip = document.querySelector(".rmt-clip--video");
    expect(pictureClip).toBeTruthy();
    await user.click(pictureClip as HTMLElement);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Gain" })).toBeDisabled();
    expect(screen.getByText("No audio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Normalize" })).toBeDisabled();

    const audioClip = document.querySelector(".rmt-clip--audio");
    expect(audioClip).toBeTruthy();
    await user.click(audioClip as HTMLElement);
    expect(screen.getByRole("slider", { name: "Gain" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Normalize" })).toBeEnabled();
  });

  it("disables mixer controls on silent video sources", async () => {
    vi.mocked(probeMedia).mockResolvedValueOnce({
      durationMs: 2000,
      width: 640,
      height: 360,
      hasAudio: false,
      hasVideo: true,
    });
    const ref = createRef<VideoEditorHandle>();
    render(<VideoEditor ref={ref} />);

    await ref.current?.addSource({
      file: new Blob(["video"]),
      name: "Silent",
      durationMs: 2000,
      width: 640,
      height: 360,
    });
    await waitFor(() => expect(screen.getByText("Silent")).toBeInTheDocument());

    expect(screen.getByRole("slider", { name: "Gain" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mute" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Normalize" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unlink audio" })).toBeDisabled();
    expect(screen.getByText("No audio")).toBeInTheDocument();
  });

  it("optionally splits picture and extra audio at the playhead", async () => {
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
    await user.click(screen.getByRole("region", { name: "Video editor" }));
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await user.click(screen.getByRole("button", { name: "Split all tracks" }));

    await waitFor(() => {
      const clips = onChange.mock.calls.at(-1)?.[0] as Array<{
        id: string;
        kind?: string;
        linkedClipId?: string;
        outMs: number;
        inMs: number;
        startMs?: number;
      }>;
      const videos = clips.filter((clip) => clip.kind !== "audio");
      const audios = clips.filter((clip) => clip.kind === "audio");
      expect(videos).toHaveLength(2);
      expect(audios).toHaveLength(2);
      expect(videos[0]?.outMs).toBe(videos[1]?.inMs);
      expect(audios[0]?.linkedClipId).toBe(videos[0]?.id);
      expect(audios[1]?.linkedClipId).toBe(videos[1]?.id);
      expect(audios[1]?.startMs).toBe(videos[0]?.outMs);
    });
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

  it("stacks overlapping extra-audio clips onto extra rows", async () => {
    vi.mocked(probeMedia)
      .mockResolvedValueOnce({
        durationMs: 2000,
        width: 640,
        height: 360,
        hasAudio: true,
        hasVideo: true,
      })
      .mockResolvedValueOnce({
        durationMs: 1500,
        width: 0,
        height: 0,
        hasAudio: true,
        hasVideo: false,
      })
      .mockResolvedValueOnce({
        durationMs: 800,
        width: 0,
        height: 0,
        hasAudio: true,
        hasVideo: false,
      });
    const ref = createRef<VideoEditorHandle>();
    render(<VideoEditor ref={ref} />);

    await ref.current?.addSource({
      file: new Blob(["video"]),
      name: "Take 1",
      durationMs: 2000,
      width: 640,
      height: 360,
    });
    await waitFor(() => expect(screen.getByText("Take 1")).toBeInTheDocument());
    await ref.current?.addSource({
      file: new Blob(["audio"], { type: "audio/webm" }),
      name: "VO 1",
      durationMs: 1500,
    });
    await ref.current?.addSource({
      file: new Blob(["audio"], { type: "audio/webm" }),
      name: "VO 2",
      durationMs: 800,
    });

    await waitFor(() => expect(screen.getByText("VO 2")).toBeInTheDocument());
    expect(document.querySelectorAll("[data-audio-row]")).toHaveLength(2);
    expect(screen.getByRole("group", { name: /VO 1/ }).closest("[data-audio-row]")).toHaveAttribute(
      "data-audio-row",
      "0",
    );
    expect(screen.getByRole("group", { name: /VO 2/ }).closest("[data-audio-row]")).toHaveAttribute(
      "data-audio-row",
      "1",
    );
  });

  it("starts extra-track audio on play after unlink", async () => {
    const user = userEvent.setup();
    const extraPlay = vi.fn();
    const playSpy = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      if (this.tagName === "AUDIO") extraPlay();
      return Promise.resolve();
    });
    const pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);

    const ref = createRef<VideoEditorHandle>();
    render(<VideoEditor ref={ref} />);

    await ref.current?.addSource({
      file: new Blob(["video"]),
      name: "Take 1",
      durationMs: 2000,
      width: 640,
      height: 360,
    });
    await waitFor(() => expect(screen.getByText("Take 1")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Unlink audio" }));
    await waitFor(() => expect(document.querySelector("audio")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(extraPlay).toHaveBeenCalled());
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });
});
