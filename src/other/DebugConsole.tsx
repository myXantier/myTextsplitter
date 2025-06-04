import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { debugConsole, LogEntry, LogLevel } from './debugConsole';
import {
  X,
  Search,
  Copy,
  Trash2,
  ChevronDown,
  ChevronUp,
  Filter,
  Download,
  Maximize2,
  Minimize2,
  AlertCircle,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useSettings } from '../hooks/useSettings';
import { VariableSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import './styles/DebugConsoleStyle.css';

interface DebugConsoleProps {
  visible?: boolean;
  height?: number;
  shortcutKey?: string;
}

export function DebugConsole({ visible = false, height = 300, shortcutKey = 'F12' }: DebugConsoleProps) {
  // Initialize console
  useEffect(() => {
    debugConsole.intercept();
  }, []);

  const { theme } = useSettings();
  const [isVisible, setIsVisible] = useState<boolean>(visible);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [filterLevel, setFilterLevel] = useState<LogLevel | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const consoleRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<VariableSizeList>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isAutoScrollRef = useRef<boolean>(true);

  // Toggle keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === shortcutKey && !e.shiftKey && !e.ctrlKey && !e.altKey) ||
        (e.altKey && e.key.toLowerCase() === 'c')
      ) {
        setIsVisible((prev) => !prev);
        e.preventDefault();
      }

      // Ctrl+F focuses search when console is visible
      if (isVisible && e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcutKey, isVisible]);

  // Subscribe to log updates
  useEffect(() => {
    const unsubscribe = debugConsole.subscribe((newLogs) => {
      setLogs((prev) => [...prev, ...newLogs]);

      // Auto-scroll to bottom
      if (isAutoScrollRef.current && listRef.current && sortDirection === 'asc') {
        requestAnimationFrame(() => {
          listRef.current?.scrollToItem(logs.length + newLogs.length - 1);
        });
      }
    });

    // Initial load
    setLogs(debugConsole.getLogs());

    return unsubscribe;
  }, []);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    let filtered = [...logs];

    // Filter by level
    if (filterLevel !== 'all') {
      filtered = filtered.filter((log) => log.level === filterLevel);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (log) => log.message.toLowerCase().includes(query) || (log.module && log.module.toLowerCase().includes(query))
      );
    }

    // Sort logs
    return filtered.sort((a, b) => {
      if (sortDirection === 'asc') {
        return a.timestamp - b.timestamp;
      } else {
        return b.timestamp - a.timestamp;
      }
    });
  }, [logs, filterLevel, searchQuery, sortDirection]);

  // Item size calculator for virtualized list
  const getItemSize = useCallback(
    (index: number) => {
      const log = filteredLogs[index];
      if (!log) return 36;

      // Base height for a log entry
      let height = 36;

      // Add more height for expanded entries with details
      if (expandedLogs.has(log.id) && log.details) {
        const detailsStr = typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2);

        const lines = (detailsStr?.split('\n')?.length || 0) + 1;
        height += Math.min(300, lines * 21); // Limit height while allowing scrolling
      }

      return height;
    },
    [filteredLogs, expandedLogs]
  );

  // Toggle expanded state of a log entry
  const toggleExpand = useCallback((id: string) => {
    setExpandedLogs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }

      // Need to reset the list to recalculate sizes
      setTimeout(() => {
        if (listRef.current) {
          listRef.current.resetAfterIndex(0);
        }
      }, 0);

      return newSet;
    });
  }, []);

  // Clear all logs
  const clearLogs = () => {
    debugConsole.clear();
    setLogs([]);
    setExpandedLogs(new Set());
  };

  // Copy logs to clipboard
  const copyLogs = useCallback(() => {
    const logsText = filteredLogs
      .map((log) => `[${new Date(log.timestamp).toLocaleTimeString()}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');

    navigator.clipboard
      .writeText(logsText)
      .then(() => console.info('Logs copied to clipboard'))
      .catch((err) => console.error('Failed to copy logs', err));
  }, [filteredLogs]);

  // Export logs to file
  const exportLogs = useCallback(() => {
    const json = debugConsole.exportLogs();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-logs-${new Date().toISOString().slice(0, 19).replace('T', '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Toggle sorting direction
  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  // Auto-scroll toggle
  const toggleAutoScroll = () => {
    isAutoScrollRef.current = !isAutoScrollRef.current;
    if (isAutoScrollRef.current && sortDirection === 'asc' && listRef.current) {
      listRef.current.scrollToItem(filteredLogs.length - 1);
    }
  };

  // Render single log entry
  const renderLog = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const log = filteredLogs[index];
    if (!log) return null;

    const isExpanded = expandedLogs.has(log.id);

    // Icon based on log level
    const LogIcon = log.level === 'error' ? AlertCircle : log.level === 'warn' ? AlertTriangle : Info;

    return (
      <div className={`log-entry ${log.level}`} style={style}>
        <div className="log-header" onClick={() => toggleExpand(log.id)}>
          <div className="log-icon">
            <LogIcon size={14} />
          </div>
          <span className="log-timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
          {log.module && <span className="log-module">{log.module}</span>}
          <span className="log-message">{log.message}</span>

          {log.details && (
            <button className="expand-button">
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>

        {isExpanded && log.details && (
          <div className="log-details">
            <pre>{typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  };

  if (!isVisible) return null;

  return (
    <div
      ref={consoleRef}
      className={`debug-console ${isMaximized ? 'maximized' : ''} ${theme.isDark ? 'theme-dark' : 'theme-light'}`}
      style={{ height: isMaximized ? '100vh' : height }}
    >
      <div className="debug-console-header">
        <div className="debug-console-title">
          <span>Debug Console</span>
          <span className="log-count">{filteredLogs.length} logs</span>
        </div>

        <div className="debug-console-controls">
          <div className="search-box">
            <Search size={14} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs..."
              className="search-input"
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="filter-controls">
            <div className="level-selector">
              <Filter size={14} />
              <select
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value as LogLevel | 'all')}
                className="level-select"
              >
                <option value="all">All Levels</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
            </div>

            <button className="control-button" title="Toggle sort order" onClick={toggleSortDirection}>
              {sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            <button
              className={`control-button ${isAutoScrollRef.current ? 'active' : ''}`}
              title={`Auto-scroll ${isAutoScrollRef.current ? 'enabled' : 'disabled'}`}
              onClick={toggleAutoScroll}
            >
              <ChevronDown size={14} />
            </button>
          </div>

          <div className="action-buttons">
            <button className="control-button" title="Copy logs" onClick={copyLogs}>
              <Copy size={14} />
            </button>
            <button className="control-button" title="Export logs as JSON" onClick={exportLogs}>
              <Download size={14} />
            </button>
            <button className="control-button" title="Clear logs" onClick={clearLogs}>
              <Trash2 size={14} />
            </button>
            <button
              className="control-button"
              title={isMaximized ? 'Minimize' : 'Maximize'}
              onClick={() => setIsMaximized(!isMaximized)}
            >
              {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button className="control-button close" title="Close console" onClick={() => setIsVisible(false)}>
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="debug-console-content">
        {filteredLogs.length > 0 ? (
          <AutoSizer>
            {({ height, width }) => (
              <VariableSizeList
                ref={listRef}
                height={height}
                width={width}
                itemCount={filteredLogs.length}
                itemSize={getItemSize}
                overscanCount={5}
              >
                {renderLog}
              </VariableSizeList>
            )}
          </AutoSizer>
        ) : (
          <div className="no-logs">
            <div className="no-logs-message">
              {searchQuery || filterLevel !== 'all' ? 'No logs match your current filters' : 'No logs yet'}
            </div>
            <div className="no-logs-hint">
              Use <code>window.logger.debug()</code>, <code>window.logger.info()</code>,
              <code>window.logger.warn()</code>, or <code>window.logger.error()</code> to log messages
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
