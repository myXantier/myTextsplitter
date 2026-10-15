import { BaseWorker, type ProcessOptions } from './BaseWorker';
import { createResult } from '../services/ProcessingError';
import { assertSortMethod, sortText } from '../utils/sortLines';

/**
 * Sort page (Paket 9 C2): the same `sortText` as everywhere else (Sort has no Rust implementation), here off the UI
 * thread. A sort needs all lines, so it does not use the line chunks of `BaseWorker.process`. One message per job: the
 * complete `Text` result (an empty string is valid) or an error (`invalidMode` keeps its kind and message key).
 */
export class SortWorker extends BaseWorker {
  public process(options: ProcessOptions): void {
    try {
      const args = options?.args as SortConfig | undefined;
      if (!args || typeof args.sourceText !== 'string' || typeof args.configParams?.caseSensitive !== 'boolean') {
        throw new Error('sort: invalid arguments');
      }
      const { sortMethod, caseSensitive } = args.configParams;
      assertSortMethod(sortMethod);
      self.postMessage({ success: true, type: 'complete', result: createResult('Text', sortText(args.sourceText, sortMethod, caseSensitive)) });
    } catch (error) {
      this.postError(error);
    }
  }

  protected processChunk(): myResult {
    throw new Error('SortWorker sorts complete texts only');
  }
}

BaseWorker.setupWorker(SortWorker);
