import { useState, useEffect, useCallback } from 'react';
import { useProcessingState } from './useProcessingState';
import { SplitService, DiffService, FilterService, RemoveService, SortService, isBackend } from '../services/Services';
import { BaseService } from '../services/BaseService';
import { isSuperseded, logProcessingError, toProcessingError } from '../services/ProcessingError';
import { useTextBuffer } from './useTextBuffer';
import { useRuntimeSetting, setRuntimeSetting } from '../hooks/useSettings';
import { useProcessingStore } from './useProcessingStore';
import { endOperation, isLatestOperation, startOperation, type OperationType } from './runningOperations';

export function useBackendProcessor() {
  const [availableBackend, setAvailableBackend] = useState(false);
  const { setProcessing, setError, setMetrics } = useProcessingState();
  const setGlobalIsProcessing = useProcessingStore((state) => state.setGlobalIsProcessing);
  const processingMode = useRuntimeSetting('processingMode');

  // Backend-Verfügbarkeit prüfen & globalen Mode setzen
  useEffect(() => {
    const checkBackend = async () => {
      const isAvailableBackend = await isBackend();
      setAvailableBackend(isAvailableBackend);
    };
    checkBackend();
  }, []);

  const toggleMode = () => {
    if (availableBackend) {
      const newMode: processModes = (processingMode === 'fallback') ? 'backend' : 'fallback';
      if (newMode === 'fallback') {
        window.logger.warn('⚠️ Wechsel auf Fallback, 🧹 beende alle Worker...');
        BaseService.cleanupWorkers();
      }

      setRuntimeSetting('processingMode', newMode);
    }
    else setRuntimeSetting('processingMode', 'fallback');
  };

  const { saveToBuffer } = useTextBuffer();

  /**
   * Resolves with the validated result or rejects with a `ProcessingError` (logged here once, without the input
   * text; the calling page shows the message). On failure the buffer and the metrics keep the last successful result.
   * A `superseded` job (a newer job of the same type was started) leaves the processing state to the newer job.
   * Other operation types keep running: their processing state is not ended by this one.
   */
  const executeProcessing = useCallback(async (type: OperationType, serviceInstance: BaseService, args: BaseConfig) => {
    const token = startOperation(type);
    setProcessing(true);
    setError(null);

    const runInBackend = processingMode === 'backend';

    try {
      const result = await serviceInstance.invoke(args, runInBackend);
      const othersRunning = endOperation(type, token);
      setMetrics(serviceInstance.getMetrics());

      setProcessing(false);
      if (othersRunning) setGlobalIsProcessing(true);

      if (result.type === 'Text') {
        saveToBuffer(result.result);
      } else if (result.type === 'Column') {
        saveToBuffer(result.result.join('\n'));
      } else if (result.type === 'ColumnList') {
        saveToBuffer(result.result.join('\n'));
      } else if (result.type === 'TextV2') {
        saveToBuffer(result.result.result_text);
      }

      return result;
    } catch (err) {
      const error = toProcessingError(err, runInBackend ? 'backend' : 'worker');
      logProcessingError('Verarbeitung fehlgeschlagen', error);
      if (isSuperseded(error)) {
        // Normally a newer job of this type took over the state. Cancelled without successor (cancelPending): end it.
        const wasLatest = isLatestOperation(type, token);
        if (!endOperation(type, token) && wasLatest) setGlobalIsProcessing(false);
        throw error;
      }
      const othersRunning = endOperation(type, token);
      // setProcessing(false) also resets the error state, so the error is set afterwards
      setProcessing(false);
      setError(error);
      if (othersRunning) setGlobalIsProcessing(true);
      throw error;
    }
  }, [saveToBuffer, setProcessing, setMetrics, setError, setGlobalIsProcessing, processingMode]);

  return {
    splitText: (args: SplitConfig) => executeProcessing('split', new SplitService(), args),
    diffText: (args: DiffConfig) => executeProcessing('diff', new DiffService(), args),
    filterText: (args: FilterConfig) => executeProcessing('filter', new FilterService(), args),
    removeLines: (args: RemoveConfig) => executeProcessing('remove', new RemoveService(), args),
    // Always the TypeScript sort (worker), also in Rust mode: SortService ignores the backend flag
    sortText: (args: SortConfig) => executeProcessing('sort', new SortService(), args),
    availableBackend,
    toggleMode,
  };
}
