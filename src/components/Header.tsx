import React, { useState } from 'react';
import Switch from 'react-switch';
import { shadeColor } from '../utils/helper';
import IconRoundedButton from './IconRoundedButton';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getOsName } from '../utils/osName';
import SettingsModal from './SettingsModal';
import { MyAppLogo, SvgIconClose, SvgIconMaximize, SvgIconMinimize, SvgIconRestore, SvgIconSettings } from './SvgIcons';
import { useSettings } from '../hooks/useSettings';
import { isTauriCheck } from '../services/Services';
import './styles/HeaderStyle.css';

interface Props {
  focus?: boolean;
  isAppMaximized?: boolean;
  leftInformation?: string;
  actualPageName?: string;
}

const osType = getOsName();

export default function Header({
  focus,
  isAppMaximized,
  leftInformation,
  actualPageName,
}: Props) {
  // const { theme, toggleTheme } = useSettings();
  const theme = useSettings((state) => state.theme);
  const toggleTheme = useSettings((state) => state.toggleTheme);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const headerStyle: React.CSSProperties = {
    '--header-opacity': focus ? '1' : '0.5',
  } as React.CSSProperties;

  const appWindow = (osType !== 'MacOS' && isTauriCheck()) ? getCurrentWindow() : null;

  // SvgIcons
  const svgIconMinimize = <SvgIconMinimize size="14" />;
  const svgIconMaximize = <SvgIconMaximize size="14" />;
  const svgIconRestore = <SvgIconRestore size="14" />;
  const svgIconClose = <SvgIconClose size="14" />;
  const svgIconSettings = <SvgIconSettings size="20" />;

  return (
    <>
      <header data-tauri-drag-region className="header" style={headerStyle}>
        <div className="title-bar">
          <div data-tauri-drag-region className="icon-title">
            {/* {titleBarIcon}
            <h1 data-tauri-drag-region>{appName?.toUpperCase()}</h1> */}
            <MyAppLogo data-tauri-drag-region color={theme.colors.color} height={24} />
          </div>
          <div className="buttons">
            <div title="Toggle theme" className="switch">
              <Switch
                onChange={toggleTheme}
                checked={theme.isDark}
                checkedIcon={false}
                uncheckedIcon={false}
                width={30}
                height={16}
                handleDiameter={12}
                offColor={shadeColor(0.6, theme.colors.accentColor)}
                onColor={theme.colors.accentColor}
              />
            </div>

            <IconRoundedButton
              onClick={() => setIsSettingsOpen(true)}
              title="Settings"
              size="30px"
              svgIcon={svgIconSettings}
              colorDefault={theme.colors.background}
              colorHover={theme.colors.buttonBgHover}
              colorPressed={theme.colors.appColorGreen}
              highlightIcon={true}
              radius="8px"
            />

            {/* Title Bar for Windows and Linux only */}
            {appWindow && (
              <div className="buttons-box">
                <div id="titlebar-minimize">
                  <IconRoundedButton
                    onClick={() => {
                      appWindow.minimize();
                    }}
                    title="Minimize"
                    size="30px"
                    svgIcon={svgIconMinimize}
                    colorDefault={theme.colors.background}
                    colorHover={theme.colors.buttonBgHover}
                    colorPressed={theme.colors.appColorYellow}
                    highlightIcon={true}
                    radius="8px"
                  />
                </div>
                <div id="titlebar-maximize">
                  <IconRoundedButton
                    onClick={() => {
                      appWindow.toggleMaximize();
                    }}
                    title={isAppMaximized ? 'Restore' : 'Maximize'}
                    size="30px"
                    svgIcon={isAppMaximized ? svgIconRestore : svgIconMaximize}
                    colorDefault={theme.colors.background}
                    colorHover={theme.colors.buttonBgHover}
                    colorPressed={theme.colors.appColorGreen}
                    highlightIcon={true}
                    radius="8px"
                  />
                </div>
                <div id="titlebar-close">
                  <IconRoundedButton
                    onClick={() => {
                      appWindow.close();
                    }}
                    title="Close"
                    size="30px"
                    svgIcon={svgIconClose}
                    colorDefault={theme.colors.background}
                    colorHover={theme.colors.buttonBgHover}
                    colorPressed={theme.colors.appColorRed}
                    highlightIcon={true}
                    radius="8px"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="info-bar">
          <span>{leftInformation}</span>
          <span>
            | <b>{actualPageName?.toUpperCase()}</b>
          </span>
        </div>
      </header>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
}
