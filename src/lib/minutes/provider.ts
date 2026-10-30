// 회의록 실시간 공유(Yjs) — 계약 (A) 그대로. React·DOM·시그널링 클래스에 기대지 않는다(전달 함수만 받음) → node 시험에서 가짜 중계로 3대를 이어 본다.
//
//   update = 내 고침 증분(150ms 묶음) · 방송
//   sync1  = 내 state vector. 받은 쪽은 sync2(그 벡터 기준 차분)로 답하고, 방송으로 온 sync1 이면 자기 sync1 도 상대에게 보낸다(양방향 맞추기)
//   sync2  = 차분. 한 번에 보내기엔 큰 고침은 update 대신 이걸 방송으로 보낸다(서버 상한 1,500,000자)
//   처음 접속·재접속·누군가 입장할 때 sync1 방송, 60초마다도 방송(누락 자가치유).
// 서버는 중계만 한다(저장·로그 없음). 원격에서 온 고침에는 RemoteOrigin 표를 붙여 다시 내보내지 않는다.
// 겹침 확인: 기존 lib 에 동기화 코드는 없음(annotations.ts 는 화면 주석용 단순 중계).

import * as Y from 'yjs';
import { base64ToBytes, bytesToBase64 } from './base64';
import { RemoteOrigin, isRemoteOrigin } from './model';
import type { MinutesLinkStatus, MinutesWire, MinutesWireKind } from './types';

/** 서버 상한(update·sync1 = 200,000자) 안쪽 여유 */
export const MAX_UPDATE_CHARS = 190_000;
/**
 * 한 번에 보낼 수 있는 JSON 한 개(메시지 틀 + data)의 길이 상한.
 * 서버 규칙(sync2 1,500,000자)보다 실행 환경(workerd)의 제한이 더 작다: WebSocket 메시지가 1 MiB(1,048,576)를 넘으면
 * 보낸 사람의 연결을 끊어 버리고, 그러면 다시 연결 → 다시 맞추기 → 또 끊김으로 빙빙 돈다. 그래서 여유를 두고 1,000,000자에서 멈춘다.
 */
export const MAX_FRAME_CHARS = 1_000_000;
/** sync2 의 data(base64) 길이 상한 — 위 틀 길이(약 150자)와 여유를 뺀 값 */
export const MAX_SYNC2_CHARS = 990_000;
/**
 * 문서 전체(Y.encodeStateAsUpdate)의 크기 상한(바이트) = sync2 한 개로 새 입장자에게 «통째로» 줄 수 있는 최대 크기.
 * 이보다 커지면 아무도 새 사람에게 문서를 줄 수 없게 되므로, 남이 보낸 고침이 이 한도를 넘기게 만들면 그 고침은 받지 않는다
 * (서버는 update 를 초당 30개 × 200,000자까지 중계하므로 참석자 한 명이 몇 초 만에 모두의 문서를 부풀릴 수 있다).
 */
export const MAX_DOC_BYTES = Math.floor(MAX_SYNC2_CHARS / 4) * 3;
/**
 * 한 사람의 sync1 요청에 답하는 최소 간격(ms) — 짧은 간격으로 계속 오는 요청은 마지막 것 하나로 합쳐 이 간격 뒤에 한 번만 답한다.
 * 문서가 작으면(DOC_SMALL_CHARS 이하) 답도 작아서 이 간격을 두지 않는다 — 재접속 뒤 바로 맞춰지도록.
 */
export const ANSWER_GAP_MS = 5_000;
export const DOC_SMALL_CHARS = 40_000;
/** 내가 «답(sync2)» 으로 내보내는 양의 예산(문서 크기와 무관): 한꺼번에 최대 2.5MB, 이후 초당 250KB 씩 다시 찬다 */
export const ANSWER_BURST_CHARS = 2_500_000;
export const ANSWER_CHARS_PER_SEC = 250_000;

export type ProviderOptions = {
  doc: Y.Doc;
  selfId: string;
  /** 시그널링으로 내보낸다(연결이 닫혀 있으면 조용히 버려도 됨) */
  send: (msg: MinutesWire) => void;
  /** 시작할 때 연결이 열려 있나 (기본 false — 열리면 setOpen(true)) */
  open?: boolean;
  flushMs?: number;
  resyncMs?: number;
  /** 다시 연결한 뒤 이 시간 안에 응답이 없어도 «맞춤됨» 으로 본다 */
  syncGraceMs?: number;
  justSyncedMs?: number;
  /** sync1 에 답하기 전 기다리는 시간(여럿이 한꺼번에 답해 초당 상한을 넘기지 않게) */
  respondDelayMs?: () => number;
  /** 같은 사람의 sync1 에 답하는 최소 간격(기본 5초). 시험에서만 줄인다. */
  answerGapMs?: number;
  /** 답(sync2) 바이트 예산: 한꺼번에 · 초당 (기본 ANSWER_BURST_CHARS · ANSWER_CHARS_PER_SEC). 시험에서만 바꾼다. */
  answerBurstChars?: number;
  answerCharsPerSec?: number;
  /** 다른 참석자가 나에게 차분(sync2)으로 답해 왔을 때 — 처음 문서를 받았다는 신호로 쓴다 */
  onAnswer?: () => void;
};

type Listener = () => void;

type AnswerState = {
  /** 가장 최근에 받은 질문(state vector) */
  sv: Uint8Array;
  /** 합쳐진 질문 중 방송으로 온 것이 있었나(그러면 답할 때 내 sync1 도 보냄) */
  broadcast: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** 마지막으로 답한 시각(ms), 아직 없으면 0 */
  lastAt: number;
};

export class MinutesProvider {
  private readonly doc: Y.Doc;
  private readonly selfId: string;
  private readonly sendFn: (msg: MinutesWire) => void;
  private readonly flushMs: number;
  private readonly resyncMs: number;
  private readonly syncGraceMs: number;
  private readonly justSyncedMs: number;
  private readonly respondDelayMs: () => number;
  private readonly answerGapMs: number;
  private readonly answerBurstChars: number;
  private readonly answerCharsPerSec: number;
  private readonly onAnswer: (() => void) | null;

  private open: boolean;
  private started = false;
  private queue: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private justSyncedTimer: ReturnType<typeof setTimeout> | null = null;
  // sync1 에 답하는 일 — 보낸 사람(from)마다 «마지막 요청 하나» 만 들고 있다가 간격·예산을 지켜 한 번에 답한다
  private answers = new Map<string, AnswerState>();
  private answerTokens: number;
  private answerTokensAt = 0;
  private docCharsAt = 0;
  private docCharsCache = 0;
  // 문서 크기 추정(바이트): 고침이 들어올 때마다 더하고, 한도에 가까워지면 실제 크기를 잰다
  private sizeEstimate = 0;
  private oversizeTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = 0;
  private lastPendingAt = 0;
  private synced = true;
  private wasOffline = false;
  private justSynced = false;
  private oversize = false;
  private lastSync1At = 0;
  private listeners = new Set<Listener>();

  constructor(opts: ProviderOptions) {
    this.doc = opts.doc;
    this.selfId = opts.selfId;
    this.sendFn = opts.send;
    this.open = opts.open === true;
    this.flushMs = opts.flushMs ?? 150;
    this.resyncMs = opts.resyncMs ?? 60_000;
    this.syncGraceMs = opts.syncGraceMs ?? 3_000;
    this.justSyncedMs = opts.justSyncedMs ?? 3_200;
    this.respondDelayMs = opts.respondDelayMs ?? (() => Math.random() * 200);
    this.answerGapMs = opts.answerGapMs ?? ANSWER_GAP_MS;
    this.answerBurstChars = opts.answerBurstChars ?? ANSWER_BURST_CHARS;
    this.answerCharsPerSec = opts.answerCharsPerSec ?? ANSWER_CHARS_PER_SEC;
    this.answerTokens = this.answerBurstChars;
    this.onAnswer = opts.onAnswer ?? null;
  }

  // ───────────────────────── 수명 ─────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;
    this.sizeEstimate = Y.encodeStateAsUpdate(this.doc).length;
    this.doc.on('update', this.onDocUpdate);
    this.resyncTimer = setInterval(() => {
      if (this.open) this.broadcastSync1();
    }, this.resyncMs);
    if (this.open) this.beginSync();
  }

  destroy(): void {
    if (!this.started) return;
    this.started = false;
    this.doc.off('update', this.onDocUpdate);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.justSyncedTimer) clearTimeout(this.justSyncedTimer);
    if (this.resyncTimer) clearInterval(this.resyncTimer);
    for (const st of this.answers.values()) if (st.timer) clearTimeout(st.timer);
    this.answers.clear();
    if (this.oversizeTimer) clearTimeout(this.oversizeTimer);
    this.oversizeTimer = null;
    this.flushTimer = this.syncTimer = this.justSyncedTimer = null;
    this.resyncTimer = null;
    this.queue = [];
    this.listeners.clear();
  }

  // ───────────────────────── 상태 ─────────────────────────

  getStatus(): MinutesLinkStatus {
    const state = !this.open ? 'offline' : !this.synced && this.wasOffline ? 'syncing' : 'live';
    return { state, pending: this.pending, justSynced: this.justSynced, oversize: this.oversize };
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of Array.from(this.listeners)) {
      try {
        cb();
      } catch (err) {
        console.error('[minutes] status listener error', err);
      }
    }
  }

  // ───────────────────────── 연결 상태 ─────────────────────────

  /** 시그널링 연결이 열리거나 닫힐 때 부른다 */
  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    if (!open) {
      this.wasOffline = true;
      this.synced = false;
      this.queue = [];
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      if (this.syncTimer) {
        clearTimeout(this.syncTimer);
        this.syncTimer = null;
      }
      this.notify();
      return;
    }
    if (this.started) this.beginSync();
    else this.notify();
  }

  /** 누군가 방에 들어왔다 — 내 상태를 알려 서로 맞춘다 */
  peerJoined(): void {
    if (!this.open) return;
    const now = Date.now();
    if (now - this.lastSync1At < 500) return; // 몰려 들어올 때 방송이 겹치지 않게
    this.broadcastSync1();
  }

  private beginSync(): void {
    this.synced = !this.wasOffline; // 처음 접속은 «맞추는 중» 표시를 띄우지 않는다(재접속일 때만)
    this.broadcastSync1();
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.finishSync();
    }, this.syncGraceMs);
    this.notify();
  }

  private finishSync(): void {
    const wasRecovering = this.wasOffline;
    this.synced = true;
    this.wasOffline = false;
    this.pending = 0;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (wasRecovering) {
      this.justSynced = true;
      if (this.justSyncedTimer) clearTimeout(this.justSyncedTimer);
      this.justSyncedTimer = setTimeout(() => {
        this.justSynced = false;
        this.justSyncedTimer = null;
        this.notify();
      }, this.justSyncedMs);
    }
    this.notify();
  }

  // ───────────────────────── 보내기 ─────────────────────────

  /**
   * 한 개를 보낸다. JSON 전체가 MAX_FRAME_CHARS 를 넘으면 보내지 않고 false(= 너무 큼).
   * 보내지 않는 쪽이 연결이 끊겨 빙빙 도는 것보다 낫다 — 호출한 쪽이 oversize 표시를 켠다.
   */
  private send(kind: MinutesWireKind, data: Uint8Array, to?: string): boolean {
    const msg: MinutesWire = { type: 'minutes', from: this.selfId, kind, data: bytesToBase64(data) };
    if (to) msg.to = to;
    // base64 글자는 JSON 에서 그대로 한 글자씩이라, 틀 길이 + data 길이가 곧 전체 길이다
    const frame = JSON.stringify({ ...msg, data: '' }).length + msg.data.length;
    if (frame > MAX_FRAME_CHARS) return false;
    this.sendFn(msg);
    return true;
  }

  /** 너무 큰 메시지를 못 보냈다는 표시를 켠다(화면이 «회의록이 너무 큽니다» 를 띄움) */
  private markOversize(): void {
    if (this.oversize) return;
    this.oversize = true;
    this.notify();
  }

  /**
   * 문서 전체가 한 번에 보낼 수 있는 크기로 돌아왔으면 표시를 끈다.
   * (못 보낸 고침은 다른 참석자의 주기적 sync1 에 내가 차분으로 답하면서 저절로 전해진다)
   */
  private recheckOversize(): void {
    if (!this.oversize) return;
    const full = Y.encodeStateAsUpdate(this.doc);
    if (Math.ceil(full.length / 3) * 4 <= MAX_SYNC2_CHARS) {
      this.oversize = false;
      this.notify();
    }
  }

  private broadcastSync1(): void {
    this.lastSync1At = Date.now();
    this.send('sync1', Y.encodeStateVector(this.doc));
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (isRemoteOrigin(origin)) return; // 남이 보낸 것은 되돌려 보내지 않는다
    this.sizeEstimate += update.length;
    if (!this.open) {
      this.countPending();
      return;
    }
    this.queue.push(update);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.flushMs);
    }
  };

  /** «고친 곳 N군데 대기» — 글자를 치는 동안 쏟아지는 고침을 1초 단위로 묶어 센다 */
  private countPending(): void {
    const now = Date.now();
    if (this.pending === 0 || now - this.lastPendingAt > 1000) this.pending += 1;
    this.lastPendingAt = now;
    this.notify();
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    const merged = this.queue.length === 1 ? this.queue[0] : Y.mergeUpdates(this.queue);
    this.queue = [];
    if (!this.open) {
      this.countPending();
      return;
    }
    const b64Len = Math.ceil(merged.length / 3) * 4;
    let sent = false;
    if (b64Len <= MAX_UPDATE_CHARS) {
      sent = this.send('update', merged);
    } else if (b64Len <= MAX_SYNC2_CHARS) {
      // update 상한(200,000자)을 넘는 고침(큰 붙여넣기 등) → sync2 방송으로 보낸다(받는 쪽은 둘을 똑같이 반영)
      sent = this.send('sync2', merged);
    }
    if (!sent) this.markOversize();
    else this.recheckOversize();
  }

  // ───────────────────────── 받기 ─────────────────────────

  handleMessage(msg: MinutesWire): void {
    if (!msg || msg.type !== 'minutes' || msg.from === this.selfId) return;
    if (msg.to && msg.to !== this.selfId) return;
    if (typeof msg.data !== 'string') return;
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(msg.data);
    } catch {
      return;
    }
    switch (msg.kind) {
      case 'update':
        this.applyRemote(bytes, msg.from);
        break;
      case 'sync2':
        this.applyRemote(bytes, msg.from);
        if (msg.to) this.gotAnswer(); // 나에게 온 답(차분)이면 «맞춰졌다»
        break;
      case 'sync1':
        this.answerSync1(bytes, msg.from, !msg.to);
        break;
      default:
        break;
    }
  }

  /**
   * 이 고침을 받아도 문서가 MAX_DOC_BYTES 안에 있나. 평소(추정이 한도 안)엔 계산 없이 통과하고,
   * 추정이 한도를 넘으면 실제 크기를 재서 정한다(추정은 지운 글·합쳐진 고침을 몰라 실제보다 크게 나온다).
   */
  private canAccept(bytes: Uint8Array): boolean {
    const est = this.sizeEstimate + bytes.length;
    if (est <= MAX_DOC_BYTES) {
      this.sizeEstimate = est;
      return true;
    }
    const actual = Y.encodeStateAsUpdate(this.doc).length;
    if (actual + bytes.length <= MAX_DOC_BYTES) {
      this.sizeEstimate = actual + bytes.length;
      return true;
    }
    this.sizeEstimate = actual;
    return false;
  }

  /** 받지 못한 고침이 있었다 — 화면에 «너무 큽니다» 를 띄우고, 한동안 더 없으면 끈다 */
  private markOversizeIn(): void {
    if (!this.oversize) {
      this.oversize = true;
      this.notify();
    }
    if (this.oversizeTimer) clearTimeout(this.oversizeTimer);
    this.oversizeTimer = setTimeout(() => {
      this.oversizeTimer = null;
      this.recheckOversize();
    }, 30_000);
  }

  private applyRemote(bytes: Uint8Array, from: string): void {
    if (!this.canAccept(bytes)) {
      console.warn('[minutes] update dropped: the document would exceed', MAX_DOC_BYTES, 'bytes');
      this.markOversizeIn();
      return;
    }
    try {
      Y.applyUpdate(this.doc, bytes, new RemoteOrigin(from));
    } catch (err) {
      console.warn('[minutes] bad update ignored', err instanceof Error ? err.message : err);
    }
  }

  private gotAnswer(): void {
    try {
      this.onAnswer?.();
    } catch (err) {
      console.error('[minutes] onAnswer error', err);
    }
    if (!this.synced) this.finishSync();
  }

  /**
   * 누가 «내 상태는 이런데 뭘 더 줄래?» (sync1) 라고 물었다. 답(sync2)은 문서 전체 차분이라 질문(65자)보다 수만 배 클 수 있어서,
   * 보낸 사람마다 ① 질문이 여러 번 와도 마지막 것 하나로 합쳐 ANSWER_GAP_MS 간격으로 한 번만 답하고
   * ② 내가 답으로 내보내는 총량에도 예산을 둔다(예산이 모자라면 찰 때까지 미룸).
   * 늦춰도 잃는 것은 없다: 실시간 고침(update)은 따로 방송되고, 60초마다 누구나 sync1 을 다시 보낸다.
   */
  private answerSync1(stateVector: Uint8Array, from: string, wasBroadcast: boolean): void {
    // 깨진 state vector 는 여기서 걸러낸다(답할 때 다시 계산하므로 결과는 쓰지 않음)
    try {
      Y.decodeStateVector(stateVector);
    } catch {
      return;
    }
    let st = this.answers.get(from);
    if (!st) {
      this.pruneAnswers();
      st = { sv: stateVector, broadcast: wasBroadcast, timer: null, lastAt: 0 };
      this.answers.set(from, st);
    } else {
      st.sv = stateVector; // 가장 최근 질문으로 답한다
      st.broadcast = st.broadcast || wasBroadcast;
    }
    if (st.timer) return; // 이미 답할 예정 — 합쳐진다
    this.scheduleAnswer(from, st, Math.max(0, this.respondDelayMs()));
  }

  /** 문서 전체가 base64 로 몇 글자쯤 되나 — 5초에 한 번만 다시 잰다(요청이 몰려도 매번 문서 전체를 훑지 않게) */
  private docChars(): number {
    const now = Date.now();
    if (now - this.docCharsAt > 5_000) {
      this.docCharsAt = now;
      this.docCharsCache = Math.ceil(Y.encodeStateAsUpdate(this.doc).length / 3) * 4;
    }
    return this.docCharsCache;
  }

  private scheduleAnswer(from: string, st: AnswerState, minWait: number): void {
    const gap = this.docChars() > DOC_SMALL_CHARS ? this.answerGapMs : 0;
    const wait = Math.max(minWait, st.lastAt + gap - Date.now(), 0);
    if (wait === 0) {
      this.respondTo(from);
      return;
    }
    st.timer = setTimeout(() => {
      st.timer = null;
      this.respondTo(from);
    }, wait);
  }

  private respondTo(from: string): void {
    const st = this.answers.get(from);
    if (!st || st.timer) return;
    if (!this.started || !this.open) {
      this.answers.delete(from);
      return;
    }
    // 기다린 사이에 문서가 더 바뀌었을 수 있으니 답하는 순간의 차분을 만든다
    const diff = Y.encodeStateAsUpdate(this.doc, st.sv);
    const cost = Math.ceil(diff.length / 3) * 4;
    if (cost <= MAX_SYNC2_CHARS) {
      const now = Date.now();
      this.answerTokens = Math.min(
        this.answerBurstChars,
        this.answerTokens + ((now - this.answerTokensAt) / 1000) * this.answerCharsPerSec
      );
      this.answerTokensAt = now;
      if (cost > this.answerTokens) {
        // 예산이 모자란다 — 찰 때까지 기다렸다가 다시(질문은 그대로 들고 있음)
        const wait = Math.max(200, Math.ceil(((cost - this.answerTokens) / this.answerCharsPerSec) * 1000));
        st.timer = setTimeout(() => {
          st.timer = null;
          this.respondTo(from);
        }, wait);
        return;
      }
      this.answerTokens -= cost;
      if (!this.send('sync2', diff, from)) this.markOversize();
    } else {
      this.markOversize();
    }
    st.lastAt = Date.now();
    // 방송으로 온 sync1 에만 내 sync1 로 되묻는다 — 개별로 온 것에 또 되물으면 끝없이 오간다
    if (st.broadcast) this.send('sync1', Y.encodeStateVector(this.doc), from);
    st.broadcast = false;
  }

  /** 오래 조용한 보낸 사람 기록을 치운다(방을 드나든 사람들의 기록이 쌓이지 않게) */
  private pruneAnswers(): void {
    if (this.answers.size < 64) return;
    const now = Date.now();
    for (const [id, st] of this.answers) {
      if (!st.timer && now - st.lastAt > 60_000) this.answers.delete(id);
    }
  }
}
