import { BaseService, type JobOutcome, type JobRegex } from './BaseService';
import { ERROR_KEYS, ProcessingError, assertBackendResult, createResult } from './ProcessingError';
import { assertFilterMode } from '../utils/textModes';

export class FilterService extends BaseService {
  protected readonly resultType = 'Text';

  constructor() {
    super('filter');
  }

  protected async invokeBackend(args: FilterConfig): Promise<JobOutcome> {
    const { sourceText, mainParam, configParams } = args;
    const { caseSensitive, filterMode, splitMatches } = configParams;
    const { invokeUNSAFE } = await import('./tauriInvoke');

    const response = await invokeUNSAFE<unknown>('filter_text', {
      text: sourceText,
      pattern: mainParam,
      filtermode: filterMode,
      casesensitive: caseSensitive,
      splitmatches: splitMatches,
    });

    // An empty `result_text` is a valid result (all lines filtered out)
    const result = assertBackendResult(response, 'Text');
    return this.backendOutcome(createResult('Text', result.result_text), result.metrics, sourceText, result.result_text);
  }

  /** An unknown or empty mode is refused before any processing path runs (Rust and the worker check it too). */
  protected checkRequest({ configParams }: FilterConfig): void {
    assertFilterMode(configParams.filterMode);
  }

  protected regexOf({ mainParam, configParams }: FilterConfig): JobRegex {
    return { pattern: mainParam, flags: configParams.caseSensitive ? 'g' : 'gi' };
  }

  /**
   * Paket 10 E10: the Filter has no JS main-thread implementation (it always runs a user regex, which cannot be stopped
   * in the UI thread). `invoke` never gets here: without Web Worker `BaseService.assertMainThreadAllowed` reports the
   * mode, pattern and syntax errors and then `regexRequiresWorker`. A direct call is refused with `regexRequiresWorker`
   * and runs no regex (no former Filter semantics); the Filter runs in the FilterWorker or in Rust.
   */
  protected async frontendInMainThread(_args: FilterConfig): Promise<myResult> {
    throw new ProcessingError('worker', ERROR_KEYS.regexRequiresWorker, `${this.type}: no Web Worker available`);
  }
}
