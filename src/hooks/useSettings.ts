import { create } from 'zustand';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { dark, myTheme } from '../Themes';
import type { PageKey } from '../config/pages';

export interface SaveAppSettings {
  isDarkMode: boolean;
  language: language;
  trimLine: boolean;
  trimParts: boolean;
  fontSize: fontSize;
  showLineNumbers: boolean;
  showEmptyLines: boolean;
  savedPatterns: string[];
}

export interface AppSettings {
  processingMode: processModes;
  multipleSeparators: boolean;
  useRegex: boolean;
  autoSplit: boolean;
  separator: string;
  combineSeparator: string;
}

export interface UiSettings {
  // General
  appName: string;
  appVersion: string;
  appDefaultPage: PageKey;

  // Left Menu
  leftMenuToggleIconSize: string;
  leftMenuButtonsIconSize: string;
  leftMenuWidthClosed: string;
  leftMenuWidthOpened: string;
  leftMenuIconLeftPadding: string;
  leftMenuTextLeftPadding: string;

  // Splash Screen
  splashScreenLoadingText: string;
  splashScreenStrokeWidth: number;
  splashScreenBgStrokeWidth: number;
  splashScreenUpdateMilliseconds: number;
  splashScreenUpdateSteps: number;
}

interface SettingsStore {
  permanent: SaveAppSettings;
  runtime: AppSettings;
  ui: UiSettings;
  theme: myTheme;

  setPermanent: (settings: Partial<SaveAppSettings>) => void;
  setRuntime: (settings: Partial<AppSettings>) => void;
  setTheme: (theme: myTheme) => void;
  toggleTheme: () => void;
  loadSettings: () => Promise<void>;
}

// DEFAULTS
const defaultPermanent: SaveAppSettings = {
  isDarkMode: true,
  language: 'en',
  trimLine: false,
  trimParts: false,
  fontSize: 'text-sm',
  showLineNumbers: false,
  showEmptyLines: false,
  savedPatterns: [],
};

const defaultRuntime: AppSettings = {
  processingMode: isTauri() ? 'backend' : 'fallback',
  multipleSeparators: false,
  useRegex: false,
  autoSplit: false,
  separator: '_',
  combineSeparator: ':',
};

const defaultUi: UiSettings = {
  appName: 'my Split Tool',
  appVersion: 'v2.0.0 Beta',
  appDefaultPage: 'split',

  // Left Menu
  leftMenuToggleIconSize: '24',
  leftMenuButtonsIconSize: '24',
  leftMenuWidthClosed: '56px',
  leftMenuWidthOpened: '240px',
  leftMenuIconLeftPadding: '13px',
  leftMenuTextLeftPadding: '16px',

  // Splash Screen
  splashScreenLoadingText: 'Loading',
  splashScreenStrokeWidth: 8,
  splashScreenBgStrokeWidth: 3,
  splashScreenUpdateMilliseconds: 40, // 40,
  splashScreenUpdateSteps: 2,
};

// STORE
export const useSettings = create<SettingsStore>((set, get) => ({
  permanent: defaultPermanent,
  runtime: defaultRuntime,
  ui: defaultUi,
  theme: dark,

  setPermanent: (newSettings) => {
    const updated = { ...get().permanent, ...newSettings };
    set({ permanent: updated });
    invoke('set_settings', { newsettings: updated }).catch(console.error);
  },

  setRuntime: (newSettings) => {
    set((state) => ({ runtime: { ...state.runtime, ...newSettings } }));
  },

  setTheme: (newTheme) => {
    document.documentElement.setAttribute('data-theme', newTheme.title);
    set({ theme: newTheme });
    if (get().permanent.isDarkMode !== newTheme.isDark)
      get().setPermanent({ isDarkMode: newTheme.isDark });
  },

  toggleTheme: () => {
    const next = get().theme.getNextTheme();
    get().setTheme(next);
  },

  loadSettings: async () => {
    try {
      const saved = await invoke<SaveAppSettings>('get_settings');
      if (saved) {
        set((state) => ({ permanent: { ...state.permanent, ...saved } }));
        const themeToApply = saved.isDarkMode ? dark : dark.getNextTheme();
        get().setTheme(themeToApply);
      }
    } catch (err) {
      console.warn('⚠️ Could not load settings:', err);
    }
  },
}));

// --- Typzuordnungen ---
type RuntimeTypeMap = {
  processingMode: processModes;
  multipleSeparators: boolean;
  useRegex: boolean;
  autoSplit: boolean;
  separator: string;
  combineSeparator: string;
};

type PermanentTypeMap = {
  isDarkMode: boolean;
  language: language;
  trimLine: boolean;
  trimParts: boolean;
  fontSize: fontSize;
  showLineNumbers: boolean;
  showEmptyLines: boolean;
  savedPatterns: string[];
};

// --- Runtime Getter & Setter ---
export function setRuntimeSetting<K extends keyof RuntimeTypeMap>(key: K, value: RuntimeTypeMap[K]) {
  useSettings.setState((state) => ({
    runtime: {
      ...state.runtime,
      [key]: value,
    },
  }));
}

export function getRuntimeSetting<K extends keyof RuntimeTypeMap>(key: K): RuntimeTypeMap[K] {
  return useSettings.getState().runtime[key];
}

// --- Permanent Getter & Setter ---
export function setPermanentSetting<K extends keyof PermanentTypeMap>(key: K, value: PermanentTypeMap[K]) {
  // useSettings.setState((state) => ({ permanent: { ...state.permanent, [key]: value } }));
  useSettings.getState().setPermanent({ [key]: value });
}

export function getPermanentSetting<K extends keyof PermanentTypeMap>(key: K): PermanentTypeMap[K] {
  return useSettings.getState().permanent[key];
}

// --- React Hook Varianten ---
export function useRuntimeSetting<K extends keyof RuntimeTypeMap>(key: K): RuntimeTypeMap[K] {
  return useSettings((state) => state.runtime[key]);
}

export function usePermanentSetting<K extends keyof PermanentTypeMap>(key: K): PermanentTypeMap[K] {
  return useSettings((state) => state.permanent[key]);
}
