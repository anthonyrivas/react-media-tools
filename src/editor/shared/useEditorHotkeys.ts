import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
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

export function useEditorHotkeys(actions: EditorHotkeys) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const root = () => actionsRef.current.rootRef.current;
    const editorActive = { current: false };
    const onPointerDown = (event: PointerEvent) => {
      editorActive.current = !!root()?.contains(event.target as Node);
    };
    const onKey = (event: KeyboardEvent) => {
      const host = root();
      const {
        clipsRef,
        selectedIdRef,
        playheadRef,
        timelineRef,
        timelineEndMs,
        undo,
        redo,
        duplicateSelected,
        togglePlay,
        handleScrub,
        setSelectedId,
        split,
        toggleMute,
        deleteSelected,
        unlinkSelected,
      } = actionsRef.current;
      if (!host) return;
      const target = event.target;
      if (!editorActive.current && !(target instanceof Node && host.contains(target))) return;
      if (isTypingTarget(target)) return;

      const meta = event.metaKey || event.ctrlKey;
      if (meta && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && (event.key === "y" || event.key === "Y")) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "d" || event.key === "D") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (meta) return;

      if (event.code === "Space") {
        if (target instanceof HTMLElement && target.closest("button, a, [role='button']")) return;
        if (!clipsRef.current.length) return;
        event.preventDefault();
        togglePlay();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (!clipsRef.current.length) return;
        event.preventDefault();
        const step = event.shiftKey ? SKIP_MS : FRAME_MS;
        handleScrub(playheadRef.current + (event.key === "ArrowLeft" ? -step : step));
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const clipsNow = clipsRef.current;
        if (!clipsNow.length) return;
        event.preventDefault();
        const current = selectedIdRef.current;
        let index = clipsNow.findIndex((clip) => clip.id === current);
        if (index < 0) index = locateClip(clipsNow, playheadRef.current)?.index ?? 0;
        const nextIndex =
          event.key === "ArrowDown" ? Math.min(clipsNow.length - 1, index + 1) : Math.max(0, index - 1);
        const clip = clipsNow[nextIndex];
        if (clip) setSelectedId(clip.id);
        return;
      }
      if (event.key === "Home") {
        if (!clipsRef.current.length) return;
        event.preventDefault();
        handleScrub(0);
        return;
      }
      if (event.key === "End") {
        if (!clipsRef.current.length) return;
        event.preventDefault();
        handleScrub(timelineEndMs());
        return;
      }
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        split(event.shiftKey);
        return;
      }
      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        toggleMute();
        return;
      }
      if ((event.key === "u" || event.key === "U") && unlinkSelected) {
        event.preventDefault();
        unlinkSelected();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (!selectedIdRef.current) return;
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        timelineRef.current?.zoomBy(1 / 1.25);
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        timelineRef.current?.zoomBy(1.25);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        timelineRef.current?.zoomFit();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
