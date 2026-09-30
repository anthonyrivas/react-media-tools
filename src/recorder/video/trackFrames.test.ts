import { describe, expect, it, vi } from "vitest";
import { pumpTrackFrames, startBackgroundDrawClock } from "./trackFrames";

describe("trackFrames", () => {
  it("no-ops when MediaStreamTrackProcessor is missing", () => {
    const track = { kind: "video", readyState: "live", clone: vi.fn() } as unknown as MediaStreamTrack;
    const stop = pumpTrackFrames(track, () => undefined);
    expect(track.clone).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it("ticks a draw clock", async () => {
    const onTick = vi.fn();
    const stop = startBackgroundDrawClock(onTick, 50);
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    stop();
    expect(onTick.mock.calls.length).toBeGreaterThan(0);
  });
});
