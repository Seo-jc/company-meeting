// 참석자 자동 입력 — 시그널링이 알려 주는 «지금 방에 있는 사람 이름들» 을 회의록 문서의 참석자 줄과 맞춘다.
// 모든 PC 가 같은 결정적 key('a:'+정규화 이름)로 쓰므로 여러 PC 가 동시에 써도 한 줄로 합쳐진다.
// 나간 사람은 지우지 않고 «나감» 시각(leftAt)을 남기고, 돌아오면 지운다. 잠깐 끊겼다 돌아오는 경우(서버가 sync 를 다시 보내는 순간)엔
// 나감으로 치지 않도록 leaveGraceMs 만큼 기다린다.
// React·DOM 없음 → node 시험에서 그대로 불러 쓴다.
// 겹침 확인: webrtc.ts 의 displayNames 는 연결 코드 안의 비공개 표라 재사용할 수 없어, 시그널링을 «엿듣는» 별도 추적기로 둔다.

import * as Y from 'yjs';
import { ORIGIN_AUTO, attendeesOf, autoKey, ensureAutoAttendee, markAttendeeLeft, normalizeName } from './model';

export type RosterOptions = {
  doc: Y.Doc;
  selfId: string;
  selfName: string;
  now?: () => number;
  /** 사라진 지 이만큼 지나도 안 돌아오면 «나감» 으로 적는다 (기본 8초) */
  leaveGraceMs?: number;
  /** 같은 이름이 이만큼 «계속» 둘 이상이어야 동명이인으로 본다 (기본 8초 — 끊겼다 돌아오는 옛 접속이 잠깐 겹치는 것은 제외) */
  sameNameGraceMs?: number;
  /** 동명이인 판정이 바뀌었다 (화면을 다시 그려야 할 때) */
  onChange?: () => void;
};

type PeerList = ReadonlyArray<{ peerId: string; displayName: string }>;

export class RosterTracker {
  private readonly doc: Y.Doc;
  private readonly selfId: string;
  private readonly selfName: string;
  private readonly now: () => number;
  private readonly leaveGraceMs: number;
  private readonly sameNameGraceMs: number;
  private readonly onChange: (() => void) | null;

  private peers = new Map<string, string>();
  // 같은 이름으로 둘 이상 접속한 이름(key) → 그렇게 된 시각
  private sameSince = new Map<string, number>();
  private sameTimer: ReturnType<typeof setTimeout> | null = null;
  private ready = false;
  private open = false;
  private leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private absentSince = new Map<string, number>();

  constructor(opts: RosterOptions) {
    this.doc = opts.doc;
    this.selfId = opts.selfId;
    this.selfName = opts.selfName;
    this.now = opts.now ?? (() => Date.now());
    this.leaveGraceMs = opts.leaveGraceMs ?? 8000;
    this.sameNameGraceMs = opts.sameNameGraceMs ?? 8000;
    this.onChange = opts.onChange ?? null;
  }

  /** 처음 문서를 받아 오는 시간이 지났다 — 이제부터 줄을 만든다(그 전에 만들면 같은 줄을 두 번 만들 수 있음) */
  setReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.reconcile();
  }

  /** 시그널링 연결 여부. 끊겨 있으면 «누가 나갔나» 를 알 수 없으므로 나감 표시를 멈춘다. */
  setOpen(open: boolean): void {
    this.open = open;
    if (!open) this.clearTimers();
    else this.reconcile();
  }

  /** 'peers' · 'sync' 메시지 — 서버가 알려 주는 전체 목록 */
  setPeers(list: PeerList): void {
    const next = new Map<string, string>();
    for (const p of list) {
      if (p.peerId !== this.selfId) next.set(p.peerId, p.displayName);
    }
    this.peers = next;
    this.reconcile();
    this.refreshSameNames();
  }

  peerJoined(peerId: string, displayName: string): void {
    if (peerId === this.selfId) return;
    this.peers.set(peerId, displayName);
    this.reconcile();
    this.refreshSameNames();
  }

  peerLeft(peerId: string): void {
    this.peers.delete(peerId);
    this.reconcile();
    this.refreshSameNames();
  }

  /** 나 말고 지금 방에 있다고 알고 있는 사람 수 */
  peerCount(): number {
    return this.peers.size;
  }

  /** 지금 방에 있는 사람의 이름(모르면 null) */
  nameOf(peerId: string): string | null {
    return this.peers.get(peerId) ?? null;
  }

  /**
   * 지금 같은 이름으로 둘 이상이 접속해 있는 이름과 그 인원(오래 이어진 것만).
   * 참석자 줄의 key 가 이름이라 이런 사람들은 표에서 한 줄로 합쳐지므로, 화면이 «동석자로 따로 적어 달라» 고 안내한다.
   */
  sameNames(): Array<{ name: string; count: number }> {
    const t = this.now();
    const counts = this.countNames();
    const out: Array<{ name: string; count: number }> = [];
    for (const [key, since] of this.sameSince) {
      if (t - since < this.sameNameGraceMs) continue;
      const hit = counts.get(key);
      if (hit && hit.count > 1) out.push({ name: hit.name, count: hit.count });
    }
    return out;
  }

  destroy(): void {
    this.clearTimers();
    if (this.sameTimer) clearTimeout(this.sameTimer);
    this.sameTimer = null;
  }

  private countNames(): Map<string, { name: string; count: number }> {
    const counts = new Map<string, { name: string; count: number }>();
    const add = (raw: string) => {
      const clean = normalizeName(raw);
      if (!clean) return;
      const key = autoKey(clean);
      const hit = counts.get(key);
      if (hit) hit.count += 1;
      else counts.set(key, { name: clean, count: 1 });
    };
    add(this.selfName);
    for (const [peerId, name] of this.peers) add(name.trim() ? name : `참가자-${peerId.slice(0, 4)}`);
    return counts;
  }

  /** 접속자 목록이 바뀔 때마다: 동명이인이 생겼으면 시각을 적어 두고, 오래 그대로면 화면에 알린다. 풀렸으면 바로 알린다. */
  private refreshSameNames(): void {
    const t = this.now();
    const counts = this.countNames();
    let changed = false;
    for (const [key, v] of counts) {
      if (v.count > 1 && !this.sameSince.has(key)) this.sameSince.set(key, t);
    }
    for (const key of Array.from(this.sameSince.keys())) {
      const v = counts.get(key);
      if (!v || v.count <= 1) {
        this.sameSince.delete(key);
        changed = true;
      }
    }
    // 아직 «오래 이어지지» 않은 것이 있으면, 가장 먼저 오래 이어질 때에 맞춰 한 번 알린다
    if (this.sameTimer) clearTimeout(this.sameTimer);
    this.sameTimer = null;
    let nextAt = Infinity;
    for (const since of this.sameSince.values()) {
      if (t - since < this.sameNameGraceMs) nextAt = Math.min(nextAt, since + this.sameNameGraceMs);
    }
    if (nextAt !== Infinity) {
      this.sameTimer = setTimeout(() => {
        this.sameTimer = null;
        this.onChange?.();
        this.refreshSameNames(); // 뒤이어 오래 이어질 다른 이름이 있으면 그 때를 다시 맞춘다
      }, Math.max(0, nextAt - t) + 50);
    }
    if (changed) this.onChange?.();
  }

  private clearTimers(): void {
    for (const t of this.leaveTimers.values()) clearTimeout(t);
    this.leaveTimers.clear();
    this.absentSince.clear();
  }

  private presentKeys(): Map<string, string> {
    const out = new Map<string, string>();
    const add = (name: string) => {
      const clean = normalizeName(name);
      if (clean) out.set(autoKey(clean), clean);
    };
    add(this.selfName);
    for (const [peerId, name] of this.peers) add(name.trim() ? name : `참가자-${peerId.slice(0, 4)}`);
    return out;
  }

  /** 문서의 참석자 줄을 지금 방 상태와 맞춘다. 여러 번 불러도 바뀐 게 없으면 아무것도 쓰지 않는다. */
  reconcile(): void {
    if (!this.ready) return;
    const present = this.presentKeys();
    const t = this.now();

    for (const [key, name] of present) {
      ensureAutoAttendee(this.doc, name, t, ORIGIN_AUTO);
      const timer = this.leaveTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.leaveTimers.delete(key);
      }
      this.absentSince.delete(key);
    }

    if (!this.open) return;
    attendeesOf(this.doc).forEach((row, key) => {
      if (!key.startsWith('a:') || present.has(key)) return;
      if (!(row instanceof Y.Map) || row.has('leftAt')) return;
      if (this.leaveTimers.has(key)) return;
      this.absentSince.set(key, t);
      const timer = setTimeout(() => {
        this.leaveTimers.delete(key);
        if (!this.open || this.presentKeys().has(key)) return;
        markAttendeeLeft(this.doc, key, this.absentSince.get(key) ?? this.now(), ORIGIN_AUTO);
        this.absentSince.delete(key);
      }, this.leaveGraceMs);
      this.leaveTimers.set(key, timer);
    });
  }
}
