import { useEffect, useState } from 'react';
import AppBorders from './components/AppBorders';
import Header from './components/Header';
import LeftMenuBar from './components/LeftMenuBar';
import { invoke } from '@tauri-apps/api/core';
import { getOsName } from './utils/osName';
import { useSettings } from './hooks/useSettings';
import { PageKey } from './config/pages';
import { getAppWindow, listenSafely, disableWebFunctions, shouldDisableWebFunctions } from './platform/platform';

const osType = getOsName();

// Tauri window, null in the browser
const appWindow = getAppWindow();

// Set DropShadow
if (appWindow && osType == 'Windows')
  invoke('set_window_shadow').catch((err) => console.warn('⚠️ Could not set window shadow:', err));

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

  useEffect(() => {
    if (!appWindow) return;
    const win = appWindow;

    // Check if window is Maximized or Restored
    const stopResized = listenSafely(() =>
      win.onResized(() => {
        win.isMaximized().then(setAppBorderRadius).catch(console.warn);
      })
    );

    // OnFocus
    const stopFocusChanged = listenSafely(() => win.onFocusChanged(({ payload: focus }) => setFocus(focus)));

    return () => {
      stopResized();
      stopFocusChanged();
    };
  }, []);

  // Check if is Maximized when open
  async function setMaximized() {
    if (!appWindow) return;
    try {
      if (await appWindow.isMaximized()) {
        setAppBorderRadius(true);
      }
    } catch (err) {
      console.warn('⚠️ Could not read window state:', err);
    }
  }

  // Set appName on taskbar (browser: tab title)
  async function updateAppName() {
    const title = `${appName}: ${pageName}`;
    if (!appWindow) {
      document.title = title;
      return;
    }
    try {
      await appWindow.setTitle(title);
    } catch (err) {
      console.warn('⚠️ Could not set window title:', err);
    }
  }

  // Prevent context menu and shortcuts (desktop only)
  useEffect(() => {
    if (shouldDisableWebFunctions(osType)) return disableWebFunctions();
  }, []);

  // Rounded, transparent window frame is only drawn by the Linux desktop app
  const hasFrameMargin = appWindow !== null && osType === 'Linux' && !isAppMaximized;

  return (
    <AppBorders
      isMaximized={isAppMaximized}
      focus={focus}
      margin={hasFrameMargin ? theme.settings.appBorderMargin : '0'}
      borderRadius={hasFrameMargin ? theme.settings.appBorderRadius : '0'}
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
