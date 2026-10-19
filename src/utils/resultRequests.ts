// Requests of the processing pages and their comparison (Paket 12, contract docs/analyse/Paket12-PhaseB-Stale-Results-Vertrag.md §3).
// A request is the snapshot of every value a processing result depends on. A shown result is current while its request
// equals the current input in the sense of these functions; display options are no part of a request.
// Pure functions without framework, service or store dependencies: cheap options are compared first, texts last with
// `===` (no normalization, trimming, copy or hash). Arguments are never changed.
import type { SortMethod } from './sortLines';

export type FilterAction = 'remove' | 'keep';
export type RemoveAction = 'duplicates' | 'containing' | 'notContaining';

/** Text and options a sort result belongs to. Sort always runs the TypeScript sort: no processing mode. */
export interface SortRequest {
  sourceText: string;
  sortMethod: SortMethod;
  caseSensitive: boolean;
}

/** Filter job: the action is the button that started it. `splitMatches` is only used by `keep`. */
export interface FilterRequest {
  action: FilterAction;
  sourceText: string;
  pattern: string;
  caseSensitive: boolean;
  splitMatches: boolean;
  processingMode: processModes;
}

/** Remove job: the action is the button that started it; which options it uses depends on the action. */
export interface RemoveRequest {
  action: RemoveAction;
  sourceText: string;
  pattern: string;
  useRegex: boolean;
  caseSensitive: boolean;
  trim: boolean;
  processingMode: processModes;
}

/** Compared texts of a diff. The word diff is computed for a shown comparison on request and is no part of it. */
export interface DiffRequest {
  sourceText: string;
  newText: string;
  ignoreWhitespace: boolean;
}

/** Split job. `keepEmptyLines` is the derived boolean (setting `showEmptyLines !== false`), not the raw setting. */
export interface SplitRequest {
  sourceText: string;
  delimiter: string;
  useRegex: boolean;
  trimParts: boolean;
  keepEmptyLines: boolean;
  processingMode: processModes;
}

/** Only alphabetical and natural sorting compare letters; line length and random ignore the case option. */
export const sortUsesCase = (method: SortMethod) => method.startsWith('alphabetical') || method.startsWith('natural');

/** Same text and the options that matter for the method (the case option only where it is used). */
export const sameSortRequest = (a: SortRequest, b: SortRequest) =>
  a.sortMethod === b.sortMethod && (!sortUsesCase(a.sortMethod) || a.caseSensitive === b.caseSensitive) && a.sourceText === b.sourceText;

/** Every filter runs a user regex, so the engine always matters; `splitMatches` only for `keep`. */
export const sameFilterRequest = (a: FilterRequest, b: FilterRequest) =>
  a.action === b.action &&
  a.caseSensitive === b.caseSensitive &&
  a.processingMode === b.processingMode &&
  (a.action !== 'keep' || a.splitMatches === b.splitMatches) &&
  a.pattern === b.pattern &&
  a.sourceText === b.sourceText;

/**
 * Duplicates compare lines by key (`trim`, case) and ignore pattern, regex and engine. Containing / not containing use
 * pattern, regex and case and ignore `trim`; the engine only matters for a regex (the engines' regex dialects differ).
 */
export function sameRemoveRequest(a: RemoveRequest, b: RemoveRequest): boolean {
  if (a.action !== b.action || a.caseSensitive !== b.caseSensitive) return false;
  if (a.action === 'duplicates') return a.trim === b.trim && a.sourceText === b.sourceText;
  return (
    a.useRegex === b.useRegex &&
    (!a.useRegex || a.processingMode === b.processingMode) &&
    a.pattern === b.pattern &&
    a.sourceText === b.sourceText
  );
}

/** Both texts and the whitespace option; the engines give the same diff (Paket 7). */
export const sameDiffRequest = (a: DiffRequest, b: DiffRequest) =>
  a.ignoreWhitespace === b.ignoreWhitespace && a.sourceText === b.sourceText && a.newText === b.newText;

/** Delimiter and split options; the engine only matters for a regex split (the engines' regex dialects differ). */
export const sameSplitRequest = (a: SplitRequest, b: SplitRequest) =>
  a.useRegex === b.useRegex &&
  a.trimParts === b.trimParts &&
  a.keepEmptyLines === b.keepEmptyLines &&
  (!a.useRegex || a.processingMode === b.processingMode) &&
  a.delimiter === b.delimiter &&
  a.sourceText === b.sourceText;
