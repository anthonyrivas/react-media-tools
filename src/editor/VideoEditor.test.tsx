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
  })),
  extractThumbnail: vi.fn(async () => null),
  rasterizeClip: vi.fn(),
}));

vi.mock("./waveform", () => ({
  extractPeaks: vi.fn(async () => null),
  paintWaveform: vi.fn(),
}));

const exportTimeline = vi.fn();
vi.mock("./exportTimeline", () => ({
  exportTimeline: (...args: unknown[]) => exportTimeline(...args),
}));

import { VideoEditor } from "./VideoEditor";

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
});
