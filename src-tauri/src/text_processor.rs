use fancy_regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::line_endings::{join_lines, split_lines, LineFormat, TextLines};

use memory_stats::{memory_stats, MemoryStats};
use thousands::Separable;

pub struct TextProcessor;

/// A used column of the Combine (same shape as `ColumnSeparator` in the frontend).
#[derive(Debug, Clone, Deserialize)]
pub struct CombineColumn {
    /// Index of the split column
    pub index: usize,
    /// Placed before the value of this column (ignored for the first used column)
    pub separator: String,
}


/// `None` (JSON `null`) = the memory metric is not available on this platform.
#[derive(Clone, Debug, Serialize)]
pub struct BackendMetrics {
    execution_time_ms: f64,
    memory_usage_kb: Option<usize>,
    memory_usage_str: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessedText<T> {
    pub(crate) result_text: T,
    pub(crate) removed_lines: usize,
    pub(crate) metrics: BackendMetrics,
}

/// Error of the text commands. Reaches the frontend through Tauri IPC as `{ kind, message }`
/// (`src/services/ProcessingError.ts`), so invalid user input can be told apart from technical errors.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum TextError {
    /// The pattern is not a valid regex.
    InvalidRegex(String),
    /// The regex failed while matching (e.g. backtrack limit exceeded).
    RegexRuntime(String),
    /// The diff alignment needs more work than `diff::DIFF_WORK_LIMIT` (too many reordered lines). No partial result.
    DiffTooComplex(String),
    /// The Filter or Remove mode is not supported (unknown or empty): invalid user input, never a silent default.
    InvalidMode(String),
    /// The plain (non-regex) split delimiter is empty (Paket 10 E4): invalid user input, never a split into characters.
    EmptyDelimiter(String),
    /// The processing task itself failed (panic or cancelled task), not the user input.
    Internal(String),
    /// A newer request of the same operation replaced this one before it started (it never ran).
    Superseded,
}

impl std::fmt::Display for TextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TextError::InvalidRegex(message) => write!(f, "invalid regex: {message}"),
            TextError::RegexRuntime(message) => write!(f, "regex runtime error: {message}"),
            TextError::DiffTooComplex(message) => write!(f, "diff too complex: {message}"),
            TextError::InvalidMode(message) => write!(f, "invalid mode: {message}"),
            TextError::EmptyDelimiter(message) => write!(f, "empty delimiter: {message}"),
            TextError::Internal(message) => write!(f, "internal error: {message}"),
            TextError::Superseded => write!(f, "superseded by a newer request"),
        }
    }
}

/// Backtracking limit of fancy-regex per match attempt (= its default, set explicitly to make it visible).
///
/// This is a step limit, **not a time limit**: it only applies to patterns that need the backtracking VM
/// (lookaround, backreferences, atomic groups, ...). Other patterns are delegated to the linear-time `regex`
/// crate. The limit applies to every single match attempt, so the total run time still grows with the
/// number of lines and matches. A running command cannot be stopped from the outside.
pub const REGEX_BACKTRACK_LIMIT: usize = 1_000_000;

fn build_regex(pattern: &str) -> Result<Regex, fancy_regex::Error> {
    RegexBuilder::new(pattern).backtrack_limit(REGEX_BACKTRACK_LIMIT).build()
}

/// Compiles a user pattern. Case-insensitive matching uses an `(?i)` prefix: `RegexBuilder::case_insensitive`
/// is not equivalent in fancy-regex 0.14 (it ignores lookaround/atomic groups and cannot be overridden by `(?-i)`).
fn compile_regex(pattern: &str, case_insensitive: bool) -> Result<Regex, TextError> {
    if !case_insensitive {
        return build_regex(pattern).map_err(|e| TextError::InvalidRegex(e.to_string()));
    }
    build_regex(&format!("(?i){pattern}")).map_err(|e| {
        // Report the error for the user's pattern (positions would otherwise be shifted by the prefix)
        TextError::InvalidRegex(build_regex(pattern).err().unwrap_or(e).to_string())
    })
}

fn regex_runtime_error(e: fancy_regex::Error) -> TextError {
    TextError::RegexRuntime(e.to_string())
}

/// Supported Filter and Remove modes, the same lists as the JS engine (`src/utils/textModes.ts`).
const FILTER_MODES: [&str; 2] = ["keep", "remove"];
const REMOVE_MODES: [&str; 3] = ["duplicates", "containing", "notContaining"];

/// An unknown or empty mode is `TextError::InvalidMode` (checked before anything else, also for an empty text).
fn check_mode(operation: &str, mode: &str, supported: &[&str]) -> Result<(), TextError> {
    if supported.contains(&mode) {
        Ok(())
    } else {
        Err(TextError::InvalidMode(format!("unknown {operation} mode {mode:?}")))
    }
}

/// Metrics of a finished command. `memory_stats()` returns `None` where the platform does not provide the
/// value: the metric is then reported as not available instead of failing (formerly `unwrap()` -> panic).
pub fn get_backend_metrics(execution_time: f64, before_mem: Option<MemoryStats>) -> BackendMetrics {
    backend_metrics(execution_time, before_mem, memory_stats())
}

fn backend_metrics(execution_time: f64, before_mem: Option<MemoryStats>, after_mem: Option<MemoryStats>) -> BackendMetrics {
    BackendMetrics {
        execution_time_ms: execution_time,
        memory_usage_kb: after_mem.map(|after| after.physical_mem / 1024),
        // saturating: memory can shrink during processing (plain `-` panics in debug builds and wraps in release)
        memory_usage_str: before_mem
            .zip(after_mem)
            .map(|(before, after)| after.physical_mem.saturating_sub(before.physical_mem).separate_with_commas()),
    }
}

impl TextProcessor {

    /// Splits every line into parts; column `i` holds the i-th part of every processed row.
    /// Each processed row is represented exactly once in every column (missing parts are `""`).
    /// Rows are the data lines of the shared line model (`split_lines`): LF, CRLF and CR are line breaks, a trailing
    /// line break adds no row. `keep_empty_lines == false` skips lines that are completely empty. Whitespace-only
    /// lines are not empty and are always kept. The columns are joined with `\n` only for the transport to the
    /// frontend (`SplitService` splits them again); values never contain a line break.
    pub fn process_text_block_to_column_strings(
        text: &str,
        delimiter: &str,
        trimparts: bool,
        useregex: bool,
        keep_empty_lines: bool,
    ) -> Result<ProcessedText<Vec<String>>, TextError> {
        // Paket 10 E4: checked before anything else, also for an empty text (an empty regex pattern is rule E3)
        if !useregex && delimiter.is_empty() {
            return Err(TextError::EmptyDelimiter("the plain delimiter is empty".into()));
        }
        let before_mem = memory_stats::memory_stats();
        let start_time = std::time::Instant::now();

        let regex = if useregex {
            Some(compile_regex(delimiter, false)?)
        } else {
            None
        };

        let mut columns: Vec<Vec<String>> = Vec::new();
        let mut rows = 0;

        for line in split_lines(text).lines {
            if !keep_empty_lines && line.is_empty() {
                continue;
            }

            let parts: Vec<&str> = if let Some(ref reg) = regex {
                // Stop at the first runtime error: fancy-regex keeps yielding the same error (endless parts)
                reg.split(line).collect::<Result<Vec<_>, _>>().map_err(regex_runtime_error)?
            } else {
                line.split(delimiter).collect::<Vec<_>>()
            };

            parts.iter().enumerate().for_each(|(i, part)| {
                if columns.len() <= i {
                    // A new column must also hold a value for all previous rows (B1)
                    columns.push(vec![String::new(); rows]);
                }
                columns[i].push(if trimparts {
                    part.trim().to_string()
                } else {
                    part.to_string()
                });
            });

            for col in columns.iter_mut().skip(parts.len()) {
                col.push(String::new());
            }
            rows += 1;
        }

        let execution_time = start_time.elapsed().as_secs_f64() * 1000.0;
        let metrics = get_backend_metrics(execution_time, before_mem);
        
        Ok(ProcessedText {
            result_text: columns.into_iter().map(|col| col.join("\n")).collect(),
            removed_lines: 0,
            metrics,
        })
    }

    /// Joins the used columns row by row (Combine). The row count is the longest used column; missing values are `""`,
    /// so leading and trailing empty values keep their rows and the columns never shift against each other.
    /// `format` is the line format of the text that was split (the frontend detects it with the same rules).
    /// Same rules as `combineColumns` (JS), shared fixtures: `tests/fixtures/line-endings-cases.json`.
    pub fn combine_columns(columns: &[Vec<String>], used: &[CombineColumn], format: LineFormat) -> String {
        let value = |col: &CombineColumn, row: usize| columns.get(col.index).and_then(|c| c.get(row)).map_or("", String::as_str);
        let rows = used.iter().map(|col| columns.get(col.index).map_or(0, Vec::len)).max().unwrap_or(0);

        let lines: Vec<String> = (0..rows)
            .map(|row| {
                let mut line = String::new();
                for (i, col) in used.iter().enumerate() {
                    if i > 0 {
                        line.push_str(&col.separator);
                    }
                    line.push_str(value(col, row));
                }
                line
            })
            .collect();
        join_lines(&lines, format)
    }

    /// Verbindet zwei Textblöcke wieder spaltenweise mit dem separator und gibt das Ergebnis als `String` zurück.
    /// Not used by the UI any more (Combine uses `combine_columns`: re-splitting a combined text cannot tell a trailing
    /// empty value from a trailing newline). Lines follow the shared line model; the result uses the line format of
    /// `text1`, or of `text2` if `text1` has no line break (LF if neither has one).
    pub fn connect_texts(text1: &str, text2: &str, separator: &str) -> Result<String, String> {

        // Zeilenweise Aufteilung der Texte
        let TextLines { lines: lines1, format: format1 } = split_lines(text1);
        let TextLines { lines: lines2, format: format2 } = split_lines(text2);
        let has_line_break = |text: &str| text.contains(['\r', '\n']);
        let format = if has_line_break(text1) || !has_line_break(text2) { format1 } else { format2 };

        // Die maximale Anzahl von Zeilen ermitteln (für den Fall, dass die Texte unterschiedliche Längen haben)
        let max_lines = lines1.len().max(lines2.len());

        // Füge jeweils die Zeile von text1 und text2 zusammen, wenn sie existieren (leading empty rows are kept)
        let rows: Vec<String> = (0..max_lines)
            .map(|i| format!("{}{}{}", lines1.get(i).unwrap_or(&""), separator, lines2.get(i).unwrap_or(&"")))
            .collect();

        Ok(join_lines(&rows, format))
    }

    
    pub fn filter_text_internal(
        text: &str,
        pattern: &str,
        filter_mode: &str,
        casesensitive: bool,
        splitmatches: bool,
    ) -> Result<ProcessedText<String>, TextError> {
        check_mode("filter", filter_mode, &FILTER_MODES)?;
        let before_mem = memory_stats::memory_stats();
        let start_time = std::time::Instant::now();

        let regex = compile_regex(pattern, !casesensitive)?;

        // Runtime errors are returned instead of panicking (`replace_all`) or looping forever
        // (`find_iter` keeps yielding the same error, `filter_map(Result::ok)` never ended).
        // Shared line model: the result keeps the line ending and the trailing newline of the input
        let TextLines { lines, format } = split_lines(text);
        let mut processed_lines: Vec<String> = Vec::new();
        for line in lines {
            // Blank = only Unicode `White_Space` (`str::trim`, `char::is_whitespace`): U+0085 is whitespace, U+FEFF is not.
            // Same set as the JS engine (`src/utils/diff/whitespace.ts`).
            let is_blank = |text: &str| text.trim().is_empty();

            if filter_mode == "remove" {
                // Paket 8 C2: only a line from which a match actually removed text may disappear, and only if the rest
                // is blank. A line without removed text (no match, only zero-width matches) stays unchanged, also an
                // empty or whitespace-only line. Removing text always shortens the line, so "unchanged" = equal text.
                let rest = regex.try_replacen(line, 0, "").map_err(regex_runtime_error)?;
                if rest == line {
                    processed_lines.push(line.to_string());
                } else if !is_blank(&rest) {
                    processed_lines.push(rest.into_owned());
                }
                continue;
            }

            if is_blank(line) {
                continue;
            }
            let processed = regex
                .find_iter(line)
                .map(|m| m.map(|m| m.as_str()))
                .collect::<Result<Vec<_>, _>>()
                .map_err(regex_runtime_error)?
                .join(if splitmatches { format.line_ending.as_str() } else { "" });

            if !processed.is_empty() {
                processed_lines.push(processed);
            }
        }

        let execution_time = start_time.elapsed().as_secs_f64() * 1000.0;
        let metrics = get_backend_metrics(execution_time, before_mem);
        
        Ok(ProcessedText {
            result_text: join_lines(&processed_lines, format),
            removed_lines: 0,
            metrics,
        })
    }

    /// Diese Funktion entfernt Zeilen aus dem Text, entweder durch Duplikate oder durch Übereinstimmungen mit einem Muster (entweder mit regulären Ausdrücken oder normaler Textsuche).
    /// Wenn der Modus duplicates gewählt wird, werden doppelte Zeilen basierend auf einem Schlüssel (der ggf. bei Bedarf auf Kleinbuchstaben reduziert wird) entfernt.
    pub fn remove_lines_internal(
        text: &str,
        pattern: &str,
        removemode: &str,
        casesensitive: bool,
        useregex: bool,
        trimparts: bool,
    ) -> Result<ProcessedText<String>, TextError> {
        check_mode("remove", removemode, &REMOVE_MODES)?;
        // Shared line model: a trailing newline is no line; the result keeps the line ending and the trailing newline
        let TextLines { lines, format } = split_lines(text);
        let total_lines = lines.len(); // 🏆 Anzahl der Originalzeilen

        let before_mem = memory_stats::memory_stats();
        let start_time = std::time::Instant::now();

        let processed_lines: Vec<String> = if removemode == "duplicates" {
            let mut seen = std::collections::HashSet::new();
            lines
                .iter()
                .filter_map(|&line| {
                    // Trim (Unicode `White_Space`, same set as the JS engine) and case only change the comparison key:
                    // the first occurrence is kept as it is, with its indentation
                    let processed_line = if trimparts { line.trim() } else { line };
                    let key = if casesensitive {
                        processed_line.to_string()
                    } else {
                        processed_line.to_lowercase()
                    };

                    if seen.contains(&key) {
                        None
                    } else {
                        seen.insert(key);
                        Some(line.to_string())
                    }
                })
                .collect()
        } else {
            // B4: an invalid regex is an error result (was `unwrap()` -> panic); a runtime error while matching
            // is an error too (was silently treated as "no match")
            let matcher: Box<dyn Fn(&str) -> Result<bool, TextError>> = if useregex {
                let regex = compile_regex(pattern, !casesensitive)?;
                Box::new(move |line| regex.is_match(line).map_err(regex_runtime_error))
            } else {
                Box::new(move |line| {
                    let processed_line = if casesensitive {
                        line
                    } else {
                        &line.to_lowercase()
                    };
                    let pattern2 = if casesensitive {
                        pattern
                    } else {
                        &pattern.to_lowercase()
                    };
                    Ok(processed_line.contains(pattern2))
                })
            };

            let mut kept = Vec::new();
            for &line in &lines {
                let matched = matcher(line)?;
                // The mode was checked: anything but "containing" is "notContaining"
                if (removemode == "containing" && !matched) || (removemode != "containing" && matched) {
                    kept.push(line.to_string());
                }
            }
            kept
        };

        let execution_time = start_time.elapsed().as_secs_f64() * 1000.0;
        let processed_text = join_lines(&processed_lines, format);

        let metrics = get_backend_metrics(execution_time, before_mem);
        
        Ok(ProcessedText {
            result_text: processed_text,
            removed_lines: total_lines - processed_lines.len(),
            metrics,
        })
    }



    
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    /// Shared with the JS engine tests (`tests/unit/split.test.ts`).
    const SPLIT_FIXTURES: &str = include_str!("../../tests/fixtures/split-cases.json");

    #[derive(Deserialize)]
    struct Fixtures {
        cases: Vec<SplitCase>,
    }

    /// A delimiter string, or `{ repeat, count }` for long patterns (Paket 10).
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Delimiter {
        Text(String),
        Repeat { repeat: String, count: usize },
    }

    impl Delimiter {
        fn text(&self) -> String {
            match self {
                Delimiter::Text(text) => text.clone(),
                Delimiter::Repeat { repeat, count } => repeat.repeat(*count),
            }
        }
    }

    /// Split result in fixture form: the columns or an error kind. `expectedJs` / `targetJs` are not read here (they may
    /// contain lone surrogates, which a Rust `String` cannot hold); the JS runner checks them.
    #[derive(Deserialize, Debug, PartialEq)]
    #[serde(untagged)]
    enum SplitOutcome {
        Columns(Vec<Vec<String>>),
        Error { error: String },
    }

    /// A not yet implemented decision of Paket 10 (`docs/analyse/Paket10-PhaseB-Regexvertrag.md`).
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Pending {
        decisions: Vec<String>,
        phase: String,
        engines: Vec<String>,
        reason: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SplitCase {
        name: String,
        input: String,
        delimiter: Delimiter,
        #[serde(default)]
        use_regex: bool,
        #[serde(default)]
        trim_parts: bool,
        keep_empty_lines: Option<bool>,
        expected: Option<SplitOutcome>,
        expected_rust: Option<SplitOutcome>,
        target: Option<SplitOutcome>,
        target_rust: Option<SplitOutcome>,
        pending: Option<Pending>,
    }

    fn split(text: &str, delimiter: &str, trim_parts: bool, use_regex: bool, keep_empty_lines: bool) -> SplitOutcome {
        match TextProcessor::process_text_block_to_column_strings(text, delimiter, trim_parts, use_regex, keep_empty_lines) {
            // Same decoding as the frontend (SplitService.invokeBackend)
            Ok(result) => SplitOutcome::Columns(result.result_text.iter().map(|col| col.split('\n').map(String::from).collect()).collect()),
            Err(TextError::InvalidRegex(_)) => SplitOutcome::Error { error: "invalidRegex".into() },
            Err(TextError::EmptyDelimiter(_)) => SplitOutcome::Error { error: "emptyDelimiter".into() },
            Err(e) => panic!("unexpected split error {e:?}"),
        }
    }

    /// The pending rule of the shared fixtures: an engine listed in `pending.engines` still differs from its target,
    /// every other engine already delivers it. Returns a problem or `None`.
    fn pending_problem<T: PartialEq + std::fmt::Debug>(name: &str, actual: &T, target: Option<&T>, pending: Option<&Pending>) -> Option<String> {
        const DECISIONS: [&str; 11] = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E11"];
        let pending = match (target, pending) {
            (None, None) => return None,
            (Some(_), Some(pending)) => pending,
            _ => return Some(format!("{name}: a target needs 'pending' (and only a target)")),
        };
        let well_formed = !pending.decisions.is_empty()
            && pending.decisions.iter().all(|d| DECISIONS.contains(&d.as_str()))
            && ["C1", "C2"].contains(&pending.phase.as_str())
            && !pending.engines.is_empty()
            && pending.engines.iter().all(|e| e == "rust" || e == "js")
            && !pending.reason.is_empty();
        if !well_formed {
            return Some(format!("{name}: invalid pending"));
        }
        let listed = pending.engines.iter().any(|e| e == "rust");
        let differs = target.is_some_and(|target| target != actual);
        (listed != differs).then(|| format!("{name}: pending.engines must list rust exactly while the Rust result differs from its target\n    target: {target:?}\n    actual: {actual:?}"))
    }

    #[test]
    fn split_fixtures() {
        let fixtures: Fixtures = serde_json::from_str(SPLIT_FIXTURES).expect("invalid split fixtures");
        assert!(!fixtures.cases.is_empty());

        let mut failures = Vec::new();
        for c in &fixtures.cases {
            let expected = c.expected_rust.as_ref().or(c.expected.as_ref()).expect(&c.name);
            let actual = split(&c.input, &c.delimiter.text(), c.trim_parts, c.use_regex, c.keep_empty_lines.unwrap_or(true));
            let ragged = matches!(&actual, SplitOutcome::Columns(columns) if columns.iter().any(|col| col.len() != columns[0].len()));
            if &actual != expected || ragged {
                failures.push(format!("{}\n    expected: {:?}\n    actual:   {:?}", c.name, expected, actual));
            }
            // `targetJs` always comes with `targetRust` (checked by the JS runner)
            let target = c.target_rust.as_ref().or(c.target.as_ref());
            if matches!(target, Some(SplitOutcome::Error { error }) if error == "regexSplitsCharacter") {
                failures.push(format!("{}: regexSplitsCharacter is a JS-only target", c.name));
            }
            failures.extend(pending_problem(&c.name, &actual, target, c.pending.as_ref()));
        }
        assert!(failures.is_empty(), "{} of {} split fixtures failed:\n  {}", failures.len(), fixtures.cases.len(), failures.join("\n  "));
    }

    // --- Paket 5: regex compatibility fixtures, shared with the JS engine (`tests/unit/regex-compat.test.ts`) ---

    const REGEX_FIXTURES: &str = include_str!("../../tests/fixtures/regex-cases.json");

    #[derive(Deserialize)]
    struct RegexFixtures {
        cases: Vec<RegexCase>,
    }

    #[derive(Deserialize, Debug, PartialEq)]
    #[serde(untagged)]
    enum Expected {
        Text(String),
        Error { error: String },
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RegexCase {
        name: String,
        input: String,
        pattern: String,
        mode: Option<String>,
        case_sensitive: Option<bool>,
        split_matches: Option<bool>,
        expected: Option<Expected>,
        expected_rust: Option<Expected>,
    }

    #[test]
    fn regex_fixtures() {
        let fixtures: RegexFixtures = serde_json::from_str(REGEX_FIXTURES).expect("invalid regex fixtures");
        assert!(!fixtures.cases.is_empty());

        let mut failures = Vec::new();
        for c in &fixtures.cases {
            let expected = c.expected_rust.as_ref().or(c.expected.as_ref()).expect(&c.name);
            let mode = c.mode.as_deref().unwrap_or("keep");
            let actual = match TextProcessor::filter_text_internal(&c.input, &c.pattern, mode, c.case_sensitive.unwrap_or(true), c.split_matches.unwrap_or(true)) {
                Ok(result) => Expected::Text(result.result_text),
                Err(TextError::InvalidRegex(_)) => Expected::Error { error: "invalidRegex".into() },
                Err(TextError::RegexRuntime(_)) => Expected::Error { error: "regexRuntime".into() },
                Err(e @ (TextError::Internal(_) | TextError::DiffTooComplex(_) | TextError::InvalidMode(_) | TextError::EmptyDelimiter(_) | TextError::Superseded)) => panic!("{}: {e}", c.name),
            };
            if &actual != expected {
                failures.push(format!("{}\n    expected: {:?}\n    actual:   {:?}", c.name, expected, actual));
            }
        }
        assert!(failures.is_empty(), "{} of {} regex fixtures failed:\n  {}", failures.len(), fixtures.cases.len(), failures.join("\n  "));
    }

    #[test]
    fn split_then_combine_keeps_rows_aligned() {
        // Same calls as the backend combine (LeftMenuBar.appendColumnTauri): Part 3, then Part 1
        let result = TextProcessor::process_text_block_to_column_strings("A,B\nC,D,E\n\nF,G", ",", false, false, true).unwrap();
        let columns: Vec<Vec<String>> = result.result_text.iter().map(|col| col.split('\n').map(String::from).collect()).collect();
        let used = [CombineColumn { index: 2, separator: String::new() }, CombineColumn { index: 0, separator: ":".into() }];
        assert_eq!(TextProcessor::combine_columns(&columns, &used[..1], LineFormat::default()), "\nE\n\n");
        assert_eq!(TextProcessor::combine_columns(&columns, &used, LineFormat::default()), ":A\nE:C\n:\n:F");
    }

    #[test]
    fn connect_texts_follows_the_line_model() {
        // No longer used by the UI. Its text input cannot tell a trailing empty value from a trailing newline:
        // "\nE\n\n" (Part 3 above) is read as 3 lines + trailing newline, the max with Part 1 restores the 4th row.
        let first = TextProcessor::connect_texts("", "\nE\n\n", "").unwrap();
        assert_eq!(first, "\nE\n\n");
        assert_eq!(TextProcessor::connect_texts(&first, "A\nC\n\nF", ":").unwrap(), ":A\nE:C\n:\n:F\n");
        // CRLF/CR are line breaks and are not part of the values; format of text1, else of text2
        assert_eq!(TextProcessor::connect_texts("a\r\nb\r\n", "1\n2", "-").unwrap(), "a-1\r\nb-2\r\n");
        assert_eq!(TextProcessor::connect_texts("a", "1\r2", "-").unwrap(), "a-1\r-2");
        assert_eq!(TextProcessor::connect_texts("", "", "-").unwrap(), "");
    }

    // --- Paket 6: shared line-ending fixtures, also run by the JS engine (`tests/unit/line-endings.test.ts`) ---

    const LINE_FIXTURES: &str = include_str!("../../tests/fixtures/line-endings-cases.json");

    #[derive(Deserialize)]
    struct LineFixtures {
        filter: Vec<FilterLineCase>,
        remove: Vec<RemoveLineCase>,
        combine: Vec<CombineLineCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FilterLineCase {
        name: String,
        input: String,
        pattern: String,
        mode: Option<String>,
        split_matches: Option<bool>,
        expected: String,
    }

    #[derive(Deserialize, Debug, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct RemoveExpected {
        text: String,
        removed_lines: usize,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RemoveLineCase {
        name: String,
        input: String,
        #[serde(default)]
        pattern: String,
        remove_mode: String,
        #[serde(default)]
        use_regex: bool,
        #[serde(default)]
        trim_parts: bool,
        expected: Option<RemoveExpected>,
        expected_rust: Option<RemoveExpected>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CombineLineCase {
        name: String,
        columns: Vec<Vec<String>>,
        used: Vec<CombineColumn>,
        line_ending: String,
        trailing_newline: bool,
        expected: String,
    }

    fn line_fixtures() -> LineFixtures {
        serde_json::from_str(LINE_FIXTURES).expect("invalid line-ending fixtures")
    }

    #[test]
    fn filter_line_ending_fixtures() {
        let cases = line_fixtures().filter;
        assert!(!cases.is_empty());
        let failures: Vec<String> = cases
            .iter()
            .filter_map(|c| {
                let mode = c.mode.as_deref().unwrap_or("keep");
                let actual = TextProcessor::filter_text_internal(&c.input, &c.pattern, mode, true, c.split_matches.unwrap_or(true)).map(|r| r.result_text);
                (actual.as_ref() != Ok(&c.expected)).then(|| format!("{}\n    expected: {:?}\n    actual:   {:?}", c.name, c.expected, actual))
            })
            .collect();
        assert!(failures.is_empty(), "{} of {} filter line fixtures failed:\n  {}", failures.len(), cases.len(), failures.join("\n  "));
    }

    #[test]
    fn remove_line_ending_fixtures() {
        let cases = line_fixtures().remove;
        assert!(!cases.is_empty());
        let failures: Vec<String> = cases
            .iter()
            .filter_map(|c| {
                let expected = c.expected_rust.as_ref().or(c.expected.as_ref()).expect(&c.name);
                let actual = TextProcessor::remove_lines_internal(&c.input, &c.pattern, &c.remove_mode, true, c.use_regex, c.trim_parts)
                    .map(|r| RemoveExpected { text: r.result_text, removed_lines: r.removed_lines });
                (actual.as_ref() != Ok(expected)).then(|| format!("{}\n    expected: {:?}\n    actual:   {:?}", c.name, expected, actual))
            })
            .collect();
        assert!(failures.is_empty(), "{} of {} remove line fixtures failed:\n  {}", failures.len(), cases.len(), failures.join("\n  "));
    }

    #[test]
    fn combine_line_ending_fixtures() {
        let cases = line_fixtures().combine;
        assert!(!cases.is_empty());
        let failures: Vec<String> = cases
            .iter()
            .filter_map(|c| {
                let line_ending = crate::line_endings::LineEnding::parse(&c.line_ending).expect(&c.name);
                let actual = TextProcessor::combine_columns(&c.columns, &c.used, LineFormat { line_ending, trailing_newline: c.trailing_newline });
                (actual != c.expected).then(|| format!("{}\n    expected: {:?}\n    actual:   {:?}", c.name, c.expected, actual))
            })
            .collect();
        assert!(failures.is_empty(), "{} of {} combine line fixtures failed:\n  {}", failures.len(), cases.len(), failures.join("\n  "));
    }

    #[test]
    fn crlf_does_not_change_regex_results() {
        // The same visible text gives the same matches; only the line ending of the result follows the input
        for (text, ending) in [("a1\nb22\n", "\n"), ("a1\r\nb22\r\n", "\r\n"), ("a1\rb22\r", "\r")] {
            let filter = TextProcessor::filter_text_internal(text, r"\d+$", "keep", true, true).unwrap();
            assert_eq!(filter.result_text, format!("1{ending}22{ending}"));
            let remove = TextProcessor::remove_lines_internal(text, r"^a\d$", "containing", true, true, false).unwrap();
            assert_eq!((remove.result_text, remove.removed_lines), (format!("b22{ending}"), 1));
            let split = TextProcessor::process_text_block_to_column_strings(text, r"(?<=[a-z])", false, true, true).unwrap();
            assert_eq!(split.result_text, vec!["a\nb", "1\n22"]);
        }
    }

    #[test]
    fn split_reports_metrics() {
        let result = TextProcessor::process_text_block_to_column_strings("a,b\nc", ",", false, false, true).unwrap();
        assert!(result.metrics.execution_time_ms >= 0.0);
        // Windows/Linux provide the memory metric (`None` = not available, see missing_memory_metrics_...)
        assert!(result.metrics.memory_usage_kb.is_some_and(|kb| kb > 0));
        assert_eq!(result.removed_lines, 0);
    }

    #[test]
    fn split_invalid_regex_is_an_error() {
        assert!(matches!(
            TextProcessor::process_text_block_to_column_strings("a", "([a-", false, true, true),
            Err(TextError::InvalidRegex(_))
        ));
    }

    // --- Paket 4: error propagation (B4) and empty results (B3) ---

    /// Pattern + input that exceed fancy-regex's default backtrack limit (runtime error, not a parse error).
    const BACKTRACKING_PATTERN: &str = "(?i)(a|b|ab)*(?=c)";
    fn backtracking_input() -> String {
        "ab".repeat(40)
    }

    #[test]
    fn remove_invalid_regex_is_an_error() {
        for mode in ["containing", "notContaining"] {
            let result = TextProcessor::remove_lines_internal("a\nb", "([a-", mode, true, true, false);
            assert!(matches!(result, Err(TextError::InvalidRegex(_))), "{mode}: {result:?}");
        }
    }

    #[test]
    fn remove_invalid_pattern_without_regex_mode_is_plain_text() {
        let result = TextProcessor::remove_lines_internal("([a-\nb", "([a-", "containing", true, false, false).unwrap();
        assert_eq!(result.result_text, "b");
        assert_eq!(result.removed_lines, 1);
    }

    #[test]
    fn remove_all_lines_is_an_empty_result() {
        let result = TextProcessor::remove_lines_internal("a\nab", "a", "containing", true, true, false).unwrap();
        assert_eq!(result.result_text, "");
        assert_eq!(result.removed_lines, 2);
    }

    #[test]
    fn remove_regex_runtime_error_is_an_error() {
        let text = format!("x\n{}", backtracking_input());
        let result = TextProcessor::remove_lines_internal(&text, BACKTRACKING_PATTERN, "containing", true, true, false);
        assert!(matches!(result, Err(TextError::RegexRuntime(_))), "{result:?}");
    }

    #[test]
    fn filter_invalid_regex_is_an_error() {
        for mode in ["keep", "remove"] {
            let result = TextProcessor::filter_text_internal("a", "([a-", mode, true, false);
            assert!(matches!(result, Err(TextError::InvalidRegex(_))), "{mode}: {result:?}");
        }
    }

    #[test]
    fn filter_removing_all_lines_is_an_empty_result() {
        let result = TextProcessor::filter_text_internal("apple\nbanana", "x", "keep", true, false).unwrap();
        assert_eq!(result.result_text, "");
        let result = TextProcessor::filter_text_internal("apple\nbanana", ".*", "remove", true, false).unwrap();
        assert_eq!(result.result_text, "");
    }

    #[test]
    fn filter_regex_runtime_error_is_an_error() {
        let text = backtracking_input();
        // catch_unwind: before the fix "remove" panicked (`replace_all`) and "keep" never returned
        for mode in ["keep", "remove"] {
            let outcome = std::panic::catch_unwind(|| TextProcessor::filter_text_internal(&text, BACKTRACKING_PATTERN, mode, true, false));
            assert!(matches!(outcome, Ok(Err(TextError::RegexRuntime(_)))), "{mode}: expected an error result, not a panic or success");
        }
    }

    #[test]
    fn split_regex_runtime_error_is_an_error() {
        // Before the fix every error became an empty part and fancy-regex repeats the error: endless parts
        let result = TextProcessor::process_text_block_to_column_strings(&backtracking_input(), BACKTRACKING_PATTERN, false, true, true);
        assert!(matches!(result, Err(TextError::RegexRuntime(_))), "{result:?}");
    }

    // --- Paket 5: regex robustness ---

    #[test]
    fn backtrack_limit_is_the_documented_fancy_regex_default() {
        // Changing it changes which patterns fail with `RegexRuntime`: needs new regression tests
        assert_eq!(REGEX_BACKTRACK_LIMIT, 1_000_000);
    }

    #[test]
    fn backtracking_below_the_limit_still_matches() {
        // Same pattern as BACKTRACKING_PATTERN, but a short input stays below the limit
        let result = TextProcessor::filter_text_internal("ababc", BACKTRACKING_PATTERN, "keep", true, false).unwrap();
        assert_eq!(result.result_text, "abab");
    }

    #[test]
    fn backtrack_limit_applies_per_search_not_per_job() {
        // Paket 10 R4 (characterization, decision E6 for Phase C2): the limit counts the steps of one search for the next
        // match. Each line below needs more than a third of the limit (proved with a third of the limit), so the three lines
        // together need more steps than REGEX_BACKTRACK_LIMIT, and the job still succeeds: there is no budget per job.
        const PATTERN: &str = "(a|aa)+(?=c)";
        let line = format!("{}b", "a".repeat(22));
        let third = RegexBuilder::new(PATTERN).backtrack_limit(REGEX_BACKTRACK_LIMIT / 3).build().unwrap();
        assert!(third.find(&line).is_err(), "one line needs more than a third of the limit");
        let text = [line.as_str(); 3].join("\n");
        let result = TextProcessor::filter_text_internal(&text, PATTERN, "keep", true, false).unwrap();
        assert_eq!(result.result_text, "", "no match, no runtime error");
        // Two more `a` exceed the limit within one search
        let over = TextProcessor::filter_text_internal(&format!("{}b", "a".repeat(24)), PATTERN, "keep", true, false);
        assert!(matches!(over, Err(TextError::RegexRuntime(_))), "{over:?}");
    }

    #[test]
    fn non_fancy_patterns_have_no_backtracking_limit() {
        // Without lookaround/backreferences fancy-regex delegates to the linear-time `regex` crate:
        // the classic catastrophic pattern for backtracking engines finishes immediately and correctly
        let text = format!("{}b\n{}", "a".repeat(5_000), "a".repeat(5_000));
        let result = TextProcessor::filter_text_internal(&text, "(a+)+$", "keep", true, false).unwrap();
        assert_eq!(result.result_text, "a".repeat(5_000));
    }

    #[test]
    fn regex_runtime_error_on_the_last_line_of_a_large_text_is_an_error() {
        // No partial result: one failing line fails the whole operation
        let text = format!("{}{}", "x\n".repeat(50_000), backtracking_input());
        let filter = TextProcessor::filter_text_internal(&text, BACKTRACKING_PATTERN, "keep", true, false);
        assert!(matches!(filter, Err(TextError::RegexRuntime(_))), "{filter:?}");
        let remove = TextProcessor::remove_lines_internal(&text, BACKTRACKING_PATTERN, "containing", true, true, false);
        assert!(matches!(remove, Err(TextError::RegexRuntime(_))), "{remove:?}");
        let split = TextProcessor::process_text_block_to_column_strings(&text, BACKTRACKING_PATTERN, false, true, true);
        assert!(matches!(split, Err(TextError::RegexRuntime(_))), "{split:?}");
    }

    #[test]
    fn ordinary_large_input_is_processed_unchanged() {
        let text = "alpha,1\nbeta,2\n".repeat(20_000);
        let split = TextProcessor::process_text_block_to_column_strings(&text, r"(?<=\w),", false, true, true).unwrap();
        assert_eq!(split.result_text.len(), 2);
        assert_eq!(split.result_text[1].lines().count(), 40_000);
        let filter = TextProcessor::filter_text_internal(&text, r"(?<=,)\d", "keep", true, false).unwrap();
        // Paket 6: the trailing newline of the input is kept (was dropped by `lines()` + `join`)
        assert_eq!(filter.result_text, "1\n2\n".repeat(20_000));
        let remove = TextProcessor::remove_lines_internal(&text, r"^beta", "containing", true, true, false).unwrap();
        assert_eq!(remove.removed_lines, 20_000);
    }

    #[test]
    fn rust_specific_patterns_are_accepted_by_all_text_commands() {
        // Valid fancy-regex syntax that the JS engine rejects (must not be blocked by a JS pre-validation)
        for pattern in [r"(?i)x", r"(?>x+)", r"x++", r"(?P<n>x)"] {
            let split = TextProcessor::process_text_block_to_column_strings("aXb", pattern, false, true, true);
            assert!(split.is_ok(), "split {pattern}: {split:?}");
            let filter = TextProcessor::filter_text_internal("aXb", pattern, "keep", false, false);
            assert_eq!(filter.map(|r| r.result_text), Ok("X".to_string()), "filter {pattern}");
            let remove = TextProcessor::remove_lines_internal("aXb\nc", pattern, "containing", false, true, false);
            assert_eq!(remove.map(|r| r.result_text), Ok("c".to_string()), "remove {pattern}");
        }
        let split = TextProcessor::process_text_block_to_column_strings("aXb", "(?i)x", false, true, true).unwrap();
        assert_eq!(split.result_text, vec!["a", "b"]);
    }

    #[test]
    fn lookbehind_and_backreferences_in_remove_and_split() {
        let remove = TextProcessor::remove_lines_internal("aa\nab\n$5\n5", r"(\w)\1|(?<=\$)\d", "containing", true, true, false).unwrap();
        assert_eq!(remove.result_text, "ab\n5");
        assert_eq!(remove.removed_lines, 2);
        let split = TextProcessor::process_text_block_to_column_strings("a--b-c", r"(?<=-)-|(?<=b)-", false, true, true).unwrap();
        assert_eq!(split.result_text, vec!["a-", "b", "c"]);
    }

    #[test]
    fn invalid_regex_error_position_refers_to_the_users_pattern() {
        // Case-insensitive matching prefixes `(?i)`; the error must not report a position shifted by 4
        let sensitive = TextProcessor::filter_text_internal("x", "a([b-", "keep", true, false);
        let insensitive = TextProcessor::filter_text_internal("x", "a([b-", "keep", false, false);
        assert!(matches!(sensitive, Err(TextError::InvalidRegex(_))), "{sensitive:?}");
        assert_eq!(sensitive.unwrap_err(), insensitive.unwrap_err());
        let remove = TextProcessor::remove_lines_internal("x", "a([b-", "containing", false, true, false);
        assert_eq!(remove.unwrap_err(), TextProcessor::filter_text_internal("x", "a([b-", "keep", true, false).unwrap_err());
    }

    #[test]
    fn missing_memory_metrics_are_reported_as_not_available() {
        // `memory_stats()` returns None on unsupported platforms: no panic, no invented value
        let metrics = backend_metrics(1.5, None, None);
        assert_eq!(metrics.memory_usage_kb, None);
        assert_eq!(metrics.memory_usage_str, None);
        let json = serde_json::to_value(&metrics).unwrap();
        assert_eq!(json, serde_json::json!({ "execution_time_ms": 1.5, "memory_usage_kb": null, "memory_usage_str": null }));

        let after = MemoryStats { physical_mem: 4096 * 1024, virtual_mem: 0 };
        let only_after = backend_metrics(1.0, None, Some(after));
        assert_eq!(only_after.memory_usage_kb, Some(4096));
        assert_eq!(only_after.memory_usage_str, None, "no difference without a start value");
        let before = MemoryStats { physical_mem: 5000 * 1024, virtual_mem: 0 };
        assert_eq!(backend_metrics(1.0, Some(before), Some(after)).memory_usage_str.as_deref(), Some("0"), "memory can shrink");
    }

    #[test]
    fn text_error_reaches_the_frontend_as_kind_and_message() {
        // Shape expected by `fromBackendError` (src/services/ProcessingError.ts)
        let invalid = serde_json::to_value(TextError::InvalidRegex("bad".into())).unwrap();
        assert_eq!(invalid, serde_json::json!({ "kind": "invalidRegex", "message": "bad" }));
        let runtime = serde_json::to_value(TextError::RegexRuntime("limit".into())).unwrap();
        assert_eq!(runtime, serde_json::json!({ "kind": "regexRuntime", "message": "limit" }));
        let mode = serde_json::to_value(TextError::InvalidMode("unknown filter mode \"x\"".into())).unwrap();
        assert_eq!(mode, serde_json::json!({ "kind": "invalidMode", "message": "unknown filter mode \"x\"" }));
    }

    #[test]
    fn unknown_and_empty_modes_are_invalid_mode_errors() {
        for mode in ["", "bogus", "Keep", " keep", "keep ", "duplicates"] {
            let error = TextProcessor::filter_text_internal("a", "a", mode, true, false).unwrap_err();
            assert!(matches!(error, TextError::InvalidMode(_)), "filter {mode:?}: {error:?}");
        }
        for mode in ["", "bogus", "Containing", "notcontaining", "keep", "duplicates "] {
            let error = TextProcessor::remove_lines_internal("a", "a", mode, true, false, false).unwrap_err();
            assert!(matches!(error, TextError::InvalidMode(_)), "remove {mode:?}: {error:?}");
        }
        // The mode is checked first: also for an empty text and before an invalid regex
        assert!(matches!(TextProcessor::filter_text_internal("", "([a-", "bogus", true, false), Err(TextError::InvalidMode(_))));
        assert!(matches!(TextProcessor::remove_lines_internal("", "([a-", "bogus", true, true, false), Err(TextError::InvalidMode(_))));
        // Every supported mode is accepted
        for mode in FILTER_MODES {
            assert!(TextProcessor::filter_text_internal("a1", r"\d", mode, true, false).is_ok(), "{mode}");
        }
        for mode in REMOVE_MODES {
            assert!(TextProcessor::remove_lines_internal("a1\nb", "a", mode, true, false, false).is_ok(), "{mode}");
        }
    }

    // --- Paket 8 Phase B: Filter/Remove golden fixtures, also run by the JS engine (`tests/unit/filter-remove.test.ts`) ---
    // They characterize the current behaviour: per-engine expectations document known differences (see the file's description).

    mod filter_remove_fixtures {
        use super::*;
        use serde_json::{json, Map, Value};

        const FIXTURES: &str = include_str!("../../tests/fixtures/filter-remove-cases.json");
        const DIVERGENCE_KINDS: [&str; 5] = ["dialect", "utf16Guard", "suspectedBug", "inconsistentDefinition", "unvalidatedInput"];

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Fixtures {
            #[allow(dead_code)]
            description: String,
            filter: Vec<Case<FilterOptions>>,
            remove: Vec<Case<RemoveOptions>>,
        }

        /// A pattern string, or `{ repeat, count }` for long patterns.
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Pattern {
            Text(String),
            Repeat(PatternRepeat),
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct PatternRepeat {
            repeat: String,
            count: usize,
        }

        impl Pattern {
            fn text(&self) -> String {
                match self {
                    Pattern::Text(text) => text.clone(),
                    Pattern::Repeat(r) => r.repeat.repeat(r.count),
                }
            }
        }

        /// All options are required (no defaults).
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct FilterOptions {
            mode: String,
            case_sensitive: bool,
            split_matches: bool,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct RemoveOptions {
            remove_mode: String,
            case_sensitive: bool,
            use_regex: bool,
            trim_parts: bool,
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Divergence {
            kind: String,
            reason: String,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        #[allow(dead_code)]
        struct Case<O> {
            name: String,
            #[serde(rename = "ref")]
            reference: Option<String>,
            input: String,
            pattern: Pattern,
            options: O,
            expected: Option<Value>,
            expected_rust: Option<Value>,
            /// Checked in detail by the JS runner (may be the JS-only error `regexSplitsCharacter`).
            expected_js: Option<Value>,
            /// JS only (unreachable Filter main-thread implementation).
            expected_js_unreachable_main_thread: Option<Value>,
            divergence: Option<Divergence>,
            open_question: Option<String>,
            /// Why a correction changed the expectation (always a shared `expected`).
            resolved: Option<String>,
            /// Paket 10: result of a not yet implemented decision (both engines), with `pending`.
            target: Option<Value>,
            pending: Option<Pending>,
            /// Paket 10: the pattern preview of the Filter page, JS only (checked by the JS runner; may contain lone surrogates).
            preview: Option<serde::de::IgnoredAny>,
        }

        /// Filter outcome in fixture form: the result text or the error kind.
        type FilterOutcome = Result<String, String>;

        #[derive(Debug, PartialEq)]
        struct RemoveResult {
            text: String,
            removed_lines: usize,
        }
        type RemoveOutcome = Result<RemoveResult, String>;

        fn error_kind(error: TextError) -> String {
            match error {
                TextError::InvalidRegex(_) => "invalidRegex".into(),
                TextError::RegexRuntime(_) => "regexRuntime".into(),
                TextError::InvalidMode(_) => "invalidMode".into(),
                other => format!("unexpected error {other:?}"),
            }
        }

        fn expected_error(map: &Map<String, Value>) -> Result<String, String> {
            match map.get("error").and_then(Value::as_str) {
                Some(kind @ ("invalidRegex" | "regexRuntime" | "invalidMode")) if map.len() == 1 => Ok(kind.into()),
                _ => Err(format!("invalid error expectation {}", Value::Object(map.clone()))),
            }
        }

        /// A target may also use the errors of Paket 10 E3 (own errors for an empty or too long regex pattern).
        fn parse_target<X>(value: &Value, parse: fn(&Value) -> Result<Result<X, String>, String>) -> Result<Result<X, String>, String> {
            match value.get("error").and_then(Value::as_str) {
                Some(kind @ ("emptyPattern" | "patternTooLong")) if value.as_object().is_some_and(|map| map.len() == 1) => Ok(Err(kind.into())),
                _ => parse(value),
            }
        }

        /// Rust and shared expectations; `regexSplitsCharacter` is a JS-only error (Rust never cuts a character).
        fn parse_filter(value: &Value) -> Result<FilterOutcome, String> {
            match value {
                Value::String(text) => Ok(Ok(text.clone())),
                Value::Object(map) if map.contains_key("error") => expected_error(map).map(Err),
                other => Err(format!("invalid filter expectation {other}")),
            }
        }

        fn parse_remove(value: &Value) -> Result<RemoveOutcome, String> {
            match value {
                Value::Object(map) if map.contains_key("error") => expected_error(map).map(Err),
                Value::Object(map) if map.len() == 2 => match (map.get("text").and_then(Value::as_str), map.get("removedLines").and_then(Value::as_u64)) {
                    (Some(text), Some(removed)) => Ok(Ok(RemoveResult { text: text.into(), removed_lines: removed as usize })),
                    _ => Err(format!("invalid remove expectation {value}")),
                },
                other => Err(format!("invalid remove expectation {other}")),
            }
        }

        /// Structural problems of one case (the JS runner checks the same rules plus the JS-only forms).
        fn case_problems<O, X>(case: &Case<O>, parse: fn(&Value) -> Result<Result<X, String>, String>) -> Vec<String> {
            let mut problems = Vec::new();
            if case.name.is_empty() {
                problems.push("empty name".to_string());
            }
            let shared = case.expected.is_some();
            let per_engine = case.expected_rust.is_some() || case.expected_js.is_some();
            if shared == per_engine {
                problems.push("needs either expected or expectedRust + expectedJs".into());
            }
            if per_engine && (case.expected_rust.is_none() || case.expected_js.is_none()) {
                problems.push("expectedRust and expectedJs belong together".into());
            }
            if per_engine != case.divergence.is_some() {
                problems.push("per-engine expectations need a divergence (and only they)".into());
            }
            if per_engine && case.expected_rust == case.expected_js {
                problems.push("expectedRust equals expectedJs, use expected".into());
            }
            if let Some(d) = &case.divergence {
                if !DIVERGENCE_KINDS.contains(&d.kind.as_str()) || d.reason.is_empty() {
                    problems.push(format!("invalid divergence kind {:?} or empty reason", d.kind));
                }
            }
            if case.resolved.as_ref().is_some_and(|note| note.is_empty() || !shared) {
                problems.push("a resolved case needs a non-empty note and a shared expected".into());
            }
            // A JS result refused for a cut character and the utf16Guard divergence belong together
            let refused_by_js = case.expected_js == Some(json!({ "error": "regexSplitsCharacter" }));
            if refused_by_js != case.divergence.as_ref().is_some_and(|d| d.kind == "utf16Guard") {
                problems.push("expectedJs regexSplitsCharacter requires the divergence kind utf16Guard and vice versa".into());
            }
            for value in [&case.expected, &case.expected_rust].into_iter().flatten() {
                if let Err(problem) = parse(value) {
                    problems.push(problem);
                }
            }
            if let Pattern::Repeat(r) = &case.pattern {
                if r.repeat.is_empty() || r.count == 0 {
                    problems.push("pattern repeat must be non-empty with count > 0".into());
                }
            }
            if let Some(Err(problem)) = case.target.as_ref().map(|target| parse_target(target, parse)) {
                problems.push(format!("target: {problem}"));
            }
            if case.target.is_some() != case.pending.is_some() {
                problems.push("a target needs pending (and only a target)".into());
            }
            problems.into_iter().map(|p| format!("{}: {p}", case.name)).collect()
        }

        fn fixtures() -> Fixtures {
            serde_json::from_str(FIXTURES).expect("invalid filter/remove fixtures")
        }

        fn rust_expectation<O>(case: &Case<O>) -> &Value {
            case.expected_rust.as_ref().or(case.expected.as_ref()).unwrap_or_else(|| panic!("{}: no Rust expectation", case.name))
        }

        #[test]
        fn filter_remove_fixtures_are_well_formed() {
            let fixtures = fixtures();
            assert!(!fixtures.filter.is_empty() && !fixtures.remove.is_empty());
            let mut problems: Vec<String> = fixtures.filter.iter().flat_map(|c| case_problems(c, parse_filter)).collect();
            problems.extend(fixtures.remove.iter().flat_map(|c| case_problems(c, parse_remove)));
            for names in [fixtures.filter.iter().map(|c| &c.name).collect::<Vec<_>>(), fixtures.remove.iter().map(|c| &c.name).collect()] {
                let unique: std::collections::HashSet<_> = names.iter().collect();
                if unique.len() != names.len() {
                    problems.push("duplicate case names".into());
                }
            }
            assert!(problems.is_empty(), "malformed fixtures:\n  {}", problems.join("\n  "));
        }

        #[test]
        fn filter_remove_fixture_check_rejects_malformed_entries() {
            let case = |extra: Value| {
                let mut value = json!({ "name": "x", "input": "a", "pattern": "a", "options": { "mode": "keep", "caseSensitive": true, "splitMatches": false } });
                value.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
                serde_json::from_value::<Case<FilterOptions>>(value)
            };
            let problems = |extra: Value| case_problems(&case(extra).expect("parses"), parse_filter);

            assert!(problems(json!({ "expected": "a" })).is_empty());
            // Rejected by the parser: implicit option, unknown key, incomplete pattern repeat
            let implicit = json!({ "name": "x", "input": "a", "pattern": "a", "options": { "mode": "keep", "caseSensitive": true }, "expected": "" });
            assert!(serde_json::from_value::<Case<FilterOptions>>(implicit).is_err(), "implicit splitMatches");
            assert!(case(json!({ "expected": "a", "expectedTs": "a" })).is_err(), "unknown key");
            assert!(case(json!({ "expected": "a", "pattern": { "repeat": "a" } })).is_err(), "pattern repeat without count");
            // Rejected by the check
            assert!(!problems(json!({ "expected": "a", "expectedRust": "a", "expectedJs": "b", "divergence": { "kind": "dialect", "reason": "r" } })).is_empty());
            assert!(!problems(json!({ "expectedRust": "a", "expectedJs": "b" })).is_empty(), "per-engine without divergence");
            assert!(!problems(json!({ "expected": "a", "divergence": { "kind": "dialect", "reason": "r" } })).is_empty(), "divergence without per-engine");
            assert!(!problems(json!({ "expectedRust": "a", "expectedJs": "b", "divergence": { "kind": "accepted", "reason": "r" } })).is_empty());
            assert!(!problems(json!({ "expectedRust": "a", "expectedJs": "b", "divergence": { "kind": "dataIntegrityRisk", "reason": "r" } })).is_empty(), "former kind");
            assert!(!problems(json!({ "expectedRust": { "error": "regexSplitsCharacter" }, "expectedJs": "a", "divergence": { "kind": "utf16Guard", "reason": "r" } })).is_empty());
            assert!(!problems(json!({ "expected": { "error": "regexSplitsCharacter" } })).is_empty(), "JS-only error as shared expectation");
            assert!(!problems(json!({ "expectedRust": "a", "expectedJs": { "error": "regexSplitsCharacter" }, "divergence": { "kind": "dialect", "reason": "r" } })).is_empty());
            assert!(!problems(json!({ "expectedRust": "a", "expectedJs": "b", "divergence": { "kind": "utf16Guard", "reason": "r" } })).is_empty());
            assert!(!problems(json!({ "expectedRust": { "utf16": ["D83D"] }, "expectedJs": "a", "divergence": { "kind": "dialect", "reason": "r" } })).is_empty(), "utf16 form");
            assert!(!problems(json!({ "expected": { "error": "timeout" } })).is_empty(), "unknown error kind");
            assert!(parse_remove(&json!({ "text": "a" })).is_err(), "remove expectation without removedLines");
            // Paket 10: targets with pending decisions; the JS-only preview is not read (it may hold lone surrogates)
            let pending = json!({ "decisions": ["E3"], "phase": "C2", "engines": ["rust"], "reason": "r" });
            assert!(problems(json!({ "expected": "a", "target": { "error": "patternTooLong" }, "pending": pending })).is_empty());
            assert!(!problems(json!({ "expected": "a", "target": { "error": "patternTooLong" } })).is_empty(), "target without pending");
            assert!(!problems(json!({ "expected": "a", "pending": pending })).is_empty(), "pending without target");
            assert!(!problems(json!({ "expected": "a", "target": { "error": "tooLong" }, "pending": pending })).is_empty(), "unknown target error");
            assert!(case(json!({ "expected": "a", "target": "b", "pending": { "decisions": ["E3"], "phase": "C2", "engines": ["rust"] } })).is_err(), "pending without reason");
            let preview: Value = serde_json::from_str(r#"{ "expected": "a", "preview": { "segments": [["", "\uD83D", "\uDE00"]] } }"#).unwrap_or(Value::Null);
            assert!(preview.is_null(), "a lone surrogate cannot be a serde_json Value, so the preview is only skipped while parsing a case");
            let with_preview = r#"{ "name": "x", "input": "a", "pattern": "a", "options": { "mode": "keep", "caseSensitive": true, "splitMatches": false }, "expected": "a", "preview": { "segments": [["", "\uD83D", "\uDE00"]] } }"#;
            assert!(serde_json::from_str::<Case<FilterOptions>>(with_preview).is_ok(), "preview with lone surrogates is accepted and ignored");
            // The pending rule against the real Rust result
            let pending: Pending = serde_json::from_value(pending).unwrap();
            let target: FilterOutcome = Err("patternTooLong".into());
            assert!(pending_problem("x", &Ok::<String, String>(String::new()), Some(&target), Some(&pending)).is_none(), "Rust still differs and is listed");
            assert!(pending_problem("x", &target, Some(&target), Some(&pending)).is_some(), "Rust already delivers the target but is still listed");
        }

        #[test]
        fn filter_fixtures() {
            let cases = fixtures().filter;
            let failures: Vec<String> = cases
                .iter()
                .filter_map(|c| {
                    let expected = parse_filter(rust_expectation(c)).unwrap_or_else(|p| panic!("{}: {p}", c.name));
                    let o = &c.options;
                    let result = TextProcessor::filter_text_internal(&c.input, &c.pattern.text(), &o.mode, o.case_sensitive, o.split_matches);
                    // The Filter has no line statistics: `removed_lines` is always 0
                    if let Ok(r) = &result {
                        if r.removed_lines != 0 {
                            return Some(format!("{}: removed_lines {} (expected 0)", c.name, r.removed_lines));
                        }
                    }
                    let actual: FilterOutcome = result.map(|r| r.result_text).map_err(error_kind);
                    if actual != expected {
                        return Some(format!("{}\n    expected: {:?}\n    actual:   {:?}", c.name, expected, actual));
                    }
                    let target = c.target.as_ref().map(|t| parse_target(t, parse_filter).unwrap_or_else(|p| panic!("{}: {p}", c.name)));
                    pending_problem(&c.name, &actual, target.as_ref(), c.pending.as_ref())
                })
                .collect();
            assert!(failures.is_empty(), "{} of {} filter fixtures failed:\n  {}", failures.len(), cases.len(), failures.join("\n  "));
        }

        #[test]
        fn remove_fixtures() {
            let cases = fixtures().remove;
            let failures: Vec<String> = cases
                .iter()
                .filter_map(|c| {
                    let expected = parse_remove(rust_expectation(c)).unwrap_or_else(|p| panic!("{}: {p}", c.name));
                    let o = &c.options;
                    let actual: RemoveOutcome =
                        TextProcessor::remove_lines_internal(&c.input, &c.pattern.text(), &o.remove_mode, o.case_sensitive, o.use_regex, o.trim_parts)
                            .map(|r| RemoveResult { text: r.result_text, removed_lines: r.removed_lines })
                            .map_err(error_kind);
                    if actual != expected {
                        return Some(format!("{}\n    expected: {:?}\n    actual:   {:?}", c.name, expected, actual));
                    }
                    let target = c.target.as_ref().map(|t| parse_target(t, parse_remove).unwrap_or_else(|p| panic!("{}: {p}", c.name)));
                    pending_problem(&c.name, &actual, target.as_ref(), c.pending.as_ref())
                })
                .collect();
            assert!(failures.is_empty(), "{} of {} remove fixtures failed:\n  {}", failures.len(), cases.len(), failures.join("\n  "));
        }
    }
}
