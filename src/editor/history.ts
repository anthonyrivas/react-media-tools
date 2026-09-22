import type { EditorClip } from "../types";

export type EditorSnapshot = {
  clips: EditorClip[];
  selectedId: string | null;
  playheadMs: number;
};

const LIMIT = 80;

export function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    clips: snapshot.clips.map((clip) => ({ ...clip })),
    selectedId: snapshot.selectedId,
    playheadMs: snapshot.playheadMs,
  };
}

export function sameClips(a: EditorClip[], b: EditorClip[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((clip, index) => {
    const other = b[index];
    return (
      !!other &&
      clip.id === other.id &&
      clip.sourceId === other.sourceId &&
      clip.inMs === other.inMs &&
      clip.outMs === other.outMs &&
      (clip.volume ?? 1) === (other.volume ?? 1) &&
      Boolean(clip.muted) === Boolean(other.muted) &&
      (clip.fadeInMs ?? 0) === (other.fadeInMs ?? 0) &&
      (clip.fadeOutMs ?? 0) === (other.fadeOutMs ?? 0) &&
      (clip.kind ?? "video") === (other.kind ?? "video") &&
      (clip.startMs ?? 0) === (other.startMs ?? 0) &&
      (clip.linkedClipId ?? "") === (other.linkedClipId ?? "")
    );
  });
}

export function createHistory() {
  const past: EditorSnapshot[] = [];
  const future: EditorSnapshot[] = [];

  return {
    push(snapshot: EditorSnapshot) {
      past.push(cloneSnapshot(snapshot));
      if (past.length > LIMIT) past.shift();
      future.length = 0;
    },
    undo(current: EditorSnapshot): EditorSnapshot | null {
      const previous = past.pop();
      if (!previous) return null;
      future.push(cloneSnapshot(current));
      return previous;
    },
    redo(current: EditorSnapshot): EditorSnapshot | null {
      const next = future.pop();
      if (!next) return null;
      past.push(cloneSnapshot(current));
      return next;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
  };
}
