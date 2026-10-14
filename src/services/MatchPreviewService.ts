import { BaseService, type JobOutcome, type JobRegex } from './BaseService';
import { ProcessingError, ERROR_KEYS } from './ProcessingError';

/**
 * Pattern preview of the Filter page. Always uses the native JS RegExp in the preview worker (also in Rust mode:
 * no IPC per keystroke), so it is only an approximation of the Rust result (see MatchPreview).
 * Result: `ColumnList`, one row of alternating text/match segments per line with a match (`findMatchSegments`).
 */
export class MatchPreviewService extends BaseService {
  protected readonly resultType = 'ColumnList';

  constructor() {
    super('preview');
  }

  protected async invokeBackend(): Promise<JobOutcome> {
    throw new ProcessingError('backend', ERROR_KEYS.general, 'the preview has no backend implementation');
  }

  protected regexOf({ mainParam, configParams }: MatchPreviewConfig): JobRegex {
    return { pattern: mainParam, flags: configParams.caseSensitive ? 'g' : 'gi' };
  }

  /** Not reachable: the preview always runs a regex, which is refused without Web Worker (`regexOf`). */
  protected async frontendInMainThread(): Promise<myResult> {
    throw new ProcessingError('worker', ERROR_KEYS.regexRequiresWorker);
  }
}
