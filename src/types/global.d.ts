declare interface Window {
  __TAURI__?: any;
  // currentOS: string | OsType;
  // logger: Logger;
  // myResultConverter: <T extends AllowedResultTypes>(
  //   myresult: myResult,
  //   defaultValue?: T
  // ) => Result<T, Error>;
}

type OsType = 'windows' | 'linux' | 'mac' | 'zero';
type TabType = 'split' | 'diff' | 'remove' | 'filter';


interface Item<T extends string = string> {
  label: string;
  value: T;
  index?: number;
}

interface SaveAppSettings {
  isDarkMode: boolean;
  language: string;
  trimLine: boolean;
  trimParts: boolean;
  fontSize: fontSize;
  showLineNumbers: boolean;
  showEmptyLines: boolean;
  savedPatterns: string[];
}

interface AppSettings {
  processingMode: processModes;
  multipleSeparators: boolean;
  useRegex: boolean;
  autoSplit: boolean;
  separator: string;
  combineSeparator: string;
}

interface Settings {
  permanent: SaveAppSettings;
  runtime: Omit<AppSettings, keyof SaveAppSettings>;
  setPermanent: (permanent: Partial<SaveAppSettings>) => void;
  setRuntime: (runtime: Partial<Omit<AppSettings, keyof SaveAppSettings>>) => void;
}

type Result<T, E> =
	| { status: "ok"; data: T }
	| { status: "error"; error: E };

type myResultDataType = null | 'Text' | 'Column' | 'ColumnList' | 'TextV2';
type myResultBrand = { __brand: 'myResult' };

interface myResultBase<T> extends myResultBrand {
  readonly type: myResultDataType;
  readonly result: T;
  readonly isNull: boolean;
  abort: boolean;
}


type myResultText = myResultBase<string> & { readonly type: 'Text' };
type myResultColumn = myResultBase<string[]> & { readonly type: 'Column' };
type myResultColumnList = myResultBase<string[][]> & { readonly type: 'ColumnList' };
type myResultTextV2 = myResultBase<ProcessedText> & { readonly type: 'TextV2' };

type myResult = myResultText | myResultColumn | myResultColumnList | myResultTextV2;

type AllowedResultTypes = string | ProcessedText | string[] | string[][];

type IsMyText<T extends AllowedResultTypes> = T extends string ? "Yes" : "No";


interface DiffResult {
  type: 'added' | 'removed' | 'moved' | 'unchanged';
  text: string;
  lineNumber: number;
}



type MyResultType<T> = T extends ProcessedText
  ? myResultTextV2
  : T extends string
  ? myResultText
  : T extends string[]
  ? myResultColumn
  : T extends string[][]
  ? myResultColumnList
  : never;


interface BackendMetrics {
    execution_time_ms: number,
    memory_usage_kb: number,
    memory_usage_str: string,
}

interface ProcessedText<T> {
    result_text: T,
    removed_lines: number,
    metrics: BackendMetrics,
}



interface ProcessedText {
  result_text: string;
  removed_lines: number;
}

interface BaseConfig {
  sourceText: string,
  mainParam: string,
  configParams: unknown | unknown[],
}

interface SplitConfig extends BaseConfig {
  configParams: {
    trimParts: boolean,
    useRegex: boolean
  };
}

interface DiffConfig extends BaseConfig {
  configParams: {
    caseSensitive: boolean,
    ignoreWhitespace: boolean
  };
}

interface FilterConfig extends BaseConfig {
  configParams: {
    caseSensitive: boolean,
    filterMode: string,
    splitMatches: boolean
  };
}

interface RemoveConfig extends BaseConfig {
  configParams: {
    caseSensitive: boolean,
    useRegex: boolean,
    trimParts: boolean,
    removeMode: string
  };
}


interface ProcessMetrics {
  executionTime: number;
  memoryUsage: number;
  inputSize: number;
  outputSize: number;
}

// make to Array:  const sizes: Array<fontSize> = ['text-sm', 'text-base', 'text-lg'];
type fontSize = 'text-xs' | 'text-sm' | 'text-base' | 'text-lg';
type processModes = 'backend' | 'fallback';
type messageType = 'success' | 'warning' | 'error' | 'info';
type logLevel = 'debug' | 'info' | 'warn' | 'error';
type language = 'en' | 'de';

const logColor = {
  info: 'color: blue; font-weight: bold',
  warn: 'color: orange; font-weight: bold;',
  error: 'color: red; font-weight: bold;',
}

interface ColumnSeparator {
  index: number;
  separator: string;
}

