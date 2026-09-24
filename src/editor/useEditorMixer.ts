import { useCallback, useRef, type MutableRefObject } from "react";
import type { EditorClip } from "../types";
import { MAX_GAIN, normalizedVolume } from "./audioGain";
import { measureClipPeak } from "./exportAudio";
import type { EditorSnapshot } from "./history";
import { clamp } from "./timelineMath";

type MixerSource = { file?: Blob; hasAudio?: boolean };

export type EditorMixer = {
  clipsRef: MutableRefObject<EditorClip[]>;
  selectedIdRef: MutableRefObject<string | null>;
  sourcesRef: MutableRefObject<Record<string, MixerSource>>;
  captureState: () => EditorSnapshot;
  commitCoalesced: (beforeRef: MutableRefObject<EditorSnapshot | null>) => void;
  recordHistory: () => void;
  patchClip: (id: string, patch: Partial<EditorClip>) => void;
  report: (err: unknown) => void;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  canMix?: (clip: EditorClip) => boolean;
};

export function useEditorMixer(opts: EditorMixer) {
  const fadeBeforeRef = useRef<EditorSnapshot | null>(null);
  const gainBeforeRef = useRef<EditorSnapshot | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const handleFade = useCallback((id: string, fadeInMs: number, fadeOutMs: number) => {
    const { captureState, patchClip } = optsRef.current;
    if (!fadeBeforeRef.current) fadeBeforeRef.current = captureState();
    patchClip(id, { fadeInMs, fadeOutMs });
  }, []);

  const handleFadeEnd = useCallback(() => {
    optsRef.current.commitCoalesced(fadeBeforeRef);
  }, []);

  const handleGainInput = useCallback((percent: number) => {
    const { clipsRef, selectedIdRef, captureState, patchClip, canMix } = optsRef.current;
    const clip = clipsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!clip) return;
    if (canMix && !canMix(clip)) return;
    if (!gainBeforeRef.current) gainBeforeRef.current = captureState();
    patchClip(clip.id, { volume: clamp(percent / 100, 0, MAX_GAIN), muted: false });
  }, []);

  const handleGainCommit = useCallback(() => {
    optsRef.current.commitCoalesced(gainBeforeRef);
  }, []);

  const toggleMute = useCallback(() => {
    const { clipsRef, selectedIdRef, recordHistory, patchClip, canMix } = optsRef.current;
    const clip = clipsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!clip) return;
    if (canMix && !canMix(clip)) return;
    recordHistory();
    patchClip(clip.id, { muted: !clip.muted });
  }, []);

  const normalizeSelected = useCallback(async () => {
    const {
      clipsRef,
      selectedIdRef,
      sourcesRef,
      recordHistory,
      patchClip,
      report,
      setBusy,
      setError,
      canMix,
    } = optsRef.current;
    const clip = clipsRef.current.find((item) => item.id === selectedIdRef.current);
    const file = clip ? sourcesRef.current[clip.sourceId]?.file : undefined;
    if (!clip || !file) return;
    if (canMix && !canMix(clip)) return;
    setBusy(true);
    setError(null);
    try {
      const peak = await measureClipPeak(file, clip.inMs, clip.outMs);
      if (!(peak > 0)) throw new Error("Could not measure this clip for normalize.");
      recordHistory();
      patchClip(clip.id, { volume: normalizedVolume(peak), muted: false });
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }, []);

  return { handleFade, handleFadeEnd, handleGainInput, handleGainCommit, toggleMute, normalizeSelected };
}
