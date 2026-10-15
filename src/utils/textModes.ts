// Supported Filter and Remove modes (Paket 8 C3), the same lists as the Rust engine (`text_processor.rs`).
// An unknown or empty mode is invalid input (`errors.invalidMode`), never a silent default.
import { invalidModeError } from '../services/ProcessingError';

export const FILTER_MODES: readonly string[] = ['keep', 'remove'];
export const REMOVE_MODES: readonly string[] = ['duplicates', 'containing', 'notContaining'];

export function assertFilterMode(mode: unknown): void {
  if (!FILTER_MODES.includes(mode as string)) throw invalidModeError(`unknown filter mode ${JSON.stringify(mode)}`);
}

export function assertRemoveMode(mode: unknown): void {
  if (!REMOVE_MODES.includes(mode as string)) throw invalidModeError(`unknown remove mode ${JSON.stringify(mode)}`);
}
