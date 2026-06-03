const SIGNALING_HTTP =
  (import.meta as unknown as { env?: { VITE_SIGNALING_URL?: string } }).env
    ?.VITE_SIGNALING_URL?.replace(/^wss:/i, 'https:')
    ?.replace(/\/?$/, '') ?? 'https://meet-sig.jcseo.workers.dev';

const PASSWORD_KEY = 'adminPassword';

export function getStoredPassword(): string | null {
  return localStorage.getItem(PASSWORD_KEY);
}

export function setStoredPassword(password: string): void {
  localStorage.setItem(PASSWORD_KEY, password);
}

export function clearStoredPassword(): void {
  localStorage.removeItem(PASSWORD_KEY);
}

export async function verifyPassword(password: string): Promise<boolean> {
  try {
    const resp = await fetch(`${SIGNALING_HTTP}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export type BugReportRecord = {
  id: string;
  ts: number;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  appVersion: string;
  os: string;
  arch?: string;
  locale?: string;
  userAgent?: string;
  tz?: string;
  roomCodeMasked?: string;
  participantCount?: number;
  details?: Record<string, unknown>;
  userDescription?: string;
  logs?: Array<{ level: string; ts: number; msg: string }>;
  read?: boolean;
};

export async function fetchBugs(
  password: string,
  limit = 50,
  offset = 0
): Promise<{ reports: BugReportRecord[]; unread: number; total: number } | null> {
  try {
    const resp = await fetch(`${SIGNALING_HTTP}/api/bugs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, limit, offset }),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as {
      reports: BugReportRecord[];
      unread: number;
      total: number;
    };
  } catch {
    return null;
  }
}

export async function markBugAction(
  password: string,
  id: string,
  action: 'read' | 'delete'
): Promise<boolean> {
  try {
    const resp = await fetch(`${SIGNALING_HTTP}/api/bugs/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, action }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Auto-diagnose a bug report based on patterns. Returns a hint string
 * or undefined if no specific pattern matched.
 */
export function autoDiagnose(r: BugReportRecord): string | undefined {
  if (r.type === 'webrtc-failed') {
    const d = r.details as
      | {
          candidateTypes?: string[];
          relayAvailable?: boolean;
          iceState?: string;
        }
      | undefined;
    if (d?.relayAvailable === false) {
      return '⚠️ relay 후보 없음 → TURN 서버가 필요합니다 (P2P 직접 연결이 ISP/방화벽에서 차단됨).';
    }
    if (d?.iceState === 'failed') {
      return '⚠️ ICE 연결 실패 → 네트워크 경로 차단 또는 TURN 서버 필요.';
    }
  }
  if (r.type === 'permission-denied' || /permission/i.test(r.message)) {
    return '💡 Windows 마이크/카메라 권한 차단 가능성. 사용자에게 권한 설정 안내 필요.';
  }
  if (/NotReadableError/i.test(r.message)) {
    return '💡 다른 프로그램(Zoom/Teams 등)이 마이크를 점유 중. 그 앱 종료 안내.';
  }
  if (/NotAllowedError/i.test(r.message)) {
    return '💡 사용자가 마이크 권한을 거부. 브라우저/OS 권한 재설정 필요.';
  }
  if (r.type === 'screen-share-failed') {
    return '💡 Windows 화면 캡처 권한 차단 가능성.';
  }
  if (r.type === 'update-failed') {
    return '💡 GitHub Releases 접근 불가 (방화벽?) 또는 디스크 용량 부족.';
  }
  return undefined;
}
