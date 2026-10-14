import { BaseService, type JobOutcome, type JobRegex } from './BaseService';
import { compileUserRegex } from '../utils/regex';
import { joinLines, splitLines } from '../utils/lines';
import { assertBackendResult, createResult } from './ProcessingError';

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

  protected regexOf({ mainParam, configParams }: FilterConfig): JobRegex {
    return { pattern: mainParam, flags: configParams.caseSensitive ? 'g' : 'gi' };
  }

  /** Not reachable through `invoke` (Filter always runs a regex, see `regexOf`); kept as JS implementation. */
  protected async frontendInMainThread(args: FilterConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { caseSensitive, filterMode, splitMatches } = configParams;

    const regex = compileUserRegex(mainParam, caseSensitive ? 'g' : 'gi');

    const { lines, ...format } = splitLines(sourceText);
    const processedLines = lines.map((line) => {
      if (!line.trim()) return line;

      if (filterMode === 'remove') {
        return line.replace(regex, '');
      } else {
        const matches = [...line.matchAll(regex)].map((m) => m[0]);
        if (!matches.length) return '';
        return splitMatches ? matches.join(format.lineEnding) : matches.join('');
      }
    });

    return createResult('Text', joinLines(processedLines, format));
  }
}
