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

The former differences for trailing newlines, empty input and CRLF (`str::lines()` vs. `split('\n')`) no longer exist.
Further regex split differences (named/non-participating captures, zero-width matches at the line start, `\b`,
Unicode `\d`) are documented as `divergence` cases in the fixtures.

Paket 10 Phase B (contract: `docs/analyse/Paket10-PhaseB-Regexvertrag.md`) extended the format, backwards compatible:

| Field | Meaning |
|---|---|
| `delimiter` | A string or `{ "repeat", "count" }` (long patterns). |
| `expected*` | Current behaviour; may also be `{ "error": "invalidRegex" \| "emptyDelimiter" \| "patternEmpty" \| "patternTooLong" }` (and, JS only, `regexSplitsCharacter`). |
| `divergence` | A string (accepted dialect difference) or `{ kind, reason }`: `dialect`, `utf16Guard` (the JS worker refuses the split with `regexSplitsCharacter`, Rust never cuts a character; required for that error), `utf16Damage` (the JS split still damages a character; only with a pending JS target, none left after C1), `unvalidatedInput`. An independent test oracle (native `matchAll` with match indices and native `split`) checks that exactly the cases whose native JS split would cut a pair are refused or marked. |
| `target` or `targetRust` + `targetJs`, `pending` | Target of a not yet implemented decision (none left: E3, E4, E5 and E9 are implemented): columns or `{ error: invalidRegex \| emptyDelimiter \| patternEmpty \| patternTooLong \| regexSplitsCharacter }` (the last JS only). `pending { decisions, phase, engines, reason }`: exactly the listed engines still differ from their target; both runners check it against the real engines, so the suite stays green and a reached target is noticed. |
| `ref` | Finding of `docs/analyse/Paket10-PhaseA-Regex-Analyse.md`. |

**Paket 10 C4 (E9):** the JS regex split uses the flag `g` (formerly `gm`) in the native split and in the checked
reproduction for lines with surrogates (`gd` with match indices): `^` and `$` match only at the start and end of the data
line, not next to U+2028/U+2029 inside it, like Rust. Real line breaks (LF, CRLF, CR) are rows of the line model.
Remaining differences are dialect (empty part after/before an empty match at the line end/start in Rust, captures).
Tests: the E9 fixtures, `split (JS, E9)` in `split.test.ts` (native `g` split comparison with U+2028/U+2029, before/after
with `gm`), E2E `checkSplitFlags` (browser; Tauri in Rust and JS mode).

**Paket 10 C1 (implemented, `resolved` in the fixtures):**

- **E4:** an empty plain delimiter is invalid input `emptyDelimiter` (`errors.emptyDelimiter`, de/en) in the JS worker, the
  main-thread fallback (`SplitInputError` of `splitColumns.ts`), Rust (`TextError::EmptyDelimiter`, IPC kind
  `emptyDelimiter`, mapped by `fromBackendError`) and the Split page; checked before the text, also for an empty text.
  Whitespace delimiters stay valid; the empty *regex* pattern is rule E3 (Paket 10 C3, below).
- **E5:** the JS regex split refuses (`regexSplitsCharacter`, no partial columns) when an effective split position or a
  boundary of a participating non-empty capture lies inside a surrogate pair (an empty capture only adds an empty column,
  e.g. `\uD83D()\uDE00`). Lines with surrogates follow the steps of
  `RegExp.prototype[Symbol.split]` with one match at a time (an empty match at the previous split end and a match at the
  line end are skipped like in the native split); captures are located with match indices (flag `d`, only for patterns
  with groups). Lines without surrogates and well-formed plain delimiters use the native split unchanged. Lone surrogates
  already in the input are not refused. A seeded test compares the checked split with the native split for 1500 lines ×
  42 patterns.

The JS side runs every case through `splitColumns.ts`, the real `SplitWorker` module and the service without Web Worker
(plain splits run in the main thread, a regex is refused: `regexRequiresWorker`, or `invalidRegex` for an invalid, empty
or too long pattern). Rust does not read `expectedJs`/`targetJs` (they may contain lone surrogates).

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

Per operation: Filter/Remove/Sort join their result lines with the input format (Filter `splitMatches` too; Sort adds a
trailing newline if an empty line ends its result, otherwise that line would be lost, Paket 9 C1). Diff compares
line contents: CRLF vs. LF and a trailing newline on one side only are no difference. Combine joins the *columns*
(`combineColumns` in JS, `combine_columns` in Rust; the combined text is never split again, so trailing empty values
keep their rows) with the line format of the text that was split (stored on a successful Split); the column copy uses
the same format. One empty line without trailing newline and an empty result are both `""` (text representation).

## Filter/Remove fixtures (`tests/fixtures/filter-remove-cases.json`, Paket 8)

Golden fixtures for both engines: `npm test` (`tests/unit/filter-remove.test.ts`) and `cargo test`
(`text_processor.rs`, module `tests::filter_remove_fixtures`). Phase B characterized the behaviour; Phase C1 corrected
some of it (cases turned from per-engine into shared expectations). A passing test means the behaviour is described
correctly, not that every documented difference is wanted. Expectations are written by hand, never generated from an engine.

Semantics fixed in C1:

- **Whitespace** (Filter blank lines, Remove trim of the duplicate key) is the Unicode `White_Space` set of
  `src/utils/diff/whitespace.ts` (`isBlankLine`, `trimWhitespace`), the same as Rust `str::trim`: U+0085 is
  whitespace, U+FEFF is not. Regex `\s` is unchanged.
- **Duplicates with trim:** trim and case only change the comparison key; the original first occurrence is output.
- **Filter "remove matches" (C2):** a line is dropped only if a match actually removed text from it and the rest is
  empty or whitespace-only (same whitespace set). A line without removed text (no match, only zero-width matches) stays
  exactly as it is, also an empty or whitespace-only line. The keep mode still skips blank lines. Changed expectations
  carry a `resolved` note. E2E: `checkLineEndings` (browser, Tauri with Rust, Tauri with JS).
- **Modes (C3):** only `keep`/`remove` (Filter) and `duplicates`/`containing`/`notContaining` (Remove) are accepted,
  exactly as written. Anything else, also an empty mode, is `{ "error": "invalidMode" }`: Rust `TextError::InvalidMode`,
  JS `invalidInput` / `errors.invalidMode` (`src/utils/textModes.ts`), checked before the regex and also for an empty
  text. The services refuse it before any processing path runs (`checkRequest`), so no result and no metrics are applied.
  The Remove page labels the trim option as "duplicates only" (with tooltip); E2E: `checkProcessingErrors`.
- **Cut characters (JS Filter):** a RegExp without `u` works on UTF-16 code units. If a match boundary lies inside a
  surrogate pair and the result would not put both halves next to each other again (split matches, a partly removed
  emoji, halves of two different emoji), the worker reports `invalidInput` / `errors.regexSplitsCharacter` instead of
  returning damaged text (`matchesWithoutCutCharacters` in `src/utils/regex.ts`). Lone surrogates already in the input
  are not refused. The check is a generator: it keeps only the previous match end and one open cut, never a list of
  matches. Lines without surrogates skip it; the remove mode drains it and then uses the native `replace` (memory for
  the result only, an error never leaves a partial result). Targeted cases: `tests/unit/surrogate-guard.test.ts`
  (time and memory are measured separately, not asserted in unit tests).

| Field | Meaning |
|---|---|
| `options` | Always complete, no defaults. Filter: `mode`, `caseSensitive`, `splitMatches`. Remove: `removeMode`, `caseSensitive`, `useRegex`, `trimParts`. |
| `pattern` | A string, or `{ "repeat": "a", "count": 10001 }` for long patterns. |
| `expected` | Same result in both engines. Filter: the text or `{ "error": "invalidRegex" \| "regexRuntime" \| "invalidMode" \| "patternEmpty" \| "patternTooLong" }`. Remove: `{ "text", "removedLines" }` or `{ "error" }`. |
| `expectedRust` + `expectedJs` + `divergence` | Different current results; `divergence.kind` is `dialect` (accepted, Paket 5), `utf16Guard`, `suspectedBug`, `inconsistentDefinition` or `unvalidatedInput`, with a `reason`. |
| `{ "error": "regexSplitsCharacter" }` | JS Filter only, always with `utf16Guard`: Rust processes valid Unicode, the JS worker refuses a result with a cut character. Every successful JS result is checked to be well-formed Unicode. |
| `ref`, `openQuestion` | Case id in the Phase A report; open product decision for identical behaviour. |
| `resolved` | Why a correction changed the expectation (only with a shared `expected`). |
| `target` + `pending` | Paket 10: result of a not yet implemented decision in both engines (none left in these fixtures after C3). `pending { decisions, phase, engines, reason }`: exactly the listed engines still differ from the target (checked against the real engines in both runners). |
| `preview` | Paket 10, Filter only, JS only: the pattern preview (`MatchPreviewWorker`, `buildMatchPreview`; it knows `caseSensitive` and `splitMatches`, not the mode). `segments` = rows `[text, match, …, text]` per line with a non-empty highlight, or `{ "error": "invalidRegex" \| "regexSplitsCharacter" }`; `keepSplitCutsCharacter: true` = some highlights join two halves of a character, so only "keep" with split matches refuses them (C2, E1); `resolved` = why C2 changed the expectation; `target` + `pending { decisions, phase, reason }` = a still open preview decision (E3); `note` = intended difference to the Filter result (E2). Rows never contain a lone surrogate and rebuild their input line; with the mode of the case the preview judgement gives exactly the JS Filter verdict (cut in every mode = refused; joined halves = refused only by keep with split matches). The preview worker runs for every Filter case (complete, without omissions, line numbers and match count checked). |

JS paths per case: the real worker module; for Remove also `frontendInMainThread`; and the service without Web Worker
(`invoke(args, false)` in Node): Filter always refuses (the mode, pattern and syntax errors of the worker, otherwise
`regexRequiresWorker`), Remove runs duplicates and literal search in the main thread and refuses regex jobs. Paket 10 C6
(E10): the Filter has no main-thread implementation (the former one with outdated rules and the field
`expectedJsUnreachableMainThread` are gone); `FilterService.frontendInMainThread` refuses with `regexRequiresWorker`, also
when called directly, and a RegExp spy checks that the user regex never runs in the main thread (with a positive control
on the worker module). Both runners reject malformed entries
(missing options, unknown keys, inconsistent expectations).

## Sort contract fixtures (`tests/fixtures/sort-cases.json`, Paket 9)

JS only (Sort has no Rust implementation), run by `tests/unit/sort-contract.test.ts` with the helpers in
`tests/unit/helpers/sort-properties.ts`. Phase B wrote the contract and the golden results by hand, Phase C1 implemented
them (`src/utils/sortLines.ts`, `src/utils/sort/`). Contract and decisions: `docs/analyse/Paket9-PhaseB-Sortiervertrag.md`.

| Field / section | Meaning |
|---|---|
| `rules` | The contract (R1-R9 general, N1-N6 natural), referenced by every case. |
| `cases[].expected` | Golden result, asserted against the real `sortText` (also: sorting it again changes nothing). The golden data is checked for consistency too: same lines as the input, line format of the input (plus the trailing newline of R9 / OD-8 B), blank lines at the end in input order (R1), and for alphabetical, `icuNumeric` and length cases the order against `Intl.Collator('de')` / code points. |
| `basis`, `resolved` | `decision` or `derived`; `resolved` names the open decision of Phase B the case settles. |
| `invalidMethods` | `{ "error": "invalidMode" }`: `sortText` throws `ProcessingError` `invalidInput` / `errors.invalidMode`. |
| `properties` | Corpora of equivalence classes in sort order. 40 seeded permutations each: classes in order, ties in input order, no line lost, idempotent. |
| `random` | No golden order: `sortText(text, 'random', cs, { random })` with a seeded generator; chi-square over the 6 permutations of 3 lines and per position of 10 lines, blank lines at the end. |

The comparator laws (antisymmetry, transitivity) of every order are checked directly (`lineOrder` of
`src/utils/sort/compare.ts`) on a corpus of critical lines; antisymmetry also on every line of the golden cases.
All orders use `Intl.Collator('de')` explicitly and do not depend on the host locale (only on the ICU data of the runtime).

Processing path (Paket 9 C2): the Sort page runs `SortService` (`src/services/SortService.ts`, `BaseService`: latest job
wins, timeout, error contract) with `SortWorker`, in the browser and in Tauri (also in Rust mode: there is no sort
command). `tests/unit/sort-service.test.ts` runs the real worker module behind a fake `Worker` with every golden case
(worker = `sortText`, no Tauri command), supersede/timeout/crash/malformed answers and the line-count check of the result
(`countLines`); `tests/unit/sort-main-thread.test.ts` covers the path without Web Worker (main thread up to
`SORT_MAIN_THREAD_LIMITS`, larger texts `errors.sortRequiresWorker`). E2E: `checkSort` in `tests/e2e/lib/app.mjs`
(browser; Tauri in Rust and JS mode): golden cases through file import, worker used, exact copy, outdated marker, case
option, empty and whitespace-only input, rapid clicks, 100 000 lines.

Timing baselines (not part of `npm test`): `node tests/bench/sort-baseline.ts` (algorithm in Node) and
`node tests/bench/sort-ui-baseline.mjs` (algorithm and UI in headless Chrome/Edge; production preview if `dist/` exists),
both with the seeded input of `tests/bench/sort-data.mjs`.

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

Paket 10 (R7) added more silent differences: `\h` (Rust: hex digit, JS: `h`), `\u{1F600}` (JS: literal text), `\0`
(Rust accepts it but does not match NUL), `.` at U+2028/U+2029 and `\s` at U+0085 (`different`), `\Z` and `\1` without a
group (`jsOnly`: JS literal/octal, Rust error), and `a$` before U+2028 (`same` in the Filter, flag `g`; since Paket 10 C4
(E9) the JS Split uses `g` too, formerly `gm`: see the resolved E9 cases in `split-cases.json`). A surrogate escape such as `\uD83D` is an error in Rust (no
Unicode scalar value) and cuts characters in JS (Filter: `regexSplitsCharacter`). `jsRuntimeDependent { reason,
otherJsResults }` marks syntax whose JS result depends on the engine version, e.g. the modifier group `(?i:a)` (V8 12.5+,
Chrome/WebView2 125+, Node 23+; older runtimes: `invalidRegex`): the JS result must be the expectation or one of
`otherJsResults`, no cross-version guarantee is claimed.

## Regex execution (Paket 5)

- **Rust:** `fancy-regex` with an explicit `REGEX_BACKTRACK_LIMIT` (= default 1,000,000 per match attempt). This is a
  step limit, not a time limit; patterns without fancy features run in the linear-time `regex` crate. Exceeding it is
  `regexRuntime` -> "too complex". All text commands are `async` (sync Tauri commands run on the main thread); Split,
  Filter, Remove and Diff run on the blocking pool (`spawn_blocking`) through a `JobSlot` per operation (`job_slot.rs`): at
  most one running and one waiting job, waiting happens in the async command (no blocked thread). A newer request
  replaces the waiting one, which never runs and drops its input (`superseded`). A panicking job is `internal` (backend
  error) and does not block later jobs.
- **Rust regex budget and supersede (Paket 10 C5B, E6):** a running user regex job (Split with regex, Filter keep/remove,
  Remove containing/notContaining with regex) has a cooperative time budget from its execution start (Split and Filter
  10 s, Remove 12 s) and the supersede signal of its `JobControl`: a newer request of the same operation marks the running
  job, a job never signals a newer one. Checks (`Checkpoint` in `text_processor.rs`, `RegexBudget` in `job_slot.rs`) run
  before and after compiling, around every line, before and after every single search step (`split`/`find_iter` items,
  `is_match`) and before the result; Filter remove streams `find_iter` instead of `try_replacen` (same text, checked
  against it). Budget: `regexRuntime` -> "too complex"; superseded: `superseded`, hidden when a newer job exists. No partial
  result, metrics kept. **No hard limit:** a single running search or compile cannot be interrupted, the job ends at the
  first check after it (measured: 3.3 s over the budget for a quadratic lookahead on 80,000 characters, 66 s for a
  10,000-character literal on 1 MB). `BaseService.cancelPending` alone does not reach Rust: such a job ends at its budget
  or when a newer request of the same operation arrives. Plain splits, plain Remove, duplicates and Diff never check
  (no new limit). Tests: `regex_jobs_fail_at_every_checkpoint_without_a_partial_result` and the other E6 tests in
  `text_processor.rs` (counted checks, no timing), the supersede/budget tests in `job_slot.rs` (channels, one small real
  budget), `processing.test.ts` (frontend mapping, metrics).
- **JS:** user regexes only run in Web Workers. The timeout calls `Worker.terminate()` immediately, which really stops a
  running regex (`worker-termination.test.ts` runs the real worker module in a `worker_threads` thread). A terminated
  worker is never reused; only the latest job per type is delivered (older ones end as `superseded` and are not shown).
- **Latest job wins** (Rust and JS): result and metrics of a superseded job are never applied, also not on the same
  service instance; it changes no loading state and shows no message. The global processing state ends only when no
  other operation type is still running (`src/hooks/runningOperations.ts`).
- **No Web Worker** (main-thread fallback): jobs with a user regex are refused (`errors.regexRequiresWorker`; an empty or
  too long pattern still reports `patternEmpty` / `patternTooLong`, an invalid one `invalidRegex`); jobs without regex still run there.
- **Regex pattern rule (Paket 10 C3, E3):** every user regex (Split with regex, Filter, Remove containing/notContaining
  with regex, pattern preview) must not be empty (spaces are allowed) and may have at most 10,000 UTF-16 code units
  (`MAX_PATTERN_LENGTH`, `src/utils/regexPattern.ts`; JS `pattern.length`, Rust `encode_utf16().count()` in `check_pattern`,
  `src-tauri/src/text_processor.rs`). Checked after the mode and before compiling, also for an empty text; errors
  `patternEmpty` / `patternTooLong` (`invalidInput`, IPC kinds of the same name, `errors.*` de/en), never `invalidRegex`.
  Not checked: plain delimiters (only `emptyDelimiter`), plain Remove search terms, the duplicates mode. Tests: the shared
  fixtures (boundaries 9,999 / 10,000 / 10,001, 5,000 / 5,001 emoji, emoji + ASCII, before the syntax), `regex.test.ts`,
  `split.test.ts`, `workers.test.ts` (every worker), `processing.test.ts` (IPC kinds, main thread, metrics), Rust
  `pattern_rule_counts_utf16_code_units_before_compiling` and `text_commands_report_the_regex_pattern_rule_as_pattern_errors`.
- **Validation** happens in the engine that runs the pattern (no JS pre-validation in Rust mode). The pattern preview of
  the Filter page always uses JS in its own worker; in Rust mode it says so, and a pattern JS rejects shows a note.
- **Known limits (Paket 10, decided for Phase C):** the backtracking limit applies to one search, not to a job
  (`backtrack_limit_applies_per_search_not_per_job`); the job budget of C5B is checked between searches only, and one
  search cannot be interrupted (measured up to about a minute for a 10,000-character literal on a 1 MB line). Details: `docs/analyse/Paket10-PhaseB-Regexvertrag.md`.
- **Pattern preview (Paket 10 C2):** `buildMatchPreview` (`src/utils/matchPreview.ts`) builds the answer `MatchPreview`
  `{ rows: [{ line, segments, elided, restOmitted }], matches, complete, keepSplitCutsCharacter }` with the limits
  `PREVIEW_LIMITS`, enforced while it is built (no match list): 1,000 highlights per row (the rest of the line is cut,
  `restOmitted`), 1,000 rows, 20,001 segments, 200,000 stored characters; segments longer than 200 units are shown as their
  first and last 80 units with an omission marker (`elided`, never inside a surrogate pair). `complete: false` = a limit
  stopped it (the page says "at least …" and "incomplete"; "no matches" only for a complete search). Cut characters use the
  Filter guard `matchesWithoutCutCharacters` with adjacent matches joined: a cut in every mode is the error
  `regexSplitsCharacter`, joined halves are one highlight and, with "split matches", `keepSplitCutsCharacter`. Unit tests:
  `regex.test.ts` (Unicode cases, line endings, complete and limited previews with the omitted text), `workers.test.ts`
  (worker answer, limits at full size, splitMatches change, timeout); sizes and UI costs: `node tests/bench/preview-baseline.mjs`.

## File import fixtures (`tests/fixtures/file-io-cases.json`, Paket 11)

Real files for the two import paths: the "Open File" button (`OpenFileButton`, every page) and the drop onto the Remove
textarea. Contract D1–D14: `docs/analyse/Paket11-PhaseB-Datei-IO-Vertrag.md`; findings F1–F15: the Phase A report and the
contract. Per case: `file` (name), `bytes` (hex) or `generate` (byte count of a deterministic ASCII text, written at run
time), the CURRENT result `expected` or `expectedButton` + `expectedDrop` (`{ text }`, `{ generatedText }`, `{ unchanged }`
= previous text kept without a message, `{ rejected, message? }` = previous text kept with an error message), and for an
open decision `target` + `pending { decisions, phase, paths }` (exactly the paths still differing). `divergence
{ kind: "chromiumFileReader", whatwg }` marks a Chromium result that differs from the WHATWG decode (F15: an odd UTF-16
byte count is dropped silently). `scenarios` describe import flows (reselection, read errors, overlapping imports,
loading state, navigation, cancelled dialog) as `current` / `target` observations with `pending.fields`.

`tests/unit/file-io-fixtures.test.ts` checks only the fixture data: the format, the current expectations against a model
of today's code (WHATWG decode with BOM sniffing, every content read is set also `''` since C1, drop checks `.txt`
case-sensitively and 10 MiB), the targets against the contract (strict decoding, `.txt` in any case, at most 10 MiB
inclusive) and the pending lists. Whether the app behaves like this is checked only by `checkFileIo` (below).

`tests/unit/file-import.test.ts` (Paket 11 C2, C3) checks the shared import path (`src/utils/fileImport.ts`): the strict
decoder `decodeText` (BOM selects UTF-8 / UTF-16LE / UTF-16BE and is removed once, otherwise UTF-8; invalid or incomplete
sequences and an odd UTF-16 byte count are refused, never replaced by U+FFFD; a valid U+FFFD stays), the file check
`checkImportFile` (`.txt` in any case, at most 10 MiB inclusive) and, with a controllable FileReader stand-in
(`readAsArrayBuffer`), the import jobs: latest import wins, a replaced import sets no text, shows no error and does not
end the loading state of its successor, a refused file starts no job (a running import stays current), an accepted file
that fails to decode ends its own job with `invalidEncoding`, an empty content is a text, targets are independent,
nothing happens after `dispose` (unmount) and a new import works after an error. Since C3 `file-io-fixtures.test.ts`
checks the current expectations with these product functions. The React binding (`useFileImport`: the shared source text in
`PageList`, the new Diff text in `DiffPage`; `readOnly` + `aria-busy` + the hint) is checked by `checkFileIo`.

## Integration tests

They drive the **real application** and are not part of `npm test`.

### Browser (`npm run test:e2e:browser`)

- Builds the frontend, then tests the Vite dev server **and** the production build (`vite preview`).
- Single mode: `node tests/e2e/browser.e2e.mjs --mode=dev` or `--mode=preview` (needs `npm run build`).
- Targeted run (Paket 11): `E2E_ONLY=file-io` runs only the start checks and `checkFileIo`, e.g.
  `E2E_ONLY=file-io node tests/e2e/browser.e2e.mjs --mode=dev` (PowerShell: `$env:E2E_ONLY='file-io'`).
- Runs without Tauri runtime and without mocks. It checks startup, navigation, Split/Sort/Filter/Remove/Diff,
  the JS mode with its metrics, persistence of the settings across a reload, and damaged `localStorage` data.
- Browser: found automatically (Chrome, Edge, Chromium); otherwise set `CHROME_PATH`.
- Vite and the browser run on free ports with a temporary profile. Both processes are stopped and the
  profile is deleted afterwards (also on failure / Ctrl+C).

### Tauri (`npm run test:e2e:tauri`)

- Prerequisite: `npx tauri build --no-bundle` (the test warns if sources are newer than the build).
  `TAURI_APP_PATH` can point to another executable.
- Targeted run (Paket 11): `E2E_ONLY=file-io npm run test:e2e:tauri` starts the app once and runs only the start checks,
  `checkFileIo` and the error check of the main window (no settings round trip, no restart).
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

Split integrity (`checkSplitIntegrity`, Paket 10 C1; browser: Web Worker, Tauri: Rust backend and JS mode): an empty plain
delimiter shows the input error, `[😀]` and `(\uD83D)\uDE00` are refused in JS (Rust: whole-emoji split, invalid regex), the
previous columns and metrics stay, and whole-emoji captures and a plain emoji delimiter work afterwards.

Regex robustness (`checkRegexRobustness`, Paket 5; browser: Web Worker, Tauri: Rust backend and JS mode): a catastrophic
regex keeps the UI responsive and ends with one error message (JS: worker timeout after ~10 s, Rust: backtracking limit)
while the previous result stays; the next normal Filter works. Split with the Rust-only pattern `(?i)x` is processed in
Rust mode and reported with the JS syntax error in JS mode. Paket 10 C2 `checkMatchPreview` (browser; Tauri in Rust and JS mode): a surrogate half is a note, not a highlight;
a whole emoji is highlighted with the match counter; "split matches" updates the joined-halves note; 100,000 matches show
1,000 highlights, the row cut marker and the incomplete note; a valid preview after an error; the JS engine note only in
Rust mode. Surrogate notes depend on the Filter engine: for `😀x` with `.` (keep, split matches) and `😁` with `[😀]`
(remove) the real JS Filter refuses and its notes say so; the real Rust Filter succeeds (`😀`/`x`, `😁` unchanged) and the
Rust mode notes speak only about the JS preview. Paket 10 C3 `checkPatternRule` (browser; Tauri in Rust and JS mode): on the
Split (regex), Filter and Remove (regex) pages an empty pattern, 10,001 units and 5,001 emoji show their own message
(not the syntax error), the previous result and metrics stay, a later valid job works; a plain delimiter and a plain
search term of 10,001 characters work, duplicates ignore an empty, invalid or too long pattern; the preview of a too long
pattern names the length, also in Rust mode. The pattern preview is checked for highlighting, the engine
hint (Rust mode), the note for patterns JS rejects (also after switching the engine) and the stop of a catastrophic
preview (3 s preview timeout). JS mode only (the first run must still be running): two rapid Filter runs show only
the newer result and one success message; a Split that finishes keeps the processing state of a running Filter.

Line endings (`checkLineEndings`, Paket 6; browser: Web Worker, Tauri: Rust backend and JS mode): CRLF files with a
trailing newline are imported through "Open File" (typing into a textarea turns CRLF into LF) and run through Split
(no extra row, no `\r` in values), column copy, Combine, Filter, Remove (duplicates), Sort and Diff (CRLF file vs. the
same text typed with LF = no difference; Paket 7: a new text with more lines than the old one keeps every line, and a
move keeps both positions and is counted once). Results are read from React's props (`__t.raw`) and from the copied text
(`__t.captureCopy`), because `textarea.value` also normalizes line breaks to LF.

File import (`checkFileIo`, Paket 11 Phase B, updated in C1 and C2; browser and Tauri in Rust mode, once): every byte fixture through the
button (`DOM.setFileInputFiles` with the real file, i.e. the Chromium file chooser path with its real `change` event, one
path per case) and through the drop (`Input.dispatchDragEvent` with the real file onto the Remove textarea); the same
path chosen again (F3, no artificial `change`); real read errors (a path that does not exist, a file deleted before its
read starts); overlapping imports, the loading state and navigation as a **controlled simulation**: the FileReader and
Blob read methods are wrapped in the page and the start of a read is held and released in a fixed order, then the
browser really reads (no fixed sleeps, completion is counted); typing uses real key input (`Input.insertText`); the
cancelled dialog uses an intercepted file chooser (`Page.setInterceptFileChooserDialog`, opened with a user gesture).
Since C3 a refused file (extension, size, invalid encoding) shows exactly one snackbar, the localized message of its
reason (read from `src/i18n/locales`), the same for the button and the drop. The drop point is a visible point of the
textarea outside the layout boxes of the snackbar containers (their messages slide with a transform, the boxes do not
move) and confirmed with `elementFromPoint`; no app style is changed, a missing free point or an undelivered drop fails
with the covering elements; a valid drop is checked while error messages cover a part of the textarea. The checks expect the current behaviour; a
pending target is named in the check label. No error is expected: since
Paket 11 C1 a failed button read shows `notifications.readError` without a React hook error (F1), and any logged error,
also a hook error, fails `checkFileIo` and the final error check of the Tauri main window. File drop zones (Paket 11 C5): every text input is a file drop zone of its own import target (Split, Filter, Remove,
Sort, Diff old = the shared source text; Diff new = its page-local text), `useDragAndDrop(fileImport)` = the same job as
its Open File button. Per zone a valid file, a `.csv`, invalid bytes and an empty file are dropped (exact text, one
localized message, `""`; on Diff the other field stays); a held drop locks the text (`readOnly`, `aria-busy`, hint); drop
A, drop B, button C on Split and button A, drop B on the new Diff text: only the latest is set; the Diff fields lock
independently; the late error of a replaced drop shows no message. Only file drags (`dataTransfer.types` with `Files`)
are handled; a text drag onto a text field (also onto Remove) is inserted by the browser. The 41 byte fixtures run
through the button and the Remove drop only (the shared path).

File drop guard (Paket 11 C4B, `src/utils/fileDropGuard.ts`, unit test `tests/unit/file-drop-guard.test.ts`): a real file
dragged onto the header of Remove, onto the Split options, onto an Open File button and onto a result column ends without drop, without
navigation (CDP page events, URL, page helpers still present), without read and without message; a text drag is
left alone (the textarea inserts it); the result columns are still reordered by an in-page drag (real Chromium drag:
`Input.setInterceptDrags`, mouse press and move, the intercepted drag data dropped on the target column). A page that
stops answering after a file drop (navigated to the file) fails the run instead of hanging. **Limit:** CDP drags enter
the renderer, after the native OS drop target. Since C4B the main window has `dragDropEnabled: false` (WebView2 handles
Explorer drops itself, F8 confirmed manually before), but whether a real Explorer drop and a native in-page drag work
in the Windows app is shown only by the manual Windows test. Native file dialogs are not automated.

The Tauri test switches "Keep Empty Lines" explicitly, because an existing `settings.json` may still
contain `showEmptyLines: false` (the default before the option was wired to Split).
