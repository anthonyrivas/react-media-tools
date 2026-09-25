import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

if (typeof AudioBuffer === "undefined") {
  class TestAudioBuffer {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    private channels: Float32Array[];
    constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
      this.length = options.length;
      this.numberOfChannels = options.numberOfChannels;
      this.sampleRate = options.sampleRate;
      this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
    }
    getChannelData(channel: number) {
      return this.channels[channel] ?? new Float32Array(this.length);
    }
  }
  vi.stubGlobal("AudioBuffer", TestAudioBuffer);
}

HTMLCanvasElement.prototype.getContext = function getContext() {
  return {
    canvas: this,
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    roundRect: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
} as typeof HTMLCanvasElement.prototype.getContext;

HTMLCanvasElement.prototype.captureStream = function captureStream() {
  return new MediaStream();
};

URL.createObjectURL ??= () => "blob:mock";
URL.revokeObjectURL ??= () => undefined;

HTMLMediaElement.prototype.pause = function pause() {};
HTMLMediaElement.prototype.load = function load() {};
HTMLMediaElement.prototype.play = async function play() {};

document.elementsFromPoint = function elementsFromPoint() {
  return [];
};

