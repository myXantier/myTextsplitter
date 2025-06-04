import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import AppBorders from './components/AppBorders';
import Header from './components/Header';
import LeftMenuBar from './components/LeftMenuBar';
import { invoke } from '@tauri-apps/api/core';
import { getOsName } from './utils/osName';
import { useSettings } from './hooks/useSettings';
import { PageKey } from './config/pages';

const osType = getOsName();

// Set DropShadow
if (osType == 'Windows') invoke('set_window_shadow');

export default function App() {
  useEffect(() => {
    // load permanent settings from JSON
    useSettings.getState().loadSettings();
  }, []);
  
  const theme = useSettings((state) => state.theme);
  const ui = useSettings((state) => state.ui);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme.title);
  }, []);

  const [isAppMaximized, setAppBorderRadius] = useState<boolean>(false);
  const [appName] = useState(ui.appName);
  const [pageName, setPageName] = useState<PageKey>(ui.appDefaultPage);
  const [focus, setFocus] = useState<boolean>(true);

  // useEffect(() => {
  //   const root = document.documentElement;
  //   document.documentElement.style.setProperty('--app-border-radius', theme.settings.appBorderRadius);
  //   document.documentElement.style.setProperty('--color', theme.colors.color);
  //   document.documentElement.style.setProperty('--button-bg-color', theme.colors.buttonBgColor);
  //   document.documentElement.style.setProperty('--button-color', theme.colors.buttonColor);
  //   // Setze weitere Variablen analog …
  // }, []);

  useEffect(() => {
    setMaximized();
    updateAppName();
  }, [isAppMaximized, appName, pageName, theme]);

  const appWindow = getCurrentWindow();

  // Check if window is Maximized or Restored
  appWindow.onResized(async () => {
    const isMaximized = await appWindow.isMaximized();
    setAppBorderRadius(isMaximized);
  });

  // OnFocus
  appWindow.onFocusChanged(async ({ payload: focus }) => setFocus(focus));

  // Check if is Maximized when open
  async function setMaximized() {
    if (await appWindow.isMaximized()) {
      setAppBorderRadius(true);
    }
  }

  // Set appName on taskbar
  async function updateAppName() {
    await appWindow.setTitle(`${appName}: ${pageName}`);
  }

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
    <AppBorders
      isMaximized={isAppMaximized}
      focus={focus}
      margin={osType === 'Linux' && !isAppMaximized ? theme.settings.appBorderMargin : '0'}
      borderRadius={osType === 'Linux' && !isAppMaximized ? theme.settings.appBorderRadius : '0'}
      className="app"
      isVisible={true}
    >
      {/* Content */}
      <section className="right-column">
        {/* Header */}
        <Header
          isAppMaximized={isAppMaximized}
          leftInformation={'Hier App Beschreibung allgemein...'}
          actualPageName={pageName}
          focus={focus}
        />

        {/* Left Menu */}
        <LeftMenuBar setPageName={setPageName} />

        {/* Footer */}
        <footer className="footer">
          <div className="left">{'by: Xantier'}</div>
          <div className="right">{ui.appVersion}</div>
        </footer>
      </section>
    </AppBorders>
  );
}
