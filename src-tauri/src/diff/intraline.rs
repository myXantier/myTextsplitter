//! Optional word diff (Paket 7, B2): a pure analysis of a finished `DiffDocument`, step-for-step identical to
//! `src/utils/diff/intraline.ts` (rules, tie-breaks and limits are documented there). Nothing of it runs unless
//! `compute_intraline` is called; the line diff (`get_diff`) never calls it. The Tauri command and the UI use it from
//! Paket 7 B3 on.

use std::collections::HashMap;

use serde::Serialize;

use super::myers::align_sequences;
use super::tokenize::{is_whitespace_token, token_class, tokenize, TokenClass};
use super::{DiffDocument, DiffLine, DiffRow};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct IntralineLimits {
    pub max_line_tokens: usize,
    pub max_pairing_cells: usize,
    pub max_pair_work: u64,
    pub budget: u64,
}

/// Same values as `INTRALINE_LIMITS` in JS (reasons there).
pub const INTRALINE_LIMITS: IntralineLimits =
    IntralineLimits { max_line_tokens: 500, max_pairing_cells: 2_500, max_pair_work: 1_000_000, budget: 2_000_000 };

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SegmentOp {
    Equal,
    Delete,
    Insert,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IntralineSegment {
    pub op: SegmentOp,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkipReason {
    LineTooLong,
    HunkTooLarge,
    BudgetExceeded,
    TooComplex,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Similarity {
    pub common: usize,
    pub total: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntralinePair {
    pub old_line: usize,
    pub new_line: usize,
    pub similarity: Similarity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old: Option<Vec<IntralineSegment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new: Option<Vec<IntralineSegment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<SkipReason>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IntralineSkip {
    pub reason: SkipReason,
    pub old: Vec<usize>,
    pub new: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntralineAnalysis {
    pub version: u32,
    pub ignore_whitespace: bool,
    pub pairs: Vec<IntralinePair>,
    pub skipped: Vec<IntralineSkip>,
    pub work: u64,
}

struct BudgetExceeded;

struct Budget {
    used: u64,
    limit: u64,
}

impl Budget {
    fn spend(&mut self, units: u64) -> Result<(), BudgetExceeded> {
        self.used += units;
        if self.used > self.limit {
            return Err(BudgetExceeded);
        }
        Ok(())
    }

    fn remaining(&self) -> u64 {
        self.limit - self.used
    }
}

struct Candidate {
    line: usize,
    tokens: Vec<String>,
    /// Similarity tokens with their counts
    bag: HashMap<String, usize>,
    similarity_count: usize,
    /// Non-whitespace tokens: the cost of a similarity check
    content_count: usize,
}

/// Tokens that decide the line similarity: the significant ones, or the punctuation of a line without them (as in JS).
pub fn similarity_tokens(tokens: &[String]) -> Vec<&String> {
    let significant: Vec<&String> = tokens.iter().filter(|t| token_class(t) == TokenClass::Significant).collect();
    if !significant.is_empty() {
        return significant;
    }
    tokens.iter().filter(|t| token_class(t) == TokenClass::Punctuation).collect()
}

struct Hunk<'d> {
    deletes: Vec<&'d DiffLine>,
    inserts: Vec<&'d DiffLine>,
}

fn hunks_of(document: &DiffDocument) -> Vec<Hunk<'_>> {
    let mut hunks = Vec::new();
    let mut current = Hunk { deletes: Vec::new(), inserts: Vec::new() };
    for row in &document.rows {
        match row {
            DiffRow::Equal { .. } => {
                let done = std::mem::replace(&mut current, Hunk { deletes: Vec::new(), inserts: Vec::new() });
                if !done.deletes.is_empty() && !done.inserts.is_empty() {
                    hunks.push(done);
                }
            }
            DiffRow::Delete { move_id: Some(_), .. } | DiffRow::Insert { move_id: Some(_), .. } => {}
            DiffRow::Delete { old, .. } => current.deletes.push(old),
            DiffRow::Insert { new, .. } => current.inserts.push(new),
        }
    }
    if !current.deletes.is_empty() && !current.inserts.is_empty() {
        hunks.push(current);
    }
    hunks
}

pub fn compute_intraline(document: &DiffDocument, limits: IntralineLimits) -> IntralineAnalysis {
    let ignore_whitespace = document.options.ignore_whitespace;
    let mut pairs = Vec::new();
    let mut skipped = Vec::new();
    let mut budget = Budget { used: 0, limit: limits.budget };
    let mut exhausted = false;

    for hunk in hunks_of(document) {
        let old_lines: Vec<usize> = hunk.deletes.iter().map(|l| l.line).collect();
        let new_lines: Vec<usize> = hunk.inserts.iter().map(|l| l.line).collect();
        if exhausted {
            skipped.push(IntralineSkip { reason: SkipReason::BudgetExceeded, old: old_lines, new: new_lines });
            continue;
        }
        if hunk.deletes.len() * hunk.inserts.len() > limits.max_pairing_cells {
            skipped.push(IntralineSkip { reason: SkipReason::HunkTooLarge, old: old_lines, new: new_lines });
            continue;
        }
        let start = budget.used;
        let mut hunk_pairs = Vec::new();
        let mut hunk_skips = Vec::new();
        match analyze_hunk(&hunk, ignore_whitespace, limits, &mut budget, &mut hunk_pairs, &mut hunk_skips) {
            Ok(()) => {
                pairs.extend(hunk_pairs);
                skipped.extend(hunk_skips);
            }
            Err(BudgetExceeded) => {
                // Nothing of this hunk is delivered; its work is not counted
                budget.used = start;
                exhausted = true;
                skipped.push(IntralineSkip { reason: SkipReason::BudgetExceeded, old: old_lines, new: new_lines });
            }
        }
    }
    IntralineAnalysis { version: 1, ignore_whitespace, pairs, skipped, work: budget.used }
}

fn candidates(
    lines: &[&DiffLine],
    is_old: bool,
    limits: IntralineLimits,
    budget: &mut Budget,
    skips: &mut Vec<IntralineSkip>,
) -> Result<Vec<Candidate>, BudgetExceeded> {
    let mut out = Vec::new();
    for line in lines {
        let tokens = tokenize(&line.text);
        budget.spend(tokens.len() as u64)?;
        if tokens.len() > limits.max_line_tokens {
            let (old, new) = if is_old { (vec![line.line], vec![]) } else { (vec![], vec![line.line]) };
            skips.push(IntralineSkip { reason: SkipReason::LineTooLong, old, new });
            continue;
        }
        let content_count = tokens.iter().filter(|t| !is_whitespace_token(t)).count();
        if content_count == 0 {
            continue;
        }
        let similar = similarity_tokens(&tokens);
        let similarity_count = similar.len();
        let mut bag: HashMap<String, usize> = HashMap::new();
        for token in similar {
            *bag.entry(token.clone()).or_insert(0) += 1;
        }
        out.push(Candidate { line: line.line, tokens, bag, similarity_count, content_count });
    }
    Ok(out)
}

fn analyze_hunk(
    hunk: &Hunk<'_>,
    ignore_whitespace: bool,
    limits: IntralineLimits,
    budget: &mut Budget,
    pairs: &mut Vec<IntralinePair>,
    skips: &mut Vec<IntralineSkip>,
) -> Result<(), BudgetExceeded> {
    let olds = candidates(&hunk.deletes, true, limits, budget, skips)?;
    let news = candidates(&hunk.inserts, false, limits, budget, skips)?;
    let (rows, cols) = (olds.len(), news.len());
    if rows == 0 || cols == 0 {
        return Ok(());
    }

    // Similarity of every candidate pair (score -1 = below the threshold)
    let mut common = vec![0usize; rows * cols];
    let mut score = vec![-1i64; rows * cols];
    for i in 0..rows {
        for j in 0..cols {
            budget.spend((olds[i].content_count + news[j].content_count) as u64)?;
            let total = olds[i].similarity_count + news[j].similarity_count;
            let c = common_count(&olds[i].bag, &news[j].bag);
            common[i * cols + j] = c;
            if 4 * c >= total {
                score[i * cols + j] = (2_000_000 * c / total) as i64;
            }
        }
    }

    // Order-preserving pairing with the highest total score (ties: the earliest old line is paired)
    let width = cols + 1;
    let mut best = vec![0i64; (rows + 1) * width];
    for i in (0..rows).rev() {
        for j in (0..cols).rev() {
            let s = score[i * cols + j];
            let pair = if s >= 0 { s + best[(i + 1) * width + j + 1] } else { -1 };
            best[i * width + j] = best[(i + 1) * width + j].max(best[i * width + j + 1]).max(pair);
        }
    }
    let (mut i, mut j) = (0, 0);
    while i < rows && j < cols {
        let s = score[i * cols + j];
        if s >= 0 && best[i * width + j] == s + best[(i + 1) * width + j + 1] {
            let similarity = Similarity { common: common[i * cols + j], total: olds[i].similarity_count + news[j].similarity_count };
            pairs.push(token_diff(&olds[i], &news[j], similarity, ignore_whitespace, limits, budget)?);
            i += 1;
            j += 1;
        } else if best[i * width + j] == best[i * width + j + 1] {
            j += 1;
        } else {
            i += 1;
        }
    }
    Ok(())
}

fn common_count(a: &HashMap<String, usize>, b: &HashMap<String, usize>) -> usize {
    let (small, large) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    small.iter().map(|(token, n)| (*n).min(large.get(token).copied().unwrap_or(0))).sum()
}

struct PairAlignment<'c> {
    old: &'c Candidate,
    new: &'c Candidate,
    ids: HashMap<&'c str, u32>,
    matched_old: Vec<bool>,
    matched_new: Vec<bool>,
    work: u64,
}

impl<'c> PairAlignment<'c> {
    fn id_of(&mut self, token: &'c str) -> u32 {
        let next = self.ids.len() as u32;
        *self.ids.entry(token).or_insert(next)
    }

    /// Aligns the tokens at the given indices and marks the matched ones; `Ok(false)` if the pair is too complex.
    fn align(&mut self, old_index: &[usize], new_index: &[usize], limits: IntralineLimits, budget: &mut Budget) -> Result<bool, BudgetExceeded> {
        if old_index.is_empty() || new_index.is_empty() {
            return Ok(true);
        }
        let (old, new) = (self.old, self.new);
        let a: Vec<u32> = old_index.iter().map(|&k| self.id_of(&old.tokens[k])).collect();
        let b: Vec<u32> = new_index.iter().map(|&k| self.id_of(&new.tokens[k])).collect();
        let left = budget.remaining();
        let pair_left = limits.max_pair_work - self.work;
        let limit = pair_left.min(left);
        match align_sequences(&a, &b, self.ids.len(), limit) {
            Ok(matches) => {
                budget.spend(matches.work)?;
                self.work += matches.work;
                for &k in &matches.old {
                    self.matched_old[old_index[k]] = true;
                }
                for &k in &matches.new {
                    self.matched_new[new_index[k]] = true;
                }
                Ok(true)
            }
            Err(_) => {
                // The budget is the tighter limit: the whole analysis stops here; otherwise only this pair is skipped
                if left <= pair_left {
                    return Err(BudgetExceeded);
                }
                budget.spend(limit)?;
                Ok(false)
            }
        }
    }
}

fn token_diff(
    old: &Candidate,
    new: &Candidate,
    similarity: Similarity,
    ignore_whitespace: bool,
    limits: IntralineLimits,
    budget: &mut Budget,
) -> Result<IntralinePair, BudgetExceeded> {
    let mut alignment = PairAlignment {
        old,
        new,
        ids: HashMap::new(),
        matched_old: vec![false; old.tokens.len()],
        matched_new: vec![false; new.tokens.len()],
        work: 0,
    };
    let too_complex = |similarity: Similarity| IntralinePair {
        old_line: old.line,
        new_line: new.line,
        similarity,
        old: None,
        new: None,
        skipped: Some(SkipReason::TooComplex),
    };

    // 1. Non-whitespace tokens
    let content = |tokens: &[String]| -> Vec<usize> { (0..tokens.len()).filter(|&k| !is_whitespace_token(&tokens[k])).collect() };
    let old_content = content(&old.tokens);
    let new_content = content(&new.tokens);
    if !alignment.align(&old_content, &new_content, limits, budget)? {
        return Ok(too_complex(similarity));
    }

    // 2. Whitespace tokens inside each gap between consecutive matched content tokens
    if !ignore_whitespace {
        let anchors = |content: &[usize], matched: &[bool], len: usize| -> Vec<isize> {
            let mut anchors = vec![-1isize];
            anchors.extend(content.iter().filter(|&&k| matched[k]).map(|&k| k as isize));
            anchors.push(len as isize);
            anchors
        };
        let anchors_old = anchors(&old_content, &alignment.matched_old, old.tokens.len());
        let anchors_new = anchors(&new_content, &alignment.matched_new, new.tokens.len());
        let gap = |tokens: &[String], from: isize, to: isize| -> Vec<usize> {
            ((from + 1)..to).map(|k| k as usize).filter(|&k| is_whitespace_token(&tokens[k])).collect()
        };
        for g in 1..anchors_old.len() {
            let old_gap = gap(&old.tokens, anchors_old[g - 1], anchors_old[g]);
            let new_gap = gap(&new.tokens, anchors_new[g - 1], anchors_new[g]);
            if !alignment.align(&old_gap, &new_gap, limits, budget)? {
                return Ok(too_complex(similarity));
            }
        }
    }

    Ok(IntralinePair {
        old_line: old.line,
        new_line: new.line,
        similarity,
        old: Some(segments(&old.tokens, &alignment.matched_old, SegmentOp::Delete, ignore_whitespace)),
        new: Some(segments(&new.tokens, &alignment.matched_new, SegmentOp::Insert, ignore_whitespace)),
        skipped: None,
    })
}

/// Segments of one side: adjacent tokens with the same op are joined; an unchanged whitespace-only segment between
/// two changes of this side joins them (as in JS).
fn segments(tokens: &[String], matched: &[bool], changed: SegmentOp, ignore_whitespace: bool) -> Vec<IntralineSegment> {
    let mut out: Vec<IntralineSegment> = Vec::new();
    for (index, text) in tokens.iter().enumerate() {
        let op = if matched[index] || (ignore_whitespace && is_whitespace_token(text)) { SegmentOp::Equal } else { changed };
        let n = out.len();
        if op == changed && n >= 2 && out[n - 1].op == SegmentOp::Equal && out[n - 2].op == changed && is_whitespace_token(&out[n - 1].text) {
            let gap = out.pop().expect("n >= 2");
            let last = out.last_mut().expect("n >= 2");
            last.text.push_str(&gap.text);
            last.text.push_str(text);
            continue;
        }
        match out.last_mut() {
            Some(last) if last.op == op => last.text.push_str(text),
            _ => out.push(IntralineSegment { op, text: text.clone() }),
        }
    }
    out
}
