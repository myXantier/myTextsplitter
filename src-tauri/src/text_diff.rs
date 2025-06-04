use serde::Serialize;
use std::collections::HashMap;

use crate::text_processor::{get_backend_metrics, ProcessedText};

#[derive(Debug, Clone, Serialize)]
pub enum DiffType {
    Added,
    Removed,
    Moved,
    Unchanged,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffResult {
    pub text: String,
    pub diff_type: DiffType,
    pub line_number: usize,
}

pub fn compare_texts(oldtext: &str, newtext: &str, ignorewhitespace: bool) -> Result<Vec<DiffResult>, String> {
    // Split texts into lines
    let old_lines: Vec<&str> = oldtext.lines().collect();
    let new_lines: Vec<&str> = newtext.lines().collect();
    
    let mut result = Vec::new();
    
    // Helper function to normalize line content based on whitespace preference
    let normalize = |line: &str| -> String {
        if ignorewhitespace {
            line.split_whitespace().collect::<Vec<&str>>().join(" ")
        } else {
            line.to_string()
        }
    };
    
    // Count occurrences of each line in both texts
    let mut old_line_counts: HashMap<String, usize> = HashMap::new();
    let mut new_line_counts: HashMap<String, usize> = HashMap::new();
    
    for line in &old_lines {
        let key = normalize(line);
        *old_line_counts.entry(key).or_insert(0) += 1;
    }
    
    for line in &new_lines {
        let key = normalize(line);
        *new_line_counts.entry(key).or_insert(0) += 1;
    }
    
    // Track matched lines to avoid duplicate classification
    let mut old_matched = vec![false; old_lines.len()];
    let mut new_matched = vec![false; new_lines.len()];
    
    // First pass: Find unchanged lines (same content, same position)
    for i in 0..old_lines.len().min(new_lines.len()) {
        let old_key = normalize(&old_lines[i]);
        let new_key = normalize(&new_lines[i]);
        
        if old_key == new_key {
            result.push(DiffResult {
                text: old_lines[i].to_string(),
                diff_type: DiffType::Unchanged,
                line_number: i + 1,
            });
            old_matched[i] = true;
            new_matched[i] = true;
        }
    }
    
    // Second pass: Find moved lines (same content, different position)
    let mut old_positions: HashMap<String, Vec<usize>> = HashMap::new();
    let mut new_positions: HashMap<String, Vec<usize>> = HashMap::new();
    
    // Build position maps
    for (i, line) in old_lines.iter().enumerate() {
        if !old_matched[i] {
            let key = normalize(line);
            old_positions.entry(key).or_insert_with(Vec::new).push(i);
        }
    }
    
    for (i, line) in new_lines.iter().enumerate() {
        if !new_matched[i] {
            let key = normalize(line);
            new_positions.entry(key).or_insert_with(Vec::new).push(i);
        }
    }
    
    // Match moved lines
    for (key, old_pos_list) in &old_positions {
        if let Some(new_pos_list) = new_positions.get(key) {
            // Take minimum of available positions on both sides
            let count = old_pos_list.len().min(new_pos_list.len());
            
            for i in 0..count {
                let old_pos = old_pos_list[i];
                let new_pos = new_pos_list[i];
                
                result.push(DiffResult {
                    text: new_lines[new_pos].to_string(),
                    diff_type: DiffType::Moved,
                    line_number: new_pos + 1,
                });
                
                old_matched[old_pos] = true;
                new_matched[new_pos] = true;
            }
        }
    }
    
    // Third pass: Handle added and removed lines
    for (i, &matched) in old_matched.iter().enumerate() {
        if !matched {
            result.push(DiffResult {
                text: old_lines[i].to_string(),
                diff_type: DiffType::Removed,
                line_number: i + 1,
            });
        }
    }
    
    for (i, &matched) in new_matched.iter().enumerate() {
        if !matched {
            result.push(DiffResult {
                text: new_lines[i].to_string(),
                diff_type: DiffType::Added,
                line_number: i + 1,
            });
        }
    }
    
    // Sort results by line number
    result.sort_by(|a, b| {
        // First sort by type to group added/removed with the same line number
        let type_order = |t: &DiffType| match t {
            DiffType::Unchanged => 0,
            DiffType::Moved => 1,
            DiffType::Removed => 2,
            DiffType::Added => 3,
        };
        
        let type_cmp = type_order(&a.diff_type).cmp(&type_order(&b.diff_type));
        if type_cmp != std::cmp::Ordering::Equal {
            return type_cmp;
        }
        
        // Then sort by line number
        a.line_number.cmp(&b.line_number)
    });
    
    Ok(result)
}

pub fn get_diff_json(oldtext: &str, newtext: &str, ignorewhitespace: bool) -> Result<ProcessedText<String>, String> {
    let before_mem = memory_stats::memory_stats().unwrap();
    let start_time = std::time::Instant::now();

    let diffs = compare_texts(oldtext, newtext, ignorewhitespace)?;

    let result_json = serde_json::to_string(&diffs)
        .map_err(|e| format!("JSON serialization error: {}", e))?;

    let execution_time = start_time.elapsed().as_secs_f64() * 1000.0;
    let metrics = get_backend_metrics(execution_time, before_mem);
    
    Ok(ProcessedText {
        result_text: result_json,
        removed_lines: 0,
        metrics,
    })
}
