import React, { useCallback, useRef, useEffect, useState } from 'react';
import { VariableSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { debounceMini } from '../../utils/debounce';
import './styles/VirtualizedTextAreaStyle.css';


interface VirtualizedTextAreaProps {
  lines: string[];
  onChange?: (lines: string[]) => void;
  onFocus?: () => void;
  readOnly?: boolean;
  fontSize: fontSize;
  isDarkMode: boolean;
  showLineNumbers?: boolean;
  className?: string;
}

export function VirtualizedTextArea({
  lines,
  onChange,
  onFocus,
  readOnly = false,
  fontSize,
  isDarkMode,
  showLineNumbers = false,
  className = '',
}: VirtualizedTextAreaProps) {
  const listRef = useRef<List>(null);
  const [mounted, setMounted] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [cursorPosition, setCursorPosition] = useState<number | null>(null);
  const inputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({});

  const getItemSize = useCallback(
    (_: number) => {
      switch (fontSize) {
        case 'text-xs':
          return 18;
        case 'text-sm':
          return 20;
        case 'text-base':
          return 24;
        case 'text-lg':
          return 28;
        default:
          return 20;
      }
    },
    [fontSize]
  );

  const debouncedResetAfterIndex = useCallback(
    debounceMini((index: number) => {
      if (listRef.current) {
        listRef.current.resetAfterIndex(index);
      }
    }, 100),
    []
  );

  const Row = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const line = lines[index];

      return (
        <div style={style} className="virtualized-row">
          {showLineNumbers && (
            <div className="line-number">
              {index + 1}
            </div>
          )}
          <input
            ref={(el) => {
              inputRefs.current[index] = el;
              if (focusedIndex === index && el) {
                el.focus();
                const position = cursorPosition ?? el.value.length;
                el.setSelectionRange(position, position);
              }
            }}
            type="text"
            value={line}
            onChange={(e) => {
              if (onChange && !readOnly) {
                const newPosition = e.target.selectionStart;
                const newLines = [...lines];
                newLines[index] = e.target.value;
                setCursorPosition(newPosition);
                onChange(newLines);
                debouncedResetAfterIndex(index);
              }
            }}
            onFocus={(e) => {
              setFocusedIndex(index);
              onFocus?.();
              if (cursorPosition === null) {
                setCursorPosition(e.target.selectionStart);
              }
            }}
            onBlur={() => {
              setFocusedIndex(null);
              setCursorPosition(null);
            }}
            readOnly={readOnly}
            className={`virtualized-input ${fontSize}`}
            style={{ marginLeft: showLineNumbers ? '32px' : '0' }}
          />
        </div>
      );
    },
    [
      lines,
      onChange,
      readOnly,
      fontSize,
      isDarkMode,
      showLineNumbers,
      focusedIndex,
      cursorPosition,
      onFocus,
      debouncedResetAfterIndex,
    ]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && listRef.current) {
      debouncedResetAfterIndex(0);
    }
  }, [fontSize, mounted, debouncedResetAfterIndex]);

  return (
    <div className={`virtualized-container ${className}`}>
      <AutoSizer>
        {({ height, width }) => (
          <List
            ref={listRef}
            height={height}
            itemCount={lines.length}
            itemSize={getItemSize}
            width={width}
            className="virtualized-list"
          >
            {Row}
          </List>
        )}
      </AutoSizer>
    </div>
  );
}