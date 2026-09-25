import { describe, expect, it } from "vitest";
import { FRAME_MS, SKIP_MS } from "../timeline/timelineMath";
import { matchEditorHotkey } from "./editorHotkey";

function key(
  partial: Partial<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; target: EventTarget | null }>,
) {
  return {
    key: "a",
    code: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    target: document.body,
    ...partial,
  };
}

const ready = {
  host: document.body,
  editorActive: true,
  hasClips: true,
  hasSelection: true,
  canUnlink: true,
};

describe("matchEditorHotkey", () => {
  it("ignores keys when the editor is not the target", () => {
    expect(matchEditorHotkey(key({ key: " " }), { ...ready, host: null })).toBeNull();
    expect(
      matchEditorHotkey(key({ target: document.createElement("div") }), { ...ready, editorActive: false }),
    ).toBeNull();
    expect(matchEditorHotkey(key({ key: "s", target: document.createElement("input") }), ready)).toBeNull();
  });

  it("maps history, duplicate, and zoom shortcuts", () => {
    expect(matchEditorHotkey(key({ key: "z", metaKey: true }), ready)).toEqual({ action: "undo" });
    expect(matchEditorHotkey(key({ key: "Z", metaKey: true, shiftKey: true }), ready)).toEqual({ action: "redo" });
    expect(matchEditorHotkey(key({ key: "y", ctrlKey: true }), ready)).toEqual({ action: "redo" });
    expect(matchEditorHotkey(key({ key: "d", metaKey: true }), ready)).toEqual({ action: "duplicate" });
    expect(matchEditorHotkey(key({ key: "s", metaKey: true }), ready)).toBeNull();
    expect(matchEditorHotkey(key({ key: "-" }), ready)).toEqual({ action: "zoomBy", factor: 1 / 1.25 });
    expect(matchEditorHotkey(key({ key: "=" }), ready)).toEqual({ action: "zoomBy", factor: 1.25 });
    expect(matchEditorHotkey(key({ key: "0" }), ready)).toEqual({ action: "zoomFit" });
  });

  it("maps playback and clip keys only when the timeline can use them", () => {
    expect(matchEditorHotkey(key({ key: " ", code: "Space" }), ready)).toEqual({ action: "play" });
    expect(
      matchEditorHotkey(key({ key: " ", code: "Space", target: document.createElement("button") }), ready),
    ).toBeNull();
    expect(matchEditorHotkey(key({ key: " ", code: "Space" }), { ...ready, hasClips: false })).toBeNull();
    expect(matchEditorHotkey(key({ key: "ArrowLeft" }), ready)).toEqual({
      action: "scrubBy",
      deltaMs: -FRAME_MS,
    });
    expect(matchEditorHotkey(key({ key: "ArrowRight", shiftKey: true }), ready)).toEqual({
      action: "scrubBy",
      deltaMs: SKIP_MS,
    });
    expect(matchEditorHotkey(key({ key: "ArrowDown" }), ready)).toEqual({ action: "selectBy", direction: 1 });
    expect(matchEditorHotkey(key({ key: "Home" }), ready)).toEqual({ action: "scrubToStart" });
    expect(matchEditorHotkey(key({ key: "End" }), ready)).toEqual({ action: "scrubToEnd" });
    expect(matchEditorHotkey(key({ key: "s", shiftKey: true }), ready)).toEqual({
      action: "split",
      allTracks: true,
    });
    expect(matchEditorHotkey(key({ key: "m" }), ready)).toEqual({ action: "mute" });
    expect(matchEditorHotkey(key({ key: "u" }), ready)).toEqual({ action: "unlink" });
    expect(matchEditorHotkey(key({ key: "u" }), { ...ready, canUnlink: false })).toBeNull();
    expect(matchEditorHotkey(key({ key: "Backspace" }), ready)).toEqual({ action: "delete" });
    expect(matchEditorHotkey(key({ key: "Delete" }), { ...ready, hasSelection: false })).toBeNull();
  });
});
