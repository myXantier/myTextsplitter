import { matchesResultType, type ResultData, type ResultType } from '../services/ProcessingError';

type Converter = (data: never) => unknown;

/** Supported conversions `from -> to` (same type: no conversion, only validation). */
const CONVERSIONS: Partial<Record<ResultType, Partial<Record<ResultType, Converter>>>> = {
  Text: { Column: (data: string) => data.split('\n') },
  Column: {
    Text: (data: string[]) => data.join('\n'),
    // every entry is one column with '\n'-separated values
    ColumnList: (data: string[]) => data.map((column) => column.split('\n')),
  },
  ColumnList: {
    Column: (data: string[][]) => data.flat(),
    Text: (data: string[][]) => data.flat().join('\n'),
  },
};

/**
 * Returns the data of `myresult` as `target` type. The target is a runtime value (a generic type parameter
 * alone cannot be checked at runtime). The data is validated against its declared type and the converted
 * value against the target type; anything else (unknown type, wrong data, unsupported conversion) is an error.
 */
export default function changeResultType<K extends ResultType>(myresult: myResult, target: K): Result<ResultData[K], Error> {
  const source = myresult?.type;
  const data: unknown = myresult?.result;

  if (!source || !matchesResultType(source, data)) {
    return { status: 'error', error: new Error(`Invalid result: data does not match type ${String(source)}`) };
  }

  try {
    const converted = source === target ? data : CONVERSIONS[source]?.[target]?.(data as never);
    if (converted === undefined || !matchesResultType(target, converted)) {
      return { status: 'error', error: new Error(`Unsupported result conversion: ${source} -> ${target}`) };
    }
    return { status: 'ok', data: converted as ResultData[K] };
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error : new Error(String(error)) };
  }
}
