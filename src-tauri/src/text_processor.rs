use fancy_regex::Regex;
use serde::Serialize;

use memory_stats::{memory_stats, MemoryStats};
use thousands::Separable;

pub struct TextProcessor;


#[derive(Clone, Debug, Serialize)]
pub struct BackendMetrics {
    execution_time_ms: f64,
    memory_usage_kb: usize,
    memory_usage_str: String,
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
}

impl std::fmt::Display for TextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TextError::InvalidRegex(message) => write!(f, "invalid regex: {message}"),
            TextError::RegexRuntime(message) => write!(f, "regex runtime error: {message}"),
        }
    }
}

fn compile_regex(pattern: &str) -> Result<Regex, TextError> {
    Regex::new(pattern).map_err(|e| TextError::InvalidRegex(e.to_string()))
}

fn regex_runtime_error(e: fancy_regex::Error) -> TextError {
    TextError::RegexRuntime(e.to_string())
}

pub fn get_backend_metrics(execution_time: f64, before_mem: MemoryStats) -> BackendMetrics {
    let after_mem = memory_stats().unwrap();

    BackendMetrics {
        execution_time_ms: execution_time,
        memory_usage_kb: after_mem.physical_mem / 1024,
        // saturating: memory can shrink during processing (plain `-` panics in debug builds and wraps in release)
        memory_usage_str: after_mem.physical_mem.saturating_sub(before_mem.physical_mem).separate_with_commas(),
    }
}

impl TextProcessor {

    /// Splits every line into parts; column `i` holds the i-th part of every processed row.
    /// Each processed row is represented exactly once in every column (missing parts are `""`).
    /// `keep_empty_lines == false` skips lines that are completely empty (after `lines()` removed the
    /// line ending). Whitespace-only lines are not empty and are always kept.
    pub fn process_text_block_to_column_strings(
        text: &str,
        delimiter: &str,
        trimparts: bool,
        useregex: bool,
        keep_empty_lines: bool,
    ) -> Result<ProcessedText<Vec<String>>, TextError> {
        let before_mem = memory_stats::memory_stats().unwrap();
        let start_time = std::time::Instant::now();

        let regex = if useregex {
            Some(compile_regex(delimiter)?)
        } else {
            None
        };

        let mut columns: Vec<Vec<String>> = Vec::new();
        let mut rows = 0;

        for line in text.lines() {
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

    /// Verbindet zwei Textblöcke wieder spaltenweise mit dem separator und gibt das Ergebnis als `String` zurück.
    pub fn connect_texts(text1: &str, text2: &str, separator: &str) -> Result<String, String> {

        // Zeilenweise Aufteilung der Texte
        let lines1: Vec<&str> = text1.lines().collect();
        let lines2: Vec<&str> = text2.lines().collect();

        // Die maximale Anzahl von Zeilen ermitteln (für den Fall, dass die Texte unterschiedliche Längen haben)
        let max_lines = lines1.len().max(lines2.len());
        let mut result = String::new();

        for i in 0..max_lines {
            // Füge jeweils die Zeile von text1 und text2 zusammen, wenn sie existieren
            let line1 = lines1.get(i).unwrap_or(&"");
            let line2 = lines2.get(i).unwrap_or(&"");

            // Row index, not `result.is_empty()`: leading empty rows must not be dropped (row offset)
            if i > 0 {
                result.push_str("\n");
            }

            result.push_str(line1);
            result.push_str(&separator); 
            result.push_str(line2); 
        }

        Ok(result)
    }

    
    pub fn filter_text_internal(
        text: &str,
        pattern: &str,
        filter_mode: &str,
        casesensitive: bool,
        splitmatches: bool,
    ) -> Result<ProcessedText<String>, TextError> {
        let before_mem = memory_stats::memory_stats().unwrap();
        let start_time = std::time::Instant::now();

        let modified_pattern = if casesensitive {
            pattern.to_string()
        } else {
            format!("(?i){}", pattern)
        };

        let regex = compile_regex(&modified_pattern)?;

        // Runtime errors are returned instead of panicking (`replace_all`) or looping forever
        // (`find_iter` keeps yielding the same error, `filter_map(Result::ok)` never ended).
        let mut processed_lines: Vec<String> = Vec::new();
        for line in text.lines() {
            if line.trim().is_empty() {
                continue;
            }

            let processed = match filter_mode {
                "remove" => regex.try_replacen(line, 0, "").map_err(regex_runtime_error)?.into_owned(),
                _ => regex
                    .find_iter(line)
                    .map(|m| m.map(|m| m.as_str()))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(regex_runtime_error)?
                    .join(if splitmatches { "\n" } else { "" }),
            };

            if !processed.is_empty() {
                processed_lines.push(processed);
            }
        }

        let execution_time = start_time.elapsed().as_secs_f64() * 1000.0;
        let metrics = get_backend_metrics(execution_time, before_mem);
        
        Ok(ProcessedText {
            result_text: processed_lines.join("\n"),
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
        let lines: Vec<&str> = text.lines().collect();
        let total_lines = lines.len(); // 🏆 Anzahl der Originalzeilen

        let before_mem = memory_stats::memory_stats().unwrap();
        let start_time = std::time::Instant::now();

        let processed_lines: Vec<String> = if removemode == "duplicates" {
            let mut seen = std::collections::HashSet::new();
            lines
                .iter()
                .filter_map(|&line| {
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
                        Some(processed_line.to_string())
                    }
                })
                .collect()
        } else {
            let final_pattern = if casesensitive {
                pattern.to_string()
            } else {
                format!("(?i){}", pattern)
            };

            // B4: an invalid regex is an error result (was `unwrap()` -> panic); a runtime error while matching
            // is an error too (was silently treated as "no match")
            let matcher: Box<dyn Fn(&str) -> Result<bool, TextError>> = if useregex {
                let regex = compile_regex(&final_pattern)?;
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
                if (removemode == "containing" && !matched) || (removemode != "containing" && matched) {
                    kept.push(line.to_string());
                }
            }
            kept
        };

        let execution_time = start_time.elapsed().as_secs_f64() * 1000.0;
        let processed_text = processed_lines.join("\n");

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

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SplitCase {
        name: String,
        input: String,
        delimiter: String,
        #[serde(default)]
        use_regex: bool,
        #[serde(default)]
        trim_parts: bool,
        keep_empty_lines: Option<bool>,
        expected: Option<Vec<Vec<String>>>,
        expected_rust: Option<Vec<Vec<String>>>,
    }

    fn split(text: &str, delimiter: &str, trim_parts: bool, use_regex: bool, keep_empty_lines: bool) -> Vec<Vec<String>> {
        let result = TextProcessor::process_text_block_to_column_strings(text, delimiter, trim_parts, use_regex, keep_empty_lines)
            .expect("split failed");
        // Same decoding as the frontend (SplitService.invokeBackend)
        result.result_text.iter().map(|col| col.split('\n').map(String::from).collect()).collect()
    }

    #[test]
    fn split_fixtures() {
        let fixtures: Fixtures = serde_json::from_str(SPLIT_FIXTURES).expect("invalid split fixtures");
        assert!(!fixtures.cases.is_empty());

        let mut failures = Vec::new();
        for c in &fixtures.cases {
            let expected = c.expected_rust.as_ref().or(c.expected.as_ref()).expect(&c.name);
            let actual = split(&c.input, &c.delimiter, c.trim_parts, c.use_regex, c.keep_empty_lines.unwrap_or(true));
            let rows = actual.first().map_or(0, |col| col.len());
            if &actual != expected || actual.iter().any(|col| col.len() != rows) {
                failures.push(format!("{}\n    expected: {:?}\n    actual:   {:?}", c.name, expected, actual));
            }
        }
        assert!(failures.is_empty(), "{} of {} split fixtures failed:\n  {}", failures.len(), fixtures.cases.len(), failures.join("\n  "));
    }

    #[test]
    fn split_then_combine_keeps_rows_aligned() {
        // Same calls as the backend combine (LeftMenuBar.appendColumnTauri): Part 3, then Part 1
        let result = TextProcessor::process_text_block_to_column_strings("A,B\nC,D,E\n\nF,G", ",", false, false, true).unwrap();
        let first = TextProcessor::connect_texts("", &result.result_text[2], "").unwrap();
        let combined = TextProcessor::connect_texts(&first, &result.result_text[0], ":").unwrap();
        assert_eq!(combined, ":A\nE:C\n:\n:F");
    }

    #[test]
    fn split_reports_metrics() {
        let result = TextProcessor::process_text_block_to_column_strings("a,b\nc", ",", false, false, true).unwrap();
        assert!(result.metrics.execution_time_ms >= 0.0);
        assert!(result.metrics.memory_usage_kb > 0);
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

    #[test]
    fn text_error_reaches_the_frontend_as_kind_and_message() {
        // Shape expected by `fromBackendError` (src/services/ProcessingError.ts)
        let invalid = serde_json::to_value(TextError::InvalidRegex("bad".into())).unwrap();
        assert_eq!(invalid, serde_json::json!({ "kind": "invalidRegex", "message": "bad" }));
        let runtime = serde_json::to_value(TextError::RegexRuntime("limit".into())).unwrap();
        assert_eq!(runtime, serde_json::json!({ "kind": "regexRuntime", "message": "limit" }));
    }
}
