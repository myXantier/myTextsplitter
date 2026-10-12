import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './platform.ts';
import type { SaveAppSettings } from '../hooks/useSettings';

/**
 * Persistence for the permanent settings.
 * Desktop: Rust backend (`get_settings` / `set_settings`), unchanged.
 * Browser: `localStorage`, same JSON shape as the desktop settings file.
 */

export const BROWSER_SETTINGS_KEY = 'mytextsplitter.settings';

/** Returns the valid value, or `undefined` if the stored value must be dropped. */
type Sanitizer<T> = (value: unknown) => T | undefined;

/** One sanitizer per key; `-?` makes the compiler enforce that every setting is covered. */
export type SettingsSchema<T> = { [K in keyof T]-?: Sanitizer<T[K]> };

const hasOwn = (obj: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, key);

const booleanValue: Sanitizer<boolean> = (value) => (typeof value === 'boolean' ? value : undefined);

/** Accepts only the keys of `allowed`; a `Record<T, true>` makes the list exhaustive at compile time. */
function oneOf<T extends string>(allowed: Record<T, true>): Sanitizer<T> {
  return (value) => (typeof value === 'string' && hasOwn(allowed, value) ? (value as T) : undefined);
}

/** Keeps the array but drops elements that are not strings (e.g. `null`, numbers, objects). */
const stringArray: Sanitizer<string[]> = (value) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

const languages: Record<language, true> = { en: true, de: true };
const fontSizes: Record<fontSize, true> = { 'text-xs': true, 'text-sm': true, 'text-base': true, 'text-lg': true };

export const permanentSettingsSchema: SettingsSchema<SaveAppSettings> = {
  isDarkMode: booleanValue,
  language: oneOf(languages),
  trimLine: booleanValue,
  trimParts: booleanValue,
  fontSize: oneOf(fontSizes),
  showLineNumbers: booleanValue,
  showEmptyLines: booleanValue,
  savedPatterns: stringArray,
};

function getBrowserStorage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    // Access can throw (e.g. blocked site data / privacy mode)
    return null;
  }
}

/** Keeps only known keys with valid values, so corrupt data cannot break the app. */
export function sanitizeSettings<T extends object>(raw: unknown, schema: SettingsSchema<T>): Partial<T> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const result: Partial<T> = {};
  for (const key of Object.keys(schema) as (keyof T)[]) {
    if (!hasOwn(raw, key)) continue;
    const value = schema[key]((raw as Record<keyof T, unknown>)[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function loadBrowserSettings<T extends object>(
  schema: SettingsSchema<T>,
  storage = getBrowserStorage()
): Partial<T> | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(BROWSER_SETTINGS_KEY);
    return stored ? sanitizeSettings(JSON.parse(stored), schema) : null;
  } catch (err) {
    console.warn('⚠️ Could not read browser settings:', err);
    return null;
  }
}

export function saveBrowserSettings<T extends object>(settings: T, storage = getBrowserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('⚠️ Could not save browser settings:', err);
  }
}

export async function loadPersistedSettings<T extends object>(schema: SettingsSchema<T>): Promise<Partial<T> | null> {
  if (isDesktop()) return invoke<T>('get_settings');
  return loadBrowserSettings(schema);
}

export async function savePersistedSettings<T extends object>(settings: T): Promise<void> {
  if (isDesktop()) return invoke('set_settings', { newsettings: settings });
  saveBrowserSettings(settings);
}
