export { SplitService } from './SplitService';
export { DiffService } from './DiffService';
export { FilterService } from './FilterService';
export { RemoveService } from './RemoveService';
import { isTauri, invoke, InvokeArgs } from '@tauri-apps/api/core';

export function isTauriCheck() {
  return isTauri();
}

export async function isBackend(): Promise<boolean> {
  try {
    const isAvailable = isTauri() && await invoke<boolean>('is_backend_available', {});
    // window.logger.debug('✅ Backend verfügbar:', isAvailable);
    return isAvailable;
  } catch (error) {
    window.logger.error('❌ Fehler beim Abrufen der Backend-Verfügbarkeit:', error);
    return false;
  }
}
