import { describe, expect, it } from "vitest";
import type { EditorClip } from "../../types";
import { videoEditorEmptyCopy, videoMixerView } from "./videoEditorView";

function clip(id: string, extra: Partial<EditorClip> = {}): EditorClip {
  return { id, sourceId: "src", inMs: 0, outMs: 1000, ...extra };
}

describe("videoEditorView", () => {
  it("uses the same empty body and hint, and mentions open-file when that control is shown", () => {
    expect(videoEditorEmptyCopy(false).emptyBody).toBe("Drop a video or audio file, or send a recording.");
    expect(videoEditorEmptyCopy(false).emptyHint).toBe(videoEditorEmptyCopy(false).emptyBody);
    expect(videoEditorEmptyCopy(true).emptyBody).toBe(
      "Drop a video or audio file, send a recording, or open a file.",
    );
    expect(videoEditorEmptyCopy(true).emptyHint).toBe(videoEditorEmptyCopy(true).emptyBody);
  });

  it("enables the mixer on picture with audio and on extra-audio clips", () => {
    const picture = clip("v");
    const extra = clip("a", { kind: "audio", startMs: 0 });
    expect(videoMixerView([picture], picture, true)).toMatchObject({
      mixerEnabled: true,
      canUnlink: true,
      audioMoved: false,
      mutePressed: false,
      gainText: "100%",
      gainAriaText: "100 percent",
    });
    expect(videoMixerView([extra], extra, true)).toMatchObject({
      mixerEnabled: true,
      canUnlink: false,
    });
  });

  it("disables mix when the source is silent or audio was unlinked", () => {
    const picture = clip("v");
    const detached = clip("a", { kind: "audio", startMs: 0, linkedClipId: "v" });
    expect(videoMixerView([], null, true).gainText).toBe("—");
    expect(videoMixerView([picture], picture, false)).toMatchObject({
      mixerEnabled: false,
      canUnlink: false,
      gainText: "No audio",
      gainAriaText: "No audio",
    });
    expect(videoMixerView([picture, detached], picture, true)).toMatchObject({
      mixerEnabled: false,
      canUnlink: false,
      audioMoved: true,
      mutePressed: true,
    });
    expect(videoMixerView([clip("v", { muted: true })], clip("v", { muted: true }), true).gainText).toBe("Muted");
  });
});
