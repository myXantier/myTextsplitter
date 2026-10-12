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
    ) -> Result<ProcessedText<Vec<String>>, String> {
        let before_mem = memory_stats::memory_stats().unwrap();
        let start_time = std::time::Instant::now();

        let regex = if useregex {
            Some(Regex::new(delimiter).map_err(|_| "⚠ Ungültiges Regex-Pattern".to_string())?)
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
                reg.split(line).map(|s| s.unwrap_or("")).collect::<Vec<_>>()
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
    ) -> Result<ProcessedText<String>, String> {
        let before_mem = memory_stats::memory_stats().unwrap();
        let start_time = std::time::Instant::now();

        let modified_pattern = if casesensitive {
            pattern.to_string()
        } else {
            format!("(?i){}", pattern) 
        };

        let regex =
            Regex::new(&modified_pattern).map_err(|_| "⚠ Fehlerhafte Regex-Syntax".to_string())?;

        let processed_lines: Vec<String> = text
            .lines()
            .map(|line| {
                if line.trim().is_empty() {
                    return "".to_string(); 
                }

                match filter_mode {
                    "remove" => regex.replace_all(line, "").to_string(),
                    _ => regex
                        .find_iter(line)
                        .filter_map(Result::ok) 
                        .map(|m| m.as_str().to_string())
                        .collect::<Vec<_>>()
                        .join(if splitmatches { "\n" } else { "" }),
                }
            })
            .filter(|s| !s.is_empty()) 
            .collect();

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
    ) -> Result<ProcessedText<String>, String> {
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

            let matcher: Box<dyn Fn(&str) -> bool> = if useregex {
                let regex = Regex::new(&final_pattern).unwrap();
                Box::new(move |line| regex.is_match(line).unwrap_or(false))
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
                    processed_line.contains(pattern2)
                })
            };

            lines
                .iter()
                .filter_map(|&line| {
                    if (removemode == "containing" && !matcher(line))
                        || (removemode != "containing" && matcher(line))
                    {
                        Some(line.to_string())
                    } else {
                        None
                    }
                })
                .collect()
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
        assert!(TextProcessor::process_text_block_to_column_strings("a", "([a-", false, true, true).is_err());
    }
}
