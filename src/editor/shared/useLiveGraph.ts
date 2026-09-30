import { useRef } from "react";

export function useLiveGraph() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  return { audioCtxRef, gainNodeRef, mediaSourceRef };
}
