# Tests

| Type | Location | Command | Needs |
|---|---|---|---|
| Unit tests | `tests/unit/*.test.ts` | `npm test` | Node ≥ 22.18 (native TypeScript type stripping) |
| Browser integration | `tests/e2e/browser.e2e.mjs` | `npm run test:e2e:browser` | Chrome, Chromium or Edge |
| Tauri integration (smoke) | `tests/e2e/tauri.e2e.mjs` | `npm run test:e2e:tauri` | Windows, release build |

No test framework or browser automation package is installed. Everything uses `node:test` and a small
Chrome DevTools Protocol client (`tests/e2e/lib/cdp.mjs`).

## Unit tests (`npm test`)

Fast and without browser or Tauri: they cover platform detection, listener/keyboard cleanup,
validation/persistence of the browser settings and the JS split engine (`src/utils/splitColumns.ts`,
used by `SplitWorker` and the main-thread fallback). `window`/`document` are minimal in-memory stand-ins.

`processing.test.ts` and `workers.test.ts` check the result and error contract of the services
(`src/services/ProcessingError.ts`): empty strings/arrays are valid results, failures reject with a
`ProcessingError` (`invalidInput`, `backend`, `worker`, `timeout`, `invalidResult`) and are never turned into
`{}`/`[]`/`''`. The Tauri IPC is stubbed via `window.__TAURI_INTERNALS__.invoke`; the real worker modules run
in-process behind a fake `Worker`. `tests/unit/helpers/setup.ts` adds a resolve hook for the extensionless
imports of the app sources, so these tests load the sources with dynamic `await import(...)`.

## Split fixtures (`tests/fixtures/split-cases.json`)

One fixture file for **both** split engines: `npm test` (JS, `tests/unit/split.test.ts`) and `cargo test`
(Rust, `src-tauri/src/text_processor.rs`). Per case: `input`, `delimiter`, optional `useRegex`, `trimParts`,
`keepEmptyLines` (defaults `false`, `false`, `true`) and the column-major result `expected[column][row]`.
A known engine difference uses `expectedRust` + `expectedJs` and must be explained in `divergence`.

Split semantics (both engines):

- Every processed input row has exactly one value in every column; missing parts are `""` (B1).
- Empty split fields (`A,,C`) are kept, so the column assignment stays intact.
- `keepEmptyLines` = permanent setting `showEmptyLines` (Settings → Processing → "Keep Empty Lines",
  default `true`). `false` skips **completely empty** input lines (for CRLF input also the line `"\r"`).
  Whitespace-only lines are **not** empty and are always kept (with `trimParts` they become `""` values).

Known differences between Rust and JS (unchanged existing behaviour, documented in the fixtures):

| Topic | Rust (`fancy-regex`, `str::lines()`) | JS (`RegExp`, `split('\n')`) |
|---|---|---|
| Trailing newline / empty input | no row after the final line break; empty text = no rows | trailing line break adds an empty row; empty text = one empty row |
| CRLF | `\r` removed | `\r` stays at the end of the last part (removed by `trimParts`) |
| Regex capture groups | captured text is dropped | every capture becomes an extra column |
| `\w`, `\W`, `\d`, `\s` | Unicode-aware | ASCII (no `u` flag) |
| Empty plain delimiter | `""` before and after the characters | only the characters |

With `keepEmptyLines = false` the trailing-newline and empty-input differences disappear.

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

Split and Combine are checked with concrete results in both integration tests (late columns / B1,
empty lines kept and skipped, Combine without row offset; Tauri: Rust backend and JS mode). For Sort,
Filter, Remove and Diff the integration tests only check that the operations run and report results;
known functional bugs (Diff, Filter semantics) are not encoded in these tests.

Error handling (`checkProcessingErrors` in `tests/e2e/lib/app.mjs`; browser: Web Worker, Tauri: Rust backend and
JS mode): an invalid regex in Filter/Remove shows exactly one error message and no success message, keeps the
previous result and ends the processing state; removing all lines is reported as success with an empty result.

The Tauri test switches "Keep Empty Lines" explicitly, because an existing `settings.json` may still
contain `showEmptyLines: false` (the default before the option was wired to Split).
