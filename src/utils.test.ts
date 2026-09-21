import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, fitContain, formatClock, formatPrecise, objectFitContainRect, pad, stopStream, uid, waitForEvent } from "./utils";

describe("utils", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("pads numeric strings", () => {
    expect(pad(3)).toBe("03");
    expect(pad(12, 4)).toBe("0012");
  });

  it("formats clocks without going negative", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(3_661_000)).toBe("1:01:01");
    expect(formatPrecise(65_240)).toBe("01:05.24");
    expect(formatPrecise(-20)).toBe("00:00.00");
  });

  it("fits content inside a destination box", () => {
    expect(fitContain(16, 9, 160, 90)).toEqual({ x: 0, y: 0, w: 160, h: 90 });
    const letterbox = fitContain(16, 9, 200, 200);
    expect(letterbox.w).toBeCloseTo(200);
    expect(letterbox.h).toBeCloseTo(112.5);
    expect(letterbox.y).toBeCloseTo(43.75);
    expect(objectFitContainRect(0, 100, 16, 9)).toEqual({ x: 0, y: 0, w: 0, h: 100 });
  });

  it("creates prefixed ids", () => {
    expect(uid("clip")).toMatch(/^clip-/);
  });

  it("stops every track on a stream", () => {
    const stop = vi.fn();
    stopStream({ getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(() => stopStream(null)).not.toThrow();
  });

  it("resolves waitForEvent when the event fires", async () => {
    const target = new EventTarget();
    const pending = waitForEvent(target, "ready", 200);
    target.dispatchEvent(new Event("ready"));
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects waitForEvent on timeout", async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const pending = waitForEvent(target, "ready", 50);
    vi.advanceTimersByTime(50);
    await expect(pending).rejects.toThrow(/Timed out waiting for ready/);
  });

  it("downloads a blob via a temporary object URL", () => {
    const click = vi.fn();
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      if (tag === "a") {
        return { click, href: "", download: "", remove: vi.fn() } as unknown as HTMLAnchorElement;
      }
      return document.createElement(tag);
    });
    vi.spyOn(document.body, "append").mockImplementation(() => undefined);
    vi.useFakeTimers();

    downloadBlob(new Blob(["x"]), "take.webm");
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
});
