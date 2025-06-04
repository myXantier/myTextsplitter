import { invoke, InvokeArgs } from '@tauri-apps/api/core';

export async function invokeUNSAFE<T>(funcName: string, args?: InvokeArgs): Promise<T> {
  try {
    const res = await invoke<T>(funcName, args);
    window.logger.debug("'invokeUNSAFE' Result: ", res);
    return res;
  } catch (error) {
    window.logger.error('❌ invokeUNSAFE ERROR: ', error);
    return {} as T;
  }
}
