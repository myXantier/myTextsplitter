//! Whitespace of the diff comparison key, identical to the JS engine (`src/utils/diff/whitespace.ts`): the Unicode
//! `White_Space` property (25 code points, the same set as `char::is_whitespace`, checked by a test).
//!
//! U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000.
//! Not whitespace: U+200B (zero width space), U+2060 (word joiner), U+FEFF (BOM / zero width no-break space).

use std::borrow::Cow;

pub fn is_diff_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{0085}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
    )
}

/// True for an empty line or a line that only consists of whitespace.
pub fn is_blank_line(line: &str) -> bool {
    line.chars().all(is_diff_whitespace)
}

/// Comparison key of a line. With `ignore_whitespace`, leading and trailing whitespace is removed and every inner
/// whitespace run becomes one space (U+0020). Only the key is normalized; the displayed text stays unchanged.
pub fn comparison_key(line: &str, ignore_whitespace: bool) -> Cow<'_, str> {
    if !ignore_whitespace {
        return Cow::Borrowed(line);
    }
    let mut key = String::with_capacity(line.len());
    for part in line.split(is_diff_whitespace).filter(|part| !part.is_empty()) {
        if !key.is_empty() {
            key.push(' ');
        }
        key.push_str(part);
    }
    Cow::Owned(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitespace_set_is_the_unicode_white_space_property() {
        for c in (0..=0x10FFFFu32).filter_map(char::from_u32) {
            assert_eq!(is_diff_whitespace(c), c.is_whitespace(), "U+{:04X}", c as u32);
        }
        for c in ['\u{200B}', '\u{2060}', '\u{FEFF}'] {
            assert!(!is_diff_whitespace(c));
        }
    }

    #[test]
    fn keys() {
        assert_eq!(comparison_key("  a \t b\u{3000}", true), "a b");
        assert_eq!(comparison_key("  a \t b", false), "  a \t b");
        assert_eq!(comparison_key(" \t ", true), "");
        assert_eq!(comparison_key("\u{FEFF}a", true), "\u{FEFF}a");
        assert!(is_blank_line("") && is_blank_line(" \t\u{A0}") && !is_blank_line("\u{200B}"));
    }
}
