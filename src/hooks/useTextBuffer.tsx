import { createContext, useContext, useState, ReactNode } from 'react';

// Context Interface definieren
interface TextBufferContextType {
  buffer: string | string[] | null;
  saveToBuffer: (text: string | string[]) => void;
  clearBuffer: () => void;
  copyToClipboard: () => void;
}

// Context erstellen (Standardwert ist `null`)
const TextBufferContext = createContext<TextBufferContextType | null>(null);

// Provider für den Context
export function TextBufferProvider({ children }: { children: ReactNode }) {
  const [buffer, setBuffer] = useState<string | string[] | null>(null);

  const saveToBuffer = (value: string | string[]) => setBuffer(value);
  const clearBuffer = () => setBuffer(null);

  const copyToClipboard = async () => {
    if (buffer) {
      try {
        await navigator.clipboard.writeText(Array.isArray(buffer) ? buffer.join('\n') : buffer);
        window.logger.debug('📋 Buffer kopiert:', buffer);
      } catch (err) {
        window.logger.error('❌ Fehler beim Kopieren:', err);
      }
    }
  };

  return (
    <TextBufferContext.Provider value={{ buffer, saveToBuffer, clearBuffer, copyToClipboard }}>
      {children}
    </TextBufferContext.Provider>
  );
}

// Custom Hook, um den Context einfacher zu nutzen
export function useTextBuffer() {
  const context = useContext(TextBufferContext);
  if (!context) {
    throw new Error('useTextBuffer must be used within a TextBufferProvider');
  }
  return context;
}
