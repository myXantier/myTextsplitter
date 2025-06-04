import { useEffect, useState } from 'react';
import ThemeProvider from './components/MEINS/ThemeProvider';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import CircularProgressBar from './components/CircularProgressBar';
import { getOsName } from './utils/osName';
import { light, dark } from './Themes';
import { useSettings } from './hooks/useSettings';
import { MyAppLogo } from './components/SvgIcons';

const osType = getOsName();

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
    } else {
      invoke('close_splashscreen');
    }
  }, [percentage, theme]);

  const appWindow = getCurrentWindow();

  // Set appName on taskbar
  async function updateAppName() {
    await appWindow.setTitle(`${ui.appName}: ${ui.splashScreenLoadingText}`);
  }
  updateAppName();

  // Update theme when user changes in OS
  appWindow.onThemeChanged(() => {
    appWindow.theme().then((theme) => {
      theme == 'dark' ? setTheme(dark) : setTheme(light);
    });
  });

  // Prevent context menu and shortcuts
  function disable_web_functions() {
    document.addEventListener('contextmenu', (event) => event.preventDefault());
    document.onkeydown = function (e) {
      switch (e.key) {
        case 'r': // Reload
        case 'R': // Reload
        case 'p': // Print
        case 'P': // Print
        case 'f': // Search
        case 'F': // Search
          if (e.ctrlKey) e.preventDefault();
          break;
        case 'F3': // Search
        case 'F5': // Reload
        case 'F7':
          e.preventDefault();
          break;
      }
    };
  }

  if (window.location.hostname !== 'localhost') {
    disable_web_functions();
  } else if (osType == 'Linux' || osType == 'MacOS') {
    disable_web_functions();
  }

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

