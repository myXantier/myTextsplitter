import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './other/ErrorBoundary';
import { TextBufferProvider } from './hooks/useTextBuffer';
import { SnackbarProvider } from './other/SnackbarProvider';
import { Logger } from './other/Logger.ts';
import App from './App.tsx';
import changeResultType from './other/TypeConverter.ts';
import './i18n';

window.currentOS = /((?:Win|Linux|Mac|CrOS)\S*(?: x[368][246]\w*))/i.exec(window.navigator.userAgent || navigator.userAgent)?.pop() || 'unknown Os';
window.logger = Logger;
window.myResultConverter = changeResultType;

window.logger.log('OS: ', window.currentOS);
window.logger.log('userAgent: ', window.navigator.userAgent);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <TextBufferProvider>
        <SnackbarProvider>
          <App />
        </SnackbarProvider>
      </TextBufferProvider>
    </ErrorBoundary>
  </StrictMode>
);
