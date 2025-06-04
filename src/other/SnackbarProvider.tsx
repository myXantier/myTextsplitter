import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { Snackbar, MessageType, Message, SnackbarPosition } from './Snackbar';

type MessageMap = Record<SnackbarPosition, Message[]>;

interface SnackbarContextType {
  addMessage: (text: string, type: MessageType, duration?: number, position?: SnackbarPosition) => void;
  removeMessage: (id: string, position: SnackbarPosition) => void;
  messages: MessageMap;
}

const SnackbarContext = createContext<SnackbarContextType | null>(null);

export function useSnackbarContext() {
  const context = useContext(SnackbarContext);
  if (!context) {
    throw new Error('useSnackbarContext must be used within a SnackbarProvider');
  }
  return context;
}

interface SnackbarProviderProps {
  children: ReactNode;
}

const POSITIONS: SnackbarPosition[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'top-center',
  'bottom-center',
];

const createEmptyMap = (): MessageMap => {
  return POSITIONS.reduce((acc, pos) => {
    acc[pos] = [];
    return acc;
  }, {} as MessageMap);
};

export function SnackbarProvider({ children }: SnackbarProviderProps) {
  const [messages, setMessages] = useState<MessageMap>(createEmptyMap);

  const addMessage = useCallback(
    (text: string, type: MessageType = 'info', duration = 5000, position: SnackbarPosition = 'bottom-right') => {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      setMessages((prev) => ({
        ...prev,
        [position]: [...prev[position], { id, text, type, duration, position }],
      }));
    },
    []
  );

  const removeMessage = useCallback((id: string, position: SnackbarPosition) => {
    setMessages((prev) => ({
      ...prev,
      [position]: prev[position].filter((msg) => msg.id !== id),
    }));
  }, []);

  const contextValue: SnackbarContextType = {
    addMessage,
    removeMessage,
    messages,
  };

  return (
    <SnackbarContext.Provider value={contextValue}>
      {children}
      {POSITIONS.map((position) => (
        <Snackbar
          key={position}
          messages={messages[position]}
          removeMessage={(id) => removeMessage(id, position)}
          position={position}
        />
      ))}
    </SnackbarContext.Provider>
  );
}
