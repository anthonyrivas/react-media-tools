import { describe, expect, it } from "vitest";
import type { EditorClip } from "../types";
import { cloneSnapshot, createHistory, sameClips, type EditorSnapshot } from "./history";

function clip(id: string, inMs = 0, outMs = 1000): EditorClip {
  return { id, sourceId: "src", inMs, outMs };
}

function snap(clips: EditorClip[], extra: Partial<EditorSnapshot> = {}): EditorSnapshot {
  return { clips, selectedId: clips[0]?.id ?? null, playheadMs: 0, ...extra };
}

describe("history", () => {
  it("clones snapshots so later edits do not rewrite the stack", () => {
    const original = snap([clip("a")]);
    const copy = cloneSnapshot(original);
    original.clips[0]!.outMs = 50;
    original.selectedId = "nope";
    expect(copy.clips[0]?.outMs).toBe(1000);
    expect(copy.selectedId).toBe("a");
  });

  it("compares clips by id, source, in/out, and audio fields", () => {
    expect(sameClips([clip("a")], [clip("a")])).toBe(true);
    expect(sameClips([clip("a")], [clip("a", 0, 900)])).toBe(false);
    expect(sameClips([clip("a")], [clip("a"), clip("b")])).toBe(false);
    expect(sameClips([{ ...clip("a"), volume: 0.5 }], [clip("a")])).toBe(false);
    expect(sameClips([{ ...clip("a"), muted: true }], [clip("a")])).toBe(false);
    expect(sameClips([{ ...clip("a"), fadeInMs: 40 }], [clip("a")])).toBe(false);
    expect(sameClips([{ ...clip("a"), kind: "audio", startMs: 40 }], [clip("a")])).toBe(false);
  });

  it("undoes and redoes, clearing redo on a new push", () => {
    const history = createHistory();
    const a = snap([clip("a")]);
    const b = snap([clip("a"), clip("b")], { selectedId: "b", playheadMs: 40 });
    const c = snap([clip("c")]);

    expect(history.canUndo).toBe(false);
    history.push(a);
    expect(history.canUndo).toBe(true);

    const undone = history.undo(b);
    expect(undone).toEqual(a);
    expect(history.canRedo).toBe(true);

    const redone = history.redo(a);
    expect(redone).toEqual(b);

    history.push(b);
    expect(history.redo(c)).toBeNull();
    expect(history.undo(c)).toEqual(b);
  });

  it("drops the oldest snapshot after 80 entries", () => {
    const history = createHistory();
    for (let i = 0; i < 81; i += 1) {
      history.push(snap([clip(`c${i}`)]));
    }
    let current = snap([clip("now")]);
    for (let i = 0; i < 80; i += 1) {
      const previous = history.undo(current);
      expect(previous).not.toBeNull();
      current = previous!;
    }
    expect(history.undo(current)).toBeNull();
    expect(current.clips[0]?.id).toBe("c1");
  });
});
