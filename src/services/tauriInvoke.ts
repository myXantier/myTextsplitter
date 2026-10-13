import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
import { fromBackendError } from './ProcessingError';

/**
 * Calls a Tauri command. `T` is not checked here ("unsafe"): callers validate the result.
 * A failed command or IPC call rejects with a `ProcessingError` (`backend`, or `invalidInput` for an
 * invalid regex reported by the Rust text commands); it is never turned into an empty result.
 */
export async function invokeUNSAFE<T>(funcName: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(funcName, args);
  } catch (error) {
    throw fromBackendError(error);
  }
}
