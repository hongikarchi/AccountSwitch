# ADR-001 The setup wizard lives in the engine and page; the shell only does native windows

Status: accepted, 2026-11-06

## Context

The app is a WebView2 window (C#) around a local Node server (the engine) that serves the React page. The setup wizard must run installers, read the registry, and report progress; the launcher needs a native folder dialog and a new console window.

## Decision

- Checks and installs run in the engine (`src/core/setup/`), exposed as `/api/v1/setup/*`, rendered by the page. Same pattern as sign-in today (start, poll, cancel).
- The shell does only what a web page cannot: the system folder dialog and launching `cmd.exe` for the launcher, over `chrome.webview.postMessage` (SPEC §4).
- The catalog of items is data (a manifest), so adding an item needs no UI code.

## Consequences

- One code path for the desktop window and `npm start`; the browser build gets a text-field fallback for the folder.
- macOS keeps the same engine and simply hides the 설치 tab and launcher.
