import { create } from 'zustand';

interface ProcessingState {
  isProcessing: boolean;
  metrics: ProcessMetrics | null;
  error: Error | null;
  setGlobalIsProcessing: (isProcessing: boolean) => void;
  setGlobalMetrics: (metrics: ProcessMetrics | null) => void;
  setGlobalError: (error: Error | null) => void;
}

export const useProcessingStore = create<ProcessingState>((set) => ({
  isProcessing: false,
  metrics: null,
  error: null,
  setGlobalIsProcessing: (isProcessing) => set({ isProcessing }),
  setGlobalMetrics: (metrics) => set({ metrics }),
  setGlobalError: (error) => set({ error }),
}));
