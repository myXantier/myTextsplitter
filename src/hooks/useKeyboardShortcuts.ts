import { useEffect, useCallback } from 'react';

interface ShortcutHandlers {
  onSplit?: () => void;
  onSave?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onToggleDarkMode?: () => void;
  onCopy?: () => void;
}

export function useKeyboardShortcuts({ onSplit, onSave, onUndo, onRedo, onToggleDarkMode, onCopy }: ShortcutHandlers) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Check if target is an input field
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Split text (Ctrl/Cmd + Enter)
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        onSplit?.();
      }

      // Save (Ctrl/Cmd + S)
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        onSave?.();
      }

      // Undo (Ctrl/Cmd + Z)
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        onUndo?.();
      }

      // Redo (Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y)
      if ((event.ctrlKey || event.metaKey) && ((event.key === 'z' && event.shiftKey) || event.key === 'y')) {
        event.preventDefault();
        onRedo?.();
      }

      // Toggle dark mode (Ctrl/Cmd + D)
      if ((event.ctrlKey || event.metaKey) && event.key === 'd') {
        event.preventDefault();
        onToggleDarkMode?.();
      }

      // Copy (Ctrl/Cmd + C) - only if text is selected
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        const selection = window.getSelection()?.toString();
        if (selection && onCopy) {
          event.preventDefault();
          onCopy();
        }
      }
    },
    [onSplit, onSave, onToggleDarkMode, onCopy]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, onSplit, onSave, onUndo, onRedo, onToggleDarkMode, onCopy]);
}
