import { useCallback, useRef, useState } from "react";
import type { EditorClip } from "../types";
import { withClampedAudio } from "./audioGain";

export function useEditorClips(onChange?: (clips: EditorClip[]) => void) {
  const [clips, setClipsState] = useState<EditorClip[]>([]);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;

  const setClips = useCallback(
    (update: EditorClip[] | ((current: EditorClip[]) => EditorClip[])) => {
      const prev = clipsRef.current;
      const next = typeof update === "function" ? update(prev) : update;
      // Same array reference is a no-op. Do not write clipsRef before calling setClips.
      if (next === prev) return next;
      clipsRef.current = next;
      setClipsState(next);
      onChange?.(next);
      return next;
    },
    [onChange],
  );

  const patchClip = useCallback(
    (id: string, patch: Partial<EditorClip>) =>
      setClips(
        clipsRef.current.map((clip) => (clip.id === id ? withClampedAudio({ ...clip, ...patch }) : clip)),
      ),
    [setClips],
  );

  return { clips, clipsRef, setClips, patchClip };
}
