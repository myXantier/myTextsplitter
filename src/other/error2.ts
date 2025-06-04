import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export class AppError extends Error {
  constructor(message: string, public code: string, public severity: 'warning' | 'error' | 'fatal' = 'error') {
    super(message);
    this.name = 'AppError';
  }
}

export function handleError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError(error.message, 'UNKNOWN_ERROR');
  }
  return new AppError('An unknown error occurred', 'UNKNOWN_ERROR');
}

interface ErrorState {
  error: Error | string | null;
  setError: (error: Error | string | null) => void;
  clearError: () => void;
}

export const useErrorStore = create<ErrorState>()(
  devtools(
    (set) => ({
      error: null,
      setError: (error) => set({ error }, false, 'setError'),
      clearError: () => set({ error: null }, false, 'clearError'),
    }),
    { name: 'ErrorStore' }
  )
);
