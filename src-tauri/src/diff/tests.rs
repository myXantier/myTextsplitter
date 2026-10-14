//! Shared with the JS engine tests (`tests/unit/diff.test.ts`): golden fixtures `tests/fixtures/diff-cases.json`
//! (complete expected result), exact JSON shape, work counting, generated parity cases (digest), invariants.

use super::myers::{align_sequences, DiffLimitExceeded};
use crate::text_processor::TextError;
use super::whitespace::{comparison_key, is_blank_line};
use super::*;
use crate::line_endings::split_lines;
use serde_json::Value;

const FIXTURES: &str = include_str!("../../../tests/fixtures/diff-cases.json");
const LINE_FIXTURES: &str = include_str!("../../../tests/fixtures/line-endings-cases.json");

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).expect("invalid diff fixtures")
}

fn diff(old: &str, new: &str, ignore_whitespace: bool) -> DiffDocument {
    compute_line_diff(old, new, ignore_whitespace, DIFF_WORK_LIMIT).expect("within the work limit")
}

fn compact_rows(d: &DiffDocument) -> String {
    let mark = |id: &Option<usize>| id.map(|id| format!("m{id}")).unwrap_or_default();
    d.rows
        .iter()
        .map(|row| match row {
            DiffRow::Equal { old, new } => format!("={}/{}", old.line, new.line),
            DiffRow::Delete { old, move_id } => format!("-{}{}", old.line, mark(move_id)),
            DiffRow::Insert { new, move_id } => format!("+{}{}", new.line, mark(move_id)),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn compact_moves(d: &DiffDocument) -> Vec<String> {
    d.moves.iter().map(|m| format!("{}:{}>{}", m.id, m.old_line, m.new_line)).collect()
}

/// Every invariant of a diff of exactly these texts (same checks as `assertInvariants` + `diffDocumentError` in JS).
fn assert_invariants(d: &DiffDocument, old_text: &str, new_text: &str, ignore_whitespace: bool) {
    let old_lines = split_lines(old_text).lines;
    let new_lines = split_lines(new_text).lines;
    assert_eq!(d.version, 2);
    assert_eq!(d.options.ignore_whitespace, ignore_whitespace);
    assert_eq!((d.old_line_count, d.new_line_count), (old_lines.len(), new_lines.len()));

    let (mut next_old, mut next_new, mut equal) = (1, 1, 0);
    let mut delete_moves = Vec::new();
    let mut insert_moves = Vec::new();
    for row in &d.rows {
        match row {
            DiffRow::Equal { old, new } => {
                assert_eq!((old.line, new.line), (next_old, next_new), "every line once, in order");
                assert_eq!(old.text, old_lines[old.line - 1]);
                assert_eq!(new.text, new_lines[new.line - 1]);
                assert_eq!(comparison_key(&old.text, ignore_whitespace), comparison_key(&new.text, ignore_whitespace));
                next_old += 1;
                next_new += 1;
                equal += 1;
            }
            DiffRow::Delete { old, move_id } => {
                assert_eq!(old.line, next_old, "every old line once, in order");
                assert_eq!(old.text, old_lines[old.line - 1]);
                if let Some(id) = move_id {
                    delete_moves.push((*id, old.line));
                }
                next_old += 1;
            }
            DiffRow::Insert { new, move_id } => {
                assert_eq!(new.line, next_new, "every new line once, in order");
                assert_eq!(new.text, new_lines[new.line - 1]);
                if let Some(id) = move_id {
                    insert_moves.push((*id, new.line));
                }
                next_new += 1;
            }
        }
    }
    assert_eq!((next_old - 1, next_new - 1), (old_lines.len(), new_lines.len()), "no line missing");

    delete_moves.sort();
    insert_moves.sort();
    assert_eq!(delete_moves.len(), d.moves.len());
    assert_eq!(insert_moves.len(), d.moves.len());
    for (index, m) in d.moves.iter().enumerate() {
        assert_eq!(m.id, index + 1);
        assert_eq!(delete_moves[index], (m.id, m.old_line), "move has exactly its delete");
        assert_eq!(insert_moves[index], (m.id, m.new_line), "move has exactly its insert");
        let key = comparison_key(old_lines[m.old_line - 1], ignore_whitespace);
        assert!(!is_blank_line(old_lines[m.old_line - 1]));
        assert_eq!(comparison_key(new_lines[m.new_line - 1], ignore_whitespace), key);
        assert_eq!(old_lines.iter().filter(|l| comparison_key(l, ignore_whitespace) == key).count(), 1);
        assert_eq!(new_lines.iter().filter(|l| comparison_key(l, ignore_whitespace) == key).count(), 1);
    }

    let moved = d.moves.len();
    assert_eq!(
        d.stats,
        DiffStats { unchanged: equal, removed: old_lines.len() - equal - moved, added: new_lines.len() - equal - moved, moved }
    );
}

fn lcs_length(a: &[String], b: &[String]) -> usize {
    let mut prev = vec![0usize; b.len() + 1];
    for i in (0..a.len()).rev() {
        let mut cur = vec![0usize; b.len() + 1];
        for j in (0..b.len()).rev() {
            cur[j] = if a[i] == b[j] { prev[j + 1] + 1 } else { prev[j].max(cur[j + 1]) };
        }
        prev = cur;
    }
    prev[0]
}

#[test]
fn diff_fixtures() {
    let fixtures = fixtures();
    let cases = fixtures["cases"].as_array().unwrap();
    assert!(cases.len() >= 50);
    let mut failures = Vec::new();
    for c in cases {
        let (old, new) = (c["old"].as_str().unwrap(), c["new"].as_str().unwrap());
        let ignore_whitespace = c["ignoreWhitespace"].as_bool().unwrap_or(false);
        let d = diff(old, new, ignore_whitespace);
        assert_invariants(&d, old, new, ignore_whitespace);
        let actual = (compact_rows(&d), compact_moves(&d), serde_json::to_value(&d.stats).unwrap());
        let expected_moves: Vec<String> = c["moves"].as_array().unwrap().iter().map(|m| m.as_str().unwrap().to_string()).collect();
        let expected = (c["rows"].as_str().unwrap().to_string(), expected_moves, c["stats"].clone());
        if actual != expected {
            failures.push(format!("{}\n    expected: {:?}\n    actual:   {:?}", c["name"], expected, actual));
        }
    }
    assert!(failures.is_empty(), "{} diff fixtures failed:\n  {}", failures.len(), failures.join("\n  "));
}

#[test]
fn diff_documents_have_the_exact_json_shape() {
    for c in fixtures()["documents"].as_array().unwrap() {
        let d = diff(c["old"].as_str().unwrap(), c["new"].as_str().unwrap(), c["ignoreWhitespace"].as_bool().unwrap());
        assert_eq!(serde_json::to_value(&d).unwrap(), c["document"], "{}", c["name"]);
    }
}

#[test]
fn diff_work_counting_matches_the_fixture() {
    let fixtures = fixtures();
    let n = fixtures["limit"]["reversedLines"].as_u64().unwrap() as u32;
    let work = fixtures["limit"]["work"].as_u64().unwrap();
    let a: Vec<u32> = (0..n).collect();
    let b: Vec<u32> = (0..n).rev().collect();
    assert!(align_sequences(&a, &b, n as usize, work).is_ok());
    assert_eq!(align_sequences(&a, &b, n as usize, work - 1).err(), Some(DiffLimitExceeded { limit: work - 1 }));
}

// --- generated cases: same generator as `generatedCases` in tests/unit/diff.test.ts ---

const GEN_ALPHABET: [&str; 10] = ["a", "b", "c", "", "  a", "a ", "\t", "b\u{A0}", "\u{E4}", "\u{1F600}"];
const GEN_SEPARATORS: [&str; 3] = ["\n", "\r\n", "\r"];

struct XorShift(u32);

impl XorShift {
    fn next(&mut self, n: u32) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0 % n
    }
}

fn generated_cases(seed: u32, count: usize) -> Vec<(String, String, bool)> {
    let mut rng = XorShift(seed);
    let text = |rng: &mut XorShift, size: u32| {
        let length = rng.next(9);
        let lines: Vec<&str> = (0..length).map(|_| GEN_ALPHABET[rng.next(size) as usize]).collect();
        let separator = GEN_SEPARATORS[rng.next(3) as usize];
        let trailing = rng.next(2) == 1;
        let mut text = lines.join(separator);
        if trailing && length > 0 {
            text.push_str(separator);
        }
        text
    };
    (0..count)
        .map(|_| {
            let ignore_whitespace = rng.next(2) == 1;
            let size = 1 + rng.next(GEN_ALPHABET.len() as u32);
            let old = text(&mut rng, size);
            let new = text(&mut rng, size);
            (old, new, ignore_whitespace)
        })
        .collect()
}

fn fnv1a(text: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in text.bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

#[test]
fn diff_generated_cases_match_the_js_engine() {
    let fixtures = fixtures();
    let generated = &fixtures["generated"];
    let mut compact = String::new();
    for (old, new, ignore_whitespace) in generated_cases(generated["seed"].as_u64().unwrap() as u32, generated["count"].as_u64().unwrap() as usize) {
        let d = diff(&old, &new, ignore_whitespace);
        assert_invariants(&d, &old, &new, ignore_whitespace);
        let keys = |text: &str| split_lines(text).lines.iter().map(|l| comparison_key(l, ignore_whitespace).into_owned()).collect::<Vec<_>>();
        assert_eq!(d.stats.unchanged, lcs_length(&keys(&old), &keys(&new)), "minimal alignment");
        compact.push_str(&compact_rows(&d));
        compact.push('\n');
    }
    assert_eq!(fnv1a(&compact), generated["digest"].as_str().unwrap());
}

// --- limits, long texts, IPC shape ---

#[test]
fn too_many_reordered_lines_are_a_diff_too_complex_error() {
    let lines: Vec<String> = (0..12_000).map(|i| format!("line {i}")).collect();
    let reversed: Vec<String> = lines.iter().rev().cloned().collect();
    let result = get_diff(&lines.join("\n"), &reversed.join("\n"), false);
    assert!(matches!(result, Err(TextError::DiffTooComplex(_))), "{:?}", result.map(|r| r.document.stats));
    assert_eq!(
        serde_json::to_value(TextError::DiffTooComplex("x".into())).unwrap(),
        serde_json::json!({ "kind": "diffTooComplex", "message": "x" })
    );
}

#[test]
fn long_texts_mostly_equal_or_completely_different() {
    let base: Vec<String> = (0..100_000).map(|i| format!("line {i}")).collect();
    let mut changed = base.clone();
    for i in (0..changed.len()).step_by(997) {
        changed[i] = format!("changed {i}");
    }
    changed.insert(50_000, "inserted".into());
    changed.insert(0, "first".into());
    let d = diff(&base.join("\n"), &changed.join("\n"), false);
    assert_eq!(d.stats, DiffStats { unchanged: 99_899, removed: 101, added: 103, moved: 0 });

    let other: Vec<String> = base.iter().map(|l| format!("other {l}")).collect();
    let d = diff(&base.join("\n"), &other.join("\n"), false);
    assert_eq!(d.stats, DiffStats { unchanged: 0, removed: 100_000, added: 100_000, moved: 0 });
}

#[test]
fn response_is_structured_ipc_data() {
    let response = get_diff("a\nb", "b\nc", false).unwrap();
    let json = serde_json::to_value(&response).unwrap();
    assert!(json["document"].is_object(), "no JSON string inside the IPC JSON");
    assert!(json["metrics"]["execution_time_ms"].is_number());
}

// --- line-ending fixtures (Paket 6): which lines are unchanged and which are changes ---

#[test]
fn diff_line_ending_fixtures() {
    let fixtures: Value = serde_json::from_str(LINE_FIXTURES).expect("invalid line-ending fixtures");
    let cases = fixtures["diff"].as_array().unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        let d = diff(c["old"].as_str().unwrap(), c["new"].as_str().unwrap(), false);
        let mut unchanged = Vec::new();
        let mut changes = Vec::new();
        for row in &d.rows {
            match row {
                DiffRow::Equal { new, .. } => unchanged.push(new.text.clone()),
                DiffRow::Delete { old, .. } => changes.push(format!("removed:{}", old.text)),
                DiffRow::Insert { new, .. } => changes.push(format!("added:{}", new.text)),
            }
        }
        let list = |v: &Value| {
            let mut list: Vec<String> = v.as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect();
            list.sort();
            list
        };
        unchanged.sort();
        changes.sort();
        assert_eq!((unchanged, changes), (list(&c["unchanged"]), list(&c["changes"])), "{}", c["name"]);
        assert!(d.rows.iter().all(|row| match row {
            DiffRow::Equal { old, new } => !old.text.contains(['\r', '\n']) && !new.text.contains(['\r', '\n']),
            DiffRow::Delete { old, .. } => !old.text.contains(['\r', '\n']),
            DiffRow::Insert { new, .. } => !new.text.contains(['\r', '\n']),
        }));
    }
}
