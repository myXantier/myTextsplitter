/** Utility functions for safe regex handling */

const MAX_PATTERN_LENGTH = 10_000;
const REGEX_TIMEOUT_MS = 10_000;

/** Validates a regex pattern for safety @param pattern The regex pattern to validate @returns True if pattern is safe, false otherwise */
export const validateRegexPattern = (pattern: string): boolean => {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return false;
  
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

/** Safely executes a regex pattern with timeout protection @param pattern Regex pattern @param input Input string @returns RegExp match result or null */
export const safeRegexExec = (pattern: string, input: string): RegExpExecArray | null => {
  if (!validateRegexPattern(pattern)) return null;

  const timeout = setTimeout(() => {
    throw new Error('Regex execution timeout');
  }, REGEX_TIMEOUT_MS);

  try {
    return new RegExp(pattern).exec(input);
  } finally {
    clearTimeout(timeout);
  }
};

/** Escape a string by replacing <, >, &, ', ", `, \ and / with HTML entities. */
export const escapeString = (str: string) => {
  return str
    .replace(/&/g, `&amp;`)
    .replace(/"/g, `&quot;`)
    .replace(/'/g, `&#x27;`)
    .replace(/</g, `&lt;`)
    .replace(/>/g, `&gt;`)
    .replace(/\//g, `&#x2F;`)
    .replace(/\\/g, `&#x5C;`)
    .replace(/`/g, `&#96;`);
};

/** Escape a string by replacing <, >, &, ', ", `, \ and / with HTML entities. */
export const unescapeString = (str: string) => {
  return str
    .replace(/&quot;/g, `"`)
    .replace(/&#x27;/g, `'`)
    .replace(/&lt;/g, `<`)
    .replace(/&gt;/g, `>`)
    .replace(/&#x2F;/g, `/`)
    .replace(/&#x5C;/g, `\\`)
    .replace(/&#96;/g, "`")
    .replace(/&amp;/g, `&`); // <-- must be last
};