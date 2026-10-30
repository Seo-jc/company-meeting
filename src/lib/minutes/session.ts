// 회의록 «한 회의방 분량» 을 묶는 곳 — 문서(Y.Doc) · 실시간 공유(provider) · 참석자 자동(roster) · 임시 저장(autosave) ·
// 엑셀 저장 · 나가기 확인에 필요한 상태를 한 군데서 들고 있고, 화면은 getSnapshot() 만 본다(useSyncExternalStore).
//
// 수명: MeetingRoom 이 방을 여는 동안 한 개를 만들어 둔다(문서는 마이크 재시도·듣기전용 전환으로 시그널링이 다시 만들어져도 그대로 남는다).
//   activate()/deactivate()  — 화면이 보이는 동안 (React StrictMode 가 두 번 켜고 꺼도 안전하게 되돌릴 수 있다)
//   attach(signaling, peerId)/detach() — 시그널링이 새로 만들어질 때마다
// 서버에는 회의록 내용을 저장하지 않는다(중계만). 이 PC 에는 자동 임시 저장(autosave.ts)과 엑셀 파일만 남는다.
// 겹침 확인: MeetingRoom.tsx 가 채팅 상태를 직접 들고 있는 것과 달리, 회의록은 상태가 많아 별도 클래스로 둔다.

import * as Y from 'yjs';
import type { SignalingClient } from '../signaling';
import { MinutesAutosave, type SavedMinutes } from './autosave';
import { getCachedCompany, refreshCompany } from './company';
import { buildExport } from './export';
import { kstDateText, kstHHmm } from './kst';
import {
  ORIGIN_USER,
  addAgenda,
  addCompanion,
  agendaFieldName,
  agendaOf,
  applyAutoEnd,
  attendeeRemovalKeys,
  attendeesOf,
  autoKey,
  ensureMeetingStart,
  fragmentPlainText,
  hasMinutesContent,
  isRemoteOrigin,
  isUserOrigin,
  metaOf,
  previewRestore,
  readAgenda,
  readAttendees,
  readView,
  restoreInto,
  setAgendaDeleted,
  setAttendeesExcluded,
  setMetaField,
  updateAgenda,
  updateAttendee,
  type MetaKey,
} from './model';
import { MinutesProvider } from './provider';
import { RosterTracker } from './roster';
import type {
  MinutesLeftInfo,
  MinutesLinkStatus,
  MinutesNotice,
  MinutesRemoteActivity,
  MinutesUndoItem,
  MinutesViewState,
} from './types';

const MINUTES_DIR_KEY = 'pikmeeting.minutesSaveDir';
const SETTLE_MS = 2000; // 처음 문서를 받아 오는 데 기다리는 시간 (계약: 2초 안에 다른 참석자의 응답이 없으면 저장본 복구 제안)
const OFFER_REFRESH_MS = 500; // 복구 제안이 떠 있는 동안 문서가 바뀌면 이만큼 뒤에 «아직 필요한 제안인가» 를 다시 본다
const UNDO_MS = 10_000; // 지움을 되돌릴 수 있는 시간
const UNDO_MAX = 20;
const REMOTE_SHOW_MS = 1900;
const REMOTE_COLORS = ['#a44cf3', '#e0803a', '#2fa8c8', '#d4579b', '#7aa83a', '#c9a227', '#5b8def', '#e45a5a'];

/** 이름 → 사람마다 고정된 색 (입력 중 표시용) */
export function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return REMOTE_COLORS[h % REMOTE_COLORS.length];
}

export type MinutesSessionOptions = {
  roomCode: string;
  /** 내 이름(로비에서 입력한 이름) */
  myName: string;
  /** 이 PC 에서 방에 들어온 시각(ms) — 회의 시작 시각의 바탕 */
  startedAt: number;
};

type Listener = () => void;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class MinutesSession {
  readonly doc = new Y.Doc();
  private readonly roomCode: string;
  private readonly myName: string;
  private readonly startedAt: number;
  private readonly autosave: MinutesAutosave;

  private active = false;
  private provider: MinutesProvider | null = null;
  private roster: RosterTracker | null = null;
  private detachFns: Array<() => void> = [];
  private answered = false;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteTimer: ReturnType<typeof setTimeout> | null = null;
  private rosterRepairTimer: ReturnType<typeof setTimeout> | null = null;
  private panelOpen = false;
  private warmed = false;

  // 복구 제안·임시 저장
  private settledOnce = false;
  private autosaveWanted = false;
  private pendingSaved: SavedMinutes | null = null;
  private restoreOffer: MinutesViewState['restoreOffer'] = null;
  private offerTimer: ReturnType<typeof setTimeout> | null = null;
  private keptAt = 0;

  // 지움 되돌리기 — 패널이 닫혀도 남도록 화면이 아니라 여기서 들고 있는다(항목마다 UNDO_MS)
  private undoList: Array<MinutesUndoItem & { expiresAt: number }> = [];
  private undoSeq = 0;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  // 화면에 보이는 상태
  private editedSinceSave = false;
  private lastSavedAt = 0;
  private lastSavedPath = '';
  private lastSavedDir = '';
  private savedCount = 0;
  private saving = false;
  private unseenRemote = false;
  private writerOverride: string | null = null;
  private notice: MinutesNotice | null = null;
  private remote: MinutesRemoteActivity | null = null;

  private listeners = new Set<Listener>();
  private notifyQueued = false;
  private version = 0;
  private cache: { version: number; state: MinutesViewState } | null = null;

  constructor(opts: MinutesSessionOptions) {
    this.roomCode = opts.roomCode;
    this.myName = opts.myName;
    this.startedAt = opts.startedAt;
    this.autosave = new MinutesAutosave(opts.roomCode, this.doc);
    // 맨 위 칸 3개를 미리 열어 둔다(처음 받은 고침이 일반 칸에 쌓였다가 나중에 바뀌면 «무엇이 바뀌었나» 를 놓친다)
    metaOf(this.doc);
    attendeesOf(this.doc);
    agendaOf(this.doc);
  }

  // ───────────────────────── React 연결 ─────────────────────────

  readonly subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  readonly getSnapshot = (): MinutesViewState => {
    if (this.cache && this.cache.version === this.version) return this.cache.state;
    const link: MinutesLinkStatus =
      this.provider?.getStatus() ?? { state: 'live', pending: 0, justSynced: false, oversize: false };
    const state: MinutesViewState = {
      doc: readView(this.doc),
      link,
      editedSinceSave: this.editedSinceSave,
      lastSavedAt: this.lastSavedAt,
      savedCount: this.savedCount,
      keptAt: this.keptAt,
      saving: this.saving,
      unseenRemote: this.unseenRemote,
      restoreOffer: this.restoreOffer,
      lastSavedPath: this.lastSavedPath,
      undo: this.undoList.map(({ expiresAt: _expiresAt, ...item }) => item),
      sameNames: this.roster?.sameNames() ?? [],
      writerOverride: this.writerOverride,
      myName: this.myName,
      myKey: autoKey(this.myName),
      notice: this.notice,
      remote: this.remote,
    };
    this.cache = { version: this.version, state };
    return state;
  };

  private bump(): void {
    this.version += 1;
    this.cache = null;
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      for (const cb of Array.from(this.listeners)) {
        try {
          cb();
        } catch (err) {
          console.error('[minutes] listener error', err);
        }
      }
    });
  }

  // ───────────────────────── 수명 ─────────────────────────

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.doc.on('update', this.onDocUpdate);
    this.doc.on('afterTransaction', this.onAfterTransaction);
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', this.onUnload);
    if (this.autosaveWanted) this.startAutosave();
    this.armUndoTimer();
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.doc.off('update', this.onDocUpdate);
    this.doc.off('afterTransaction', this.onAfterTransaction);
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', this.onUnload);
    this.detach();
    this.autosave.disable();
    for (const t of [this.settleTimer, this.remoteTimer, this.rosterRepairTimer, this.startTimer, this.offerTimer, this.undoTimer]) {
      if (t) clearTimeout(t);
    }
    this.settleTimer = this.remoteTimer = this.rosterRepairTimer = this.startTimer = this.offerTimer = this.undoTimer = null;
  }

  private readonly onUnload = (): void => {
    this.autosave.flush();
  };

  /** 시그널링이 새로 만들어졌다 — 회의록 메시지·참석자 정보를 이어 받는다 */
  attach(signaling: SignalingClient, myPeerId: string): void {
    this.detach();
    this.answered = false;

    const roster = new RosterTracker({
      doc: this.doc,
      selfId: myPeerId,
      selfName: this.myName,
      onChange: () => this.bump(), // 같은 이름으로 접속한 사람이 생기거나 사라졌다
    });
    const provider = new MinutesProvider({
      doc: this.doc,
      selfId: myPeerId,
      open: signaling.isOpen(),
      send: (msg) => signaling.send(msg),
      onAnswer: () => {
        // 이미 있던 사람이 문서를 보내 줬으니 이제 내 줄을 만들어도 된다
        this.answered = true;
        roster.setReady();
      },
    });
    this.roster = roster;
    this.provider = provider;

    signaling.on('minutes', (msg) => provider.handleMessage(msg));
    this.detachFns.push(
      // off() 하면 그 뒤에 오는 회의록 메시지가 대기열에 쌓이므로, 아무것도 안 하는 핸들러로 바꿔 둔다
      () => signaling.on('minutes', () => undefined),
      signaling.listen('peers', (m) => roster.setPeers(m.peers)),
      signaling.listen('sync', (m) => roster.setPeers(m.peers)),
      signaling.listen('peer-joined', (m) => {
        roster.peerJoined(m.peerId, m.displayName);
        provider.peerJoined();
      }),
      signaling.listen('peer-left', (m) => roster.peerLeft(m.peerId)),
      signaling.onOpenChange((open) => {
        provider.setOpen(open);
        roster.setOpen(open);
      }),
      provider.subscribe(() => this.bump())
    );
    roster.setOpen(signaling.isOpen());
    provider.start();

    this.settleTimer = setTimeout(() => this.settle(), SETTLE_MS);
    this.bump();
  }

  detach(): void {
    for (const fn of this.detachFns.splice(0)) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.provider?.destroy();
    this.roster?.destroy();
    this.provider = null;
    this.roster = null;
    this.bump();
  }

  /** 처음 문서를 받아 올 시간이 지났다 */
  private settle(): void {
    this.settleTimer = null;
    this.roster?.setReady();
    if (this.settledOnce) return;
    this.settledOnce = true;
    const saved = this.autosave.peek();
    if (saved && saved.hasContent) {
      // 같은 방에 다시 들어왔고 이 PC 에 내용이 있는 저장본이 있다. 지금 문서에 «없는» 내용이 있으면 복구(합치기)할지 묻는다.
      // (다른 참석자가 이미 내용을 갖고 있어도 묻는다 — 끊긴 채 고친 글이 이 저장본에만 있을 수 있다.)
      // 답하기 전엔 임시 저장을 시작하지 않는다 — 시작하면 지금 문서가 옛 저장본을 덮어쓴다.
      this.pendingSaved = saved;
      this.refreshOffer();
      return;
    }
    this.beginWorking();
  }

  /**
   * 복구 제안이 아직 필요한지 지금 문서와 견주어 다시 정한다.
   *  - 저장본이 지금 문서에 이미 다 들어 있으면 제안을 거두고 일을 시작한다(첫 응답이 늦어 «빈 문서» 로 잘못 제안했다가 진짜 문서가 온 경우 등)
   *  - 아니면 제안을 띄운다: 지금 문서가 비었으면 «복구», 내용이 있으면 «합치기» (무엇을 되살리는지 라벨 포함)
   */
  private refreshOffer(): void {
    const saved = this.pendingSaved;
    if (!saved) return;
    let preview: ReturnType<typeof previewRestore>;
    try {
      preview = previewRestore(this.doc, saved.update);
    } catch (err) {
      console.warn('[minutes] restore preview failed', err instanceof Error ? err.message : err);
      this.pendingSaved = null;
      this.restoreOffer = null;
      this.beginWorking();
      this.bump();
      return;
    }
    if (!preview.changed) {
      this.pendingSaved = null;
      this.restoreOffer = null;
      this.beginWorking();
      this.bump();
      return;
    }
    const mode = hasMinutesContent(this.doc) ? 'merge' : 'restore';
    const label = (preview.purpose || preview.firstTitle).slice(0, 30);
    const cur = this.restoreOffer;
    if (!cur || cur.mode !== mode || cur.label !== label || cur.savedAt !== saved.savedAt) {
      this.restoreOffer = { savedAt: saved.savedAt, mode, label };
      this.bump();
    }
  }

  private scheduleOfferRefresh(): void {
    if (!this.pendingSaved || this.offerTimer) return;
    this.offerTimer = setTimeout(() => {
      this.offerTimer = null;
      this.refreshOffer();
    }, OFFER_REFRESH_MS);
  }

  /** 회의 시작 시각을 채우고 임시 저장을 켠다 */
  private beginWorking(): void {
    const fill = () => ensureMeetingStart(this.doc, kstDateText(this.startedAt), kstHHmm(this.startedAt));
    if ((this.roster?.peerCount() ?? 0) > 0 && !this.answered) {
      // 다른 사람이 이미 있는데 아직 문서가 안 왔다 — 그 사람이 정해 둔 시작 시각을 내 것으로 덮지 않도록 조금 더 기다린다
      this.startTimer = setTimeout(() => {
        this.startTimer = null;
        fill();
      }, 6000);
    } else {
      fill();
    }
    this.autosaveWanted = true;
    if (this.active) this.startAutosave();
  }

  private startAutosave(): void {
    this.autosave.enable(
      () => this.writerOverride,
      (at) => {
        this.keptAt = at;
        this.bump();
      }
    );
  }

  // ───────────────────────── 복구 제안 ─────────────────────────

  acceptRestore(): void {
    const saved = this.pendingSaved;
    this.pendingSaved = null;
    this.restoreOffer = null;
    if (this.offerTimer) clearTimeout(this.offerTimer);
    this.offerTimer = null;
    if (saved) {
      try {
        restoreInto(this.doc, saved.update); // 저장본 중 지금 문서에 없는 부분만 합친다(회의 정보 칸은 지금 값을 지킴)
        if (saved.writer && this.writerOverride === null) this.writerOverride = saved.writer;
        this.editedSinceSave = true; // 복구한 내용은 아직 엑셀로 저장된 적이 없다 → 나갈 때 확인 대상
        this.notice = { kind: 'restored' };
      } catch (err) {
        console.warn('[minutes] restore failed', err instanceof Error ? err.message : err);
      }
    }
    this.beginWorking();
    this.bump();
  }

  declineRestore(): void {
    this.pendingSaved = null;
    this.restoreOffer = null;
    if (this.offerTimer) clearTimeout(this.offerTimer);
    this.offerTimer = null;
    this.autosave.clear();
    this.beginWorking();
    this.bump();
  }

  // ───────────────────────── 문서 변화 감시 ─────────────────────────

  private readonly onDocUpdate = (_update: Uint8Array, origin: unknown): void => {
    if (isUserOrigin(origin) && !this.editedSinceSave) {
      this.editedSinceSave = true;
      this.bump();
    }
    // 복구 제안이 떠 있는 동안 문서가 바뀌면(남의 문서가 뒤늦게 도착 · 내가 쓰기 시작) 제안이 아직 맞는지 다시 본다
    if (this.pendingSaved) this.scheduleOfferRefresh();
  };

  /**
   * 이번 고침이 건드린 «맨 위 칸»(root) 들. 안쪽 문단·글자 칸이 바뀌어도 그 바깥의 칸(회의 정보·참석자·안건·안건 내용)으로 올려 본다.
   * (tr.changedParentTypes 는 쓰지 않는다 — 아직 아무도 getXmlFragment 로 열어 보지 않은 안건 내용 칸은 일반 칸(AbstractType)이라
   *  거기서는 바뀜 알림이 오지 않는다. 패널을 닫아 둔 PC 가 바로 그런 경우다.)
   */
  private touchedRoots(tr: Y.Transaction): Set<unknown> {
    const roots = new Set<unknown>();
    tr.changed.forEach((_subs, type) => {
      let cur = type as unknown as { _item?: { parent?: unknown } | null };
      for (let guard = 0; cur && cur._item && guard < 200; guard++) cur = cur._item.parent as typeof cur;
      roots.add(cur);
    });
    return roots;
  }

  private readonly onAfterTransaction = (tr: Y.Transaction): void => {
    const roots = this.touchedRoots(tr);
    const metaChanged = roots.has(metaOf(this.doc));
    const attChanged = roots.has(attendeesOf(this.doc));
    const agChanged = roots.has(agendaOf(this.doc));
    let bodyId: string | null = null;
    this.doc.share.forEach((type, name) => {
      if (name.startsWith('agenda:') && roots.has(type)) bodyId = name.slice('agenda:'.length);
    });
    // 안건 내용(글)만 바뀐 경우는 화면 상태가 안 바뀌므로 다시 그리지 않는다(글자 하나마다 패널 전체가 다시 그려지지 않게)
    if (metaChanged || attChanged || agChanged) this.bump();

    if (isRemoteOrigin(tr.origin)) {
      const section = bodyId ? `body:${bodyId}` : agChanged ? 'ag' : metaChanged ? 'info' : null;
      if (section) this.noteRemote(tr.origin.from, section);
      // 남이 고친 뒤 접속자 줄 상태가 어긋났을 수 있으니 잠시 뒤 한 번 맞춰 본다
      if (attChanged && !this.rosterRepairTimer) {
        this.rosterRepairTimer = setTimeout(() => {
          this.rosterRepairTimer = null;
          this.roster?.reconcile();
        }, 600);
      }
    }
  };

  private noteRemote(fromPeerId: string, section: string): void {
    const who = this.roster?.nameOf(fromPeerId) ?? '';
    this.remote = { who, color: who ? colorForName(who) : REMOTE_COLORS[0], section, ts: Date.now() };
    if (!this.panelOpen) this.unseenRemote = true;
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.remoteTimer = setTimeout(() => {
      this.remoteTimer = null;
      this.remote = null;
      this.bump();
    }, REMOTE_SHOW_MS);
    this.bump();
  }

  /** 회의록 패널이 열렸나 — 닫혀 있는 사이 남이 고친 게 있으면 단추에 점을 띄우기 위해 */
  setPanelOpen(open: boolean): void {
    if (this.panelOpen === open) return;
    this.panelOpen = open;
    if (open && this.unseenRemote) this.unseenRemote = false;
    if (open) this.warmUp();
    this.bump();
  }

  /**
   * 패널을 처음 열 때 한 번: 메인 프로세스의 엑셀 모듈(exceljs)을 미리 깨워 둔다 — 첫 저장이 느리지 않게.
   * 기본 저장 폴더를 묻는 호출이 그 일을 겸한다(메인이 그 호출을 받으면 모듈을 불러 옴). 결과는 쓰지 않고 실패해도 무시한다.
   */
  private warmUp(): void {
    if (this.warmed) return;
    this.warmed = true;
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (api && typeof api.getDefaultMinutesFolder === 'function') {
        void api.getDefaultMinutesFolder().catch(() => undefined);
      }
    } catch {
      // 예열만 못 한다
    }
  }

  // ───────────────────────── 화면에서 고치는 것 ─────────────────────────

  setMeta(key: MetaKey, value: string | null): void {
    setMetaField(this.doc, key, value, ORIGIN_USER);
  }

  setWriter(value: string | null): void {
    this.writerOverride = value;
    this.bump();
  }

  addAgenda(): string {
    return addAgenda(this.doc, {}, ORIGIN_USER);
  }

  updateAgenda(id: string, patch: { title?: string; dept?: string }): void {
    updateAgenda(this.doc, id, patch, ORIGIN_USER);
  }

  /** 안건을 지운다(10초 되돌리기 목록에 올라간다) → 되돌릴 때 쓸 id 를 돌려준다 */
  removeAgenda(id: string): string {
    const item = readAgenda(this.doc).find((a) => a.id === id);
    const hasBody = fragmentPlainText(this.doc.getXmlFragment(agendaFieldName(id))).trim() !== '';
    setAgendaDeleted(this.doc, id, true, ORIGIN_USER);
    if (item) this.pushUndo({ kind: 'agenda', title: item.title, hasBody, agendaId: id });
    return id;
  }

  restoreAgenda(id: string): void {
    setAgendaDeleted(this.doc, id, false, ORIGIN_USER);
  }

  addCompanion(hostKey: string | null): string {
    return addCompanion(this.doc, hostKey, Date.now(), ORIGIN_USER);
  }

  updateAttendee(key: string, patch: { name?: string; dept?: string; rank?: string }): void {
    updateAttendee(this.doc, key, patch, ORIGIN_USER);
  }

  /** 참석자 줄을 뺀다(접속자 줄이면 그 아래 «동석» 줄도 함께. 10초 되돌리기 목록에 올라간다) → 되돌릴 key 목록 */
  removeAttendee(key: string): string[] {
    const name = readAttendees(this.doc).find((r) => r.key === key)?.name ?? '';
    const keys = attendeeRemovalKeys(this.doc, key);
    const changed = setAttendeesExcluded(this.doc, keys, true, ORIGIN_USER);
    if (changed.length > 0) this.pushUndo({ kind: 'attendee', name, extra: changed.length - 1, keys: changed });
    return changed;
  }

  restoreAttendees(keys: string[]): void {
    setAttendeesExcluded(this.doc, keys, false, ORIGIN_USER);
  }

  // ───────────────────────── 지움 되돌리기(10초) ─────────────────────────
  // 한 줄(슬롯)이 아니라 목록이다: 연달아 지워도 앞의 것을 되돌릴 수 있고, 패널을 닫아도(화면이 사라져도) 남는다.

  private pushUndo(item: DistributiveOmit<MinutesUndoItem, 'id'>): void {
    this.undoSeq += 1;
    this.undoList.push({ ...item, id: this.undoSeq, expiresAt: Date.now() + UNDO_MS } as MinutesUndoItem & { expiresAt: number });
    while (this.undoList.length > UNDO_MAX) this.undoList.shift();
    this.armUndoTimer();
    this.bump();
  }

  /** 가장 먼저 만료될 항목에 맞춰 타이머를 하나만 둔다 */
  private armUndoTimer(): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    if (!this.active || this.undoList.length === 0) return;
    const next = Math.min(...this.undoList.map((u) => u.expiresAt));
    this.undoTimer = setTimeout(() => {
      this.undoTimer = null;
      const now = Date.now();
      const before = this.undoList.length;
      this.undoList = this.undoList.filter((u) => u.expiresAt > now);
      if (this.undoList.length !== before) this.bump();
      this.armUndoTimer();
    }, Math.max(0, next - Date.now()) + 20);
  }

  /** 지움 한 건을 되돌린다. 이미 만료됐거나 없는 항목이면 false. */
  undoRemoval(id: number): boolean {
    const at = this.undoList.findIndex((u) => u.id === id);
    if (at < 0) return false;
    const [item] = this.undoList.splice(at, 1);
    if (item.kind === 'agenda') this.restoreAgenda(item.agendaId);
    else this.restoreAttendees(item.keys);
    this.armUndoTimer();
    this.bump();
    return true;
  }

  // ───────────────────────── 저장 · 나가기 ─────────────────────────

  hasContent(): boolean {
    return hasMinutesContent(this.doc);
  }

  /** 나가기 전에 «저장하셨나요?» 를 물어야 하나: 마지막 저장 뒤 내가 고쳤고 내용이 있을 때 */
  needsLeaveConfirm(): boolean {
    return this.editedSinceSave && hasMinutesContent(this.doc);
  }

  /**
   * 회의에서 나간 뒤 로비에 보여 줄 저장 안내. 이 회의에서 엑셀로 저장한 적이 없으면 null.
   * 방이 사라지면 화면의 저장 알림도 함께 사라지므로, 나가는 쪽(MeetingRoom)이 이 값을 App 에 넘긴다.
   */
  getLeaveInfo(): MinutesLeftInfo | null {
    if (!this.lastSavedPath) return null;
    const fileName = this.lastSavedPath.split(/[\\/]/).pop() ?? this.lastSavedPath;
    return { filePath: this.lastSavedPath, fileName, dir: this.lastSavedDir, unsavedAfter: this.needsLeaveConfirm() };
  }

  setNotice(n: MinutesNotice | null): void {
    this.notice = n;
    this.bump();
  }

  /** 마지막으로 정한 저장 폴더(없으면 앱 기본 폴더) */
  async getSaveDir(): Promise<string> {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(MINUTES_DIR_KEY);
    } catch {
      stored = null;
    }
    if (stored) return stored;
    const api = window.electronAPI;
    return api ? await api.getDefaultMinutesFolder() : '';
  }

  /** 저장 폴더를 고른다(고르면 기억). 취소하면 null. */
  async chooseSaveDir(): Promise<string | null> {
    const api = window.electronAPI;
    if (!api) return null;
    const current = await this.getSaveDir().catch(() => '');
    const picked = await api.chooseRecordingFolder(current || undefined);
    if (!picked) return null;
    try {
      localStorage.setItem(MINUTES_DIR_KEY, picked);
    } catch {
      // 기억만 못 한다
    }
    return picked;
  }

  async openSavedFile(filePath: string): Promise<void> {
    await window.electronAPI?.openMinutesFile(filePath);
  }

  async openSavedFolder(filePath: string): Promise<void> {
    await window.electronAPI?.openRecordingFolder(filePath);
  }

  /**
   * 엑셀(.xlsx)로 저장한다. 성공하면 true.
   * 내용이 없거나 데스크톱 앱이 아니면 저장하지 않고 알림만 띄운다.
   */
  async save(): Promise<boolean> {
    if (this.saving) return false;
    if (!hasMinutesContent(this.doc)) {
      this.setNotice({ kind: 'empty' });
      return false;
    }
    const api = window.electronAPI;
    if (!api || typeof api.saveMinutes !== 'function') {
      this.setNotice({ kind: 'no-electron' });
      return false;
    }
    this.saving = true;
    this.notice = null;
    this.bump();
    let dir = '';
    const editedBefore = this.editedSinceSave;
    try {
      let company = getCachedCompany();
      if (!company) company = await refreshCompany({ timeoutMs: 2500 }); // 기다리는 동안 고친 글도 아래에서 파일에 들어간다
      const now = Date.now();
      applyAutoEnd(this.doc, kstHHmm(now)); // 끝 시각은 저장 때 자동(사람이 고친 값은 그대로)
      const writer = this.writerOverride?.trim() || this.myName;
      // 여기서부터 만들어지는 파일에는 «지금 문서» 가 들어간다 → 이 순간 이후에 고친 것만 «저장 안 된 고침» 이다.
      // (끝난 뒤에 false 로 내리면 저장하는 동안 고친 글이 «저장됨» 으로 잘못 처리되어 나갈 때 확인창이 안 뜬다.)
      // 사람이 고치면 onDocUpdate 가 다시 true 로 올린다.
      this.editedSinceSave = false;
      const report = { truncated: false };
      const exportDoc = buildExport(this.doc, company, writer, now, { startedAt: this.startedAt, report });
      dir = await this.getSaveDir();
      const res = await api.saveMinutes({ dir, doc: exportDoc });
      if (res.ok) {
        this.lastSavedAt = Date.now();
        this.lastSavedPath = res.filePath;
        this.lastSavedDir = dir;
        this.savedCount += 1;
        const fileName = res.filePath.split(/[\\/]/).pop() ?? res.filePath;
        this.notice = {
          kind: 'saved',
          filePath: res.filePath,
          fileName,
          dir,
          offline: (this.provider?.getStatus().state ?? 'live') !== 'live',
          renamedHint: / \(\d+\)\.xlsx$/i.test(fileName),
          truncated: report.truncated,
        };
        return true;
      }
      this.editedSinceSave = editedBefore || this.editedSinceSave; // 저장 실패 — 저장 안 된 고침은 그대로 남는다
      this.notice = { kind: 'save-failed', message: res.message, dir };
      return false;
    } catch (err) {
      this.editedSinceSave = editedBefore || this.editedSinceSave;
      this.notice = { kind: 'save-failed', message: err instanceof Error ? err.message : String(err), dir };
      return false;
    } finally {
      this.saving = false;
      this.bump();
    }
  }
}
