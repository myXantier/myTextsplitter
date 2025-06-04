import { useEffect, useCallback } from 'react';

interface Hotkey {
  keys: string;
  callback: () => void;
  description: string;
}

export function useHotkeys(hotkeys: Hotkey[], deps: any[] = []) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Ignoriere Eingaben in Textfeldern
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      for (const hotkey of hotkeys) {
        const keys = hotkey.keys.toLowerCase().split('+');
        const modKey = keys.includes('mod');

        if (modKey && !event.metaKey && !event.ctrlKey) continue;

        const mainKey = keys[keys.length - 1];
        if (event.key.toLowerCase() !== mainKey) continue;

        event.preventDefault();
        hotkey.callback();
        break;
      }
    },
    [hotkeys]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, ...deps]);
}
