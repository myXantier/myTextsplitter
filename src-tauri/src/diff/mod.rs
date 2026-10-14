//! Line diff (Paket 7, B1). Same algorithm and JSON shape (`DiffDocumentV2`) as the JS engine
//! (`src/utils/diff/lineDiff.ts`, types in `src/utils/diff/types.ts`); the shared fixtures
//! `tests/fixtures/diff-cases.json` check the complete result of both engines.

// Optional word diff (B2): pure functions, called by the Tauri command and the UI from Paket 7 B3 on
#[allow(dead_code)]
pub mod intraline;
mod myers;
#[allow(dead_code)]
mod tokenize;
mod whitespace;

use std::collections::HashMap;

use serde::Serialize;

use crate::line_endings::split_lines;
use crate::text_processor::{get_backend_metrics, BackendMetrics, TextError};
pub use myers::DIFF_WORK_LIMIT;
use myers::{align_sequences, DiffLimitExceeded};
use whitespace::{comparison_key, is_blank_line};

/// One line of the old or new text: 1-based line number and the original (never normalized) content.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DiffLine {
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffRow {
    /// Comparison keys are equal (the texts can differ when whitespace is ignored).
    Equal { old: DiffLine, new: DiffLine },
    Delete {
        old: DiffLine,
        #[serde(rename = "moveId", skip_serializing_if = "Option::is_none")]
        move_id: Option<usize>,
    },
    Insert {
        new: DiffLine,
        #[serde(rename = "moveId", skip_serializing_if = "Option::is_none")]
        move_id: Option<usize>,
    },
}

/// A moved line: exactly one delete row (`old_line`) and one insert row (`new_line`) carry `moveId == id`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffMove {
    pub id: usize,
    pub old_line: usize,
    pub new_line: usize,
}

/// A move is counted once (in `moved`), not in `removed`/`added`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DiffStats {
    pub unchanged: usize,
    pub removed: usize,
    pub added: usize,
    pub moved: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffOptions {
    pub ignore_whitespace: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffDocument {
    pub version: u32,
    pub options: DiffOptions,
    pub old_line_count: usize,
    pub new_line_count: usize,
    pub rows: Vec<DiffRow>,
    pub moves: Vec<DiffMove>,
    pub stats: DiffStats,
}

/// Answer of the `get_text_diff` command: the document itself (no JSON string inside the IPC JSON) + metrics.
#[derive(Debug, Clone, Serialize)]
pub struct DiffResponse {
    pub document: DiffDocument,
    pub metrics: BackendMetrics,
}

/// Compares the data lines of both texts (shared line model). Rows: matched lines in order; between two matched
/// lines first all deleted, then all inserted lines.
pub fn compute_line_diff<'t>(old_text: &'t str, new_text: &'t str, ignore_whitespace: bool, limit: u64) -> Result<DiffDocument, DiffLimitExceeded> {
    let old_lines = split_lines(old_text).lines;
    let new_lines = split_lines(new_text).lines;

    // Key ids in order of first appearance (old text first): equal ids = equal comparison keys
    let mut ids: HashMap<std::borrow::Cow<'t, str>, u32> = HashMap::new();
    let mut to_ids = |lines: &[&'t str]| -> Vec<u32> {
        lines
            .iter()
            .map(|line| {
                let next = ids.len() as u32;
                *ids.entry(comparison_key(line, ignore_whitespace)).or_insert(next)
            })
            .collect()
    };
    let old_ids = to_ids(&old_lines);
    let new_ids = to_ids(&new_lines);
    let id_count = ids.len();

    let matches = align_sequences(&old_ids, &new_ids, id_count, limit)?;

    let mut rows = Vec::with_capacity(old_lines.len() + new_lines.len() - matches.old.len());
    let (mut i, mut j) = (0usize, 0usize);
    let line = |index: usize, lines: &[&str]| DiffLine { line: index + 1, text: lines[index].to_string() };
    let emit_changes = |rows: &mut Vec<DiffRow>, i: &mut usize, j: &mut usize, old_end: usize, new_end: usize| {
        while *i < old_end {
            rows.push(DiffRow::Delete { old: line(*i, &old_lines), move_id: None });
            *i += 1;
        }
        while *j < new_end {
            rows.push(DiffRow::Insert { new: line(*j, &new_lines), move_id: None });
            *j += 1;
        }
    };
    for (&mo, &mn) in matches.old.iter().zip(&matches.new) {
        emit_changes(&mut rows, &mut i, &mut j, mo, mn);
        rows.push(DiffRow::Equal { old: line(i, &old_lines), new: line(j, &new_lines) });
        i += 1;
        j += 1;
    }
    emit_changes(&mut rows, &mut i, &mut j, old_lines.len(), new_lines.len());

    let moves = detect_moves(&mut rows, &old_ids, &new_ids, id_count);
    let (unchanged, moved) = (matches.old.len(), moves.len());
    Ok(DiffDocument {
        version: 2,
        options: DiffOptions { ignore_whitespace },
        old_line_count: old_lines.len(),
        new_line_count: new_lines.len(),
        rows,
        stats: DiffStats {
            unchanged,
            removed: old_lines.len() - unchanged - moved,
            added: new_lines.len() - unchanged - moved,
            moved,
        },
        moves,
    })
}

/// Moves (conservative, B1): a delete and an insert are linked only if their comparison key occurs exactly once in
/// the old and exactly once in the new text, and the line is not blank. Duplicates and blank lines stay
/// delete + insert. Rows keep their positions; ids ascend with the old line.
fn detect_moves(rows: &mut [DiffRow], old_ids: &[u32], new_ids: &[u32], id_count: usize) -> Vec<DiffMove> {
    let mut old_count = vec![0u32; id_count];
    let mut new_count = vec![0u32; id_count];
    for &id in old_ids {
        old_count[id as usize] += 1;
    }
    for &id in new_ids {
        new_count[id as usize] += 1;
    }
    let unique = |id: u32| old_count[id as usize] == 1 && new_count[id as usize] == 1;

    // Insert row index per unique id
    let mut insert_of: HashMap<u32, usize> = HashMap::new();
    for (index, row) in rows.iter().enumerate() {
        if let DiffRow::Insert { new, .. } = row {
            let id = new_ids[new.line - 1];
            if unique(id) {
                insert_of.insert(id, index);
            }
        }
    }

    // (delete row, insert row) per move, ascending by old line (rows are in old-line order)
    let mut links = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        if let DiffRow::Delete { old, .. } = row {
            let id = old_ids[old.line - 1];
            if !unique(id) || is_blank_line(&old.text) {
                continue;
            }
            if let Some(&insert) = insert_of.get(&id) {
                links.push((index, insert));
            }
        }
    }

    let mut moves = Vec::with_capacity(links.len());
    for (number, (delete, insert)) in links.into_iter().enumerate() {
        let id = number + 1;
        let (DiffRow::Delete { old, move_id: delete_move }, DiffRow::Insert { new, move_id: insert_move }) = pair_mut(rows, delete, insert) else {
            unreachable!("links only hold delete/insert rows");
        };
        *delete_move = Some(id);
        *insert_move = Some(id);
        moves.push(DiffMove { id, old_line: old.line, new_line: new.line });
    }
    moves
}

/// Two distinct rows mutably at once.
fn pair_mut(rows: &mut [DiffRow], first: usize, second: usize) -> (&mut DiffRow, &mut DiffRow) {
    if first < second {
        let (left, right) = rows.split_at_mut(second);
        (&mut left[first], &mut right[0])
    } else {
        let (left, right) = rows.split_at_mut(first);
        (&mut right[0], &mut left[second])
    }
}

/// Diff with metrics for the Tauri command. Exceeding the work limit is an input error (`diffTooComplex`).
pub fn get_diff(old_text: &str, new_text: &str, ignore_whitespace: bool) -> Result<DiffResponse, TextError> {
    let before_mem = memory_stats::memory_stats();
    let start_time = std::time::Instant::now();
    let document = compute_line_diff(old_text, new_text, ignore_whitespace, DIFF_WORK_LIMIT)
        .map_err(|e| TextError::DiffTooComplex(format!("diff needs more than {} work units", e.limit)))?;
    let execution_time = start_time.elapsed().as_secs_f64() * 1000.0;
    Ok(DiffResponse { document, metrics: get_backend_metrics(execution_time, before_mem) })
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod intraline_tests;
