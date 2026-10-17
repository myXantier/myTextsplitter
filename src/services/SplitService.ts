import { BaseService, type JobOutcome, type JobRegex } from './BaseService';
import { SplitInputError, splitTextToColumns } from '../utils/splitColumns';
import { assertBackendResult, createResult, invalidRegexError, splitInputError } from './ProcessingError';

export class SplitService extends BaseService {
  protected readonly resultType = 'ColumnList';

  constructor() {
    super('split');
  }

  protected async invokeBackend(args: SplitConfig): Promise<JobOutcome> {
    const { sourceText, mainParam, configParams } = args;
    const { trimParts, useRegex, keepEmptyLines } = configParams;
    const { invokeUNSAFE } = await import('./tauriInvoke'); // ✅ Lazy import
    
    const response = await invokeUNSAFE<unknown>('process_text_block', {
      text: sourceText,
      delimiter: mainParam,
      trimparts: trimParts,
      useregex: useRegex,
      keepemptylines: keepEmptyLines,
    });

    // One '\n'-joined string per column; no columns (empty text) is a valid result
    const result = assertBackendResult(response, 'Column');
    return this.backendOutcome(createResult('ColumnList', result.result_text.map((c) => c.split('\n'))), result.metrics);
  }

  protected regexOf({ mainParam, configParams }: SplitConfig): JobRegex | null {
    return configParams.useRegex ? { pattern: mainParam, flags: 'gm' } : null;
  }

  protected async frontendInMainThread(args: SplitConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;

    try {
      return createResult('ColumnList', splitTextToColumns(sourceText, mainParam, configParams));
    } catch (error) {
      // `splitTextToColumns` throws a SyntaxError for an invalid regex and a SplitInputError for an empty plain
      // delimiter (Paket 10 E4) or an empty / too long regex pattern (E3); a regex never runs here (BaseService.assertMainThreadAllowed)
      if (configParams.useRegex && error instanceof SyntaxError) throw invalidRegexError(error.message);
      if (error instanceof SplitInputError) throw splitInputError(error.reason);
      throw error;
    }
  }
}
