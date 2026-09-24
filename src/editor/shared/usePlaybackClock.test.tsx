import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlaybackClock } from "./usePlaybackClock";
import { usePlayheadScrub } from "./usePlayheadScrub";

afterEach(() => {
  cleanup();
});

describe("usePlaybackClock", () => {
  it("ticks while playing and stops when onTick returns false", async () => {
    const onPlay = vi.fn();
    const onEnded = vi.fn();
    const onTick = vi.fn(({ keepPlaying }: { keepPlaying: () => void }) => {
      keepPlaying();
      return onTick.mock.calls.length < 2;
    });
    const media = document.createElement("video");
    vi.spyOn(media, "play").mockResolvedValue(undefined);
    const mediaRef = { current: media };
    const playingRef = { current: true };
    const seekingRef = { current: false };
    const audioCtxRef = { current: { resume: vi.fn() } as unknown as AudioContext };

    function Clock() {
      usePlaybackClock({
        playing: true,
        mediaRef,
        seekingRef,
        playingRef,
        audioCtxRef,
        onPlay,
        onTick,
        onEnded,
      });
      return null;
    }

    render(<Clock />);
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(onPlay).toHaveBeenCalled();
    expect(onTick).toHaveBeenCalled();
    media.dispatchEvent(new Event("ended"));
    expect(onEnded).toHaveBeenCalled();
  });
});

describe("usePlayheadScrub", () => {
  it("coalesces scrubs onto one animation frame", async () => {
    const sync = vi.fn();
    function Scrubber() {
      const queue = usePlayheadScrub(sync);
      useEffect(() => {
        queue(100);
        queue(250);
      }, [queue]);
      return null;
    }
    render(<Scrubber />);
    expect(sync).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(250, false);
  });
});
