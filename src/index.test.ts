import { describe, expect, it } from "vitest";
import {
  VideoEditor,
  VideoRecorder,
  detectCapabilities,
  extensionForMime,
  pickAudioMimeType,
  pickMimeType,
} from "./index";

describe("package exports", () => {
  it("exposes the public components and helpers", () => {
    expect(VideoRecorder).toBeDefined();
    expect(VideoEditor).toBeDefined();
    expect(typeof detectCapabilities).toBe("function");
    expect(typeof pickMimeType).toBe("function");
    expect(typeof pickAudioMimeType).toBe("function");
    expect(extensionForMime("video/mp4")).toBe("mp4");
    expect(extensionForMime("audio/mp4")).toBe("m4a");
  });
});
