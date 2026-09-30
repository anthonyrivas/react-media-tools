import { useEffect, useRef } from "react";
import type { EditorHotkeys } from "./editorHotkey";
import { matchEditorHotkey, runEditorHotkey } from "./editorHotkey";

export type { EditorHotkeys };

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
      const current = actionsRef.current;
      const command = matchEditorHotkey(event, {
        host: root(),
        editorActive: editorActive.current,
        hasClips: current.clipsRef.current.length > 0,
        hasSelection: Boolean(current.selectedIdRef.current),
        canUnlink: Boolean(current.unlinkSelected),
      });
      if (!command) return;
      event.preventDefault();
      runEditorHotkey(command, current);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
