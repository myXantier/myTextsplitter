import React, { useContext, useMemo } from 'react';
import { myTheme } from '../../Themes';

type ThemeFn = (outerTheme?: myTheme | undefined) => myTheme;
type ThemeArgument = myTheme | ThemeFn;

interface ThemeProviderProps {
  children?: React.ReactNode;
  theme: ThemeArgument;
};

export const ThemeContext = React.createContext<myTheme | undefined>(undefined);

export const ThemeConsumer = ThemeContext.Consumer;

function isFunction(test: any): test is Function {
  return typeof test === 'function';
}

function mergeTheme(theme: ThemeArgument, outerTheme?: myTheme | undefined): myTheme {
  if (!theme) {
    throw new Error('ThemeProvider: "theme" prop is required.\n\n');
  }

  if (isFunction(theme)) {
    const themeFn = theme as ThemeFn;
    const mergedTheme = themeFn(outerTheme);

    if (
      process.env.NODE_ENV !== 'production' &&
      (mergedTheme === null || Array.isArray(mergedTheme) || typeof mergedTheme !== 'object')
    ) {
      throw new Error(
        'ThemeProvider: Please return an object from your "theme" prop function, e.g.\n\n```js\ntheme={() => ({})}\n```\n\n'
      );
    }

    return mergedTheme;
  }

  if (Array.isArray(theme) || typeof theme !== 'object') {
    throw new Error('ThemeProvider: Please make your "theme" prop an object.\n\n');
  }

  return outerTheme ? { ...outerTheme, ...theme } : theme;
}

/**
 * Returns the current theme (as provided by the closest ancestor `ThemeProvider`.)
 *
 * If no `ThemeProvider` is found, the function will error. If you need access to the theme in an
 * uncertain composition scenario, `React.useContext(ThemeContext)` will not emit an error if there
 * is no `ThemeProvider` ancestor.
 */
export function useTheme(): myTheme {
  const theme = useContext(ThemeContext);

  if (!theme) {
    throw new Error('ThemeProvider: Please make sure your useTheme hook is within a `<ThemeProvider>`');
  }

  return theme;
}

/**
 * Provide a theme to an entire react component tree via context
 */
export default function ThemeProvider(props: ThemeProviderProps) {
  const outerTheme = React.useContext(ThemeContext);
  const themeContext = useMemo(() => mergeTheme(props.theme, outerTheme), [props.theme, outerTheme]);

  if (!props.children) {
    return null;
  }

  return <ThemeContext.Provider value={themeContext}>{props.children}</ThemeContext.Provider>;
}
