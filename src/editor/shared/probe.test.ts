import { describe, expect, it } from "vitest";
import { probeMedia } from "./probe";

describe("probeMedia", () => {
  it("uses duration hints when the decoder cannot read the blob", async () => {
    await expect(probeMedia(new Blob(["not media"]), { durationMs: 1500 })).resolves.toMatchObject({
      durationMs: 1500,
      hasAudio: false,
      hasVideo: false,
    });
  });
});
