import { BaseService, type JobOutcome } from './BaseService';
import { ProcessingError, ERROR_KEYS, createResult } from './ProcessingError';
import { diffInJs } from '../utils/diff/jsEngine';
import { diffInputMismatch } from '../utils/diff/validate';
import { diffDataError, type DiffData } from '../utils/diff/result';
import { splitLines } from '../utils/lines';

const invalid = (detail: string) => new ProcessingError('invalidResult', ERROR_KEYS.general, `unexpected diff result: ${detail}`);

/**
 * Checks the answer of the Rust command `get_text_diff`: `{ document, intraline, metrics }` (structured IPC data, no
 * JSON string) with a valid document, `intraline` null or a valid word diff of that document, and valid metrics.
 * Throws `invalidResult` for anything else.
 */
export function assertBackendDiff(value: unknown): { data: DiffData; metrics: BackendMetrics } {
  const candidate = value as { document?: unknown; intraline?: unknown; metrics?: BackendMetrics } | null;
  if (!candidate || typeof candidate !== 'object' || Object.keys(candidate).sort().join() !== 'document,intraline,metrics') {
    throw invalid('no diff response');
  }
  const data = { document: candidate.document, intraline: candidate.intraline };
  const error = diffDataError(data);
  if (error) throw invalid(error);
  const metrics = candidate.metrics;
  if (!metrics || typeof metrics !== 'object' || !Number.isFinite(metrics.execution_time_ms) || !(metrics.memory_usage_kb === null || Number.isFinite(metrics.memory_usage_kb))) {
    throw invalid('metrics');
  }
  return { data: data as DiffData, metrics };
}

/** Whether the request asks for the word diff (optional, off by default). */
const wordDiffRequested = (args: DiffConfig) => args.configParams.wordDiff === true;

export class DiffService extends BaseService {
  protected readonly resultType = 'Diff';

  constructor() {
    super('diff');
  }

  /**
   * Every path (Rust, Web Worker, main thread) delivers a `Diff` result (`{ document, intraline }`) that `assertResult`
   * validated (document invariants, word diff of exactly this document). Checked here against the request: same
   * options, all lines of both texts with their original content, and the word diff present exactly when it was
   * requested. Runs before the metrics are applied (BaseService): an invalid result is an `invalidResult` error, never a
   * displayed diff, and its metrics are discarded.
   */
  protected checkResult(result: myResult, args: DiffConfig): void {
    const { document, intraline } = result.result as DiffData;
    const mismatch = diffInputMismatch(document, splitLines(args.sourceText).lines, splitLines(args.mainParam).lines, args.configParams.ignoreWhitespace);
    if (mismatch) throw invalid(mismatch);
    if ((intraline !== null) !== wordDiffRequested(args)) throw invalid(intraline ? 'word diff that was not requested' : 'requested word diff is missing');
  }

  protected async invokeBackend(args: DiffConfig): Promise<JobOutcome> {
    const { sourceText, mainParam, configParams } = args;

    const { invokeUNSAFE } = await import('./tauriInvoke');
    const response = await invokeUNSAFE<unknown>('get_text_diff', {
      oldtext: sourceText,
      newtext: mainParam,
      ignorewhitespace: configParams.ignoreWhitespace,
      worddiff: wordDiffRequested(args),
    });

    const { data, metrics } = assertBackendDiff(response);
    // Output size for the metrics display, measured like the worker path (BaseService)
    return this.backendOutcome(createResult('Diff', data), metrics, sourceText, JSON.stringify(data));
  }

  protected async frontendInMainThread(args: DiffConfig): Promise<myResult> {
    return createResult('Diff', diffInJs(args));
  }
}
