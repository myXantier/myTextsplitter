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

`regex.test.ts` covers the JS regex helpers and error messages, `worker-termination.test.ts` the real termination of a
running regex (worker thread, time-limited). `processing.test.ts` and `workers.test.ts` check the result and error contract of the services
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
Further regex split differences (named/non-participating captures, zero-width matches at the line start, `\b`,
Unicode `\d`) are documented as `divergence` cases in the fixtures.

## Regex fixtures (`tests/fixtures/regex-cases.json`)

Shared by `npm test` (`tests/unit/regex-compat.test.ts`, real `FilterWorker` module = native JS `RegExp`) and
`cargo test` (`regex_fixtures` in `text_processor.rs`, `fancy-regex`). Operation: Filter per line (`mode` keep/remove,
`caseSensitive`, `splitMatches`; defaults keep/true/true). `expected` is the result text or `{ "error": "invalidRegex" }`.
Each case has a `category`:

| Category | Meaning | Examples |
|---|---|---|
| `same` | shared syntax, same result (`expected`) | lookbehind (constant length), lookahead, `\1`, `(?<n>…)`, `\k<n>`, ASCII classes, `(?i)` on umlauts, zero-width matches |
| `different` | both accept the pattern, results differ | Unicode `\w`/`\d`/`\b`, `\s` vs. U+FEFF, `.` on emojis, `\p{L}`, `\A`, `\z`, `\x{41}`, `{,n}`, `[[:alpha:]]`, case folding (Kelvin sign, ß/ẞ), case-insensitive backreferences, empty match after a match |
| `rustOnly` | JS rejects the pattern | inline flags `(?i)`, `(?P<n>…)`, atomic groups, possessive quantifiers |
| `jsOnly` | Rust rejects the pattern | variable-length lookbehind, `[^]`, `\cI` |

Important: without the `u` flag several Rust escapes (`\p{L}`, `\A`, `\z`, `\x{41}`) are **valid JS with another meaning**
(literal letters), so the JS engine silently returns other matches instead of an error. Patterns are not rewritten and no new
JS flags are enabled (`u`/`v` would change existing JS behaviour and need their own decision and regression tests).
Catastrophic backtracking is not in the fixtures: see `worker-termination.test.ts` (JS) and the backtracking tests in Rust.

## Regex execution (Paket 5)

- **Rust:** `fancy-regex` with an explicit `REGEX_BACKTRACK_LIMIT` (= default 1,000,000 per match attempt). This is a
  step limit, not a time limit; patterns without fancy features run in the linear-time `regex` crate. Exceeding it is
  `regexRuntime` -> "too complex". All text commands are `async` (sync Tauri commands run on the main thread); Split,
  Filter and Remove run on the blocking pool (`spawn_blocking`) through a `JobSlot` per operation (`job_slot.rs`): at
  most one running and one waiting job, waiting happens in the async command (no blocked thread). A newer request
  replaces the waiting one, which never runs and drops its input (`superseded`). A running regex cannot be stopped.
  A panicking job is `internal` (backend error) and does not block later jobs.
- **JS:** user regexes only run in Web Workers. The timeout calls `Worker.terminate()` immediately, which really stops a
  running regex (`worker-termination.test.ts` runs the real worker module in a `worker_threads` thread). A terminated
  worker is never reused; only the latest job per type is delivered (older ones end as `superseded` and are not shown).
- **Latest job wins** (Rust and JS): result and metrics of a superseded job are never applied, also not on the same
  service instance; it changes no loading state and shows no message. The global processing state ends only when no
  other operation type is still running (`src/hooks/runningOperations.ts`).
- **No Web Worker** (main-thread fallback): jobs with a user regex are refused (`errors.regexRequiresWorker`, an invalid
  pattern still reports `invalidRegex`); jobs without regex still run there.
- **Validation** happens in the engine that runs the pattern (no JS pre-validation in Rust mode). The pattern preview of
  the Filter page always uses JS in its own worker; in Rust mode it says so, and a pattern JS rejects shows a note.

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

Regex robustness (`checkRegexRobustness`, Paket 5; browser: Web Worker, Tauri: Rust backend and JS mode): a catastrophic
regex keeps the UI responsive and ends with one error message (JS: worker timeout after ~10 s, Rust: backtracking limit)
while the previous result stays; the next normal Filter works. Split with the Rust-only pattern `(?i)x` is processed in
Rust mode and reported with the JS syntax error in JS mode. The pattern preview is checked for highlighting, the engine
hint (Rust mode), the note for patterns JS rejects (also after switching the engine) and the stop of a catastrophic
preview (3 s preview timeout). JS mode only (the first run must still be running): two rapid Filter runs show only
the newer result and one success message; a Split that finishes keeps the processing state of a running Filter.

The Tauri test switches "Keep Empty Lines" explicitly, because an existing `settings.json` may still
contain `showEmptyLines: false` (the default before the option was wired to Split).
