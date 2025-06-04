import { BaseService } from './BaseService';
import { validateRegexPattern } from '../utils/regex';

export class FilterService extends BaseService {
  constructor() {
    super('filter');
  }

  protected async invokeBackend(args: FilterConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { caseSensitive, filterMode, splitMatches } = configParams;
    const { invokeUNSAFE } = await import('./tauriInvoke');

    const result = await invokeUNSAFE<ProcessedText<string>>('filter_text', {
      text: sourceText,
      pattern: mainParam,
      filtermode: filterMode,
      casesensitive: caseSensitive,
      splitmatches: splitMatches,
    });

    if (result.result_text) {
      this.setMetrics(result.metrics, sourceText, result.result_text);
      return this.convertToMyResult(result.result_text);
    }
    window.logger.error('[invokeBackend] konnte nicht erfolgreich ausgeführt werden.');
    return this.convertToMyResult('');
  }

  protected async frontendInMainThread(args: FilterConfig): Promise<myResult> {
    try {
      const { sourceText, mainParam, configParams } = args;
      const { caseSensitive, filterMode, splitMatches } = configParams;

      if (!validateRegexPattern(mainParam)) {
        throw new Error('errors.invalidRegex');
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

      return this.convertToMyResult(processedLines.join('\n'));
    } catch (error) {
      window.logger.error(error);
      return this.convertToMyResult([]);
    }
  }
}
