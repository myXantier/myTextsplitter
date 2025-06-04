import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';
import './styles/SnackbarStyle.css';

export type MessageType = 'success' | 'info' | 'warning' | 'error';
export type SnackbarPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center';

export interface Message {
  id: string;
  text: string;
  type: MessageType;
  duration: number; // in milliseconds
  position: SnackbarPosition;
}

interface SnackbarProps {
  messages: Message[];
  removeMessage: (id: string) => void;
  position?: SnackbarPosition;
  direction?: 'stack-up' | 'stack-down';
}

interface SnackbarMessageProps {
  message: Message;
  removeMessage: (id: string) => void;
}

const MessageIcon = {
  success: CheckCircle,
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
};

export const SnackbarMessage: React.FC<SnackbarMessageProps> = ({ message, removeMessage }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef(Date.now());
  const remainingRef = useRef(message.duration);

  const Icon = MessageIcon[message.type];

  const startTimer = () => {
    timeoutRef.current = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => removeMessage(message.id), 300); // exit animation
    }, remainingRef.current);
    startTimeRef.current = Date.now();
  };

  const pauseTimer = () => {
    if (!timeoutRef.current) return;
    clearTimeout(timeoutRef.current);
    const elapsed = Date.now() - startTimeRef.current;
    remainingRef.current = remainingRef.current - elapsed;
  };

  const resumeTimer = () => {
    startTimer();
  };

  useEffect(() => {
    startTimer();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClose = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsExiting(true);
    setTimeout(() => removeMessage(message.id), 300);
  };

  return (
    <div
      className={`snackbar-message ${message.type} ${isExiting ? 'exit' : 'enter'}`}
      onMouseEnter={() => {
        setIsPaused(true);
        pauseTimer();
      }}
      onMouseLeave={() => {
        setIsPaused(false);
        resumeTimer();
      }}
      role="alert"
    >
      <div className="message-content">
        <Icon size={18} className="message-icon" />
        <span className="message-text">{message.text}</span>
        <button onClick={handleClose} className="close-button" aria-label="Close message">
          <X size={16} />
        </button>
      </div>
      {!isPaused && <div className="progress-bar" style={{ animationDuration: `${remainingRef.current}ms` }} />}
    </div>
  );
};

export function Snackbar({ messages, removeMessage, position = 'bottom-right', direction = 'stack-up' }: SnackbarProps) {
  return (
    <div
      className={`snackbar-container ${position} ${direction}`}
      role="log"
      aria-live="polite"
      aria-atomic="true"
    >
      {messages.map((message) => (
        <SnackbarMessage key={message.id} message={message} removeMessage={removeMessage} />
      ))}
    </div>
  );
}
