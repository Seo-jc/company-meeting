import { pickT } from '../i18n';

const SIGNALING_HTTP =
  (import.meta as unknown as { env?: { VITE_SIGNALING_URL?: string } }).env
    ?.VITE_SIGNALING_URL?.replace(/^wss:/i, 'https:')
    ?.replace(/\/?$/, '') ?? 'https://meet-sig.jcseo.workers.dev';

const STR = {
  ko: {
    countryKR: '🇰🇷 한국',
    countryVN: '🇻🇳 베트남',
    countryUS: '🇺🇸 미국',
    countryJP: '🇯🇵 일본',
    countryCN: '🇨🇳 중국',
    countryUnknown: '❔ 알 수 없음',
    diagNoRelay:
      '⚠️ relay 후보 없음 → TURN 서버가 필요합니다 (P2P 직접 연결이 ISP/방화벽에서 차단됨).',
    diagIceFailed: '⚠️ ICE 연결 실패 → 네트워크 경로 차단 또는 TURN 서버 필요.',
    diagPermissionDenied:
      '💡 Windows 마이크/카메라 권한 차단 가능성. 사용자에게 권한 설정 안내 필요.',
    diagNotReadable:
      '💡 다른 프로그램(Zoom/Teams 등)이 마이크를 점유 중. 그 앱 종료 안내.',
    diagNotAllowed: '💡 사용자가 마이크 권한을 거부. 브라우저/OS 권한 재설정 필요.',
    diagScreenShareFailed: '💡 Windows 화면 캡처 권한 차단 가능성.',
    diagUpdateFailed:
      '💡 GitHub Releases 접근 불가 (방화벽?) 또는 디스크 용량 부족.',
  },
  en: {
    countryKR: '🇰🇷 Korea',
    countryVN: '🇻🇳 Vietnam',
    countryUS: '🇺🇸 USA',
    countryJP: '🇯🇵 Japan',
    countryCN: '🇨🇳 China',
    countryUnknown: '❔ Unknown',
    diagNoRelay:
      '⚠️ No relay candidates found → a TURN server is required (direct P2P connection is being blocked by an ISP/firewall).',
    diagIceFailed:
      '⚠️ ICE connection failed → network path blocked or a TURN server is required.',
    diagPermissionDenied:
      '💡 Possible Windows mic/camera permission block. User needs guidance on permission settings.',
    diagNotReadable:
      '💡 Another program (Zoom/Teams, etc.) is holding the microphone. Advise the user to close that app.',
    diagNotAllowed:
      '💡 User denied microphone permission. Browser/OS permission needs to be reset.',
    diagScreenShareFailed: '💡 Possible Windows screen capture permission block.',
    diagUpdateFailed:
      '💡 Cannot reach GitHub Releases (firewall?) or insufficient disk space.',
  },
};

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
  feedbackCategory?: string;
  submitterName?: string;
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

export type PresenceParticipant = {
  displayName: string;
  country: string | null;
  city: string | null;
  region: string | null;
  ipMasked: string;
  connectedAt: number | null;
  roomCode: string;
};

export async function fetchPresence(
  password: string
): Promise<{ now: number; participants: PresenceParticipant[] } | null> {
  try {
    const resp = await fetch(`${SIGNALING_HTTP}/api/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as {
      now: number;
      participants: PresenceParticipant[];
    };
  } catch {
    return null;
  }
}

export type UsageStats = {
  totalJoins: number;
  totalMinutes: number;
  byCountry: Record<string, number>;
  byDay: Record<string, { joins: number; minutes: number }>;
  byHour: Record<string, number>;
};

export async function fetchStats(password: string): Promise<UsageStats | null> {
  try {
    const resp = await fetch(`${SIGNALING_HTTP}/api/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as UsageStats;
  } catch {
    return null;
  }
}

export function countryName(code: string | null): string {
  const t = pickT(STR);
  const countryNames: Record<string, string> = {
    KR: t.countryKR,
    VN: t.countryVN,
    US: t.countryUS,
    JP: t.countryJP,
    CN: t.countryCN,
    UNKNOWN: t.countryUnknown,
  };
  if (!code) return t.countryUnknown;
  return countryNames[code] ?? `🌐 ${code}`;
}

/**
 * Auto-diagnose a bug report based on patterns. Returns a hint string
 * or undefined if no specific pattern matched.
 */
export function autoDiagnose(r: BugReportRecord): string | undefined {
  const t = pickT(STR);
  if (r.type === 'webrtc-failed') {
    const d = r.details as
      | {
          candidateTypes?: string[];
          relayAvailable?: boolean;
          iceState?: string;
        }
      | undefined;
    if (d?.relayAvailable === false) {
      return t.diagNoRelay;
    }
    if (d?.iceState === 'failed') {
      return t.diagIceFailed;
    }
  }
  if (r.type === 'permission-denied' || /permission/i.test(r.message)) {
    return t.diagPermissionDenied;
  }
  if (/NotReadableError/i.test(r.message)) {
    return t.diagNotReadable;
  }
  if (/NotAllowedError/i.test(r.message)) {
    return t.diagNotAllowed;
  }
  if (r.type === 'screen-share-failed') {
    return t.diagScreenShareFailed;
  }
  if (r.type === 'update-failed') {
    return t.diagUpdateFailed;
  }
  return undefined;
}
