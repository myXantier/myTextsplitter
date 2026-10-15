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
A known engine difference uses `expectedRust` + `expectedJs` and must be explained in `divergence`;
`resolved` documents a former divergence (the line-ending cases resolved by Paket 6).

Split semantics (both engines):

- Rows are the data lines of the shared line model (see "Line-ending fixtures"): LF, CRLF and CR are line breaks,
  a trailing line break adds no row, an empty text has no rows, values never contain `\r`.
- Every processed input row has exactly one value in every column; missing parts are `""` (B1).
- Empty split fields (`A,,C`) are kept, so the column assignment stays intact.
- `keepEmptyLines` = permanent setting `showEmptyLines` (Settings → Processing → "Keep Empty Lines",
  default `true`). `false` skips **completely empty** input lines (with any line ending).
  Whitespace-only lines are **not** empty and are always kept (with `trimParts` they become `""` values).

Known differences between Rust and JS (unchanged existing behaviour, documented in the fixtures):

| Topic | Rust (`fancy-regex`) | JS (`RegExp`) |
|---|---|---|
| Regex capture groups | captured text is dropped | every capture becomes an extra column |
| `\w`, `\W`, `\d`, `\s` | Unicode-aware | ASCII (no `u` flag) |
| Empty plain delimiter | `""` before and after the characters | only the characters |

The former differences for trailing newlines, empty input and CRLF (`str::lines()` vs. `split('\n')`) no longer exist.
Further regex split differences (named/non-participating captures, zero-width matches at the line start, `\b`,
Unicode `\d`) are documented as `divergence` cases in the fixtures.

## Line-ending fixtures (`tests/fixtures/line-endings-cases.json`, Paket 6)

Shared by `npm test` (`tests/unit/line-endings.test.ts`: line model, real worker modules, main-thread fallbacks) and
`cargo test` (`line_endings.rs`, `text_processor.rs`, `diff/tests.rs`). Sections: `lines` (line model), `filter`,
`remove`, `combine`, `diff` (which lines are unchanged/changed; the complete diff is in `diff-cases.json`) and `sort` (JS only,
Sort has no Rust implementation). The line model is implemented twice with the same rules:
`src/utils/lines.ts` (`splitLines`, `joinLines`, `lineFormatOf`) and `src-tauri/src/line_endings.rs`.

| Rule | Meaning |
|---|---|
| Line breaks | LF, CRLF and CR, detected from the text (never from the OS). U+2028/U+2029, NEL, VT, FF are no line breaks. |
| Data lines | `"A\nB"` and `"A\nB\n"` = 2 lines, `"A\nB\n\n"` = 3 (last one empty), `""` = no line, `"\n"` = one empty line. Terminators are not part of a line. |
| Result format | Newly generated text uses the most frequent line ending of the input; tie: the one that occurs first; no line break: LF. The input is never changed. |
| Trailing newline | A non-empty result keeps the trailing newline of the input; no remaining line = `""`. |
| Regex | Patterns run per line on the line content (no terminator), so `$`, lookbehind etc. behave the same for LF/CRLF/CR. Texts are not normalized before a regex. |

Per operation: Filter/Remove/Sort join their result lines with the input format (Filter `splitMatches` too). Diff compares
line contents: CRLF vs. LF and a trailing newline on one side only are no difference. Combine joins the *columns*
(`combineColumns` in JS, `combine_columns` in Rust; the combined text is never split again, so trailing empty values
keep their rows) with the line format of the text that was split (stored on a successful Split); the column copy uses
the same format. One empty line without trailing newline and an empty result are both `""` (text representation).

## Filter/Remove fixtures (`tests/fixtures/filter-remove-cases.json`, Paket 8 Phase B)

Golden fixtures for both engines: `npm test` (`tests/unit/filter-remove.test.ts`) and `cargo test`
(`text_processor.rs`, module `tests::filter_remove_fixtures`). They **characterize the current behaviour**: a passing
test means the behaviour is described correctly, not that it is wanted. Expectations are written by hand, never
generated from an engine.

| Field | Meaning |
|---|---|
| `options` | Always complete, no defaults. Filter: `mode`, `caseSensitive`, `splitMatches`. Remove: `removeMode`, `caseSensitive`, `useRegex`, `trimParts`. |
| `pattern` | A string, or `{ "repeat": "a", "count": 10001 }` for long patterns. |
| `expected` | Same result in both engines. Filter: the text or `{ "error": "invalidRegex" \| "regexRuntime" }`. Remove: `{ "text", "removedLines" }` or `{ "error" }`. |
| `expectedRust` + `expectedJs` + `divergence` | Different current results; `divergence.kind` is `dialect` (accepted, Paket 5), `suspectedBug`, `dataIntegrityRisk`, `inconsistentDefinition` or `unvalidatedInput`, with a `reason`. |
| `{ "utf16": ["D83D", …] }` | JS only: a result with lone UTF-16 surrogates (not storable as a JSON string). The test compares the code units and asserts that the result is not well-formed Unicode; only allowed with `dataIntegrityRisk`. |
| `expectedJsUnreachableMainThread` | `FilterService.frontendInMainThread`, which `invoke` never reaches. Tested separately, **not a product path**. |
| `ref`, `openQuestion` | Case id in the Phase A report; open product decision for identical behaviour. |

JS paths per case: the real worker module; for Remove also `frontendInMainThread`; and the service without Web Worker
(`invoke(args, false)` in Node): Filter always refuses (`regexRequiresWorker`, or `invalidRegex`), Remove runs
duplicates and literal search in the main thread and refuses regex jobs. Both runners reject malformed entries
(missing options, unknown keys, inconsistent expectations).

## Diff fixtures (`tests/fixtures/diff-cases.json`, Paket 7 B1)

One line diff, implemented twice with the same steps: `src/utils/diff/` (JS: Web Worker and main-thread fallback) and
`src-tauri/src/diff/` (Rust). `npm test` (`tests/unit/diff.test.ts`) and `cargo test` (`src-tauri/src/diff/tests.rs`)
check the **complete** result of every case: row order, old and new line numbers, move links and statistics
(notation in the file). Both suites also check every invariant (each old and new line exactly once and in order, original
texts, equal rows have equal keys, each move has exactly one delete and one insert, statistics without double counting).

| Section | Meaning |
|---|---|
| `cases` | hand-written cases (the 18 examples of the Phase A analysis and edge cases), expected values reviewed by hand |
| `documents` | the exact JSON of a few `DiffDocument`s (field names, omitted `moveId`) |
| `validatedDocuments` | valid and corrupted documents for the runtime validator (JS only): equal rows with different keys, moves between different, blank or repeated lines, unlinked unique moves, wrong id order |
| `limit` | exact work units of one alignment: the work limit counts identically in both engines |
| `generated` | 2000 random cases from the same xorshift32 generator in both suites; the FNV-1a digest of all results must match |

Algorithm and rules (details in `src/utils/diff/myers.ts`, `lineDiff.ts`, `whitespace.ts`):

- Myers, linear space (middle snake). Tie-break: lines that occur on one side only are removed first, common prefix/suffix,
  bisection, then "earliest match" (of several equal lines the earliest ones are paired). Between two matched lines all
  deletes come before all inserts. The result is minimal (as many unchanged lines as the LCS; checked against a DP).
- Moves are only added afterwards: a delete and an insert with the same key that occurs exactly once in each text and is
  not blank. Duplicates and blank lines stay delete + insert. `stats`: a move counts once (`moved`), not as removed/added.
- `ignoreWhitespace` only changes the comparison key (trim + whitespace runs = one space), never the displayed text.
  Whitespace = Unicode `White_Space` (25 code points, explicit list; not U+FEFF/U+200B). No NFC normalization; case matters.
- Work limit `DIFF_WORK_LIMIT` = 100,000,000 units (diagonals + snake steps, counted, not timed): exceeding it is the input
  error `diffTooComplex` (`errors.diffTooComplex`), never a partial result. Mostly equal or completely different texts are
  cheap (prefix/suffix and one-sided lines cost nothing); the limit applies to many reordered common lines (about 10,000
  reversed lines, about 1 s in JS).
- Transport: Rust returns `{ document, metrics }` as structured IPC data (blocking pool, own `JobSlot`); the Web Worker
  computes the diff from both complete texts in one message. `DiffService` validates every document and checks it against
  the request (options, line counts, every original text), so a truncated or foreign result is `invalidResult`.
  The validator also checks the semantics in linear time (equal rows have equal keys, moves follow the move rules) and
  runs before the metrics are applied (`BaseService.checkResult`): a rejected result never sets metrics.

## Word diff fixtures (`tests/fixtures/intraline-cases.json`, Paket 7 B2)

Optional word diff (intraline), implemented twice: `src/utils/diff/tokenize.ts` + `intraline.ts` and
`src-tauri/src/diff/tokenize.rs` + `intraline.rs`. It is a separate analysis of a finished `DiffDocument`
(`computeIntraline` / `compute_intraline`), computed only when a diff job requests it (see "Diff integration").
`npm test` (`tests/unit/intraline.test.ts`) and `cargo test` (`src-tauri/src/diff/intraline_tests.rs`) check:

| Section | Meaning |
|---|---|
| `limits` | the default limits (500 tokens per line, 2,500 pairing cells, 1,000,000 work units per pair, budget 2,000,000) |
| `tokens` | tokenizer results (explicit code point table: whitespace runs, words, punctuation/CJK/emoji as single tokens, combining marks, ZWJ sequences, flags) |
| `cases` | complete analyses (pairs, similarity, segments, skip reasons, work), reviewed by hand; `limits` overrides some limits |
| `invalidAnalyses` | valid and forged analyses for the runtime validator `intralineError` (JS only): negative/non-integer work, unknown skip reasons, invented similarity, `null` values, unknown fields, invalid skip entries |
| `generated` | 1500 random cases (half with small random limits, so every skip reason occurs) from the same xorshift32 generator; FNV-1a digest over the UTF-8 bytes |

Rules: pairs only inside one hunk (delete/insert run between equal rows), never moved or blank lines; Dice similarity of
the similarity tokens >= 0.5 (words, numbers, CJK, emoji, symbols; punctuation only counts for lines without them, so
`Alphabeta.` / `Zyxwvu.` are not paired); order-preserving DP (highest total score, ties: earliest old line). Token alignment
with the Myers code of the line diff: first the words, then (without `ignoreWhitespace`) the whitespace inside each gap.
Segments are texts (no offsets) and rebuild each line exactly. Limits never produce partial segments: `lineTooLong`,
`hunkTooLarge`, `budgetExceeded` (this and every later hunk) or a `tooComplex` pair; the line diff stays complete.

## Diff integration (Paket 7 B3)

- **Contract:** `DiffConfig.configParams.wordDiff` (optional, default off). Every path delivers the `Diff` result
  `{ document, intraline }` (`src/utils/diff/result.ts`): Rust `get_text_diff(oldtext, newtext, ignorewhitespace,
  worddiff)` answers `{ document, intraline, metrics }`, the Web Worker and the main-thread fallback use `diffInJs`.
  The line diff runs once; the word diff is computed from that document only when requested (`intraline: null`
  otherwise). `DiffService` validates the document (B1), the word diff (`intralineError`), the input texts and that the
  word diff is present exactly when requested, before metrics are applied.
- **View model:** `buildDiffView(document, intraline | null)` (`src/utils/diff/viewModel.ts`, no React) builds unified
  rows (document order, old/new line numbers), split rows (per hunk: word diff pairs on one row, other lines side by
  side), moves with the other position, statistics and skipped word diff lines; `formatDiffText` is the copy text
  (`"  "`, `"- "`, `"+ "` per line). The DiffPage only renders it (`tests/unit/diffView.test.ts`).
- **E2E:** `checkWordDiff` (`tests/e2e/lib/app.mjs`) runs in the browser (Web Worker) and in Tauri (Rust backend and JS
  mode): off by default, highlighted words of the paired lines only, split rows, copy text, hiding without a new
  comparison and switching the word diff on during a running comparison.

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
  Filter, Remove and Diff run on the blocking pool (`spawn_blocking`) through a `JobSlot` per operation (`job_slot.rs`): at
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
known functional bugs (Filter semantics) are not encoded in these tests. The diff result itself is checked by the unit
fixtures above; the rendered diff and word diff by `checkLineEndings` and `checkWordDiff`.

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

Line endings (`checkLineEndings`, Paket 6; browser: Web Worker, Tauri: Rust backend and JS mode): CRLF files with a
trailing newline are imported through "Open File" (typing into a textarea turns CRLF into LF) and run through Split
(no extra row, no `\r` in values), column copy, Combine, Filter, Remove (duplicates), Sort and Diff (CRLF file vs. the
same text typed with LF = no difference; Paket 7: a new text with more lines than the old one keeps every line, and a
move keeps both positions and is counted once). Results are read from React's props (`__t.raw`) and from the copied text
(`__t.captureCopy`), because `textarea.value` also normalizes line breaks to LF.

The Tauri test switches "Keep Empty Lines" explicitly, because an existing `settings.json` may still
contain `showEmptyLines: false` (the default before the option was wired to Split).
