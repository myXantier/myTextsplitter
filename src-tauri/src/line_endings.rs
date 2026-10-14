//! Shared line model of the text processing (Paket 6). Same rules as the JS engine (`src/utils/lines.ts`),
//! shared fixtures: `tests/fixtures/line-endings-cases.json`.
//!
//! - Line breaks are LF, CRLF and CR, detected from the text itself (never from the operating system).
//! - A text is a list of data lines. A terminator after the last line is the trailing newline, not an extra empty line:
//!   `"A\nB"` and `"A\nB\n"` both have 2 lines, `"A\nB\n\n"` has 3 (the last one empty). An empty text has no lines.
//! - Terminators are never part of a line's content (unlike `str::lines()`, a lone CR is a line break too).
//! - Newly generated result strings use one line ending: the most frequent one of the input, on a tie the one that
//!   occurs first, LF if the input has no line break. The input text itself is never changed.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineEnding {
    Lf,
    CrLf,
    Cr,
}

impl LineEnding {
    /// Order of the counters in `split_lines`.
    const ALL: [LineEnding; 3] = [LineEnding::Lf, LineEnding::CrLf, LineEnding::Cr];

    pub fn as_str(self) -> &'static str {
        match self {
            LineEnding::Lf => "\n",
            LineEnding::CrLf => "\r\n",
            LineEnding::Cr => "\r",
        }
    }

    /// The line ending written as text (`"\n"`, `"\r\n"`, `"\r"`), e.g. from the frontend.
    pub fn parse(value: &str) -> Option<LineEnding> {
        LineEnding::ALL.into_iter().find(|ending| ending.as_str() == value)
    }
}

/// How result lines are joined into a text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineFormat {
    pub line_ending: LineEnding,
    /// The input ends with a line break: a non-empty result ends with one too.
    pub trailing_newline: bool,
}

impl Default for LineFormat {
    fn default() -> Self {
        LineFormat { line_ending: LineEnding::Lf, trailing_newline: false }
    }
}

#[derive(Debug, PartialEq)]
pub struct TextLines<'a> {
    /// Content of the data lines, without terminators. Empty lines are `""`.
    pub lines: Vec<&'a str>,
    pub format: LineFormat,
}

/// Splits a text into its data lines and detects its line format.
pub fn split_lines(text: &str) -> TextLines<'_> {
    let bytes = text.as_bytes();
    let mut lines = Vec::new();
    // Count and first position per line ending, in the order of `LineEnding::ALL`
    let mut counts = [0usize; 3];
    let mut first = [usize::MAX; 3];
    let mut start = 0;
    let mut i = 0;

    while i < bytes.len() {
        // CR and LF are ASCII: the slice boundaries are always valid UTF-8 boundaries
        let kind = match bytes[i] {
            b'\n' => 0,
            b'\r' if bytes.get(i + 1) == Some(&b'\n') => 1,
            b'\r' => 2,
            _ => {
                i += 1;
                continue;
            }
        };
        first[kind] = first[kind].min(i);
        counts[kind] += 1;
        lines.push(&text[start..i]);
        i += if kind == 1 { 2 } else { 1 };
        start = i;
    }

    // A text that ends with a terminator has no further line; otherwise the rest is the last line
    let trailing_newline = start > 0 && start == text.len();
    if start < text.len() {
        lines.push(&text[start..]);
    }

    let line_ending = (0..3)
        .filter(|&kind| counts[kind] > 0)
        // most frequent; on a tie the smaller first position wins
        .max_by(|&a, &b| counts[a].cmp(&counts[b]).then(first[b].cmp(&first[a])))
        .map_or(LineEnding::Lf, |kind| LineEnding::ALL[kind]);

    TextLines { lines, format: LineFormat { line_ending, trailing_newline } }
}

/// Joins result lines with the line ending of `format`; a trailing newline is added if the input had one.
/// No lines give `""` (all data lines removed). One empty line without trailing newline is also `""`: the text
/// representation cannot tell it apart from an empty result.
pub fn join_lines<S: AsRef<str>>(lines: &[S], format: LineFormat) -> String {
    if lines.is_empty() {
        return String::new();
    }
    let ending = format.line_ending.as_str();
    let mut text = lines.iter().map(AsRef::as_ref).collect::<Vec<&str>>().join(ending);
    if format.trailing_newline {
        text.push_str(ending);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    /// Shared with the JS engine tests (`tests/unit/line-endings.test.ts`).
    const LINE_FIXTURES: &str = include_str!("../../tests/fixtures/line-endings-cases.json");

    #[derive(Deserialize)]
    struct Fixtures {
        lines: Vec<LineCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LineCase {
        name: String,
        input: String,
        lines: Vec<String>,
        line_ending: String,
        trailing_newline: bool,
        joined: String,
    }

    #[test]
    fn line_model_fixtures() {
        let fixtures: Fixtures = serde_json::from_str(LINE_FIXTURES).expect("invalid line fixtures");
        assert!(!fixtures.lines.is_empty());

        let mut failures = Vec::new();
        for c in &fixtures.lines {
            let actual = split_lines(&c.input);
            let expected_ending = LineEnding::parse(&c.line_ending).unwrap_or_else(|| panic!("{}: unknown line ending", c.name));
            let joined = join_lines(&actual.lines, actual.format);
            if actual.lines != c.lines
                || actual.format.line_ending != expected_ending
                || actual.format.trailing_newline != c.trailing_newline
                || joined != c.joined
            {
                failures.push(format!("{}\n    expected: {:?} {:?} {} {:?}\n    actual:   {:?} {:?} {} {:?}",
                    c.name, c.lines, expected_ending, c.trailing_newline, c.joined,
                    actual.lines, actual.format.line_ending, actual.format.trailing_newline, joined));
            }
        }
        assert!(failures.is_empty(), "{} of {} line fixtures failed:\n  {}", failures.len(), fixtures.lines.len(), failures.join("\n  "));
    }

    #[test]
    fn join_lines_without_lines_is_empty_even_with_trailing_newline() {
        let format = LineFormat { line_ending: LineEnding::CrLf, trailing_newline: true };
        assert_eq!(join_lines::<&str>(&[], format), "");
        assert_eq!(join_lines(&[""], format), "\r\n");
        assert_eq!(join_lines(&["a".to_string(), "b".to_string()], format), "a\r\nb\r\n");
    }

    #[test]
    fn parse_accepts_only_the_three_line_endings() {
        assert_eq!(LineEnding::parse("\r\n"), Some(LineEnding::CrLf));
        assert_eq!(LineEnding::parse("\r"), Some(LineEnding::Cr));
        assert_eq!(LineEnding::parse("\n"), Some(LineEnding::Lf));
        for invalid in ["", "\n\r", "lf", "\u{2028}"] {
            assert_eq!(LineEnding::parse(invalid), None, "{invalid:?}");
        }
    }

    #[test]
    fn large_crlf_text_is_split_without_terminators() {
        let text = "a,1\r\nb,2\r\n".repeat(50_000);
        let split = split_lines(&text);
        assert_eq!(split.lines.len(), 100_000);
        assert!(split.lines.iter().all(|line| !line.contains(['\r', '\n'])));
        assert_eq!(split.format, LineFormat { line_ending: LineEnding::CrLf, trailing_newline: true });
        assert_eq!(join_lines(&split.lines, split.format), text);
    }
}
