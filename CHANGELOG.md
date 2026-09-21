# Changelog

All notable changes to `@anthonyrivas/react-media-tools` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-20

Initial public release: in-browser React recorder and editor. Nothing is uploaded; both components produce a `Blob`.

### Added

- `VideoRecorder` for camera, screen, or camera-on-screen composition, with optional microphone and system audio, pause/resume, and a movable camera overlay.
- `VideoEditor` for trim, split, reorder, preview, undo/redo, timeline zoom, waveform overlay, and client-side export (Mediabunny / WebCodecs).
- Imperative handles (`start` / `stop` / `addSource` / `exportVideo` / `download`, and related methods) so hosts can skip built-in Download and Open file controls.
- `exportLabel` and `downloadLabel` on the editor; `showDownload` and `showOpenFile` default to off.
- Dark palette by default; `data-theme="light"` or `data-theme="dark"` on an ancestor switches tokens (`rmt-*` CSS variables).
- Helpers `detectCapabilities`, `pickMimeType`, and `extensionForMime`.

[Unreleased]: https://github.com/anthonyrivas/react-media-tools/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/anthonyrivas/react-media-tools/releases/tag/v0.1.0
