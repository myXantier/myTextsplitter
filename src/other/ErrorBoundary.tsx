import { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { XCircle, Copy, Check, RefreshCw } from 'lucide-react';
import { AppError, useErrorStore } from './error2';
import './styles/ErrorBoundaryStyle.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: null | string | Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error: error, hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return <ErrorNotification error={this.state.error} onDismiss={this.handleDismiss} />;
    }
    return this.props.children;
  }
}

interface ErrorNotificationProps {
  error: Error | string;
  onDismiss: () => void;
}

function ErrorNotification({ error, onDismiss }: ErrorNotificationProps) {
  const [copied, setCopied] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const errorMessage = error instanceof AppError
    ? `${error.severity.toUpperCase()}: ${error.message}`
    : error instanceof Error
    ? error.message
    : error;
  const fullError = error instanceof Error ? error.stack || error.message : error;

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onDismiss, 300);
    }, 30000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(fullError);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy error details:', err);
    }
  };

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div className={`error-notification ${isExiting ? 'exit' : 'enter'}`}>
      <div className="error-content">
        <div className="error-header">
          <div className="error-icon">
            <XCircle />
          </div>
          <h3>Error Occurred</h3>
          <button onClick={onDismiss} className="close-button">
            <XCircle />
          </button>
        </div>

        <div className="error-message">
          <p>{errorMessage}</p>
        </div>

        <div className="error-actions">
          <button onClick={copyToClipboard} className="action-button copy-button">
            {copied ? (
              <>
                <Check size={16} />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy size={16} />
                <span>Copy Details</span>
              </>
            )}
          </button>

          <button onClick={handleReload} className="action-button reload-button">
            <RefreshCw size={16} />
            <span>Reload App</span>
          </button>
        </div>
      </div>
    </div>
  );
}