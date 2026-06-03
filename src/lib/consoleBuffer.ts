/**
 * Ring buffer that captures the last N console log entries.
 * Patches console methods on first import so all subsequent logs are recorded.
 * Used by the bug reporter to attach recent log context to reports.
 */

export type LogEntry = {
  level: 'log' | 'info' | 'warn' | 'error';
  ts: number;
  msg: string;
};

const MAX_ENTRIES = 50;
const buffer: LogEntry[] = [];
let installed = false;

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ')
    .slice(0, 400); // cap each entry
}

function push(level: LogEntry['level'], args: unknown[]) {
  buffer.push({ level, ts: Date.now(), msg: format(args) });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

export function installConsoleBuffer(): void {
  if (installed) return;
  installed = true;
  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    push('log', args);
    origLog(...args);
  };
  console.info = (...args: unknown[]) => {
    push('info', args);
    origInfo(...args);
  };
  console.warn = (...args: unknown[]) => {
    push('warn', args);
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    push('error', args);
    origError(...args);
  };
}

export function getRecentLogs(count = 30): LogEntry[] {
  return buffer.slice(-count);
}
