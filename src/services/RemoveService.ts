import { BaseService, type JobOutcome, type JobRegex } from './BaseService';
import { compileUserRegex } from '../utils/regex';
import { assertBackendResult, createResult } from './ProcessingError';

export class RemoveService extends BaseService {
  protected readonly resultType = 'TextV2';

  constructor() {
    super('remove');
  }

  protected async invokeBackend(args: RemoveConfig): Promise<JobOutcome> {
    const { sourceText, mainParam, configParams } = args;
    const { caseSensitive, useRegex, trimParts, removeMode } = configParams;
    const { invokeUNSAFE } = await import('./tauriInvoke');

    const response = await invokeUNSAFE<unknown>('remove_lines', { text: sourceText, pattern: mainParam, removemode: removeMode, casesensitive: caseSensitive, useregex: useRegex, trimparts: trimParts });

    // An empty `result_text` is a valid result (all lines removed)
    const result = assertBackendResult(response, 'Text');
    return this.backendOutcome(createResult('TextV2', result), result.metrics, sourceText, result.result_text);
  }

  protected regexOf({ mainParam, configParams }: RemoveConfig): JobRegex | null {
    const { useRegex, removeMode, caseSensitive } = configParams;
    return useRegex && removeMode !== 'duplicates' ? { pattern: mainParam, flags: caseSensitive ? '' : 'i' } : null;
  }

  protected async frontendInMainThread(args: RemoveConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { caseSensitive, useRegex, trimParts, removeMode } = configParams;

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
        const regex = compileUserRegex(mainParam, caseSensitive ? '' : 'i');
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

    return createResult('TextV2', {
      result_text: processedLines.join('\n'), removed_lines: lines.length - processedLines.length,
      metrics: {
        execution_time_ms: 0,
        memory_usage_kb: 0,
        memory_usage_str: ''
      }
    });
  }
}
