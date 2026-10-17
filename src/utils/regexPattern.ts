// Shared rule for user regex patterns (Paket 10 E3), the same as Rust `check_pattern` (src-tauri/src/text_processor.rs).
// Free of imports, so the split logic (`splitColumns.ts`) and the workers can use it directly.

/** Longest allowed regex pattern in UTF-16 code units (JS `pattern.length`, Rust `encode_utf16().count()`). */
export const MAX_PATTERN_LENGTH = 10_000;

/** Why a regex pattern is refused before it is compiled; the names are the `ERROR_KEYS` entries of the errors. */
export type PatternProblem = 'patternEmpty' | 'patternTooLong';

/**
 * Engine-neutral check of a regex pattern: not empty (a pattern of spaces is allowed) and at most `MAX_PATTERN_LENGTH`
 * UTF-16 code units. No syntax check: Rust and JS have different dialects. Only for patterns that are used as regex
 * (not for plain delimiters or plain search terms).
 */
export function patternProblem(pattern: string): PatternProblem | null {
  if (pattern === '') return 'patternEmpty';
  return pattern.length > MAX_PATTERN_LENGTH ? 'patternTooLong' : null;
}
