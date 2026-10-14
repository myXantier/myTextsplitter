// Result of one diff job (Paket 7, B3): the line diff and, only when it was requested, the word diff of it.
// Same shape from Rust (`get_text_diff`), the Web Worker and the main-thread fallback.
import { diffDocumentError } from './validate';
import { intralineError } from './intraline';
import type { DiffDocument, IntralineAnalysis } from './types';

export interface DiffData {
  document: DiffDocument;
  /** `null` when the word diff was not requested */
  intraline: IntralineAnalysis | null;
}

/**
 * Error of `value` as `DiffData`, or `null`: exactly the fields `document` and `intraline`, a valid document
 * (B1 validator) and either `null` or a valid word diff of exactly this document (`intralineError`). Never throws.
 * Whether the word diff had to be present is checked against the request by DiffService.
 */
export function diffDataError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'not a diff result';
  const keys = Object.keys(value).sort().join();
  if (keys !== 'document,intraline') return 'not a diff result';
  const { document, intraline } = value as { document: unknown; intraline: unknown };
  const documentError = diffDocumentError(document);
  if (documentError) return documentError;
  if (intraline === null) return null;
  const intralineProblem = intralineError(intraline, document as DiffDocument);
  return intralineProblem ? `word diff: ${intralineProblem}` : null;
}

export const isDiffData = (value: unknown): value is DiffData => diffDataError(value) === null;
