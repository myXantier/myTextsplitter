import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: number;
  module?: string;
  details?: any;
  groupId?: string;
  expanded?: boolean;
}

export interface LogGroup {
  id: string;
  title: string;
  timestamp: number;
  collapsed: boolean;
  entries: LogEntry[];
}

// Log buffer to optimize performance
const LOG_BUFFER_SIZE = 1000;
const MAX_PERSISTENT_LOGS = 2000;

class DebugConsoleManager {
  private logs: LogEntry[] = [];
  private groups: Record<string, LogGroup> = {};
  private listeners: Set<(entries: LogEntry[]) => void> = new Set();
  private persistentStorage: Storage | null = null;
  private initialized = false;
  private bufferTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer: LogEntry[] = [];
  private currentGroupId: string | null = null;

  constructor() {
    // Initialize storage
    try {
      this.persistentStorage = localStorage;
      const savedLogs = localStorage.getItem('debug-console-logs');
      if (savedLogs) {
        const parsed = JSON.parse(savedLogs);
        if (Array.isArray(parsed)) {
          this.logs = parsed.slice(-MAX_PERSISTENT_LOGS);
        }
      }
    } catch (error) {
      console.error('Failed to initialize debug console storage:', error);
    }
  }

  public intercept() {
    if (this.initialized) return;

    const originalConsole = {
      log: console.log,
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
      group: console.group,
      groupCollapsed: console.groupCollapsed,
      groupEnd: console.groupEnd,
    };

    // Override console methods
    console.log = (...args) => {
      this.captureLog('info', args);
      originalConsole.log(...args);
    };

    console.debug = (...args) => {
      this.captureLog('debug', args);
      originalConsole.debug(...args);
    };

    console.info = (...args) => {
      this.captureLog('info', args);
      originalConsole.info(...args);
    };

    console.warn = (...args) => {
      this.captureLog('warn', args);
      originalConsole.warn(...args);
    };

    console.error = (...args) => {
      this.captureLog('error', args);
      originalConsole.error(...args);
    };

    console.group = (label: string) => {
      this.startGroup(label, false);
      originalConsole.group(label);
    };

    console.groupCollapsed = (label: string) => {
      this.startGroup(label, true);
      originalConsole.groupCollapsed(label);
    };

    console.groupEnd = () => {
      this.endGroup();
      originalConsole.groupEnd();
    };

    // Subscribe to global unhandled errors
    window.addEventListener('error', (event) => {
      this.captureLog('error', [`Unhandled Error: ${event.message}`, event.error]);
    });

    // Subscribe to global unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.captureLog('error', [`Unhandled Promise Rejection: ${event.reason}`]);
    });

    // Connect to Tauri backend logs
    if (typeof window !== 'undefined' && 'Tauri' in window) {
      this.subscribeTauriLogs().catch((error) => console.error('Failed to subscribe to Tauri logs:', error));
    }

    this.initialized = true;
  }

  private async subscribeTauriLogs() {
    try {
      await invoke('register_debug_console_handler');

      // Listen for backend log events
      await getCurrentWindow().listen('backend-log', (event: any) => {
        const { level, message, module } = event.payload;
        this.addEntry({
          id: crypto.randomUUID(),
          level: level as LogLevel,
          message: message,
          timestamp: Date.now(),
          module: module || 'backend',
          expanded: false,
        });
      });
    } catch (error) {
      console.error('Failed to subscribe to Tauri logs:', error);
    }
  }

  private startGroup(label: string, collapsed: boolean) {
    const groupId = crypto.randomUUID();
    this.groups[groupId] = {
      id: groupId,
      title: label,
      timestamp: Date.now(),
      collapsed,
      entries: [],
    };
    this.currentGroupId = groupId;
  }

  private endGroup() {
    this.currentGroupId = null;
  }

  private captureLog(level: LogLevel, args: unknown[]) {
    // Format message
    const message = args
      .map((arg) => {
        try {
          if (typeof arg === 'object' && arg !== null) {
            return JSON.stringify(arg);
          }
          return String(arg);
        } catch (error) {
          return `[Unserializable Object]: ${Object.prototype.toString.call(arg)}`;
        }
      })
      .join(' ');

    // Create log entry
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      level,
      message,
      timestamp: Date.now(),
      details: args.length > 1 ? args.slice(1) : null,
      groupId: this.currentGroupId || undefined,
      expanded: false,
    };

    // Add to current group if applicable
    if (this.currentGroupId && this.groups[this.currentGroupId]) {
      this.groups[this.currentGroupId].entries.push(entry);
    }

    this.addEntry(entry);
  }

  private addEntry(entry: LogEntry) {
    // Add to buffer for performance
    this.buffer.push(entry);

    // Flush buffer if it gets too large or set timer for delayed flush
    if (this.buffer.length >= 20) {
      this.flushBuffer();
    } else if (!this.bufferTimer) {
      this.bufferTimer = setTimeout(() => this.flushBuffer(), 100);
    }
  }

  private flushBuffer() {
    if (this.buffer.length === 0) return;

    // Add buffered logs to main logs array
    this.logs = [...this.logs, ...this.buffer];

    // Trim logs if needed
    if (this.logs.length > LOG_BUFFER_SIZE) {
      this.logs = this.logs.slice(-LOG_BUFFER_SIZE);
    }

    // Save to persistent storage
    this.persistLogs();

    // Notify listeners
    this.notifyListeners([...this.buffer]);

    // Clear buffer
    this.buffer = [];
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
  }

  private persistLogs() {
    if (!this.persistentStorage) return;

    try {
      // Only persist the most recent logs to avoid storage issues
      const logsToSave = this.logs.slice(-MAX_PERSISTENT_LOGS);
      this.persistentStorage.setItem('debug-console-logs', JSON.stringify(logsToSave));
    } catch (error) {
      console.error('Failed to persist logs:', error);
    }
  }

  public getLogs(options?: { level?: LogLevel | LogLevel[]; search?: string; limit?: number }): LogEntry[] {
    // Flush any pending logs
    if (this.buffer.length > 0) {
      this.flushBuffer();
    }

    let filteredLogs = [...this.logs];

    // Filter by level
    if (options?.level) {
      const levels = Array.isArray(options.level) ? options.level : [options.level];
      filteredLogs = filteredLogs.filter((log) => levels.includes(log.level));
    }

    // Filter by search text
    if (options?.search) {
      const searchText = options.search.toLowerCase();
      filteredLogs = filteredLogs.filter(
        (log) =>
          log.message.toLowerCase().includes(searchText) ||
          (log.module && log.module.toLowerCase().includes(searchText))
      );
    }

    // Apply limit
    if (options?.limit && options.limit > 0) {
      filteredLogs = filteredLogs.slice(-options.limit);
    }

    return filteredLogs;
  }

  public clear() {
    this.logs = [];
    this.groups = {};
    this.buffer = [];

    if (this.persistentStorage) {
      this.persistentStorage.removeItem('debug-console-logs');
    }

    this.notifyListeners([]);
  }

  public subscribe(callback: (entries: LogEntry[]) => void) {
    this.listeners.add(callback);

    // Initial callback with current logs
    if (this.logs.length > 0) {
      callback([...this.logs]);
    }

    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(entries: LogEntry[]) {
    this.listeners.forEach((listener) => {
      try {
        listener(entries);
      } catch (error) {
        console.error('Error in debug console listener:', error);
      }
    });
  }

  public getGroups() {
    return { ...this.groups };
  }

  public toggleLogExpand(logId: string) {
    const log = this.logs.find((l) => l.id === logId);
    if (log) {
      log.expanded = !log.expanded;
      this.notifyListeners([log]);
    }
  }

  public toggleGroupCollapse(groupId: string) {
    const group = this.groups[groupId];
    if (group) {
      group.collapsed = !group.collapsed;
      this.notifyListeners(group.entries);
    }
  }

  public exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const debugConsole = new DebugConsoleManager();
