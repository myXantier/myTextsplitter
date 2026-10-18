import { useEffect, useState, useCallback, DragEvent } from 'react';
import { FILE_DROP_ZONE_ATTRIBUTE, isFileDrag } from '../utils/fileDropGuard';
import { FileImport } from './useFileImport';

/** Classes of a file drop zone while a file is dragged over it. */
export const fileDragClassName = (isDragging: boolean) => (isDragging ? 'border-2 border-dashed border-blue-500' : '');

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


/**
 * File drop zone of a text field (Paket 11 C5, every text input): a dropped file is one more import of the field's text
 * (`fileImport.importFile`, the same job as its Open File button: latest wins, checks, decoding, lock). Only file drags
 * are handled; a text drag keeps the browser's own behaviour (the text is inserted).
 */
export function useDragAndDrop(fileImport: FileImport) {
  const [isDragging, setIsDragging] = useState(false);
  const { importFile } = fileImport;

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event.nativeEvent)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    setIsDragging(false);
    if (!isFileDrag(event.nativeEvent)) return;
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files[0];
    if (file) importFile(file);
  }, [importFile]);

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