import { isSafariLike } from "../browser";

export function cameraConstraints(): MediaStreamConstraints {
  return {
    video: isSafariLike()
      ? { facingMode: "user" }
      : {
          facingMode: "user",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
    audio: false,
  };
}

export function microphoneConstraints(): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
}

export function displayVideoConstraints(): boolean | MediaTrackConstraints {
  return isSafariLike()
    ? true
    : {
        frameRate: { ideal: 30 },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      };
}

export function displayAudioConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

export async function requestCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(cameraConstraints());
}

export async function requestMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(microphoneConstraints());
}

export async function requestDisplay(withAudio: boolean): Promise<MediaStream> {
  const video = displayVideoConstraints();
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video,
      audio: withAudio ? displayAudioConstraints() : false,
    });
  } catch (error) {
    if (withAudio) {
      return navigator.mediaDevices.getDisplayMedia({ video, audio: false });
    }
    throw error;
  }
}

export function liveAudioTracks(stream: MediaStream | null): MediaStreamTrack[] {
  return stream?.getAudioTracks().filter((track) => track.readyState === "live") ?? [];
}

export function hintMotion(stream: MediaStream): void {
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack && "contentHint" in videoTrack) {
    videoTrack.contentHint = "motion";
  }
}

export function captureTracks(
  captureStream: MediaStream,
  audioDest: MediaStreamAudioDestinationNode | null,
  includeAudio: boolean,
): MediaStreamTrack[] {
  return [
    ...captureStream.getVideoTracks(),
    ...(includeAudio ? (audioDest?.stream.getAudioTracks() ?? []) : []),
  ];
}

export function mixCaptureStream(
  captureStream: MediaStream,
  audioDest: MediaStreamAudioDestinationNode | null,
  includeAudio: boolean,
): MediaStream {
  return new MediaStream(captureTracks(captureStream, audioDest, includeAudio));
}

export function onTrackEnded(stream: MediaStream, kind: "video" | "audio", stop: () => void): void {
  const track = kind === "video" ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
  track?.addEventListener("ended", stop);
}
