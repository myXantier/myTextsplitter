//! Tokenizer of the optional word diff (Paket 7, B2). Same table and rules as `src/utils/diff/tokenize.ts` (documented
//! there): whitespace runs, word runs, single tokens (punctuation, CJK, emoji), extending code points appended to the
//! previous token. Explicit code point table, no Unicode properties of the engine. No full grapheme segmentation.

use super::whitespace::is_diff_whitespace;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Whitespace,
    Word,
    Single,
    Extend,
    RegionalIndicator,
    /// Single token that does not count for the line similarity
    Punctuation,
}

/// (first, last, kind), checked in this order (first match wins); everything else is a word code point.
const TABLE: &[(u32, u32, Kind)] = &[
    // extend
    (0x0300, 0x036F, Kind::Extend),
    (0x1AB0, 0x1AFF, Kind::Extend),
    (0x1DC0, 0x1DFF, Kind::Extend),
    (0x200B, 0x200F, Kind::Extend),
    (0x2060, 0x2064, Kind::Extend),
    (0x20D0, 0x20FF, Kind::Extend),
    (0xFE00, 0xFE0F, Kind::Extend),
    (0xFE20, 0xFE2F, Kind::Extend),
    (0xFEFF, 0xFEFF, Kind::Extend),
    (0x1F3FB, 0x1F3FF, Kind::Extend),
    (0xE0020, 0xE007F, Kind::Extend),
    (0xE0100, 0xE01EF, Kind::Extend),
    (0x1F1E6, 0x1F1FF, Kind::RegionalIndicator),
    // ASCII punctuation and symbols (not `_`)
    (0x21, 0x2F, Kind::Punctuation),
    (0x3A, 0x40, Kind::Punctuation),
    (0x5B, 0x5E, Kind::Punctuation),
    (0x60, 0x60, Kind::Punctuation),
    (0x7B, 0x7E, Kind::Punctuation),
    // Latin-1 punctuation and symbols (not ª µ º)
    (0xA1, 0xA9, Kind::Punctuation),
    (0xAB, 0xB4, Kind::Punctuation),
    (0xB6, 0xB9, Kind::Punctuation),
    (0xBB, 0xBF, Kind::Punctuation),
    (0xD7, 0xD7, Kind::Punctuation),
    (0xF7, 0xF7, Kind::Punctuation),
    // general punctuation, arrows, technical symbols, symbols and dingbats
    (0x2010, 0x2027, Kind::Punctuation),
    (0x2030, 0x205E, Kind::Punctuation),
    (0x2190, 0x21FF, Kind::Single),
    (0x2300, 0x23FF, Kind::Single),
    (0x2600, 0x27BF, Kind::Single),
    (0x2B00, 0x2BFF, Kind::Single),
    // CJK
    (0x2E80, 0x2FDF, Kind::Single),
    (0x3001, 0x303F, Kind::Punctuation),
    (0x3040, 0x30FF, Kind::Single),
    (0x3100, 0x312F, Kind::Single),
    (0x3400, 0x4DBF, Kind::Single),
    (0x4E00, 0x9FFF, Kind::Single),
    (0xAC00, 0xD7AF, Kind::Single),
    (0xF900, 0xFAFF, Kind::Single),
    // fullwidth punctuation
    (0xFF01, 0xFF0F, Kind::Punctuation),
    (0xFF1A, 0xFF20, Kind::Punctuation),
    (0xFF3B, 0xFF40, Kind::Punctuation),
    (0xFF5B, 0xFF65, Kind::Punctuation),
    // emoji and pictographs, CJK extension ideographs
    (0x1F000, 0x1FAFF, Kind::Single),
    (0x20000, 0x3134F, Kind::Single),
];

fn kind_of(c: char) -> Kind {
    if is_diff_whitespace(c) {
        return Kind::Whitespace;
    }
    let cp = c as u32;
    TABLE.iter().find(|(first, last, _)| cp >= *first && cp <= *last).map_or(Kind::Word, |(_, _, kind)| *kind)
}

const ZWJ: char = '\u{200D}';

/// Splits a line into tokens; their concatenation is exactly the line.
pub fn tokenize(line: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut last_kind: Option<Kind> = None;
    let (mut join_next, mut open_flag) = (false, false);
    for c in line.chars() {
        let kind = kind_of(c);
        if let Some(last) = tokens.last_mut() {
            if kind == Kind::Extend || join_next || (kind == Kind::RegionalIndicator && open_flag) {
                last.push(c);
                join_next = c == ZWJ;
                open_flag = false;
                continue;
            }
            join_next = false;
            if Some(kind) == last_kind && matches!(kind, Kind::Whitespace | Kind::Word) {
                last.push(c);
                continue;
            }
        }
        tokens.push(c.to_string());
        last_kind = Some(kind);
        join_next = c == ZWJ;
        open_flag = kind == Kind::RegionalIndicator;
    }
    tokens
}

/// Class of a token for the line similarity of the word diff (same as `tokenClass` in JS).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenClass {
    Whitespace,
    Punctuation,
    Significant,
}

pub fn token_class(token: &str) -> TokenClass {
    if is_whitespace_token(token) {
        return TokenClass::Whitespace;
    }
    match token.chars().next().map(kind_of) {
        Some(Kind::Punctuation) => TokenClass::Punctuation,
        _ => TokenClass::Significant,
    }
}

/// A token that only consists of whitespace.
pub fn is_whitespace_token(token: &str) -> bool {
    !token.is_empty() && token.chars().all(is_diff_whitespace)
}
