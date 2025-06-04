export default function changeResultType<T extends AllowedResultTypes>(
  myresult: myResult,
  defaultValue: T | null = null
): Result<T, Error> {
  const outType = myresult.type;
  const data = myresult.result;

  try {
    // falls der Typ bereits passt

    if (outType === 'TextV2') return { status: 'ok', data: myresult.result as T };

    if (!isStringArray(data) && outType === 'Text') return { status: 'ok', data: myresult.result as T };
    if (isStringArray(data) && !isStringArrayArray(data) && outType === 'Column')
      return { status: 'ok', data: myresult.result as T };
    if (isStringArrayArray(data) && outType === 'ColumnList') return { status: 'ok', data: myresult.result as T };

    if (
      (data as ProcessedText<string>) ||
      (data as { result_text: string; removed_lines: number } as ProcessedText<string>)
    ) {
      return { status: 'ok', data: myresult.result as T };
    } else if (isStringArrayArray(data)) {
    } else if (isStringArray(data)) {
    } else if (typeof data === 'string' && !Array.isArray(data)) {
    }

    switch (outType) {
      case 'Text': // date => string
        if (Array.isArray({} as T)) return { status: 'ok', data: (defaultValue as string)?.split('\n') as T }; // to string[]
        break;

      case 'Column': // date => string[]
        if (isStringArray(defaultValue)) {
          if (typeof ({} as T) === 'string')
            return { status: 'ok', data: (defaultValue as string[])?.join('\n') as T }; // to string
          else if (Array.isArray({} as T))
            return { status: 'ok', data: (defaultValue as string[])?.map((c) => c.split('\n')) as T }; // to string[][]
        }
        break;

      case 'ColumnList': // date => string[][]
        if (isStringArrayArray(defaultValue)) {
          if (Array.isArray({} as T))
            return {
              status: 'ok',
              data: (defaultValue as string[][]).reduce((acc, cur) => acc.concat(cur), []) as T,
            };
          // to string[]
          else if (typeof ({} as T) === 'string')
            return {
              status: 'ok',
              data: (defaultValue as string[][]).reduce((acc, cur) => acc.concat(cur), []).join('\n') as T,
            }; // to string
        }
        break;

      // default:
      //   throw new Error(`Konvertierung von Typ zu ${typeof ({} as T)} nicht unterstützt.`);
    }
  } catch (error) {
    return { status: 'error', error: error as Error };
  }

  return { status: 'ok', data: defaultValue || ({} as T) };
}

function isStringArray(data: unknown): data is string[] {
  return Array.isArray(data) && data.every((item) => typeof item === 'string');
}

function isStringArrayArray(data: unknown): data is string[][] {
  return Array.isArray(data) && data.every(isStringArray);
}
