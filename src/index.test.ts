import { describe, expect, it } from "vitest";
import {
  VideoEditor,
  VideoRecorder,
  detectCapabilities,
  extensionForMime,
  pickMimeType,
} from "./index";

describe("package exports", () => {
  it("exposes the public components and helpers", () => {
    expect(VideoRecorder).toBeDefined();
    expect(VideoEditor).toBeDefined();
    expect(typeof detectCapabilities).toBe("function");
    expect(typeof pickMimeType).toBe("function");
    expect(extensionForMime("video/mp4")).toBe("mp4");
  });
});
