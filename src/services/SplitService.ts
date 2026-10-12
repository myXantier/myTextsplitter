import { BaseService } from './BaseService';
import { splitTextToColumns } from '../utils/splitColumns';

export class SplitService extends BaseService {
  constructor() {
    super('split');
  }

  protected async invokeBackend(args: SplitConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;
    const { trimParts, useRegex, keepEmptyLines } = configParams;
    const { invokeUNSAFE } = await import('./tauriInvoke'); // ✅ Lazy import
    
    const result = await invokeUNSAFE<ProcessedText<string[]>>('process_text_block', {
      text: sourceText,
      delimiter: mainParam,
      trimparts: trimParts,
      useregex: useRegex,
      keepemptylines: keepEmptyLines,
    });
    window.logger.debug("SplitService.invokeUNSAFE Result: ", result);

    if (result.result_text) {
      this.setMetrics(result.metrics);
      return this.convertToMyResult(result.result_text.map((c) => c.split('\n')));
    }

    window.logger.error("[invokeBackend] konnte nicht erfolgreich ausgeführt werden.");
    return this.convertToMyResult([]);
  }

  protected async frontendInMainThread(args: SplitConfig): Promise<myResult> {
    const { sourceText, mainParam, configParams } = args;

    try {
      return this.convertToMyResult(splitTextToColumns(sourceText, mainParam, configParams));
    } catch (error) {
      window.logger.error((error as Error).message);
      return this.convertToMyResult([]);
    }
  }
}
