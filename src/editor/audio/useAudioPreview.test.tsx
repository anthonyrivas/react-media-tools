import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorClip } from "../../types";
import { useAudioPreview } from "./useAudioPreview";

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

function clip(id: string, inMs: number, outMs: number): EditorClip {
  return { id, sourceId: "src", inMs, outMs };
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

  const preview = useAudioPreview({
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
      <audio data-testid="voice" ref={preview.audioRef} />
      <button type="button" onClick={() => preview.togglePlay()}>
        Play
      </button>
      <button type="button" onClick={() => preview.seek(1900)}>
        Seek near end
      </button>
      <span data-testid="head">{playhead}</span>
      <span data-testid="clip-index">{clipIndexRef.current}</span>
      <span data-testid="playing">{String(playing)}</span>
    </div>
  );
}

describe("useAudioPreview", () => {
  it("rewinds from the end on play", async () => {
    const user = userEvent.setup();
    render(<PreviewHarness clips={[clip("a", 0, 2000)]} />);
    await user.click(screen.getByRole("button", { name: "Seek near end" }));
    expect(screen.getByTestId("head")).toHaveTextContent("1900");

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByTestId("head")).toHaveTextContent("0");
    expect(screen.getByTestId("playing")).toHaveTextContent("true");
  });

  it("does not start playback with an empty timeline", async () => {
    const user = userEvent.setup();
    render(<PreviewHarness clips={[]} />);
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
  });

  it("continues a same-source cut without cueing the next clip", async () => {
    const user = userEvent.setup();
    render(<PreviewHarness clips={[clip("a", 0, 1000), clip("b", 1000, 2000)]} />);

    await user.click(screen.getByRole("button", { name: "Play" }));
    await frames(2);
    const cues = vi.mocked(cueMediaClip).mock.calls.length;
    expect(cues).toBeGreaterThan(0);

    const audio = screen.getByTestId("voice") as HTMLAudioElement;
    await act(async () => {
      audio.currentTime = 1;
    });
    await frames(3);

    expect(screen.getByTestId("clip-index")).toHaveTextContent("1");
    expect(Number(screen.getByTestId("head").textContent)).toBeGreaterThanOrEqual(1000);
    expect(vi.mocked(cueMediaClip).mock.calls.length).toBe(cues);
  });

  it("stops at the last clip instead of wrapping", async () => {
    const user = userEvent.setup();
    render(<PreviewHarness clips={[clip("a", 0, 1000)]} />);

    await user.click(screen.getByRole("button", { name: "Play" }));
    await frames(2);

    const audio = screen.getByTestId("voice") as HTMLAudioElement;
    await act(async () => {
      audio.currentTime = 1;
    });
    await frames(3);

    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(screen.getByTestId("head")).toHaveTextContent("1000");
  });
});
