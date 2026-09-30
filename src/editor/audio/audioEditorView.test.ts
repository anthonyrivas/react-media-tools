import { describe, expect, it } from "vitest";
import type { EditorClip } from "../../types";
import { audioEditorEmptyBody, audioEditorEmptyHint, audioMixerText } from "./audioEditorView";

describe("audioEditorView", () => {
  it("keeps empty-stage body copy distinct from the timeline hint", () => {
    expect(audioEditorEmptyBody(false)).toBe("Drop audio here, or send a recording.");
    expect(audioEditorEmptyHint(false)).toBe("Drop audio, or send a recording.");
    expect(audioEditorEmptyBody(true)).toBe("Drop audio here, send a recording, or open a file.");
    expect(audioEditorEmptyHint(true)).toBe("Drop audio, send a recording, or open a file.");
  });

  it("shows a dash, muted, or gain percent in the mixer", () => {
    const selected: EditorClip = { id: "a", sourceId: "src", inMs: 0, outMs: 1000 };
    expect(audioMixerText(null, 100)).toBe("—");
    expect(audioMixerText({ ...selected, muted: true }, 80)).toBe("Muted");
    expect(audioMixerText(selected, 75)).toBe("75%");
  });
});
