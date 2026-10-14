import { BaseService, type JobOutcome } from './BaseService';
import { ProcessingError, ERROR_KEYS, createResult } from './ProcessingError';
import { diffInJs } from '../utils/diff/jsEngine';
import { diffDocumentError, diffInputMismatch } from '../utils/diff/validate';
import { splitLines } from '../utils/lines';
import type { DiffDocument } from '../utils/diff/types';

const invalid = (detail: string) => new ProcessingError('invalidResult', ERROR_KEYS.general, `unexpected diff result: ${detail}`);

/**
 * Checks the answer of the Rust command `get_text_diff`: `{ document, metrics }` with a complete, valid
 * `DiffDocument` (structured IPC data, no JSON string). Throws `invalidResult` for anything else.
 */
export function assertBackendDiff(value: unknown): { document: DiffDocument; metrics: BackendMetrics } {
  const candidate = value as { document?: unknown; metrics?: BackendMetrics } | null;
  if (!candidate || typeof candidate !== 'object' || Object.keys(candidate).sort().join() !== 'document,metrics') throw invalid('no diff response');
  const error = diffDocumentError(candidate.document);
  if (error) throw invalid(error);
  const metrics = candidate.metrics;
  if (!metrics || typeof metrics !== 'object' || !Number.isFinite(metrics.execution_time_ms) || !(metrics.memory_usage_kb === null || Number.isFinite(metrics.memory_usage_kb))) {
    throw invalid('metrics');
  }
  return { document: candidate.document as DiffDocument, metrics };
}

export class DiffService extends BaseService {
  protected readonly resultType = 'Diff';

  constructor() {
    super('diff');
  }

  /**
   * Every path (Rust, Web Worker, main thread) delivers a `Diff` result that `assertResult` validated (structure,
   * order, equal keys, move rules, statistics) and that is checked here against the request: same options, all lines
   * of both texts with their original content. Runs before the metrics are applied (BaseService): a partial or
   * foreign result is an `invalidResult` error, never a displayed diff, and its metrics are discarded.
   */
  protected checkResult(result: myResult, args: DiffConfig): void {
    const mismatch = diffInputMismatch(
      result.result as DiffDocument,
      splitLines(args.sourceText).lines,
      splitLines(args.mainParam).lines,
      args.configParams.ignoreWhitespace,
    );
    if (mismatch) throw invalid(mismatch);
  }

  protected async invokeBackend(args: DiffConfig): Promise<JobOutcome> {
    const { sourceText, mainParam, configParams } = args;

    const { invokeUNSAFE } = await import('./tauriInvoke');
    const response = await invokeUNSAFE<unknown>('get_text_diff', {
      oldtext: sourceText,
      newtext: mainParam,
      ignorewhitespace: configParams.ignoreWhitespace,
    });

    const { document, metrics } = assertBackendDiff(response);
    // Output size for the metrics display, measured like the worker path (BaseService)
    return this.backendOutcome(createResult('Diff', document), metrics, sourceText, JSON.stringify(document));
  }

  protected async frontendInMainThread(args: DiffConfig): Promise<myResult> {
    return createResult('Diff', diffInJs(args));
  }
}
