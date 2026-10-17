import { BaseWorker, type ProcessOptions } from './BaseWorker';
import { compileUserRegex } from '../utils/regex';
import { buildMatchPreview } from '../utils/matchPreview';
import { createResult } from '../services/ProcessingError';

/**
 * Pattern preview of the Filter page: the user regex runs here, never in the UI thread. The answer is limited while it is
 * built (`PREVIEW_LIMITS`); a match that cuts a character in every Filter mode is the error `regexSplitsCharacter`.
 */
export class MatchPreviewWorker extends BaseWorker {
  /** Errors are thrown and reported by `BaseWorker.process` (never turned into an empty result). */
  protected processChunk(chunk: string[], options: ProcessOptions): myResult {
    const { mainParam, configParams } = options.args as MatchPreviewConfig;
    const regex = compileUserRegex(mainParam, configParams.caseSensitive ? 'g' : 'gi');
    return createResult('MatchPreview', buildMatchPreview(chunk, regex, configParams.splitMatches === true));
  }
}

// Automatische Registrierung als Web Worker
BaseWorker.setupWorker(MatchPreviewWorker);
