// «회사 양식 설정» 클라이언트 — 로고·회사명·문서번호를 서버에서 받아 와 이 PC 에 캐시한다(계약 B).
//   GET  /api/company  → { name, docNo, logo(data URL 또는 null), updatedAt }   (인증 없음, 서버가 max-age=60)
//   POST /api/company  → body { password, name, docNo, logo } — 관리자 비밀번호 필요
// 이 값은 소스에 넣지 않는다(공개 저장소) — 관리자가 한 번 설정하면 서버에 보관되고 모든 PC 가 받아 쓴다.
// 설정이 없거나 서버가 닫혀 있어도 회의록 저장은 된다(로고 칸만 비움).
// 겹침 확인: adminAuth.ts·bugReporter.ts 도 같은 서버 주소 조립 코드를 각자 갖고 있음(여기도 같은 규칙으로 한 번 더 둠 — 정리는 해당 담당과 협의 필요).

import type { CompanySettings } from './types';

const SIGNALING_HTTP =
  (import.meta as unknown as { env?: { VITE_SIGNALING_URL?: string } }).env
    ?.VITE_SIGNALING_URL?.replace(/^wss:/i, 'https:')
    ?.replace(/^ws:/i, 'http:') // 로컬 시험 서버(ws://127.0.0.1:8787)도 같은 주소로 부를 수 있게
    ?.replace(/\/?$/, '') ?? 'https://meet-sig.jcseo.workers.dev';

const CACHE_KEY = 'pikmeeting.company';
const LOGO_PREFIXES = ['data:image/png;base64,', 'data:image/jpeg;base64,'];
export const COMPANY_NAME_MAX = 60;
export const COMPANY_DOCNO_MAX = 40;
export const COMPANY_LOGO_MAX = 400_000;

function parseCompany(v: unknown): CompanySettings | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string' || typeof o.docNo !== 'string') return null;
  const logo =
    typeof o.logo === 'string' && LOGO_PREFIXES.some((p) => (o.logo as string).startsWith(p)) ? o.logo : null;
  return {
    name: o.name,
    docNo: o.docNo,
    logo,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
  };
}

export function getCachedCompany(): CompanySettings | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? parseCompany(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function cacheCompany(c: CompanySettings): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    // 용량 초과 등 — 캐시만 못 한다
  }
}

/**
 * 서버에서 최신 회사 양식을 받아 캐시한다. 실패하면 캐시를 그대로 돌려준다(없으면 null).
 * @param fresh true 면 브라우저 캐시를 건너뛴다(설정 창에서 방금 저장한 값을 다시 읽을 때)
 */
export async function refreshCompany(opts: { timeoutMs?: number; fresh?: boolean } = {}): Promise<CompanySettings | null> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000) : null;
  try {
    const resp = await fetch(`${SIGNALING_HTTP}/api/company`, {
      method: 'GET',
      cache: opts.fresh ? 'no-store' : 'default',
      signal: ctrl?.signal,
    });
    if (!resp.ok) return getCachedCompany();
    const parsed = parseCompany(await resp.json());
    if (!parsed) return getCachedCompany();
    cacheCompany(parsed);
    return parsed;
  } catch {
    return getCachedCompany();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type SaveCompanyResult =
  | { ok: true; updatedAt: number }
  | { ok: false; reason: 'forbidden' | 'locked' | 'too-large' | 'invalid' | 'network' | 'server'; retryAfter?: number };

export async function saveCompany(
  password: string,
  data: { name: string; docNo: string; logo: string | null }
): Promise<SaveCompanyResult> {
  try {
    const resp = await fetch(`${SIGNALING_HTTP}/api/company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, name: data.name, docNo: data.docNo, logo: data.logo }),
    });
    if (resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { updatedAt?: number };
      const updatedAt = typeof body.updatedAt === 'number' ? body.updatedAt : Date.now();
      cacheCompany({ name: data.name.trim(), docNo: data.docNo.trim(), logo: data.logo, updatedAt });
      return { ok: true, updatedAt };
    }
    // 이 API 는 비밀번호가 틀리면 403(다른 관리자 API 는 401) — 어느 쪽이든 «비밀번호가 맞지 않음» 으로 안내한다
    if (resp.status === 403 || resp.status === 401) return { ok: false, reason: 'forbidden' };
    if (resp.status === 429) {
      const ra = Number(resp.headers.get('Retry-After'));
      return { ok: false, reason: 'locked', retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined };
    }
    if (resp.status === 413) return { ok: false, reason: 'too-large' };
    if (resp.status === 400) return { ok: false, reason: 'invalid' };
    return { ok: false, reason: 'server' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

// ───────────────────────── 로고 그림 줄이기 ─────────────────────────

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

/**
 * 고른 그림을 폭 600px 이하 PNG(data URL)로 줄인다. 서버 상한(400,000자)을 넘으면 더 작게, 그래도 크면 JPEG 로.
 * 돌려주는 값은 항상 'data:image/png;base64,' 또는 'data:image/jpeg;base64,' 로 시작한다.
 */
export async function shrinkLogoToDataUrl(file: Blob, maxWidth = 600): Promise<string> {
  const img = await loadImage(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error('empty image');
  const widths = [maxWidth, 450, 320, 220, 160].map((w) => Math.min(w, srcW)).filter((w, i, a) => a.indexOf(w) === i);
  let last = '';
  for (const useJpeg of [false, true]) {
    for (const w of widths) {
      const h = Math.max(1, Math.round((srcH * w) / srcW));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      if (useJpeg) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);
      const url = useJpeg ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
      last = url;
      if (url.length <= COMPANY_LOGO_MAX - 2000) return url;
    }
  }
  return last; // 서버가 너무 크다고 거절하면 화면이 안내한다
}
