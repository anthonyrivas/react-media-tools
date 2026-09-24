import { describe, expect, it } from "vitest";
import { looksLikeAudioFile, probeMedia } from "./probe";

describe("probeMedia", () => {
  it("uses duration hints when the decoder cannot read the blob", async () => {
    await expect(probeMedia(new Blob(["not media"]), { durationMs: 1500 })).resolves.toMatchObject({
      durationMs: 1500,
      hasAudio: false,
      hasVideo: false,
    });
  });

  it("treats a hinted width and height as video when the decoder is silent", async () => {
    await expect(
      probeMedia(new Blob(["not media"]), { durationMs: 800, width: 640, height: 360 }),
    ).resolves.toMatchObject({
      durationMs: 800,
      width: 640,
      height: 360,
      hasVideo: true,
    });
  });
});

describe("looksLikeAudioFile", () => {
  it("classifies by mime type and filename", () => {
    expect(looksLikeAudioFile(new Blob([], { type: "audio/webm" }))).toBe(true);
    expect(looksLikeAudioFile(new Blob([], { type: "video/webm" }))).toBe(false);
    expect(looksLikeAudioFile(new File([], "take.m4a"))).toBe(true);
    expect(looksLikeAudioFile(new File([], "take.mp4"))).toBe(false);
  });
});
