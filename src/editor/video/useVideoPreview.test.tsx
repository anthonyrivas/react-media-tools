import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorClip } from "../../types";
import { useVideoPreview } from "./useVideoPreview";

vi.mock("../shared/editorPlayback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/editorPlayback")>();
  return {
    ...actual,
    cueMediaClip: vi.fn(async (input) => {
      input.loadedSourceIdRef.current = input.sourceId;
      input.connectGraph();
      input.afterConnect?.();
      input.resume?.();
      if (input.autoplay) await input.media.play().catch(() => undefined);
    }),
  };
});

import { cueMediaClip } from "../shared/editorPlayback";

afterEach(() => {
  cleanup();
  vi.mocked(cueMediaClip).mockClear();
});

function videoClip(id: string, inMs: number, outMs: number): EditorClip {
  return { id, sourceId: "src", inMs, outMs };
}

function extraClip(id: string, startMs: number, durationMs: number): EditorClip {
  return {
    id,
    sourceId: "audio",
    inMs: 0,
    outMs: durationMs,
    kind: "audio",
    startMs,
  };
}

async function frames(count = 2) {
  await act(async () => {
    for (let i = 0; i < count; i++) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
  });
}

function PreviewHarness({ clips }: { clips: EditorClip[] }) {
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const sourcesRef = useRef<Record<string, { id: string; url: string }>>({
    src: { id: "src", url: "blob:take" },
    audio: { id: "audio", url: "blob:vo" },
  });
  const playheadRef = useRef(0);
  const [playhead, setPlayheadState] = useState(0);
  const setPlayhead = useCallback((ms: number) => {
    playheadRef.current = ms;
    setPlayheadState(ms);
    return ms;
  }, []);
  const [playing, setPlayingState] = useState(false);
  const playingRef = useRef(false);
  const setPlaying = useCallback((update: boolean | ((current: boolean) => boolean)) => {
    const next = typeof update === "function" ? update(playingRef.current) : update;
    playingRef.current = next;
    setPlayingState(next);
  }, []);
  const clipIndexRef = useRef(0);
  const loadedSourceIdRef = useRef<string | null>(null);
  const syncGenRef = useRef(0);
  const seekingRef = useRef(false);
  const skipClipSyncRef = useRef(false);

  const preview = useVideoPreview({
    clips,
    clipsRef,
    sourcesRef,
    playheadRef,
    setPlayhead,
    playing,
    playingRef,
    setPlaying,
    clipIndexRef,
    loadedSourceIdRef,
    syncGenRef,
    seekingRef,
    skipClipSyncRef,
  });

  return (
    <div>
      <video data-testid="picture" ref={preview.videoRef} />
      {preview.extraAudio.map((clip) => (
        <audio
          key={clip.id}
          data-testid={`extra-${clip.id}`}
          ref={(node) => {
            if (node) preview.extraAudioEls.current.set(clip.id, node);
            else preview.extraAudioEls.current.delete(clip.id);
          }}
        />
      ))}
      <button type="button" onClick={() => preview.togglePlay()}>
        Play
      </button>
      <button type="button" onClick={() => preview.seek(1500)}>
        Seek past picture
      </button>
      <span data-testid="blank">{String(preview.blankPicture)}</span>
      <span data-testid="head">{playhead}</span>
      <span data-testid="clip-index">{clipIndexRef.current}</span>
      <span data-testid="playing">{String(playing)}</span>
    </div>
  );
}

describe("useVideoPreview", () => {
  it("plays extra-track audio from togglePlay before the clock starts", async () => {
    const user = userEvent.setup();
    render(
      <PreviewHarness
        clips={[videoClip("v1", 0, 2000), extraClip("a1", 0, 2000)]}
      />,
    );
    const extra = screen.getByTestId("extra-a1") as HTMLAudioElement;
    let paused = true;
    Object.defineProperty(extra, "paused", { configurable: true, get: () => paused });
    const play = vi.spyOn(extra, "play").mockImplementation(async () => {
      paused = false;
    });

    await user.click(screen.getByRole("button", { name: "Play" }));

    expect(play).toHaveBeenCalled();
  });

  it("shows a blank frame when seeking past the picture", async () => {
    const user = userEvent.setup();
    render(
      <PreviewHarness
        clips={[videoClip("v1", 0, 1000), extraClip("a1", 0, 2500)]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Seek past picture" }));

    await waitFor(() => expect(screen.getByTestId("blank")).toHaveTextContent("true"));
    expect(screen.getByTestId("head")).toHaveTextContent("1500");
  });

  it("keeps extra audio going on a blank tail after the last picture clip", async () => {
    const user = userEvent.setup();
    render(
      <PreviewHarness
        clips={[videoClip("v1", 0, 1000), extraClip("a1", 800, 2000)]}
      />,
    );
    const extra = screen.getByTestId("extra-a1") as HTMLAudioElement;
    let paused = true;
    Object.defineProperty(extra, "paused", { configurable: true, get: () => paused });
    vi.spyOn(extra, "play").mockImplementation(async () => {
      paused = false;
    });
    vi.spyOn(extra, "pause").mockImplementation(() => {
      paused = true;
    });

    await user.click(screen.getByRole("button", { name: "Play" }));
    await frames(2);

    const video = screen.getByTestId("picture") as HTMLVideoElement;
    await act(async () => {
      video.currentTime = 1;
    });
    await frames(3);

    expect(screen.getByTestId("blank")).toHaveTextContent("true");
    expect(screen.getByTestId("playing")).toHaveTextContent("true");
    expect(paused).toBe(false);
  });

  it("continues a same-source cut without cueing the next clip", async () => {
    const user = userEvent.setup();
    render(<PreviewHarness clips={[videoClip("v1", 0, 1000), videoClip("v2", 1000, 2000)]} />);

    await user.click(screen.getByRole("button", { name: "Play" }));
    await frames(2);
    const cues = vi.mocked(cueMediaClip).mock.calls.length;
    expect(cues).toBeGreaterThan(0);

    const video = screen.getByTestId("picture") as HTMLVideoElement;
    await act(async () => {
      video.currentTime = 1;
    });
    await frames(3);

    expect(screen.getByTestId("clip-index")).toHaveTextContent("1");
    expect(Number(screen.getByTestId("head").textContent)).toBeGreaterThanOrEqual(1000);
    expect(vi.mocked(cueMediaClip).mock.calls.length).toBe(cues);
  });

  it("rewinds from the end on play", async () => {
    const user = userEvent.setup();
    render(<PreviewHarness clips={[videoClip("v1", 0, 2000)]} />);
    await user.click(screen.getByRole("button", { name: "Seek past picture" }));
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByTestId("head")).toHaveTextContent("0");
  });

  it("does not start playback with an empty timeline", async () => {
    const user = userEvent.setup();
    render(<PreviewHarness clips={[]} />);
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });
});
