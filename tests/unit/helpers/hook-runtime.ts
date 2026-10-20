// Runs the app's React hooks in `node --test` without a renderer (no new dependencies, no JSX).
//
// A resolve hook maps `react` (also the import inside zustand) to this module: every hook call is one "render" without
// state between calls. `useState` returns its initial value, `useCallback` the function itself, effects do not run, and
// zustand's `useSyncExternalStore` reads the store directly, so the global stores are the real zustand stores.
// useBackendProcessor's `./useTextBuffer` (a .tsx file with JSX) and `../hooks/useSettings` (imports a type without
// `type`, which Node's type stripping cannot load) are mapped to the stand-ins below. Import after setup.ts and before
// loading app sources (with dynamic `await import(...)`).
import { registerHooks } from 'node:module';

const self = import.meta.url;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react') return { url: self, format: 'module-typescript', shortCircuit: true };
    const fromProcessor = context.parentURL?.endsWith('/src/hooks/useBackendProcessor.ts');
    if (fromProcessor && (specifier === './useTextBuffer' || specifier === '../hooks/useSettings')) {
      return { url: self, format: 'module-typescript', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

export function useState<T>(initial: T | (() => T)): [T, (value: unknown) => void] {
  return [typeof initial === 'function' ? (initial as () => T)() : initial, () => {}];
}
export const useCallback = <T>(fn: T) => fn;
export const useMemo = <T>(fn: () => T) => fn();
export const useRef = <T>(current: T) => ({ current });
export const useEffect = () => {};
export const useDebugValue = () => {};
export const useSyncExternalStore = <T>(_subscribe: unknown, getSnapshot: () => T) => getSnapshot();

export default { useState, useCallback, useMemo, useRef, useEffect, useDebugValue, useSyncExternalStore };

/** Text buffer stand-in: keeps every saved result. */
export const savedToBuffer: string[] = [];
export function useTextBuffer() {
  return { buffer: null, saveToBuffer: (text: string) => savedToBuffer.push(text), clearBuffer: () => {}, copyToClipboard: () => {} };
}

/** Runtime settings stand-in (useBackendProcessor reads `processingMode`). */
export const runtimeSettings: Record<string, unknown> = { processingMode: 'fallback' };
export const useRuntimeSetting = (key: string) => runtimeSettings[key];
export function setRuntimeSetting(key: string, value: unknown) {
  runtimeSettings[key] = value;
}
