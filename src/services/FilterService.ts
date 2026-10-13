import { BaseService } from './BaseService';
import { validateRegexPattern } from '../utils/regex';
import { assertBackendResult, createResult, invalidRegexError } from './ProcessingError';

export class FilterService extends BaseService {
  protected readonly resultType = 'Text';

  constructor() {
    super('filter');
  }

  protected async invokeBackend(args: FilterConfig): Promise<myResult> {
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
    this.setMetrics(result.metrics, sourceText, result.result_text);
    return createResult('Text', result.result_text);
  }

  protected async frontendInMainThread(args: FilterConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { caseSensitive, filterMode, splitMatches } = configParams;

    if (!validateRegexPattern(mainParam)) {
      throw invalidRegexError();
    }

    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(mainParam, flags);

    const processedLines = sourceText.split('\n').map((line) => {
      if (!line.trim()) return line;

      if (filterMode === 'remove') {
        return line.replace(regex, '');
      } else {
        const matches = [...line.matchAll(regex)].map((m) => m[0]);
        if (!matches.length) return '';
        return splitMatches ? matches.join('\n') : matches.join('');
      }
    });

    return createResult('Text', processedLines.join('\n'));
  }
}
