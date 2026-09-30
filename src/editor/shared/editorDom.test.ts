import { describe, expect, it } from "vitest";
import { droppedMediaFiles, isFileDrag, isTypingTarget, positiveMs, sourceIdFor } from "./editorDom";

describe("editorDom", () => {
  it("reuses a stable id for the same Blob", () => {
    const file = new Blob(["take"]);
    expect(sourceIdFor(file)).toBe(sourceIdFor(file));
    expect(sourceIdFor(new Blob(["other"]))).not.toBe(sourceIdFor(file));
  });

  it("keeps only positive durations", () => {
    expect(positiveMs(undefined)).toBeUndefined();
    expect(positiveMs(0)).toBeUndefined();
    expect(positiveMs(-4)).toBeUndefined();
    expect(positiveMs(250)).toBe(250);
  });

  it("treats form fields as typing targets", () => {
    const input = document.createElement("input");
    const p = document.createElement("p");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(p)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("detects file drags and filters dropped media", () => {
    expect(isFileDrag({ dataTransfer: { types: ["Files"] } as unknown as DataTransfer })).toBe(true);
    expect(isFileDrag({ dataTransfer: { types: ["text/plain"] } as unknown as DataTransfer })).toBe(false);
    const video = new File(["v"], "take.mp4", { type: "video/mp4" });
    const audio = new File(["a"], "vo.m4a", { type: "audio/mp4" });
    const text = new File(["t"], "notes.txt", { type: "text/plain" });
    expect(droppedMediaFiles([video, audio, text], "video")).toEqual([video, audio]);
    expect(droppedMediaFiles([video, audio, text], "audio")).toEqual([audio]);
  });
});
