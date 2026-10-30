// 회의록 Y.Doc 모양 + 읽기/쓰기 도구 (React·DOM 없이 yjs 만 씀 → node 시험에서 그대로 불러 쓴다).
//
//   meta       Y.Map   purpose · place(없으면 자동 «웹 미팅») · date · start · end · endAuto
//   attendees  Y.Map   키 'a:'+정규화 이름(접속자 자동 줄 — 재접속·새 peerId 여도 한 줄) | 'm:'+uuid(동석·기타)
//                      값 Y.Map: name · dept · rank · companion · hostKey · firstSeen · leftAt · excluded
//   agenda     Y.Array 안건 Y.Map: id · title · dept · deleted(지움 표시 — 10초 되돌리기가 이걸 뒤집는다)
//   'agenda:'+id  Y.XmlFragment  안건별 회의 내용 (Tiptap Collaboration 의 field)
//
// 지울 때 진짜 지우지 않고 deleted / excluded 표시만 한다: 되돌리기가 «표시 뒤집기» 라서 여러 PC 가 동시에 눌러도 한 결과로 합쳐진다.
// 겹침 확인: 기존 코드에 Yjs 문서 모양은 없음(채팅은 중계만, 저장 없음).

import * as Y from 'yjs';
import type { AgendaItem, AttendeeRow, MinutesDocView } from './types';

export const DEFAULT_PLACE = '웹 미팅';

// ───────────────────────── 쓴 사람(origin) 구분 ─────────────────────────

/** 다른 PC 에서 온 고침을 반영할 때 붙이는 표 — 이 표가 붙은 고침은 다시 내보내지 않는다. */
export class RemoteOrigin {
  constructor(public readonly from: string) {}
}
export const isRemoteOrigin = (o: unknown): o is RemoteOrigin => o instanceof RemoteOrigin;
/** 앱이 알아서 쓴 값(접속 기록·회의 시작 시각 등) — «내가 고쳤다» 로 세지 않는다. */
export const ORIGIN_AUTO = 'minutes-auto';
/** 사람이 화면에서 고친 값. (Tiptap 편집기는 자기 키 객체를 origin 으로 쓰는데 그것도 «사람» 으로 센다.) */
export const ORIGIN_USER = 'minutes-user';
/** 임시 저장본 복구 */
export const ORIGIN_RESTORE = 'minutes-restore';

/** 사람이 고친 것인가 (원격·자동·복구가 아닌 모든 origin) */
export const isUserOrigin = (o: unknown): boolean =>
  !isRemoteOrigin(o) && o !== ORIGIN_AUTO && o !== ORIGIN_RESTORE;

// ───────────────────────── 문서 자리 ─────────────────────────

export const metaOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>('meta');
export const attendeesOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap<Y.Map<unknown>>('attendees');
export const agendaOf = (doc: Y.Doc): Y.Array<Y.Map<unknown>> => doc.getArray<Y.Map<unknown>>('agenda');
export const agendaFieldName = (id: string): string => 'agenda:' + id;

export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const raw = c?.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return raw.replace(/-/g, '').slice(0, 10);
}

export function normalizeName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim();
}
/** 접속자 자동 줄의 key — 모든 PC 가 같은 이름이면 같은 key 를 만든다 */
export const autoKey = (name: string): string => 'a:' + normalizeName(name).toLowerCase();

// ───────────────────────── 읽기 ─────────────────────────

const str = (m: Y.Map<unknown>, k: string): string => {
  const v = m.get(k);
  return typeof v === 'string' ? v : '';
};
const numOrNull = (m: Y.Map<unknown>, k: string): number | null => {
  const v = m.get(k);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

type RawRow = { key: string; map: Y.Map<unknown> };

function rawAttendees(doc: Y.Doc): RawRow[] {
  const out: RawRow[] = [];
  attendeesOf(doc).forEach((map, key) => {
    if (map instanceof Y.Map) out.push({ key, map });
  });
  return out;
}

function toRow(r: RawRow): AttendeeRow {
  const isAuto = r.key.startsWith('a:');
  const host = str(r.map, 'hostKey');
  return {
    key: r.key,
    kind: isAuto ? 'auto' : host ? 'with' : 'other',
    name: str(r.map, 'name'),
    dept: str(r.map, 'dept'),
    rank: str(r.map, 'rank'),
    hostKey: host || null,
    firstSeen: numOrNull(r.map, 'firstSeen') ?? 0,
    leftAt: numOrNull(r.map, 'leftAt'),
  };
}

const byFirstSeen = (a: AttendeeRow, b: AttendeeRow): number =>
  a.firstSeen - b.firstSeen || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** 화면 순서: 접속자 줄 → 그 아래 «동석» 줄들 → 마지막에 «기타» 줄들. 제외한 줄·주인이 사라진 동석 줄은 뺀다. */
export function readAttendees(doc: Y.Doc): AttendeeRow[] {
  const raws = rawAttendees(doc);
  const visible = raws.filter((r) => r.map.get('excluded') !== true);
  const rows = visible.map(toRow);
  const autos = rows.filter((r) => r.kind === 'auto').sort(byFirstSeen);
  const withs = rows.filter((r) => r.kind === 'with');
  const others = rows.filter((r) => r.kind === 'other').sort(byFirstSeen);
  const out: AttendeeRow[] = [];
  for (const a of autos) {
    out.push(a);
    withs
      .filter((w) => w.hostKey === a.key)
      .sort(byFirstSeen)
      .forEach((w) => out.push(w));
  }
  // 주인 줄이 «제외» 됐거나 없는 동석 줄은 화면에 내지 않는다(주인을 되돌리면 다시 나타남)
  others.forEach((o) => out.push(o));
  return out;
}

export function readAgenda(doc: Y.Doc, includeDeleted = false): AgendaItem[] {
  const out: AgendaItem[] = [];
  agendaOf(doc).forEach((m) => {
    if (!(m instanceof Y.Map)) return;
    const id = str(m, 'id');
    if (!id) return;
    if (!includeDeleted && m.get('deleted') === true) return;
    out.push({ id, title: str(m, 'title'), dept: str(m, 'dept') });
  });
  // 같은 id 가 두 번 들어온 경우(동시에 되돌리기 등) 첫 줄만
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

export function readView(doc: Y.Doc): MinutesDocView {
  const meta = metaOf(doc);
  const place = meta.get('place');
  return {
    purpose: str(meta, 'purpose'),
    place: typeof place === 'string' ? place : null,
    date: str(meta, 'date'),
    start: str(meta, 'start'),
    end: str(meta, 'end'),
    endAuto: meta.get('endAuto') === true,
    attendees: readAttendees(doc),
    agenda: readAgenda(doc),
  };
}

// ───────────────────────── 글 내용 ─────────────────────────

type TextDeltaPart = { insert?: unknown };

function collectText(node: unknown, out: string[]): void {
  if (node instanceof Y.XmlText) {
    for (const part of node.toDelta() as TextDeltaPart[]) {
      if (typeof part.insert === 'string') out.push(part.insert);
      else if (part.insert instanceof Y.XmlElement) out.push(part.insert.nodeName === 'hardBreak' ? '\n' : '');
    }
  } else if (node instanceof Y.XmlElement) {
    if (node.nodeName === 'hardBreak') {
      out.push('\n');
      return;
    }
    for (const child of node.toArray()) collectText(child, out);
    if (node.nodeName === 'paragraph') out.push('\n');
  } else if (node instanceof Y.XmlFragment) {
    for (const child of node.toArray()) collectText(child, out);
  }
}

/** 안건 내용 칸의 글자만 */
export function fragmentPlainText(frag: Y.XmlFragment): string {
  const out: string[] = [];
  collectText(frag, out);
  return out.join('');
}

/** 저장할 내용이 있나: 지우지 않은 안건 중 제목이나 내용이 한 글자라도 있으면 true */
export function hasMinutesContent(doc: Y.Doc): boolean {
  for (const a of readAgenda(doc)) {
    if (a.title.trim()) return true;
    if (fragmentPlainText(doc.getXmlFragment(agendaFieldName(a.id))).trim()) return true;
  }
  return false;
}

// ───────────────────────── 쓰기: 회의 정보 ─────────────────────────

export type MetaKey = 'purpose' | 'place' | 'date' | 'start' | 'end';

/** 같은 값이면 쓰지 않는다(쓰기마다 새 기록이 쌓이고 다른 PC 로 전송되므로). value=null 이면 자동으로 되돌림. */
export function setMetaField(doc: Y.Doc, key: MetaKey, value: string | null, origin: unknown = ORIGIN_USER): void {
  const meta = metaOf(doc);
  if (value === null) {
    if (meta.has(key)) doc.transact(() => meta.delete(key), origin);
    return;
  }
  if (meta.get(key) === value) return;
  doc.transact(() => {
    meta.set(key, value);
    if (key === 'end') meta.set('endAuto', false); // 사람이 끝 시각을 고치면 더는 «저장 때 자동» 이 아니다
  }, origin);
}

/** 끝 시각을 «저장 때 자동» 으로 채운다. 사람이 직접 고친 끝 시각은 그대로 둔다. 돌려주는 값 = 쓰인 끝 시각. */
export function applyAutoEnd(doc: Y.Doc, hhmm: string): string {
  const meta = metaOf(doc);
  const cur = typeof meta.get('end') === 'string' ? (meta.get('end') as string) : '';
  const isAuto = meta.get('endAuto') === true;
  if (cur && !isAuto) return cur;
  if (cur !== hhmm || !isAuto) {
    doc.transact(() => {
      meta.set('end', hhmm);
      meta.set('endAuto', true);
    }, ORIGIN_AUTO);
  }
  return hhmm;
}

/** 회의 시작 날짜·시각이 비어 있으면 채운다(한 번만). */
export function ensureMeetingStart(doc: Y.Doc, dateText: string, hhmm: string): void {
  const meta = metaOf(doc);
  const hasDate = typeof meta.get('date') === 'string' && (meta.get('date') as string) !== '';
  const hasStart = typeof meta.get('start') === 'string' && (meta.get('start') as string) !== '';
  if (hasDate && hasStart) return;
  doc.transact(() => {
    if (!hasDate) meta.set('date', dateText);
    if (!hasStart) meta.set('start', hhmm);
  }, ORIGIN_AUTO);
}

// ───────────────────────── 쓰기: 안건 ─────────────────────────

function findAgenda(doc: Y.Doc, id: string): Y.Map<unknown> | null {
  let hit: Y.Map<unknown> | null = null;
  agendaOf(doc).forEach((m) => {
    if (!hit && m instanceof Y.Map && m.get('id') === id) hit = m;
  });
  return hit;
}

export function addAgenda(doc: Y.Doc, init: { title?: string; dept?: string } = {}, origin: unknown = ORIGIN_USER): string {
  const id = newId();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('id', id);
    m.set('title', init.title ?? '');
    m.set('dept', init.dept ?? '');
    agendaOf(doc).push([m]);
  }, origin);
  return id;
}

export function updateAgenda(doc: Y.Doc, id: string, patch: { title?: string; dept?: string }, origin: unknown = ORIGIN_USER): void {
  const m = findAgenda(doc, id);
  if (!m) return;
  doc.transact(() => {
    if (patch.title !== undefined && m.get('title') !== patch.title) m.set('title', patch.title);
    if (patch.dept !== undefined && m.get('dept') !== patch.dept) m.set('dept', patch.dept);
  }, origin);
}

/** 안건 지움/되돌림 — 회의 내용(XmlFragment)은 그대로 남아 있어서 되돌리면 내용도 함께 돌아온다. */
export function setAgendaDeleted(doc: Y.Doc, id: string, deleted: boolean, origin: unknown = ORIGIN_USER): void {
  const m = findAgenda(doc, id);
  if (!m) return;
  if ((m.get('deleted') === true) === deleted) return;
  doc.transact(() => {
    if (deleted) m.set('deleted', true);
    else m.delete('deleted');
  }, origin);
}

// ───────────────────────── 쓰기: 참석자 ─────────────────────────

/** 접속자 자동 줄을 보장한다(없으면 만들고, 있으면 «나감»·«제외» 표시를 푼다). 돌려주는 값 = key. */
export function ensureAutoAttendee(doc: Y.Doc, name: string, now: number, origin: unknown = ORIGIN_AUTO): string {
  const clean = normalizeName(name);
  const key = autoKey(clean);
  const att = attendeesOf(doc);
  const row = att.get(key);
  if (!(row instanceof Y.Map)) {
    doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('name', clean);
      m.set('companion', false);
      m.set('firstSeen', now);
      att.set(key, m);
    }, origin);
    return key;
  }
  if (row.has('leftAt') || row.get('excluded') === true || str(row, 'name') === '') {
    doc.transact(() => {
      if (row.has('leftAt')) row.delete('leftAt');
      if (row.get('excluded') === true) row.delete('excluded');
      if (str(row, 'name') === '') row.set('name', clean);
    }, origin);
  }
  return key;
}

/** 나감 표시. 이미 나감 표시가 있으면 그대로 둔다(여러 PC 가 같은 일을 해도 한 번만). */
export function markAttendeeLeft(doc: Y.Doc, key: string, at: number, origin: unknown = ORIGIN_AUTO): void {
  const row = attendeesOf(doc).get(key);
  if (!(row instanceof Y.Map)) return;
  if (row.has('leftAt')) return;
  doc.transact(() => row.set('leftAt', at), origin);
}

/** 동석(hostKey 있음) 또는 기타(hostKey=null) 줄 추가 */
export function addCompanion(doc: Y.Doc, hostKey: string | null, now: number, origin: unknown = ORIGIN_USER): string {
  const key = 'm:' + newId();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('name', '');
    m.set('companion', true);
    if (hostKey) m.set('hostKey', hostKey);
    m.set('firstSeen', now);
    attendeesOf(doc).set(key, m);
  }, origin);
  return key;
}

export function updateAttendee(
  doc: Y.Doc,
  key: string,
  patch: { name?: string; dept?: string; rank?: string },
  origin: unknown = ORIGIN_USER
): void {
  const row = attendeesOf(doc).get(key);
  if (!(row instanceof Y.Map)) return;
  doc.transact(() => {
    // 접속자 자동 줄의 이름은 key 의 바탕이라 고치지 않는다
    if (patch.name !== undefined && !key.startsWith('a:') && row.get('name') !== patch.name) row.set('name', patch.name);
    if (patch.dept !== undefined && row.get('dept') !== patch.dept) row.set('dept', patch.dept);
    if (patch.rank !== undefined && row.get('rank') !== patch.rank) row.set('rank', patch.rank);
  }, origin);
}

/** «제외»/«빼기» 표시와 되돌림. 돌려주는 값 = 실제로 바뀐 key 목록. */
export function setAttendeesExcluded(doc: Y.Doc, keys: string[], excluded: boolean, origin: unknown = ORIGIN_USER): string[] {
  const changed: string[] = [];
  doc.transact(() => {
    for (const key of keys) {
      const row = attendeesOf(doc).get(key);
      if (!(row instanceof Y.Map)) continue;
      if ((row.get('excluded') === true) === excluded) continue;
      if (excluded) row.set('excluded', true);
      else row.delete('excluded');
      changed.push(key);
    }
  }, origin);
  return changed;
}

/** 줄을 빼면 함께 사라져야 하는 key 들: 그 줄 + (접속자 줄이면) 그 아래 «동석» 줄들 */
export function attendeeRemovalKeys(doc: Y.Doc, key: string): string[] {
  const keys = [key];
  if (key.startsWith('a:')) {
    for (const r of rawAttendees(doc)) {
      if (r.map.get('excluded') !== true && str(r.map, 'hostKey') === key) keys.push(r.key);
    }
  }
  return keys;
}

// ───────────────────────── 복구용 ─────────────────────────

const RESTORE_META_KEYS = ['purpose', 'place', 'date', 'start', 'end', 'endAuto'];

/** 저장본 중 «지금 문서에 아직 없는 부분»(상태 벡터 기준 차분). 같은 회의에서 온 부분은 이미 들어 있어 빠진다. */
function savedDiff(doc: Y.Doc, saved: Uint8Array): { diff: Uint8Array; tmp: Y.Doc } {
  const tmp = new Y.Doc();
  Y.applyUpdate(tmp, saved);
  return { diff: Y.encodeStateAsUpdate(tmp, Y.encodeStateVector(doc)), tmp };
}

/**
 * «사람이 쓴 내용» 만 모은 지문. 복구 제안이 필요한지(= 저장본이 지금 문서에 없는 내용을 갖고 있나) 가를 때 쓴다.
 * 접속 기록(나감 시각·처음 본 시각)과 자동으로 채워지는 날짜·시각은 뺀다 — 그것만 다르다고 «복구?» 를 묻지 않도록.
 */
function contentSignature(doc: Y.Doc): string {
  const meta = metaOf(doc);
  return JSON.stringify([
    str(meta, 'purpose'),
    typeof meta.get('place') === 'string' ? meta.get('place') : null,
    readAgenda(doc).map((a) => [a.id, a.title, a.dept, fragmentPlainText(doc.getXmlFragment(agendaFieldName(a.id)))]),
    readAttendees(doc).map((r) => [r.key, r.name, r.dept, r.rank, r.hostKey]),
  ]);
}

export type RestorePreview = {
  /** 저장본에 지금 문서에 없는 내용이 있나 */
  changed: boolean;
  /** 저장본의 회의 목적(없으면 '') */
  purpose: string;
  /** 저장본의 첫 안건 제목(없으면 '') */
  firstTitle: string;
};

/** 임시 저장본을 지금 문서에 합치면 무엇이 달라지는지 미리 본다(문서는 건드리지 않는다). */
export function previewRestore(doc: Y.Doc, saved: Uint8Array): RestorePreview {
  const { diff, tmp } = savedDiff(doc, saved);
  const clone = new Y.Doc();
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
    const before = contentSignature(clone);
    Y.applyUpdate(clone, diff);
    const changed = contentSignature(clone) !== before;
    return {
      changed,
      purpose: str(metaOf(tmp), 'purpose').trim(),
      firstTitle: readAgenda(tmp)[0]?.title.trim() ?? '',
    };
  } finally {
    clone.destroy();
    tmp.destroy();
  }
}

/**
 * 임시 저장본 «중 지금 문서에 없는 부분만» 지금 문서에 합친다.
 * 회의 정보 칸(목적·장소·날짜·시각)은 지금 문서에 값이 이미 있으면 그 값을 지킨다 — 다른 회의의 저장본이 지금 회의의 정보를 덮어쓰지 못하게.
 * 지금 문서에 그 칸이 비어 있으면 저장본 값으로 채운다(같은 칸을 둘 다 썼을 때 «나중 시각» 이 이기는 것도 막음).
 */
export function restoreInto(doc: Y.Doc, saved: Uint8Array): void {
  const { diff, tmp } = savedDiff(doc, saved);
  try {
    const meta = metaOf(doc);
    const before: Record<string, unknown> = {};
    for (const k of RESTORE_META_KEYS) before[k] = meta.get(k);
    Y.applyUpdate(doc, diff, ORIGIN_RESTORE);
    const from = metaOf(tmp);
    doc.transact(() => {
      for (const k of RESTORE_META_KEYS) {
        const had = before[k] !== undefined && before[k] !== '';
        const want = had ? before[k] : from.has(k) ? from.get(k) : undefined;
        if (want !== undefined && meta.get(k) !== want) meta.set(k, want);
      }
    }, ORIGIN_RESTORE);
  } finally {
    tmp.destroy();
  }
}
