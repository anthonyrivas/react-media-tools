import { describe, expect, it } from "vitest";
import {
  audioRecorderEmptyCopy,
  audioRecorderStartHint,
  audioRecorderStatusAnnounce,
  audioRecorderStatusLabel,
} from "./audioRecorderView";

describe("audioRecorderView", () => {
  it("labels idle, recording, paused, and a finished take", () => {
    expect(audioRecorderStatusLabel("idle", 0, false)).toBe("Idle");
    expect(audioRecorderStatusLabel("recording", 1500, false)).toBe("REC 00:01");
    expect(audioRecorderStatusLabel("paused", 1500, false)).toBe("PAUSED 00:01");
    expect(audioRecorderStatusLabel("idle", 2500, true)).toBe("Ready 00:02");
    expect(audioRecorderStatusAnnounce("recording", false)).toBe("Recording audio");
    expect(audioRecorderStatusAnnounce("paused", false)).toBe("Audio recording paused");
    expect(audioRecorderStatusAnnounce("idle", true)).toBe("Audio take ready");
    expect(audioRecorderStatusAnnounce("idle", false)).toBe("Audio recorder idle");
  });

  it("explains an empty stage vs a take that is ready to download", () => {
    expect(audioRecorderEmptyCopy(false)).toEqual({
      title: "Start to record audio",
      body: "Uses the microphone. Stop to get an audio file.",
    });
    expect(audioRecorderEmptyCopy(true)).toEqual({
      title: "Take ready",
      body: "Download the file, or start again to replace it.",
    });
  });

  it("prefers a recording capability note over the microphone note", () => {
    expect(audioRecorderStartHint({ recording: "Need a mime type", microphone: "Allow mic" })).toBe(
      "Need a mime type",
    );
    expect(audioRecorderStartHint({ microphone: "Allow mic" })).toBe("Allow mic");
    expect(audioRecorderStartHint({})).toBeUndefined();
  });
});
