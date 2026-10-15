import { BaseService, type JobOutcome } from './BaseService';
import { ERROR_KEYS, ProcessingError, createResult } from './ProcessingError';
import { assertSortMethod, sortText } from '../utils/sortLines';

/**
 * Without Web Worker a sort runs in the UI thread. Up to these limits it takes at most a few dozen milliseconds
 * (Paket 9 C1 baseline: 10 000 lines in about 20 ms); a larger text is refused as `sortRequiresWorker` instead of
 * freezing the page. With Web Worker (browser and Tauri) there is no limit.
 */
export const SORT_MAIN_THREAD_LIMITS = { lines: 20_000, chars: 1_000_000 } as const;

/** Number of data lines of the shared line model (LF, CRLF, CR; a trailing newline adds no line), without splitting. */
export function countLines(text: string): number {
  let breaks = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) breaks++;
    else if (code === 13) {
      breaks++;
      if (text.charCodeAt(i + 1) === 10) i++;
    }
  }
  const last = text.charCodeAt(text.length - 1);
  return text.length === 0 || last === 10 || last === 13 ? breaks : breaks + 1;
}

/**
 * Sort page (Paket 9 C2). Sort has no Rust implementation: every job runs the TypeScript `sortText` (src/utils/sortLines.ts),
 * in the sort worker (browser and Tauri) or, without Web Worker, in the UI thread up to `SORT_MAIN_THREAD_LIMITS`.
 * Latest job wins, timeout and error handling are those of `BaseService`. Result: `Text` (an empty string is valid).
 */
export class SortService extends BaseService {
  protected readonly resultType = 'Text';

  constructor() {
    super('sort');
  }

  /** Always the TypeScript sort, also in Rust processing mode (there is no sort command). */
  invoke(args: SortConfig, _tryBackend?: boolean): Promise<myResult> {
    return super.invoke(args, false);
  }

  protected async invokeBackend(): Promise<JobOutcome> {
    throw new ProcessingError('backend', ERROR_KEYS.general, 'sort has no backend implementation');
  }

  /** An unknown method or a missing option is refused before the worker starts (the worker checks it too). */
  protected checkRequest({ sourceText, configParams }: SortConfig): void {
    assertSortMethod(configParams?.sortMethod);
    if (typeof sourceText !== 'string' || typeof configParams.caseSensitive !== 'boolean') {
      throw new ProcessingError('invalidInput', ERROR_KEYS.general, 'sort: text and caseSensitive are required');
    }
  }

  /** A sort keeps every line: a result with another line count is cut or damaged and is never shown. */
  protected checkResult(result: myResult, { sourceText }: SortConfig): void {
    if (result.type === 'Text' && countLines(result.result) !== countLines(sourceText)) {
      throw new ProcessingError('invalidResult', ERROR_KEYS.general, 'sort result does not have the line count of the input');
    }
  }

  protected async frontendInMainThread({ sourceText, configParams }: SortConfig): Promise<myResult> {
    const lines = countLines(sourceText);
    if (lines > SORT_MAIN_THREAD_LIMITS.lines || sourceText.length > SORT_MAIN_THREAD_LIMITS.chars) {
      throw new ProcessingError('worker', ERROR_KEYS.sortRequiresWorker, `sort: no Web Worker available for ${lines} lines / ${sourceText.length} chars`);
    }
    return createResult('Text', sortText(sourceText, configParams.sortMethod as never, configParams.caseSensitive));
  }
}
