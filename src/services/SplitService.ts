import { BaseService } from './BaseService';
import { splitTextToColumns } from '../utils/splitColumns';
import { assertBackendResult, createResult, invalidRegexError } from './ProcessingError';

export class SplitService extends BaseService {
  protected readonly resultType = 'ColumnList';

  constructor() {
    super('split');
  }

  protected async invokeBackend(args: SplitConfig): Promise<myResult> {
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
    this.setMetrics(result.metrics);
    return createResult('ColumnList', result.result_text.map((c) => c.split('\n')));
  }

  protected async frontendInMainThread(args: SplitConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;

    try {
      return createResult('ColumnList', splitTextToColumns(sourceText, mainParam, configParams));
    } catch (error) {
      // `splitTextToColumns` throws a SyntaxError for an invalid regex
      if (configParams.useRegex && error instanceof SyntaxError) throw invalidRegexError(error.message);
      throw error;
    }
  }
}
