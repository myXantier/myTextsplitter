import { BaseWorker, type ProcessOptions } from './BaseWorker';
import { WorkerLogger } from '../other/Logger';
import { createResult } from '../services/ProcessingError';
import { diffInJs } from '../utils/diff/jsEngine';

/**
 * A diff always needs both complete texts, so it does not use the line chunks of `BaseWorker.process`
 * (formerly the new text was cut to the line count of the old text). One message per job: the complete
 * `Diff` result or an error.
 */
export class DiffWorker extends BaseWorker {
  public process(options: ProcessOptions): void {
    try {
      const args = options?.args as DiffConfig | undefined;
      const wordDiff = args?.configParams?.wordDiff;
      if (!args || typeof args.sourceText !== 'string' || typeof args.mainParam !== 'string' || typeof args.configParams?.ignoreWhitespace !== 'boolean' || (wordDiff !== undefined && typeof wordDiff !== 'boolean')) {
        throw new Error('diff: invalid arguments');
      }
      WorkerLogger.debug(`🔍 Diff-Prozess, Ignore Whitespace: ${args.configParams.ignoreWhitespace}, Wort-Diff: ${wordDiff === true}`);
      self.postMessage({ success: true, type: 'complete', result: createResult('Diff', diffInJs(args)) });
    } catch (error) {
      this.postError(error);
    }
  }

  protected processChunk(): myResult {
    throw new Error('DiffWorker processes complete texts only');
  }
}

BaseWorker.setupWorker(DiffWorker);
