# Tests

| Type | Location | Command | Needs |
|---|---|---|---|
| Unit tests | `tests/unit/*.test.ts` | `npm test` | Node ≥ 22.18 (native TypeScript type stripping) |
| Browser integration | `tests/e2e/browser.e2e.mjs` | `npm run test:e2e:browser` | Chrome, Chromium or Edge |
| Tauri integration (smoke) | `tests/e2e/tauri.e2e.mjs` | `npm run test:e2e:tauri` | Windows, release build |

No test framework or browser automation package is installed. Everything uses `node:test` and a small
Chrome DevTools Protocol client (`tests/e2e/lib/cdp.mjs`).

## Unit tests (`npm test`)

Fast and without browser or Tauri: they cover platform detection, listener/keyboard cleanup and
validation/persistence of the browser settings. `window`/`document` are minimal in-memory stand-ins.

## Integration tests

They drive the **real application** and are not part of `npm test`.

### Browser (`npm run test:e2e:browser`)

- Builds the frontend, then tests the Vite dev server **and** the production build (`vite preview`).
- Single mode: `node tests/e2e/browser.e2e.mjs --mode=dev` or `--mode=preview` (needs `npm run build`).
- Runs without Tauri runtime and without mocks. It checks startup, navigation, Split/Sort/Filter/Remove/Diff,
  the JS mode with its metrics, persistence of the settings across a reload, and damaged `localStorage` data.
- Browser: found automatically (Chrome, Edge, Chromium); otherwise set `CHROME_PATH`.
- Vite and the browser run on free ports with a temporary profile. Both processes are stopped and the
  profile is deleted afterwards (also on failure / Ctrl+C).

### Tauri (`npm run test:e2e:tauri`)

- Prerequisite: `npx tauri build --no-bundle` (the test warns if sources are newer than the build).
  `TAURI_APP_PATH` can point to another executable.
- Starts the real release build with the Tauri runtime and Rust backend. The WebView2 is driven through its DevTools port
  (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`, only for this process).
- Checks splash → main window, window title, backend processing and metrics, mode switch,
  maximize/restore/minimize/close, settings in the Rust state and the settings file, restart.
- **User settings:** `%APPDATA%\<identifier>\settings.json` is backed up before the test and restored afterwards
  (also on failure / Ctrl+C). If the process is killed hard, the backup path printed at the start contains the original.
- The app must not already be running (WebView2 would reuse the existing process without a debug port).
- **Windows only.** WebKitGTK on Linux has no DevTools protocol; a Linux smoke test would need
  `tauri-driver` + WebDriver (not set up). On other platforms the script ends with `SKIPPED`.

## Scope

The integration tests check that the operations run and report results, not whether the results are
correct. Known functional bugs (Split B1, Diff, Filter semantics) are therefore not encoded in these tests.
