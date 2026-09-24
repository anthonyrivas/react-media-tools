import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { EditorInput } from "../types";
import { positiveMs, sourceIdFor } from "./editorDom";
import { looksLikeAudioFile, probeMedia } from "./probe";
import { extractPeaks, type WaveformPeaks } from "./waveform";

export type LoadedVideoSource = {
  id: string;
  file: Blob;
  url: string;
  name: string;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  peaks?: WaveformPeaks;
};

export type LoadedAudioSource = {
  id: string;
  file: Blob;
  url: string;
  name: string;
  durationMs: number;
  peaks?: WaveformPeaks;
};

function asInput(input: EditorInput | Blob, name?: string): EditorInput {
  return input instanceof Blob ? { file: input, name } : input;
}

function clipName(item: EditorInput, fallbackName: string | undefined, index: number): string {
  return item.name ?? fallbackName ?? `Clip ${index}`;
}

export async function createVideoSource(
  item: EditorInput,
  id: string,
  index: number,
  fallbackName?: string,
): Promise<LoadedVideoSource> {
  const probed = await probeMedia(item.file, {
    durationMs: item.durationMs,
    width: item.width,
    height: item.height,
  });
  const durationMs = positiveMs(item.durationMs) ?? positiveMs(probed.durationMs) ?? 0;
  const audioOnly = looksLikeAudioFile(item.file) || !probed.hasVideo;
  if (durationMs <= 0) {
    throw new Error(
      audioOnly
        ? "Could not read this audio. Try another file, or record again."
        : "Could not read this video. Try another file, or record again.",
    );
  }
  return {
    id,
    file: item.file,
    url: URL.createObjectURL(item.file),
    name: clipName(item, fallbackName, index),
    durationMs,
    width: audioOnly ? 0 : item.width || probed.width || 1280,
    height: audioOnly ? 0 : item.height || probed.height || 720,
    hasAudio: audioOnly || probed.hasAudio,
  };
}

export async function createAudioSource(
  item: EditorInput,
  id: string,
  index: number,
  fallbackName?: string,
): Promise<LoadedAudioSource> {
  const probed = await probeMedia(item.file, { durationMs: item.durationMs });
  const durationMs = positiveMs(item.durationMs) ?? positiveMs(probed.durationMs) ?? 0;
  if (durationMs <= 0) {
    throw new Error("Could not read this audio. Try another file, or record again.");
  }
  return {
    id,
    file: item.file,
    url: URL.createObjectURL(item.file),
    name: clipName(item, fallbackName, index),
    durationMs,
  };
}

export function useEditorIngest<T extends { id: string; file: Blob; url: string; durationMs: number }>(options: {
  incoming?: EditorInput[];
  sourcesRef: MutableRefObject<Record<string, T>>;
  knownIds: MutableRefObject<Set<string>>;
  setSourceMap: Dispatch<SetStateAction<Record<string, T>>>;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  report: (err: unknown) => void;
  createSource: (item: EditorInput, id: string, index: number, name?: string) => Promise<T>;
  onSource: (source: T) => void;
}) {
  const { sourcesRef, knownIds, setSourceMap, setBusy, setError, report } = options;
  const createRef = useRef(options.createSource);
  const onSourceRef = useRef(options.onSource);
  createRef.current = options.createSource;
  onSourceRef.current = options.onSource;

  const addSource = useCallback(
    async (input: EditorInput | Blob, name?: string) => {
      const item = asInput(input, name);
      const id = item.id ?? sourceIdFor(item.file);
      const existing = sourcesRef.current[id];
      if (existing) {
        onSourceRef.current(existing);
        return;
      }
      if (knownIds.current.has(id)) return;
      knownIds.current.add(id);
      setBusy(true);
      setError(null);
      try {
        const loaded = await createRef.current(item, id, Object.keys(sourcesRef.current).length + 1, name);
        setSourceMap((current) => ({ ...current, [id]: loaded }));
        onSourceRef.current(loaded);
        void extractPeaks(item.file).then((peaks) => {
          if (!peaks) return;
          setSourceMap((current) => {
            const src = current[id];
            if (!src) return current;
            return { ...current, [id]: { ...src, peaks } };
          });
        });
      } catch (err) {
        knownIds.current.delete(id);
        report(err);
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        setBusy(false);
      }
    },
    [knownIds, report, setBusy, setError, setSourceMap, sourcesRef],
  );

  useEffect(() => {
    options.incoming?.forEach((item) => {
      void addSource(item).catch(() => undefined);
    });
  }, [addSource, options.incoming]);

  return addSource;
}
