import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorClip } from "../../types";
import { Timeline } from "./Timeline";

function clip(id: string, extra: Partial<EditorClip> = {}): EditorClip {
  return { id, sourceId: "src", inMs: 0, outMs: 2000, ...extra };
}

async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
}

describe("Timeline", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 48 });
  });

  afterEach(() => {
    cleanup();
  });

  it("scrubs from the playhead, trims a clip, and zooms", async () => {
    const onSelect = vi.fn();
    const onSeek = vi.fn();
    const onScrub = vi.fn();
    const onTrim = vi.fn();
    const onTrimEnd = vi.fn();
    const onReorder = vi.fn();
    const onFade = vi.fn();
    const onMoveAudio = vi.fn();

    render(
      <Timeline
        clips={[clip("v"), clip("a", { kind: "audio", startMs: 400, outMs: 900 })]}
        sources={{ src: { id: "src", name: "Take", durationMs: 4000, hasAudio: true } }}
        selectedId="v"
        playheadMs={200}
        showFades
        showAudioTrack
        onSelect={onSelect}
        onSeek={onSeek}
        onScrub={onScrub}
        onTrim={onTrim}
        onTrimEnd={onTrimEnd}
        onFade={onFade}
        onReorder={onReorder}
        onMoveAudio={onMoveAudio}
      />,
    );

    expect(screen.getByText(/2s/)).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("slider", { name: "Playhead" }), { clientX: 120, clientY: 8 });
    fireEvent.pointerMove(window, { clientX: 180, clientY: 8 });
    await flushFrame();
    fireEvent.pointerUp(window, { clientX: 180, clientY: 8 });
    expect(onScrub).toHaveBeenCalled();
    expect(onSeek).toHaveBeenCalled();

    const trimEnd = screen.getAllByRole("button", { name: "Trim end" })[0]!;
    fireEvent.pointerDown(trimEnd, { clientX: 80, clientY: 12 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 12 });
    await flushFrame();
    fireEvent.pointerUp(window, { clientX: 40, clientY: 12 });
    expect(onSelect).toHaveBeenCalledWith("v");
    expect(onTrim).toHaveBeenCalled();
    expect(onTrimEnd).toHaveBeenCalled();

    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Fade in" })[0]!, { clientX: 50, clientY: 12 });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 12 });
    await flushFrame();
    fireEvent.pointerUp(window, { clientX: 90, clientY: 12 });
    expect(onFade).toHaveBeenCalled();

    await act(async () => {
      screen.getByRole("button", { name: "Zoom in" }).click();
    });
    expect(screen.getByText("1.3×")).toBeInTheDocument();
  });
});
