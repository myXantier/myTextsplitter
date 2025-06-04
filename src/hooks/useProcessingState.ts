import { useState, useCallback, useEffect } from 'react';
import { useProcessingStore } from './useProcessingStore';

interface ProcessingState {
  isProcessing: boolean;
  progress: number;
  error: Error | null;
  startTime: number | null;
  abortController: AbortController | null;
  metrics: ProcessMetrics | null;
}

export function useProcessingState() {
  const [state, setState] = useState<Partial<ProcessingState>>({
    isProcessing: false,
    progress: 0,
    error: null,
    startTime: null,
    abortController: null,
    metrics: null,
  });

  const { setGlobalIsProcessing, setGlobalMetrics, setGlobalError } = useProcessingStore();

  useEffect(() => {
    return () => {
      if (state.abortController) {
        state.abortController.abort();
      }
    };
  }, [state.abortController]);

  const setProcessing = useCallback(
    (value: boolean) => {
      setState((prev) => ({
        ...prev,
        isProcessing: value,
        progress: value ? 0 : 100,
        error: null,
        startTime: value ? Date.now() : null,
        abortController: value ? new AbortController() : null,
        metrics: null,
      }));
      setGlobalIsProcessing(value);
      if (!value) setGlobalError(null);
    },
    [setGlobalIsProcessing, setGlobalError]
  );

  const setProgress = useCallback((value: number) => {
    setState((prev) => ({ ...prev, progress: Math.min(100, Math.max(0, value)) }));
  }, []);

  const setMetrics = useCallback(
    (metrics: ProcessingState['metrics']) => {
      setState((prev) => ({ ...prev, metrics }));
      setGlobalMetrics(metrics ?? null);
    },
    [setGlobalMetrics]
  );

  const setError = useCallback(
    (error: Error | null) => {
      setState((prev) => ({
        ...prev,
        error,
        isProcessing: false,
        startTime: null,
        abortController: null,
      }));
      setGlobalIsProcessing(false);
      setGlobalError(error);
    },
    [setGlobalIsProcessing, setGlobalError]
  );

  const abort = useCallback(() => {
    if (state.abortController) {
      state.abortController.abort();
    }
    setState((prev) => ({
      ...prev,
      isProcessing: false,
      progress: 0,
      startTime: null,
      abortController: null,
      metrics: null,
    }));
    setGlobalIsProcessing(false);
  }, [state.abortController, setGlobalIsProcessing]);

  return {
    state,
    setProcessing,
    setProgress,
    setMetrics,
    setError,
    abort,
  };
}
