// 회의록 자동 임시 저장 — 이 PC 의 localStorage 에만 둔다(서버에는 아무것도 올리지 않음).
//   키   pikmeeting.minutes.<방코드>.<한국시간 날짜YYYYMMDD>
//   값   { v:1, ts, update(base64 — 문서 전체), writer }
// 5초마다, 바뀐 게 있으면 쓴다. 방마다 가장 최근 것 하나만 남기고, 12시간 지난 것은 지운다.
// 같은 방에 다시 들어왔을 때 문서가 비어 있고 저장본에 내용이 있으면 «복구 / 새로 시작» 을 제안하는 데 쓴다(session.ts).
// 겹침 확인: 기존 localStorage 사용(언어·마이크·녹화 폴더)은 설정값뿐이라 문서 보관 도구는 새로 만든다.

import * as Y from 'yjs';
import { base64ToBytes, bytesToBase64 } from './base64';
import { hasMinutesContent } from './model';
import { kstDateKey } from './kst';

const PREFIX = 'pikmeeting.minutes.';
export const AUTOSAVE_EXPIRE_MS = 12 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
type Stored = { v: 1; ts: number; update: string; writer: string | null };

export type SavedMinutes = {
  savedAt: number;
  update: Uint8Array;
  writer: string | null;
  hasContent: boolean;
};

export type AutosaveOptions = {
  intervalMs?: number;
  expireMs?: number;
  storage?: StorageLike | null;
  now?: () => number;
};

export class MinutesAutosave {
  private readonly roomCode: string;
  private readonly doc: Y.Doc;
  private readonly intervalMs: number;
  private readonly expireMs: number;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private wroteOnce = false;
  private enabled = false;
  private getWriter: () => string | null = () => null;
  private onWrite: ((at: number) => void) | null = null;
  lastWriteAt = 0;

  constructor(roomCode: string, doc: Y.Doc, opts: AutosaveOptions = {}) {
    this.roomCode = roomCode.replace(/[^A-Za-z0-9_-]/g, '');
    this.doc = doc;
    this.intervalMs = opts.intervalMs ?? 5000;
    this.expireMs = opts.expireMs ?? AUTOSAVE_EXPIRE_MS;
    this.now = opts.now ?? (() => Date.now());
    let st: StorageLike | null = null;
    try {
      st = opts.storage !== undefined ? opts.storage : (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
    } catch {
      st = null; // 저장소 접근이 막힌 환경 — 자동 보관만 못 한다
    }
    this.storage = st;
  }

  private keyFor(ts: number): string {
    return `${PREFIX}${this.roomCode}.${kstDateKey(ts)}`;
  }

  private readonly onUpdate = (): void => {
    this.dirty = true;
  };

  /** 보관을 시작한다(복구 제안에 답하기 전에는 부르지 않는다 — 옛 저장본을 덮어쓰지 않으려고) */
  enable(getWriter: () => string | null, onWrite?: (at: number) => void): void {
    this.getWriter = getWriter;
    this.onWrite = onWrite ?? null;
    if (this.enabled) return;
    this.enabled = true;
    this.doc.on('update', this.onUpdate);
    this.timer = setInterval(() => this.flush(), this.intervalMs);
    this.cleanup();
  }

  disable(): void {
    if (!this.enabled) return;
    this.flush();
    this.enabled = false;
    this.doc.off('update', this.onUpdate);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 바뀐 게 있으면 지금 쓴다(나갈 때·창을 닫을 때 부름) */
  flush(): void {
    if (!this.enabled || !this.storage) return;
    if (!this.dirty) return;
    // 내용이 한 번도 없었던 문서(접속 기록만 있는)는 보관하지 않는다
    if (!this.wroteOnce && !hasMinutesContent(this.doc)) return;
    this.dirty = false;
    const ts = this.now();
    const payload: Stored = {
      v: 1,
      ts,
      update: bytesToBase64(Y.encodeStateAsUpdate(this.doc)),
      writer: this.getWriter(),
    };
    try {
      const key = this.keyFor(ts);
      this.storage.setItem(key, JSON.stringify(payload));
      this.wroteOnce = true;
      this.lastWriteAt = ts;
      this.removeOtherKeysOfRoom(key);
      this.onWrite?.(ts);
    } catch {
      // 용량 초과 등 — 다음 주기에 다시 시도
      this.dirty = true;
    }
  }

  private keysOfRoom(): string[] {
    const out: string[] = [];
    if (!this.storage) return out;
    const head = `${PREFIX}${this.roomCode}.`;
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const k = this.storage.key(i);
        if (k && k.startsWith(head)) out.push(k);
      }
    } catch {
      // ignore
    }
    return out;
  }

  private removeOtherKeysOfRoom(keep: string): void {
    for (const k of this.keysOfRoom()) {
      if (k !== keep) {
        try {
          this.storage?.removeItem(k);
        } catch {
          // ignore
        }
      }
    }
  }

  private parse(key: string): Stored | null {
    try {
      const raw = this.storage?.getItem(key);
      if (!raw) return null;
      const v = JSON.parse(raw) as Partial<Stored>;
      if (v && v.v === 1 && typeof v.ts === 'number' && typeof v.update === 'string') {
        return { v: 1, ts: v.ts, update: v.update, writer: typeof v.writer === 'string' ? v.writer : null };
      }
    } catch {
      // 깨진 저장본은 없는 것으로
    }
    return null;
  }

  /** 12시간 넘은 임시 저장본(모든 방)을 지운다 */
  cleanup(): void {
    if (!this.storage) return;
    const t = this.now();
    const stale: string[] = [];
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const k = this.storage.key(i);
        if (!k || !k.startsWith(PREFIX)) continue;
        const v = this.parse(k);
        if (!v || t - v.ts > this.expireMs) stale.push(k);
      }
      for (const k of stale) this.storage.removeItem(k);
    } catch {
      // ignore
    }
  }

  /** 이 방의 가장 최근 저장본(12시간 안). 없으면 null. */
  peek(): SavedMinutes | null {
    let best: Stored | null = null;
    const t = this.now();
    for (const k of this.keysOfRoom()) {
      const v = this.parse(k);
      if (v && t - v.ts <= this.expireMs && (!best || v.ts > best.ts)) best = v;
    }
    if (!best) return null;
    try {
      const update = base64ToBytes(best.update);
      const tmp = new Y.Doc();
      Y.applyUpdate(tmp, update);
      const hasContent = hasMinutesContent(tmp);
      tmp.destroy();
      return { savedAt: best.ts, update, writer: best.writer, hasContent };
    } catch {
      return null;
    }
  }

  /** 이 방의 저장본을 모두 지운다 («새로 시작» 을 골랐을 때) */
  clear(): void {
    for (const k of this.keysOfRoom()) {
      try {
        this.storage?.removeItem(k);
      } catch {
        // ignore
      }
    }
    this.wroteOnce = false;
    this.dirty = false;
  }
}
