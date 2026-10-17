import { useEffect, useState, useCallback, DragEvent } from 'react';
import { FILE_DROP_ZONE_ATTRIBUTE } from '../utils/fileDropGuard';

interface DragAndDropHandlers {
  /** A file was dropped; its extension, size and content are checked by the import (Paket 11 C3, same as the button). */
  onFileAccepted: (file: File) => void;
  /** Something without a file was dropped. */
  onNoFile: () => void;
}

export function useDragAndDropFiles(setText: (text: string) => void) {
  useEffect(() => {
    const handleDrop = async (event: globalThis.DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file) {
        const text = await file.text();
        setText(text);
      }
    };

    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('drop', handleDrop);
    };
  }, [setText]);
}


export function useDragAndDrop({ onFileAccepted, onNoFile }: DragAndDropHandlers) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const file = event.dataTransfer?.files[0];
    if (!file) {
      onNoFile();
      return;
    }

    onFileAccepted(file);
  }, [onFileAccepted, onNoFile]);

  return {
    isDragging,
    dragHandlers: {
      // Marks the element as a file drop zone: the app-wide file drop guard leaves its drops alone
      [FILE_DROP_ZONE_ATTRIBUTE]: true,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop
    }
  };
}