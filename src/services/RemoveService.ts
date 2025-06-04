import { BaseService } from './BaseService';
import { validateRegexPattern } from '../utils/regex';

export class RemoveService extends BaseService {
  constructor() {
    super('remove');
  }

  protected async invokeBackend(args: RemoveConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { caseSensitive, useRegex, trimParts, removeMode } = configParams;
    const { invokeUNSAFE } = await import('./tauriInvoke');

    const result = await invokeUNSAFE<ProcessedText<string>>('remove_lines', { text: sourceText, pattern: mainParam, removemode: removeMode, casesensitive: caseSensitive, useregex: useRegex, trimparts: trimParts });

      if (result.result_text) {
        this.setMetrics(result.metrics, sourceText, result.result_text);
        return this.convertToMyResult(result);
      }
      window.logger.error("[invokeBackend] konnte nicht erfolgreich ausgeführt werden.");
      return this.convertToMyResult('');
  }

  protected async frontendInMainThread(args: RemoveConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { caseSensitive, useRegex, trimParts, removeMode } = configParams;

    try {
      const lines = sourceText.split('\n');
      let processedLines: string[];

      if (removeMode === 'duplicates') {
        const seen = new Set<string>();
        processedLines = lines.filter((line) => {
          const processedLine = trimParts ? line.trim() : line;
          const key = caseSensitive ? processedLine : processedLine.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } else {
        let matcher: (line: string) => boolean;

        if (useRegex) {
          if (!validateRegexPattern(mainParam)) {
            throw new Error('Invalid regex pattern');
          }
          const regex = new RegExp(mainParam, caseSensitive ? '' : 'i');
          matcher = (line) => regex.test(line);
        } else {
          matcher = (line) => {
            const processedLine = caseSensitive ? line : line.toLowerCase();
            const processedPattern = caseSensitive ? mainParam : mainParam.toLowerCase();
            return processedLine.includes(processedPattern);
          };
        }

        if (removeMode === 'notContaining') {
          processedLines = lines.filter((line) => matcher(line)); // Behalte nur ÜBEREINSTIMMUNG (nicht entfernen)
        } else {
          processedLines = lines.filter((line) => !matcher(line)); // Entferne ÜBEREINSTIMMUNG (normaler Modus)
        }
      }

      const conv: ProcessedText<string> = {
        result_text: processedLines.join('\n'), removed_lines: lines.length - processedLines.length,
        metrics: {
          execution_time_ms: 0,
          memory_usage_kb: 0,
          memory_usage_str: ''
        }
      }
      return this.convertToMyResult(conv);
    } catch (error) {
      window.logger.error(error as Error);
      return this.convertToMyResult('');
    }
  }
}
