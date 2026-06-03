import { getRecentLogs, installConsoleBuffer } from './consoleBuffer';

const SIGNALING_HTTP =
  (import.meta as unknown as { env?: { VITE_SIGNALING_URL?: string } }).env
    ?.VITE_SIGNALING_URL?.replace(/^wss:/i, 'https:')
    ?.replace(/\/?$/, '') ?? 'https://meet-sig.jcseo.workers.dev';

const REPORT_URL = `${SIGNALING_HTTP}/api/report`;

export type ReportType =
  | 'webrtc-failed'
  | 'webrtc-disconnected'
  | 'js-error'
  | 'unhandled-rejection'
  | 'permission-denied'
  | 'screen-share-failed'
  | 'file-transfer-failed'
  | 'update-failed'
  | 'manual'
  | 'feedback'
  | 'other';

export type FeedbackCategory =
  | 'feature-add'
  | 'improvement'
  | 'usability'
  | 'other';

export type ReportSeverity = 'critical' | 'warning' | 'info';

export type BugReportInput = {
  type: ReportType;
  severity?: ReportSeverity;
  message: string;
  details?: Record<string, unknown>;
  userDescription?: string;
  roomCode?: string;
  participantCount?: number;
  /** Used when type === 'feedback' */
  feedbackCategory?: FeedbackCategory;
  /** Used when type === 'feedback' or 'manual' */
  submitterName?: string;
};

// Throttle: prevent same error spam. Map of fingerprint → last sent ts.
const RECENT_SEND_WINDOW_MS = 60_000;
const sentFingerprints = new Map<string, number>();

let initialized = false;
let reportingInFlight = false;

function fingerprint(r: BugReportInput): string {
  return `${r.type}|${r.message.slice(0, 100)}`;
}

function shouldSkip(r: BugReportInput): boolean {
  const fp = fingerprint(r);
  const last = sentFingerprints.get(fp);
  if (last && Date.now() - last < RECENT_SEND_WINDOW_MS) {
    return true;
  }
  sentFingerprints.set(fp, Date.now());
  return false;
}

function maskRoomCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (code.length <= 2) return code;
  return code.slice(0, 2) + '*'.repeat(code.length - 2);
}

function detectOs(): { name: string; arch: string; locale: string } {
  const ua = navigator.userAgent;
  let name = 'Unknown';
  if (/Windows NT 10/.test(ua)) name = 'Windows 10/11';
  else if (/Windows NT/.test(ua)) name = 'Windows (older)';
  else if (/Mac OS X/.test(ua)) name = 'macOS';
  else if (/Linux/.test(ua)) name = 'Linux';
  const arch = /x64|Win64|x86_64/.test(ua) ? 'x64' : /arm|ARM/.test(ua) ? 'arm' : 'unknown';
  const locale = navigator.language || 'unknown';
  return { name, arch, locale };
}

export async function sendBugReport(r: BugReportInput): Promise<boolean> {
  if (reportingInFlight && r.type !== 'manual') {
    // Avoid stampede; skip auto reports during in-flight one.
    return false;
  }
  if (shouldSkip(r)) return false;

  reportingInFlight = true;
  try {
    const os = detectOs();
    const defaultSeverity: ReportSeverity =
      r.type === 'manual' || r.type === 'feedback' ? 'info' : 'critical';
    const payload = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      type: r.type,
      severity: r.severity ?? defaultSeverity,
      message: r.message.slice(0, 500),
      appVersion: __APP_VERSION__,
      os: os.name,
      arch: os.arch,
      locale: os.locale,
      userAgent: navigator.userAgent.slice(0, 300),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      roomCodeMasked: maskRoomCode(r.roomCode),
      participantCount: r.participantCount,
      details: r.details,
      userDescription: r.userDescription,
      feedbackCategory: r.feedbackCategory,
      submitterName: r.submitterName,
      // Feedback doesn't need console logs (it's user content, not error).
      logs: r.type === 'feedback' ? [] : getRecentLogs(20),
    };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const resp = await fetch(REPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      return resp.ok;
    } finally {
      clearTimeout(t);
    }
  } catch {
    // Don't loop: if reporter itself fails, swallow.
    return false;
  } finally {
    reportingInFlight = false;
  }
}

export function initBugReporter(): void {
  if (initialized) return;
  initialized = true;
  installConsoleBuffer();

  window.addEventListener('error', (ev: ErrorEvent) => {
    // Skip script load errors from extensions etc.
    if (!ev.message) return;
    void sendBugReport({
      type: 'js-error',
      severity: 'critical',
      message: ev.message,
      details: {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        stack:
          ev.error && ev.error instanceof Error
            ? ev.error.stack?.slice(0, 1500)
            : undefined,
      },
    });
  });

  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev.reason;
    let message = 'Unhandled rejection';
    let stack: string | undefined;
    if (reason instanceof Error) {
      message = `${reason.name}: ${reason.message}`;
      stack = reason.stack?.slice(0, 1500);
    } else if (typeof reason === 'string') {
      message = reason;
    } else {
      try {
        message = JSON.stringify(reason).slice(0, 200);
      } catch {
        message = String(reason);
      }
    }
    void sendBugReport({
      type: 'unhandled-rejection',
      severity: 'critical',
      message,
      details: { stack },
    });
  });
}
