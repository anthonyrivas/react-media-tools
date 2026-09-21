import { afterEach, describe, expect, it, vi } from "vitest";
import { detectCapabilities, extensionForMime, filenameFor, pickMimeType } from "./browser";

function stubMediaRecorder(supported: string[]) {
  vi.stubGlobal("MediaRecorder", {
    isTypeSupported: (type: string) => supported.includes(type),
  });
}

describe("browser helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps mime types to file extensions", () => {
    expect(extensionForMime("video/mp4")).toBe("mp4");
    expect(extensionForMime("video/webm;codecs=vp8")).toBe("webm");
  });

  it("builds a timestamped filename", () => {
    expect(filenameFor("edit", "video/webm")).toMatch(/^edit-.*\.webm$/);
    expect(filenameFor("recording", "video/mp4")).toMatch(/^recording-.*\.mp4$/);
  });

  it("picks the first supported MediaRecorder mime", () => {
    stubMediaRecorder(["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8"]);
    expect(pickMimeType()).toBe("video/webm;codecs=vp8,opus");
    expect(pickMimeType({ audio: false })).toBe("video/webm;codecs=vp8");
  });

  it("returns an empty mime when MediaRecorder is missing", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickMimeType()).toBe("");
  });

  it("reports missing capture APIs in a headless environment", () => {
    const caps = detectCapabilities();
    expect(caps.mediaRecorder).toBe(false);
    expect(caps.notes.recording).toMatch(/not fully supported/i);
  });
});
