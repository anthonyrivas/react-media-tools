import { liveAudioTracks } from "./composerCapture";

export type ComposerAudioGraph = {
  audioCtx: AudioContext | null;
  audioDest: MediaStreamAudioDestinationNode | null;
  micSource: MediaStreamAudioSourceNode | null;
  systemSource: MediaStreamAudioSourceNode | null;
};

export function emptyAudioGraph(): ComposerAudioGraph {
  return { audioCtx: null, audioDest: null, micSource: null, systemSource: null };
}

export function ensureAudioGraph(graph: ComposerAudioGraph): ComposerAudioGraph {
  if (graph.audioCtx && graph.audioDest) return graph;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  graph.audioCtx = new Ctor();
  graph.audioDest = graph.audioCtx.createMediaStreamDestination();
  return graph;
}

export function connectMicrophone(graph: ComposerAudioGraph, stream: MediaStream): void {
  ensureAudioGraph(graph);
  graph.micSource?.disconnect();
  graph.micSource = graph.audioCtx!.createMediaStreamSource(stream);
  graph.micSource.connect(graph.audioDest!);
  void graph.audioCtx?.resume();
}

export function disconnectMicrophone(graph: ComposerAudioGraph): void {
  graph.micSource?.disconnect();
  graph.micSource = null;
}

export function disconnectSystemSource(graph: ComposerAudioGraph): void {
  graph.systemSource?.disconnect();
  graph.systemSource = null;
}

export function connectSystemAudio(
  graph: ComposerAudioGraph,
  screenStream: MediaStream | null,
  systemAudioWanted: boolean,
): boolean {
  disconnectSystemSource(graph);
  const tracks = liveAudioTracks(screenStream);
  const hasTrack = tracks.length > 0;
  if (!tracks.length || !systemAudioWanted) return hasTrack;
  ensureAudioGraph(graph);
  const stream = new MediaStream(tracks);
  graph.systemSource = graph.audioCtx!.createMediaStreamSource(stream);
  graph.systemSource.connect(graph.audioDest!);
  void graph.audioCtx?.resume();
  return hasTrack;
}

export function disconnectAudioGraph(graph: ComposerAudioGraph): void {
  disconnectMicrophone(graph);
  disconnectSystemSource(graph);
  graph.audioDest = null;
}

export function closeAudioGraph(graph: ComposerAudioGraph): void {
  disconnectAudioGraph(graph);
  void graph.audioCtx?.close();
  graph.audioCtx = null;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
