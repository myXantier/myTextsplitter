import { useEffect, useState } from 'react';
import ThemeProvider from './components/MEINS/ThemeProvider';
import { invoke } from '@tauri-apps/api/core';
import CircularProgressBar from './components/CircularProgressBar';
import { getOsName } from './utils/osName';
import { light, dark } from './Themes';
import { useSettings } from './hooks/useSettings';
import { MyAppLogo } from './components/SvgIcons';
import { getAppWindow, listenSafely, disableWebFunctions, shouldDisableWebFunctions } from './platform/platform';

const osType = getOsName();

// Tauri window, null in the browser
const appWindow = getAppWindow();

export default function SplashScreen() {
  const dots = ['.', '..', '...'];
  const theme = useSettings((state) => state.theme);
  const setTheme = useSettings((state) => state.setTheme);
  const ui = useSettings((state) => state.ui);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark.title);
  }, []);
  
  // useState
  const [dotIndex, setDotIndex] = useState(0);
  const [percentage, setPercentage] = useState<number>(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDotIndex((prev) => (prev + 1) % dots.length);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Update preloader and show app
    if (percentage < 100) {
      const timer = setInterval(() => {
        setPercentage(Math.trunc(percentage + ui.splashScreenUpdateSteps));
      }, ui.splashScreenUpdateMilliseconds);
      return () => clearInterval(timer);
    } else if (appWindow) {
      invoke('close_splashscreen').catch((err) => console.error('❌ Could not close splashscreen:', err));
    }
  }, [percentage, theme]);

  // Set appName on taskbar (browser: tab title)
  useEffect(() => {
    const title = `${ui.appName}: ${ui.splashScreenLoadingText}`;
    if (!appWindow) {
      document.title = title;
      return;
    }
    appWindow.setTitle(title).catch((err) => console.warn('⚠️ Could not set window title:', err));
  }, []);

  // Update theme when user changes in OS
  useEffect(() => {
    if (!appWindow) return;
    const win = appWindow;
    return listenSafely(() =>
      win.onThemeChanged(() => {
        win
          .theme()
          .then((theme) => (theme == 'dark' ? setTheme(dark) : setTheme(light)))
          .catch(console.warn);
      })
    );
  }, []);

  // Prevent context menu and shortcuts (desktop only)
  useEffect(() => {
    if (shouldDisableWebFunctions(osType)) return disableWebFunctions();
  }, []);

  return (
    <ThemeProvider theme={theme}>
      {/* Global Styles */}
      <div data-tauri-drag-region className="preloader-app">
        <CircularProgressBar
          data-tauri-drag-region
          value={percentage}
          textSuffix="%"
          viewBoxSize={230}
          strokeColor={theme.colors.accentColor}
          strokeWidth={ui.splashScreenStrokeWidth}
          bgStrokeWidth={ui.splashScreenBgStrokeWidth}
          bgStrokeColor={theme.colors.background_5 + '80'}
          dropShadow="0 0 5px #33333380"
        >
          <div data-tauri-drag-region className="content">
            <MyAppLogo data-tauri-drag-region color={theme.colors.color} height={100} />
            <div data-tauri-drag-region className="percentage">
              {percentage}%
            </div>
            <div data-tauri-drag-region className="version">
              {ui.appVersion}
            </div>
            <div data-tauri-drag-region className="loading-text">
              {ui.splashScreenLoadingText}{dots[dotIndex]}
            </div>
          </div>
        </CircularProgressBar>
      </div>
    </ThemeProvider>
  );
}

