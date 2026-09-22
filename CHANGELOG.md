# Changelog

All notable changes to `@anthonyrivas/react-media-tools` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-09-21

Puts clip audio controls and a second audio track into `VideoEditor`.

### Added

- Extra audio track on `VideoEditor`: drop or `addSource` an audio file to place it at the playhead. Drag to slip in time. Overlapping extras mix in preview and export, and stack onto extra timeline rows so they stay selectable.
- `EditorClip.kind`, `startMs`, and `linkedClipId`. Omitted `kind` stays magnetic (including `AudioEditor`).
- **Unlink audio** (U) moves a video clip’s soundtrack onto the extra track for J/L cuts. Picture stays silent in preview and export; the sound exists only on that track.
- **Split all tracks** (Shift+S) cuts picture and extra audio at the playhead. Linked halves stay paired.
- `VideoEditorHandle.unlinkSelected()`.

### Changed

- Video clips already had gain, mute, fades, and normalize; export now mixes those envelopes with extra-track audio. Mixer controls stay disabled on picture-only clips (unlinked or silent sources).
- `VideoEditor` Open file / drop accepts audio as well as video. Export still needs at least one picture clip.

### Fixed

- Extra-audio clips were drawn `8px` to the right of the picture track and ruler.
- Extra-track audio could stay silent in preview because `play()` ran after the click/key gesture.

## [0.3.0] - 2026-09-21

Adds a standalone audio editor.

### Added

- `AudioEditor` for standalone audio timelines: ingest `AudioRecorder` blobs and audio files, trim/split/reorder, gain, mute, fade in/out (drag on the clip waveform), normalize, and export an audio `Blob` (M4A or WebM).
- Clip fields `volume`, `muted`, `fadeInMs`, and `fadeOutMs` on `EditorClip` (optional; `VideoEditor` still ignores them).

### Fixed

- Audio editor preview waveform used editor foreground, so it vanished in light mode.

## [0.2.0] - 2026-09-21

Adds an audio-only recorder and aligns compact toolbar controls across the package.

### Added

- `AudioRecorder` for microphone takes that produce an audio `Blob` (WebM/Opus, or M4A on Safari). Pause, resume, and `showDownload` match `VideoRecorder`.
- `AudioRecordingResult`: `{ blob, mimeType, filename, durationMs }`.
- `pickAudioMimeType()` for audio-only `MediaRecorder` types; `extensionForMime` also maps `m4a` / `ogg` / `mp3`.
- Shared icon buttons for compact tools (sources, pause/resume, download, editor tools, zoom).

### Changed

- Recorder source toggles, pause/resume, download, and timeline zoom use the same icon buttons as the editor. Start, Stop, Export, and Fit stay labeled text.
- `downloadLabel` on `VideoEditor` is the accessible name of the Download icon.

## [0.1.0] - 2026-09-20

Initial public release: in-browser React recorder and editor. Nothing is uploaded; both components produce a `Blob`.

### Added

- `VideoRecorder` for camera, screen, or camera-on-screen composition, with optional microphone and system audio, pause/resume, and a movable camera overlay.
- `VideoEditor` for trim, split, reorder, preview, undo/redo, timeline zoom, waveform overlay, and client-side export (Mediabunny / WebCodecs).
- Imperative handles (`start` / `stop` / `addSource` / `exportVideo` / `download`, and related methods) so hosts can skip built-in Download and Open file controls.
- `exportLabel` and `downloadLabel` on the editor; `showDownload` and `showOpenFile` default to off.
- Dark palette by default; `data-theme="light"` or `data-theme="dark"` on an ancestor switches tokens (`rmt-*` CSS variables).
- Helpers `detectCapabilities`, `pickMimeType`, and `extensionForMime`.

[Unreleased]: https://github.com/anthonyrivas/react-media-tools/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/anthonyrivas/react-media-tools/releases/tag/v0.4.0
[0.3.0]: https://github.com/anthonyrivas/react-media-tools/releases/tag/v0.3.0
[0.2.0]: https://github.com/anthonyrivas/react-media-tools/releases/tag/v0.2.0
[0.1.0]: https://github.com/anthonyrivas/react-media-tools/releases/tag/v0.1.0
