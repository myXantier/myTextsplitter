//! Shared with the JS engine tests (`tests/unit/intraline.test.ts`): fixtures `tests/fixtures/intraline-cases.json`
//! (tokens, complete analyses, generated cases compared through a digest) and the invariants of every analysis.

use super::intraline::{compute_intraline, similarity_tokens, IntralineAnalysis, IntralineLimits, IntralineSegment, SegmentOp, INTRALINE_LIMITS};
use super::tokenize::{is_whitespace_token, tokenize};
use super::{compute_line_diff, DiffDocument, DiffRow, DIFF_WORK_LIMIT};
use serde_json::{json, Value};
use std::collections::HashMap;

const FIXTURES: &str = include_str!("../../../tests/fixtures/intraline-cases.json");

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).expect("invalid intraline fixtures")
}

fn op_char(op: SegmentOp) -> char {
    match op {
        SegmentOp::Equal => '=',
        SegmentOp::Delete => '-',
        SegmentOp::Insert => '+',
    }
}

/// Same shape as the fixtures.
fn fixture_form(a: &IntralineAnalysis) -> Value {
    let segments = |s: &[IntralineSegment]| -> Value { s.iter().map(|x| json!([op_char(x.op).to_string(), x.text])).collect() };
    let pairs: Vec<Value> = a
        .pairs
        .iter()
        .map(|p| {
            let mut v = json!({ "oldLine": p.old_line, "newLine": p.new_line, "similarity": [p.similarity.common, p.similarity.total] });
            match (&p.skipped, &p.old, &p.new) {
                (Some(reason), _, _) => v["skipped"] = serde_json::to_value(reason).unwrap(),
                (None, Some(old), Some(new)) => {
                    v["old"] = segments(old);
                    v["new"] = segments(new);
                }
                _ => panic!("pair without segments and without skip reason"),
            }
            v
        })
        .collect();
    json!({ "pairs": pairs, "skipped": serde_json::to_value(&a.skipped).unwrap(), "work": a.work })
}

fn limits_with(overrides: &Value) -> IntralineLimits {
    let mut limits = INTRALINE_LIMITS;
    if let Some(v) = overrides["maxLineTokens"].as_u64() {
        limits.max_line_tokens = v as usize;
    }
    if let Some(v) = overrides["maxPairingCells"].as_u64() {
        limits.max_pairing_cells = v as usize;
    }
    if let Some(v) = overrides["maxPairWork"].as_u64() {
        limits.max_pair_work = v;
    }
    if let Some(v) = overrides["budget"].as_u64() {
        limits.budget = v;
    }
    limits
}

/// Invariants of every analysis (same rules as `intralineError` in JS).
fn assert_invariants(a: &IntralineAnalysis, d: &DiffDocument, limits: IntralineLimits) {
    assert_eq!(a.ignore_whitespace, d.options.ignore_whitespace);
    assert!(a.work <= limits.budget);
    let mut hunk = 0;
    let (mut old_rows, mut new_rows) = (HashMap::new(), HashMap::new());
    for row in &d.rows {
        match row {
            DiffRow::Equal { .. } => hunk += 1,
            DiffRow::Delete { old, move_id: None } => {
                old_rows.insert(old.line, (hunk, old.text.clone()));
            }
            DiffRow::Insert { new, move_id: None } => {
                new_rows.insert(new.line, (hunk, new.text.clone()));
            }
            _ => {}
        }
    }
    let (mut prev_old, mut prev_new) = (0, 0);
    for p in &a.pairs {
        assert!(p.old_line > prev_old && p.new_line > prev_new, "pairs in order, each line once");
        prev_old = p.old_line;
        prev_new = p.new_line;
        let (old_hunk, old_text) = &old_rows[&p.old_line];
        let (new_hunk, new_text) = &new_rows[&p.new_line];
        assert_eq!(old_hunk, new_hunk, "pair inside one hunk");
        // The claimed similarity is the one of the similarity tokens of both lines
        let bag = |text: &str| {
            let mut bag: HashMap<String, usize> = HashMap::new();
            let tokens = tokenize(text);
            for t in similarity_tokens(&tokens) {
                *bag.entry(t.clone()).or_insert(0) += 1;
            }
            bag
        };
        let (old_bag, new_bag) = (bag(old_text), bag(new_text));
        let common: usize = old_bag.iter().map(|(t, n)| (*n).min(new_bag.get(t).copied().unwrap_or(0))).sum();
        let total = old_bag.values().sum::<usize>() + new_bag.values().sum::<usize>();
        assert_eq!((p.similarity.common, p.similarity.total), (common, total), "similarity of the similarity tokens");
        assert!(total > 0 && 4 * common >= total, "similarity >= 0.5");
        let (Some(old), Some(new)) = (&p.old, &p.new) else {
            assert!(p.skipped.is_some() && p.old.is_none() && p.new.is_none());
            continue;
        };
        for (segments, changed, original) in [(old, SegmentOp::Delete, old_text), (new, SegmentOp::Insert, new_text)] {
            assert_eq!(&segments.iter().map(|s| s.text.as_str()).collect::<String>(), original, "segments rebuild the line");
            for (k, s) in segments.iter().enumerate() {
                assert!(s.op == SegmentOp::Equal || s.op == changed);
                assert!(!s.text.is_empty());
                assert!(k == 0 || segments[k - 1].op != s.op);
                assert!(!(a.ignore_whitespace && s.op != SegmentOp::Equal && is_whitespace_token(&s.text)));
            }
        }
        // Segments consist of whole tokens: tokenize each equal segment on its own
        let unchanged = |segments: &[IntralineSegment]| -> Vec<String> {
            segments
                .iter()
                .filter(|s| s.op == SegmentOp::Equal)
                .flat_map(|s| tokenize(&s.text))
                .filter(|t| !is_whitespace_token(t))
                .collect()
        };
        assert_eq!(unchanged(old), unchanged(new), "same unchanged content on both sides");
    }
    for s in &a.skipped {
        assert!(s.old.iter().all(|l| old_rows.contains_key(l)) && s.new.iter().all(|l| new_rows.contains_key(l)));
    }
}

fn analyze(old: &str, new: &str, ignore_whitespace: bool, limits: IntralineLimits) -> IntralineAnalysis {
    let d = compute_line_diff(old, new, ignore_whitespace, DIFF_WORK_LIMIT).unwrap();
    let before = d.clone();
    let a = compute_intraline(&d, limits);
    assert_eq!(d, before, "the line diff is not changed");
    assert_invariants(&a, &d, limits);
    a
}

#[test]
fn intraline_limits_match_the_fixture() {
    let f = fixtures();
    assert_eq!(limits_with(&f["limits"]), INTRALINE_LIMITS);
    assert_eq!(
        (f["limits"]["maxLineTokens"].as_u64(), f["limits"]["maxPairingCells"].as_u64(), f["limits"]["maxPairWork"].as_u64(), f["limits"]["budget"].as_u64()),
        (Some(500), Some(2_500), Some(1_000_000), Some(2_000_000))
    );
}

#[test]
fn tokenizer_fixtures() {
    for t in fixtures()["tokens"].as_array().unwrap() {
        let text = t["text"].as_str().unwrap();
        let expected: Vec<String> = t["tokens"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
        assert_eq!(tokenize(text), expected, "{text:?}");
    }
}

#[test]
fn intraline_fixtures() {
    let mut failures = Vec::new();
    for c in fixtures()["cases"].as_array().unwrap() {
        let limits = limits_with(&c["limits"]);
        let a = analyze(c["old"].as_str().unwrap(), c["new"].as_str().unwrap(), c["ignoreWhitespace"].as_bool().unwrap_or(false), limits);
        let expected = json!({ "pairs": c["pairs"], "skipped": c["skipped"], "work": c["work"] });
        let actual = fixture_form(&a);
        if actual != expected {
            failures.push(format!("{}\n    expected: {expected}\n    actual:   {actual}", c["name"]));
        }
    }
    assert!(failures.is_empty(), "{} intraline fixtures failed:\n  {}", failures.len(), failures.join("\n  "));
}

// --- generated cases: same generator as `generatedIntralineCases` in tests/unit/intraline.test.ts ---

const GEN_WORDS: [&str; 10] = ["Die", "Katze", "l\u{E4}uft", ",", ".", "a", "b", "\u{1F600}", "x1", "\u{6211}"];
const GEN_SEPARATORS: [&str; 4] = [" ", "  ", "", "\t"];

struct XorShift(u32);

impl XorShift {
    fn next(&mut self, n: u32) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0 % n
    }
}

fn generated_intraline_cases(seed: u32, count: usize) -> Vec<(String, String, bool, IntralineLimits)> {
    let mut rng = XorShift(seed);
    let text = |rng: &mut XorShift, size: u32| {
        let line_count = rng.next(5);
        let mut lines = Vec::new();
        for _ in 0..line_count {
            let word_count = 1 + rng.next(5);
            let mut line = GEN_WORDS[rng.next(size) as usize].to_string();
            for _ in 1..word_count {
                line.push_str(GEN_SEPARATORS[rng.next(4) as usize]);
                line.push_str(GEN_WORDS[rng.next(size) as usize]);
            }
            lines.push(line);
        }
        lines.join("\n")
    };
    (0..count)
        .map(|_| {
            let ignore_whitespace = rng.next(2) == 1;
            let size = 2 + rng.next(GEN_WORDS.len() as u32 - 1);
            let small = IntralineLimits {
                max_line_tokens: 3 + rng.next(14) as usize,
                max_pairing_cells: 1 + rng.next(9) as usize,
                max_pair_work: 1 + rng.next(80) as u64,
                budget: 10 + rng.next(300) as u64,
            };
            let limits = if rng.next(2) == 1 { INTRALINE_LIMITS } else { small };
            let old = text(&mut rng, size);
            let new = text(&mut rng, size);
            (old, new, ignore_whitespace, limits)
        })
        .collect()
}

/// Same compact form as `compactAnalysis` in JS (segments separated by U+001F).
fn compact_analysis(a: &IntralineAnalysis) -> String {
    let segments = |s: &[IntralineSegment]| s.iter().map(|x| format!("{}{}", op_char(x.op), x.text)).collect::<Vec<_>>().join("\u{1F}");
    let mut parts: Vec<String> = a
        .pairs
        .iter()
        .map(|p| {
            let head = format!("P{}/{}:{}/{}", p.old_line, p.new_line, p.similarity.common, p.similarity.total);
            match (&p.skipped, &p.old, &p.new) {
                (Some(r), _, _) => format!("{head}:S{}", serde_json::to_value(r).unwrap().as_str().unwrap()),
                (None, Some(old), Some(new)) => format!("{head}:O{}:N{}", segments(old), segments(new)),
                _ => unreachable!(),
            }
        })
        .collect();
    for s in &a.skipped {
        let join = |v: &[usize]| v.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(",");
        parts.push(format!("K{}:{}:{}", serde_json::to_value(s.reason).unwrap().as_str().unwrap(), join(&s.old), join(&s.new)));
    }
    parts.push(format!("W{}", a.work));
    parts.join("|")
}

fn fnv1a(bytes: &[u8]) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for &byte in bytes {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

#[test]
fn intraline_generated_cases_match_the_js_engine() {
    let f = fixtures();
    let generated = &f["generated"];
    let mut compact = String::new();
    for (old, new, ignore_whitespace, limits) in generated_intraline_cases(generated["seed"].as_u64().unwrap() as u32, generated["count"].as_u64().unwrap() as usize) {
        let a = analyze(&old, &new, ignore_whitespace, limits);
        compact.push_str(&compact_analysis(&a));
        compact.push('\n');
    }
    assert_eq!(fnv1a(compact.as_bytes()), generated["digest"].as_str().unwrap());
}

#[test]
fn word_diff_is_in_the_response_only_when_requested() {
    let (old, new) = ("Titel\nDie schnelle braune Katze springt.", "Neue Einleitung\nTitel\nDie schnelle schwarze Katze läuft.");
    let without = serde_json::to_value(super::get_diff(old, new, false, false).unwrap()).unwrap();
    assert!(without["intraline"].is_null(), "no word diff when it is not requested");
    let with = super::get_diff(old, new, false, true).unwrap();
    assert_eq!(serde_json::to_value(&with.document).unwrap(), without["document"], "the same line diff in both modes");
    let analysis = with.intraline.clone().expect("word diff when it is requested");
    assert_eq!(analysis, compute_intraline(&with.document, INTRALINE_LIMITS));
    assert_eq!((analysis.pairs.len(), analysis.pairs[0].old_line, analysis.pairs[0].new_line), (1, 2, 3), "the introduction line is not paired");
    let keys: Vec<String> = serde_json::to_value(&with).unwrap().as_object().unwrap().keys().cloned().collect();
    assert_eq!(keys, ["document", "intraline", "metrics"]);
}
