// Shared setup for unit tests that load the services and workers (`npm test`, no browser, no Tauri runtime).
//
// The app sources use extensionless relative imports (resolved by Vite). Node needs the extension, so a
// resolve hook retries such imports with `.ts`. Hooks only apply to modules loaded *after* this file ran:
// import this module first and load app sources with dynamic `await import(...)`.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

export type TauriHandler = (cmd: string, args: Record<string, unknown>) => unknown;

/** Logger stand-in: keeps every call (to check that no input text is logged) without console output. */
export const logged: { level: string; parts: unknown[] }[] = [];
const record =
  (level: string) =>
  (...parts: unknown[]) => {
    logged.push({ level, parts });
  };
export const silentLogger = {
  log: record('log'),
  debug: record('debug'),
  info: record('info'),
  warn: record('warn'),
  error: record('error'),
};

const g = globalThis as any;

/**
 * Minimal `window`: `window.logger` and the Tauri IPC entry point used by `@tauri-apps/api/core`
 * (`window.__TAURI_INTERNALS__.invoke`). `tauri` is called for every `invoke(cmd, args)`.
 */
export function installWindow(tauri?: TauriHandler) {
  logged.length = 0;
  g.window = {
    logger: silentLogger,
    isTauri: !!tauri,
    __TAURI_INTERNALS__: tauri ? { invoke: async (cmd: string, args: Record<string, unknown>) => tauri(cmd, args) } : undefined,
  };
}

/** The services start a worker cleanup interval in their constructor; it would keep `node --test` alive. */
export function disableWorkerCleanupInterval(BaseService: unknown) {
  (BaseService as any).cleanupIntervalStarted = true;
}

/** Runs `fn` and returns the rejection reason; fails if `fn` resolves. */
export async function rejectionOf(fn: () => Promise<unknown>): Promise<any> {
  try {
    const value = await fn();
    throw new Error(`expected a rejection, but it resolved with ${JSON.stringify(value)}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('expected a rejection')) throw error;
    return error;
  }
}

/** Backend metrics as sent by the Rust commands */
export const backendMetrics = { execution_time_ms: 1.5, memory_usage_kb: 2048, memory_usage_str: '12' };
