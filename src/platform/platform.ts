import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow, type Window } from '@tauri-apps/api/window';

type UnlistenFn = () => void;

/** True inside the Tauri desktop runtime, false in a plain browser. */
export function isDesktop(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/** Current Tauri window, or `null` in the browser (no Tauri runtime available). */
export function getAppWindow(): Window | null {
  return isDesktop() ? getCurrentWindow() : null;
}

/**
 * Registers an async Tauri listener (e.g. `appWindow.onResized(...)`) from a React effect.
 * Returns a synchronous cleanup that also works if the effect is torn down before the
 * registration promise resolves (React StrictMode mounts effects twice in development).
 */
export function listenSafely(register: () => Promise<UnlistenFn>): UnlistenFn {
  let unlisten: UnlistenFn | undefined;
  let disposed = false;

  register()
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch((err) => console.warn('⚠️ Could not register window listener:', err));

  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Prevents context menu and browser shortcuts (reload, print, search). Returns a cleanup. */
export function disableWebFunctions(): UnlistenFn {
  const preventContextMenu = (event: MouseEvent) => event.preventDefault();
  const preventShortcuts = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'r': // Reload
      case 'R': // Reload
      case 'p': // Print
      case 'P': // Print
      case 'f': // Search
      case 'F': // Search
        if (e.ctrlKey) e.preventDefault();
        break;
      case 'F3': // Search
      case 'F5': // Reload
      case 'F7':
        e.preventDefault();
        break;
    }
  };

  document.addEventListener('contextmenu', preventContextMenu);
  document.addEventListener('keydown', preventShortcuts);

  // Removes only these handlers; other keydown/contextmenu listeners stay registered
  return () => {
    document.removeEventListener('contextmenu', preventContextMenu);
    document.removeEventListener('keydown', preventShortcuts);
  };
}

/**
 * The webview shortcuts are only blocked in the desktop app; in a browser, reload/search/print
 * must keep working. On desktop the original rule is kept: blocked except in the Windows dev build.
 */
export function shouldDisableWebFunctions(osType: string): boolean {
  if (!isDesktop()) return false;
  return window.location.hostname !== 'localhost' || osType == 'Linux' || osType == 'MacOS';
}
