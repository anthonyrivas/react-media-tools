import type { MutableRefObject, RefObject } from "react";
import type { EditorClip } from "../../types";
import { FRAME_MS, SKIP_MS, locateClip } from "../timeline/timelineMath";
import { isTypingTarget } from "./editorDom";

type ZoomHandle = {
  zoomBy: (factor: number) => void;
  zoomFit: () => void;
};

export type EditorHotkeys = {
  rootRef: RefObject<HTMLElement | null>;
  clipsRef: MutableRefObject<EditorClip[]>;
  selectedIdRef: MutableRefObject<string | null>;
  playheadRef: MutableRefObject<number>;
  timelineRef: RefObject<ZoomHandle | null>;
  timelineEndMs: () => number;
  undo: () => void;
  redo: () => void;
  duplicateSelected: () => void;
  togglePlay: () => void;
  handleScrub: (ms: number) => void;
  setSelectedId: (id: string) => void;
  split: (allTracks?: boolean) => void;
  toggleMute: () => void;
  deleteSelected: () => void;
  unlinkSelected?: () => void;
};

export type EditorHotkeyCommand =
  | { action: "undo" }
  | { action: "redo" }
  | { action: "duplicate" }
  | { action: "play" }
  | { action: "scrubBy"; deltaMs: number }
  | { action: "selectBy"; direction: -1 | 1 }
  | { action: "scrubToStart" }
  | { action: "scrubToEnd" }
  | { action: "split"; allTracks: boolean }
  | { action: "mute" }
  | { action: "unlink" }
  | { action: "delete" }
  | { action: "zoomBy"; factor: number }
  | { action: "zoomFit" };

type HotkeyEvent = {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
};

export function matchEditorHotkey(
  event: HotkeyEvent,
  ctx: {
    host: HTMLElement | null;
    editorActive: boolean;
    hasClips: boolean;
    hasSelection: boolean;
    canUnlink: boolean;
  },
): EditorHotkeyCommand | null {
  if (!hotkeyTargetOk(event.target, ctx.host, ctx.editorActive)) return null;
  const meta = event.metaKey || event.ctrlKey;
  const withMod = matchModHotkey(event, meta);
  if (withMod) return withMod;
  if (meta) return null;
  return matchTransportHotkey(event, ctx.hasClips) ?? matchEditHotkey(event, ctx) ?? matchZoomHotkey(event);
}

function hotkeyTargetOk(target: EventTarget | null, host: HTMLElement | null, editorActive: boolean): boolean {
  if (!host) return false;
  if (!editorActive && !(target instanceof Node && host.contains(target))) return false;
  return !isTypingTarget(target);
}

function matchModHotkey(event: HotkeyEvent, meta: boolean): EditorHotkeyCommand | null {
  const key = event.key;
  if (meta && (key === "z" || key === "Z")) return event.shiftKey ? { action: "redo" } : { action: "undo" };
  if (meta && (key === "y" || key === "Y")) return { action: "redo" };
  if (key === "d" || key === "D") return { action: "duplicate" };
  return null;
}

function matchTransportHotkey(event: HotkeyEvent, hasClips: boolean): EditorHotkeyCommand | null {
  if (event.code === "Space") {
    if (event.target instanceof HTMLElement && event.target.closest("button, a, [role='button']")) return null;
    if (!hasClips) return null;
    return { action: "play" };
  }
  if (!hasClips) return null;
  const key = event.key;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const step = event.shiftKey ? SKIP_MS : FRAME_MS;
    return { action: "scrubBy", deltaMs: key === "ArrowLeft" ? -step : step };
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    return { action: "selectBy", direction: key === "ArrowDown" ? 1 : -1 };
  }
  if (key === "Home") return { action: "scrubToStart" };
  if (key === "End") return { action: "scrubToEnd" };
  return null;
}

function matchEditHotkey(
  event: HotkeyEvent,
  ctx: { hasSelection: boolean; canUnlink: boolean },
): EditorHotkeyCommand | null {
  const key = event.key;
  if (key === "s" || key === "S") return { action: "split", allTracks: event.shiftKey };
  if (key === "m" || key === "M") return { action: "mute" };
  if ((key === "u" || key === "U") && ctx.canUnlink) return { action: "unlink" };
  if (key === "Backspace" || key === "Delete") {
    if (!ctx.hasSelection) return null;
    return { action: "delete" };
  }
  return null;
}

function matchZoomHotkey(event: HotkeyEvent): EditorHotkeyCommand | null {
  const key = event.key;
  if (key === "-" || key === "_") return { action: "zoomBy", factor: 1 / 1.25 };
  if (key === "=" || key === "+") return { action: "zoomBy", factor: 1.25 };
  if (key === "0") return { action: "zoomFit" };
  return null;
}

export function runEditorHotkey(command: EditorHotkeyCommand, actions: EditorHotkeys): void {
  switch (command.action) {
    case "undo":
      actions.undo();
      return;
    case "redo":
      actions.redo();
      return;
    case "duplicate":
      actions.duplicateSelected();
      return;
    case "play":
      actions.togglePlay();
      return;
    case "scrubBy":
      actions.handleScrub(actions.playheadRef.current + command.deltaMs);
      return;
    case "selectBy": {
      const clips = actions.clipsRef.current;
      let index = clips.findIndex((clip) => clip.id === actions.selectedIdRef.current);
      if (index < 0) index = locateClip(clips, actions.playheadRef.current)?.index ?? 0;
      const nextIndex =
        command.direction > 0 ? Math.min(clips.length - 1, index + 1) : Math.max(0, index - 1);
      const clip = clips[nextIndex];
      if (clip) actions.setSelectedId(clip.id);
      return;
    }
    case "scrubToStart":
      actions.handleScrub(0);
      return;
    case "scrubToEnd":
      actions.handleScrub(actions.timelineEndMs());
      return;
    case "split":
      actions.split(command.allTracks);
      return;
    case "mute":
      actions.toggleMute();
      return;
    case "unlink":
      actions.unlinkSelected?.();
      return;
    case "delete":
      actions.deleteSelected();
      return;
    case "zoomBy":
      actions.timelineRef.current?.zoomBy(command.factor);
      return;
    case "zoomFit":
      actions.timelineRef.current?.zoomFit();
  }
}
