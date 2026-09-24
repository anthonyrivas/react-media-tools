import { describe, expect, it } from "vitest";
import {
  microphoneArmed,
  systemAudioHint,
  videoRecorderPreviewLabel,
  videoRecorderStatusAnnounce,
  videoRecorderStatusLabel,
} from "./recorderView";

describe("recorderView", () => {
  it("labels preview and status from camera/screen and recorder state", () => {
    expect(videoRecorderPreviewLabel(true, true)).toBe("Camera over screen preview");
    expect(videoRecorderPreviewLabel(true, false)).toBe("Camera preview");
    expect(videoRecorderPreviewLabel(false, true)).toBe("Screen preview");
    expect(videoRecorderPreviewLabel(false, false)).toBe("Recorder preview");
    expect(videoRecorderStatusLabel("recording", 1500)).toBe("REC 00:01");
    expect(videoRecorderStatusLabel("paused", 1500)).toBe("PAUSED 00:01");
    expect(videoRecorderStatusLabel("preview", 0)).toBe("Preview");
    expect(videoRecorderStatusLabel("idle", 0)).toBe("Idle");
    expect(videoRecorderStatusAnnounce("recording")).toBe("Recording");
    expect(videoRecorderStatusAnnounce("idle")).toBe("Recorder idle");
  });

  it("keeps the mic armed in preview and explains missing system audio", () => {
    expect(microphoneArmed(false, true, false)).toBe(true);
    expect(microphoneArmed(false, true, true)).toBe(false);
    expect(microphoneArmed(true, false, true)).toBe(true);
    expect(systemAudioHint(true, false)).toMatch(/Share audio/);
    expect(systemAudioHint(false, false, "Unavailable")).toBe("Unavailable");
  });
});
