import { useEffect, useState, useCallback, DragEvent } from 'react';

interface DragAndDropHandlers {
  onFileAccepted: (file: File) => void;
  onError: (message: string) => void;
  maxSize?: number;
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


export function useDragAndDrop({
  onFileAccepted,
  onError,
  maxSize = 10 * 1024 * 1024 // 10MB default
}: DragAndDropHandlers) {
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
      onError('No file was dropped');
      return;
    }

    if (!file.name.endsWith('.txt')) {
      onError('Only .txt files are supported');
      return;
    }

    if (file.size > maxSize) {
      onError(`File is too large. Maximum size is ${(maxSize / (1024 * 1024)).toFixed(1)}MB`);
      return;
    }

    onFileAccepted(file);
  }, [maxSize, onFileAccepted, onError]);

  return {
    isDragging,
    dragHandlers: {
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop
    }
  };
}