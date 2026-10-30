// 회의록 패널 — 하단 바 📝 단추로 여는 오른쪽 패널(폭 440px, 채팅 패널과 동시에 열리지 않음).
// 칸 구성·문구·색은 mockups/meeting_minutes_mockup.html (사장 확인본)을 따른다:
//   상태줄(실시간 공유 / 연결 끊김) → 접기 줄 → 회의 정보 · 참석자 · 회의 안건 → 회의 내용(안건마다 흰 종이) → 저장
// 내용은 서버에 저장하지 않고 참석자끼리 실시간으로 합친다(src/lib/minutes/session.ts). 지우기는 «표시만» 하고 10초 안에 되돌릴 수 있다.
// 겹침 확인: electron/minutesExcel.ts 와 다름 — 그건 메인의 엑셀 만들기이고, 이 파일은 렌더러의 회의록 패널 화면(입력·참석자·안건·저장 단추)이다.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useT } from '../i18n';
import type { MinutesSession } from '../lib/minutes/session';
import { useMinutesState } from '../lib/minutes/useMinutes';
import type { AgendaItem, AttendeeRow } from '../lib/minutes/types';
import { DEFAULT_PLACE } from '../lib/minutes/model';
import { circledNumber } from '../lib/minutes/glyphs';
import { kstHHmm, normalizeDateInput, normalizeTimeInput } from '../lib/minutes/kst';
import MinutesWritingArea from './MinutesEditors';
import { MinutesUndoStack } from './MinutesToast';

const STR = {
  ko: {
    title: '📝 회의록',
    close: '회의록 닫기',
    live: '실시간 공유 중',
    offline: '연결 끊김',
    syncing: '다시 연결 중…',
    justSynced: '✓ 다시 연결됨 · 맞췄습니다',
    whoIdle: '누가 쓰면 여기에 표시됩니다',
    whoOff: '다시 연결을 시도하는 중…',
    someone: '누군가',
    typing: (who: string, label: string) => `${who}님이 ${label} 입력 중…`,
    typingTag: (who: string) => `${who} 입력 중`,
    secInfo: '회의 정보를',
    secAg: '안건을',
    secBody: (n: string) => `${n} 안건 회의 내용을`,
    offA: '인터넷 연결이 끊겼습니다. 지금 쓰는 내용은 ',
    offB: '이 PC에 보관',
    offC: '되고, 다시 연결되면 ',
    offD: '자동으로 맞춥니다',
    offE: '.',
    pending: (n: number) => ` (고친 곳 ${n}군데 대기 중)`,
    syncA: '다시 연결했습니다. 서로 고친 내용을 ',
    syncB: '맞추는 중',
    syncC: '입니다…',
    oversize: '회의록이 너무 큽니다. 일부 고침이 다른 사람에게 전달되지 않았거나, 다른 사람의 고침이 이 PC에 들어오지 못했을 수 있습니다. 먼저 엑셀로 저장하고, 긴 글은 줄이거나 나눠 주세요.',
    restoreText: (hhmm: string, label: string) =>
      `이 PC에 저장된 이전 회의록이 있습니다 (임시 보관 ${hhmm}${label ? ` · ‘${label}’` : ''}). 복구할까요?`,
    restoreYes: '이전 회의록 복구',
    restoreNo: '새로 시작',
    mergeText: (hhmm: string, label: string) =>
      `이 PC에 보관된 회의록(${hhmm}${label ? ` · ‘${label}’` : ''})에 지금 회의록에 없는 내용이 있습니다. 지금 회의록에 합칠까요? 합치면 모든 참석자의 회의록에 들어가고, 합치지 않으면 이 보관본은 사라집니다.`,
    mergeYes: '지금 회의록에 합치기',
    mergeNo: '합치지 않음',
    sameNames: (names: string) =>
      `같은 이름 ‘${names}’ 으로 접속한 사람이 둘 이상입니다. 참석자 표에는 한 줄로만 나오고 총 인원도 적게 셉니다. 다른 분은 ‘＋ 동석자 추가’ 로 따로 적어 주세요.`,
    openFile: '파일 열기',
    openFolder: '폴더 열기',
    foldOpen: '접기 ▴',
    foldClosed: '펼치기 ▾',
    foldSumOpen: '회의 정보 · 참석자 · 안건',
    foldSumClosed: (purpose: string, date: string, start: string, att: number, ag: number) =>
      `${purpose || '(회의목적 없음)'} · ${date} ${start}~ · 참석 ${att}명 · 안건 ${ag}개`,
    infoTitle: '회의 정보',
    lbPurpose: '회의목적',
    lbDate: '회의일시',
    lbPlace: '회의장소',
    lbWriter: '작성자',
    purposePh: '예) 신규 금형 시사출 일정 협의',
    dateAria: '회의 날짜 (요일은 자동)',
    startAria: '시작 시각',
    endAria: '끝 시각',
    endPh: '저장 때 자동',
    kst: '한국시간',
    auto: '자동',
    attTitle: '참석자',
    attTotal: (n: number) => `총 ${n}명`,
    attSub: (c: number, w: number) => `(접속 ${c} · 동석 ${w})`,
    addOther: '＋ 동석자 추가',
    attHelpA: '접속한 분은 자동 입력(엑셀 ',
    attHelpB: '확인',
    attHelpC: ' 칸에 ○ 자동 · 서명 아님). 한 PC에 여럿이면 ',
    attHelpD: '＋ 같이',
    attHelpE: ', 접속 안 한 분은 ',
    attHelpF: '＋ 동석자 추가',
    attHelpG: ' — 엑셀 ',
    attHelpH: '비고',
    attHelpI: ' 칸에 «동석».',
    colName: '성명',
    colDept: '소속',
    colRank: '직급',
    deptPh: '소속',
    rankPh: '직급',
    me: '(나)',
    leftAt: (hhmm: string) => `${hhmm} 나감`,
    addWith: '＋ 같이',
    addWithAria: (n: string) => `${n}님과 같이 참석한 사람 추가`,
    exclude: '제외',
    excludeAria: (n: string) => `${n} 명단에서 빼기`,
    companionTag: '동석',
    withPh: '같이 앉은 분',
    otherPh: '이름',
    companionNameAria: '동석자 이름',
    del: '삭제',
    delAria: '삭제',
    agTitle: '회의 안건',
    addAg: '＋ 안건 추가',
    agColNo: '번호',
    agColTitle: '회의 안건',
    agColDept: '주관부서(담당/지원)',
    agTitlePh: '안건',
    agDeptPh: '담당 / 지원',
    agTitleAria: (n: number) => `안건 ${n}`,
    agDeptAria: (n: number) => `주관부서 담당/지원 ${n}`,
    agDelAria: (n: number) => `안건 ${n} 삭제`,
    agEmpty: '아직 안건이 없습니다',
    noteA: '엑셀에 ',
    noteB: '회사 로고',
    noteC: '·',
    noteD: '결재란',
    noteE: '(작성/검토/승인) 포함. ',
    noteF: '저장하지 않으면 회의 뒤 사라질 수 있습니다.',
    notSaved: '아직 저장 안 함',
    savedMeta: (hhmm: string, n: number) => `마지막 저장 ${hhmm} · 저장한 파일 ${n}개`,
    kept: (hhmm: string) => `이 PC에 임시 보관됨 ${hhmm}`,
    keeping: '이 PC에 임시 보관 중',
    saveBtn: '💾 엑셀로 저장',
    saving: '저장 중…',
  },
  en: {
    title: '📝 Minutes',
    close: 'Close minutes',
    live: 'Live sharing',
    offline: 'Disconnected',
    syncing: 'Reconnecting…',
    justSynced: '✓ Reconnected · in sync',
    whoIdle: 'Shows here when someone is typing',
    whoOff: 'Trying to reconnect…',
    someone: 'Someone',
    typing: (who: string, label: string) => `${who} is editing ${label}…`,
    typingTag: (who: string) => `${who} typing`,
    secInfo: 'the meeting info',
    secAg: 'the agenda',
    secBody: (n: string) => `the notes of item ${n}`,
    offA: 'The internet connection is lost. What you write now is ',
    offB: 'kept on this PC',
    offC: ' and will be ',
    offD: 'merged automatically',
    offE: ' once reconnected.',
    pending: (n: number) => ` (${n} change${n === 1 ? '' : 's'} waiting)`,
    syncA: 'Reconnected. ',
    syncB: 'Merging',
    syncC: ' each other’s changes…',
    oversize: 'The minutes are too large. Some changes may not have reached the others, or theirs may not have reached this PC. Save as Excel first, then shorten or split long text.',
    restoreText: (hhmm: string, label: string) =>
      `A previous minutes draft is kept on this PC (saved ${hhmm}${label ? ` · “${label}”` : ''}). Restore it?`,
    restoreYes: 'Restore previous minutes',
    restoreNo: 'Start fresh',
    mergeText: (hhmm: string, label: string) =>
      `A draft kept on this PC (${hhmm}${label ? ` · “${label}”` : ''}) has content that is not in the current minutes. Merge it into the current minutes? Merging adds it to everyone's minutes; if you do not merge, this kept draft is discarded.`,
    mergeYes: 'Merge into current minutes',
    mergeNo: 'Do not merge',
    sameNames: (names: string) =>
      `More than one person joined with the same name “${names}”. The attendee table shows only one row and counts one person fewer. Please add the other person with “＋ Add guest”.`,
    openFile: 'Open file',
    openFolder: 'Open folder',
    foldOpen: 'Collapse ▴',
    foldClosed: 'Expand ▾',
    foldSumOpen: 'Info · Attendees · Agenda',
    foldSumClosed: (purpose: string, date: string, start: string, att: number, ag: number) =>
      `${purpose || '(no purpose)'} · ${date} ${start}~ · ${att} attendees · ${ag} items`,
    infoTitle: 'Meeting info',
    lbPurpose: 'Purpose',
    lbDate: 'Date/time',
    lbPlace: 'Location',
    lbWriter: 'Author',
    purposePh: 'e.g. Schedule review for the new mold trial',
    dateAria: 'Meeting date (weekday is automatic)',
    startAria: 'Start time',
    endAria: 'End time',
    endPh: 'auto on save',
    kst: 'KST',
    auto: 'auto',
    attTitle: 'Attendees',
    attTotal: (n: number) => `${n} total`,
    attSub: (c: number, w: number) => `(connected ${c} · with ${w})`,
    addOther: '＋ Add guest',
    attHelpA: 'People who joined are filled in automatically (',
    attHelpB: 'Check',
    attHelpC: ' column gets ○ in Excel — not a signature). If several people share one PC use ',
    attHelpD: '＋ With',
    attHelpE: ', for people who did not join use ',
    attHelpF: '＋ Add guest',
    attHelpG: ' — the Excel ',
    attHelpH: 'Remarks',
    attHelpI: ' column says “with”.',
    colName: 'Name',
    colDept: 'Dept.',
    colRank: 'Title',
    deptPh: 'Dept.',
    rankPh: 'Title',
    me: '(me)',
    leftAt: (hhmm: string) => `left ${hhmm}`,
    addWith: '＋ With',
    addWithAria: (n: string) => `Add someone attending together with ${n}`,
    exclude: 'Remove',
    excludeAria: (n: string) => `Remove ${n} from the list`,
    companionTag: 'with',
    withPh: 'Sitting together',
    otherPh: 'Name',
    companionNameAria: 'Guest name',
    del: 'Delete',
    delAria: 'Delete',
    agTitle: 'Agenda',
    addAg: '＋ Add item',
    agColNo: 'No.',
    agColTitle: 'Agenda item',
    agColDept: 'Owner dept. (lead/support)',
    agTitlePh: 'Item',
    agDeptPh: 'Lead / support',
    agTitleAria: (n: number) => `Agenda item ${n}`,
    agDeptAria: (n: number) => `Owner department of item ${n}`,
    agDelAria: (n: number) => `Delete agenda item ${n}`,
    agEmpty: 'No agenda items yet',
    noteA: 'The Excel file includes the ',
    noteB: 'company logo',
    noteC: ' and ',
    noteD: 'approval boxes',
    noteE: ' (prepared / reviewed / approved). ',
    noteF: 'If you do not save, the minutes may be lost after the meeting.',
    notSaved: 'Not saved yet',
    savedMeta: (hhmm: string, n: number) => `Last saved ${hhmm} · ${n} file${n === 1 ? '' : 's'} saved`,
    kept: (hhmm: string) => `Kept on this PC at ${hhmm}`,
    keeping: 'Being kept on this PC',
    saveBtn: '💾 Save as Excel',
    saving: 'Saving…',
  },
};

// ───────────────────────── 글자 칸 (문서와 맞춤) ─────────────────────────

type SyncInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onInput' | 'onBlur'> & {
  value: string;
  onValue: (v: string) => void;
  onBlurValue?: (v: string) => void;
};

/**
 * 문서(Yjs)의 값을 보여 주면서 쓰는 글자 칸. 남이 고친 값이 들어올 때 글 커서 위치를 지키고,
 * 한글 조합(IME) 중에는 화면 값을 건드리지 않는다.
 */
function SyncInput({ value, onValue, onBlurValue, ...rest }: SyncInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || composing.current || el.value === value) return;
    const focused = document.activeElement === el;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    el.value = value;
    if (focused && s !== null && e !== null) {
      try {
        el.setSelectionRange(Math.min(s, value.length), Math.min(e, value.length));
      } catch {
        // 무시
      }
    }
  });

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      defaultValue={value}
      onInput={(e) => {
        if (!composing.current) onValue(e.currentTarget.value);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        onValue(e.currentTarget.value);
      }}
      onBlur={(e) => onBlurValue?.(e.currentTarget.value)}
    />
  );
}

function Rich({ parts }: { parts: string[] }): ReactNode {
  // 짝수 칸 = 보통 글자, 홀수 칸 = 굵은 글자
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}
    </>
  );
}

// ───────────────────────── 패널 ─────────────────────────

type Props = {
  session: MinutesSession;
  onClose: () => void;
};

export default function MinutesPanel({ session, onClose }: Props) {
  const t = useT(STR);
  const s = useMinutesState(session);
  const v = s.doc;
  const [folded, setFolded] = useState(false);
  const focusReq = useRef<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  // 패널이 열려 있는 동안만 «열림» 으로 알린다(닫힌 사이 남이 고친 게 있으면 단추에 점)
  useEffect(() => {
    session.setPanelOpen(true);
    return () => session.setPanelOpen(false);
  }, [session]);

  // 새 줄을 만들면 그 줄의 첫 칸에 글 커서를 둔다
  useEffect(() => {
    const req = focusReq.current;
    if (!req || !panelRef.current) return;
    focusReq.current = null;
    const el = panelRef.current.querySelector<HTMLInputElement>(`[data-focus-key="${CSS.escape(req)}"]`);
    el?.focus();
  });

  // ── 회의 정보
  const dateBlur = (val: string) => {
    const n = normalizeDateInput(val);
    if (n !== val) session.setMeta('date', n);
  };
  const timeBlur = (key: 'start' | 'end') => (val: string) => {
    const n = normalizeTimeInput(val);
    if (n !== val) session.setMeta(key, n);
  };
  const placeShown = v.place ?? DEFAULT_PLACE;
  const writerShown = s.writerOverride ?? s.myName;

  // ── 참석자
  const online = (r: AttendeeRow) => r.leftAt === null;
  const connected = v.attendees.filter((r) => r.kind === 'auto').length;
  const total = v.attendees.length;
  const addCompanion = (hostKey: string | null) => {
    const key = session.addCompanion(hostKey);
    focusReq.current = `att:${key}`;
  };
  // 지움은 세션이 «10초 되돌리기 목록» 에 올린다(패널을 닫아도 남고, 연달아 지워도 각각 되돌릴 수 있다)
  const removeAttendee = (r: AttendeeRow) => {
    session.removeAttendee(r.key);
  };

  // ── 안건
  const addAgenda = () => {
    const id = session.addAgenda();
    focusReq.current = `ag:${id}`;
  };
  const removeAgenda = (a: AgendaItem) => {
    session.removeAgenda(a.id);
  };
  const onAgTitleKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      addAgenda();
    }
  };

  // ── 다른 사람이 고치는 중 표시
  const remote = s.remote;
  const remoteLabel = (() => {
    if (!remote) return '';
    if (remote.section === 'info') return t.secInfo;
    if (remote.section === 'ag') return t.secAg;
    if (remote.section.startsWith('body:')) {
      const idx = v.agenda.findIndex((a) => a.id === remote.section.slice(5));
      return t.secBody(idx >= 0 ? circledNumber(idx) : '');
    }
    return '';
  })();
  const remoteStyle = (id: string): CSSProperties | undefined =>
    remote?.section === id ? ({ ['--who' as string]: remote.color } as CSSProperties) : undefined;
  const remoteClass = (id: string): string => (remote?.section === id ? 'mm-remote-edit' : '');
  const remoteWho = remote?.who || t.someone;

  // ── 연결 상태
  const link = s.link;
  const presenceClass = link.state === 'offline' ? 'off' : link.state === 'syncing' ? 'sync' : '';
  const liveText =
    link.state === 'offline' ? t.offline : link.state === 'syncing' ? t.syncing : link.justSynced ? t.justSynced : t.live;

  const savedMeta = s.lastSavedAt ? t.savedMeta(kstHHmm(s.lastSavedAt), s.savedCount) : t.notSaved;
  const keptMeta = s.keptAt ? t.kept(kstHHmm(s.keptAt)) : t.keeping;

  return (
    <aside className="right-panel mm-panel" aria-label={t.title.replace('📝 ', '')} ref={panelRef}>
      <header className="right-panel-header">
        <h3 className="right-panel-title">{t.title}</h3>
        <button className="panel-close" onClick={onClose} aria-label={t.close}>
          ✕
        </button>
      </header>

      <div className={`mm-presence ${presenceClass}`}>
        <span className="mm-live">
          <i className="mm-live-dot" />
          {liveText}
        </span>
        <span className="mm-who" aria-live="polite">
          {remote ? (
            <span className="mm-typing" style={{ ['--who' as string]: remote.color } as CSSProperties}>
              <i className="mm-pen">✎</i> {t.typing(remoteWho, remoteLabel)}
            </span>
          ) : link.state === 'offline' ? (
            <span className="mm-who-off">{t.whoOff}</span>
          ) : (
            <span className="mm-who-idle">{t.whoIdle}</span>
          )}
        </span>
      </div>

      {link.state === 'offline' && (
        <div className="mm-netnote" role="status">
          <Rich parts={[t.offA, t.offB, t.offC, t.offD, t.offE]} />
          {link.pending > 0 && <b>{t.pending(link.pending)}</b>}
        </div>
      )}
      {link.state === 'syncing' && (
        <div className="mm-netnote sync" role="status">
          <Rich parts={[t.syncA, t.syncB, t.syncC]} />
        </div>
      )}
      {link.oversize && (
        <div className="mm-netnote" role="alert">
          {t.oversize}
        </div>
      )}
      {s.restoreOffer && (
        <div className="mm-restore" role="alertdialog" aria-label={s.restoreOffer.mode === 'merge' ? t.mergeYes : t.restoreYes}>
          <span>
            {s.restoreOffer.mode === 'merge'
              ? t.mergeText(kstHHmm(s.restoreOffer.savedAt), s.restoreOffer.label)
              : t.restoreText(kstHHmm(s.restoreOffer.savedAt), s.restoreOffer.label)}
          </span>
          <div className="mm-restore-actions">
            <button type="button" className="mm-mini-btn" onClick={() => session.acceptRestore()}>
              {s.restoreOffer.mode === 'merge' ? t.mergeYes : t.restoreYes}
            </button>
            <button type="button" className="mm-mini-btn" onClick={() => session.declineRestore()}>
              {s.restoreOffer.mode === 'merge' ? t.mergeNo : t.restoreNo}
            </button>
          </div>
        </div>
      )}

      <button type="button" className="mm-fold" aria-expanded={!folded} onClick={() => setFolded((f) => !f)}>
        <span className="mm-fold-sum">
          {folded ? t.foldSumClosed(v.purpose, v.date, v.start, total, v.agenda.length) : t.foldSumOpen}
        </span>
        <span className="mm-fold-ar">{folded ? t.foldClosed : t.foldOpen}</span>
      </button>

      <div className={`mm-body ${folded ? 'folded' : ''}`}>
        <div className="mm-top">
          {/* ───── 회의 정보 ───── */}
          <section
            className={`mm-sec ${remoteClass('info')}`}
            data-who={remote?.section === 'info' ? t.typingTag(remoteWho) : undefined}
            style={remoteStyle('info')}
          >
            <h4 className="mm-h">{t.infoTitle}</h4>
            <label className="mm-row">
              <span className="mm-lb">{t.lbPurpose}</span>
              <SyncInput
                value={v.purpose}
                maxLength={50}
                placeholder={t.purposePh}
                aria-label={t.lbPurpose}
                onValue={(val) => session.setMeta('purpose', val)}
              />
              <span />
            </label>
            <div className="mm-row">
              <span className="mm-lb">{t.lbDate}</span>
              <div className="mm-dt">
                <SyncInput
                  value={v.date}
                  maxLength={14}
                  placeholder="2026-10-30"
                  aria-label={t.dateAria}
                  onValue={(val) => session.setMeta('date', val)}
                  onBlurValue={dateBlur}
                />
                <SyncInput
                  value={v.start}
                  maxLength={5}
                  aria-label={t.startAria}
                  onValue={(val) => session.setMeta('start', val)}
                  onBlurValue={timeBlur('start')}
                />
                <span className="mm-tilde">~</span>
                <SyncInput
                  value={v.end}
                  maxLength={5}
                  placeholder={t.endPh}
                  aria-label={t.endAria}
                  onValue={(val) => session.setMeta('end', val)}
                  onBlurValue={timeBlur('end')}
                />
              </div>
              <span className="mm-auto-tag kst">{t.kst}</span>
            </div>
            <label className="mm-row">
              <span className="mm-lb">{t.lbPlace}</span>
              <SyncInput
                value={placeShown}
                maxLength={50}
                aria-label={t.lbPlace}
                onValue={(val) => session.setMeta('place', val)}
                onBlurValue={(val) => {
                  if (val.trim() === '') session.setMeta('place', null);
                }}
              />
              <span className="mm-auto-tag">{t.auto}</span>
            </label>
            <label className="mm-row">
              <span className="mm-lb">{t.lbWriter}</span>
              <SyncInput
                value={writerShown}
                maxLength={24}
                aria-label={t.lbWriter}
                onValue={(val) => session.setWriter(val)}
                onBlurValue={(val) => {
                  if (val.trim() === '' || val.trim() === s.myName) session.setWriter(null);
                }}
              />
              <span className="mm-auto-tag">{t.auto}</span>
            </label>
          </section>

          {/* ───── 참석자 ───── */}
          <section className="mm-sec" data-sec="att">
            <h4 className="mm-h">
              {t.attTitle} <span className="mm-count">{t.attTotal(total)}</span>
              <span className="mm-sub">{t.attSub(connected, total - connected)}</span>
              <button type="button" className="mm-mini-btn push mm-push" onClick={() => addCompanion(null)}>
                {t.addOther}
              </button>
            </h4>
            <p className="mm-help">
              <Rich parts={[t.attHelpA, t.attHelpB, t.attHelpC, t.attHelpD, t.attHelpE, t.attHelpF, t.attHelpG, t.attHelpH, t.attHelpI]} />
            </p>
            {s.sameNames.length > 0 && (
              <p className="mm-help mm-dup-warn" role="status">
                {t.sameNames(s.sameNames.map((n) => (n.count > 2 ? `${n.name} ×${n.count}` : n.name)).join(', '))}
              </p>
            )}
            <div className="mm-att-head">
              <span>{t.colName}</span>
              <span>{t.colDept}</span>
              <span>{t.colRank}</span>
              <span />
            </div>
            <div>
              {v.attendees.map((r) =>
                r.kind === 'auto' ? (
                  <div key={r.key} className={`mm-att-row ${online(r) ? '' : 'is-left'}`} data-key={r.key}>
                    <div className="mm-att-name chip">
                      <span className={`mm-dot ${online(r) ? 'on' : ''}`} />
                      <span className="mm-nm">{r.name}</span>
                      {r.key === s.myKey && <span className="mm-me">{t.me}</span>}
                      {!online(r) && r.leftAt !== null && <span className="mm-left-tag">{t.leftAt(kstHHmm(r.leftAt))}</span>}
                    </div>
                    <SyncInput
                      value={r.dept}
                      maxLength={16}
                      placeholder={t.deptPh}
                      aria-label={t.deptPh}
                      onValue={(val) => session.updateAttendee(r.key, { dept: val })}
                    />
                    <SyncInput
                      value={r.rank}
                      maxLength={8}
                      placeholder={t.rankPh}
                      aria-label={t.rankPh}
                      onValue={(val) => session.updateAttendee(r.key, { rank: val })}
                    />
                    {online(r) ? (
                      <button
                        type="button"
                        className="mm-mini-btn"
                        aria-label={t.addWithAria(r.name)}
                        onClick={() => addCompanion(r.key)}
                      >
                        {t.addWith}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="mm-mini-btn excl"
                        aria-label={t.excludeAria(r.name)}
                        onClick={() => removeAttendee(r)}
                      >
                        {t.exclude}
                      </button>
                    )}
                  </div>
                ) : (
                  <div key={r.key} className={`mm-att-row is-${r.kind}`} data-key={r.key}>
                    <div className="mm-att-name">
                      {r.kind === 'with' && <span className="mm-branch">└</span>}
                      <span className="mm-kind-tag">{t.companionTag}</span>
                      <SyncInput
                        value={r.name}
                        maxLength={16}
                        placeholder={r.kind === 'with' ? t.withPh : t.otherPh}
                        aria-label={t.companionNameAria}
                        data-focus-key={`att:${r.key}`}
                        onValue={(val) => session.updateAttendee(r.key, { name: val })}
                      />
                    </div>
                    <SyncInput
                      value={r.dept}
                      maxLength={16}
                      placeholder={t.deptPh}
                      aria-label={t.deptPh}
                      onValue={(val) => session.updateAttendee(r.key, { dept: val })}
                    />
                    <SyncInput
                      value={r.rank}
                      maxLength={8}
                      placeholder={t.rankPh}
                      aria-label={t.rankPh}
                      onValue={(val) => session.updateAttendee(r.key, { rank: val })}
                    />
                    <button
                      type="button"
                      className="mm-mini-btn del"
                      aria-label={t.delAria}
                      title={t.del}
                      onClick={() => removeAttendee(r)}
                    >
                      ✕
                    </button>
                  </div>
                )
              )}
            </div>
          </section>

          {/* ───── 회의 안건 ───── */}
          <section
            className={`mm-sec ${remoteClass('ag')}`}
            data-who={remote?.section === 'ag' ? t.typingTag(remoteWho) : undefined}
            style={remoteStyle('ag')}
          >
            <h4 className="mm-h">
              {t.agTitle}
              <button type="button" className="mm-mini-btn push mm-push" onClick={addAgenda}>
                {t.addAg}
              </button>
            </h4>
            <div className="mm-ag-head">
              <span>{t.agColNo}</span>
              <span>{t.agColTitle}</span>
              <span>{t.agColDept}</span>
              <span />
            </div>
            <div>
              {v.agenda.length === 0 ? (
                <div className="mm-empty-line">{t.agEmpty}</div>
              ) : (
                v.agenda.map((a, i) => (
                  <div key={a.id} className="mm-ag-row" data-id={a.id}>
                    <span className="mm-no">{circledNumber(i)}</span>
                    <SyncInput
                      value={a.title}
                      maxLength={44}
                      placeholder={t.agTitlePh}
                      aria-label={t.agTitleAria(i + 1)}
                      data-focus-key={`ag:${a.id}`}
                      onKeyDown={onAgTitleKey}
                      onValue={(val) => session.updateAgenda(a.id, { title: val })}
                    />
                    <SyncInput
                      value={a.dept}
                      maxLength={16}
                      placeholder={t.agDeptPh}
                      aria-label={t.agDeptAria(i + 1)}
                      onValue={(val) => session.updateAgenda(a.id, { dept: val })}
                    />
                    <button
                      type="button"
                      className="mm-mini-btn del"
                      aria-label={t.agDelAria(i + 1)}
                      title={t.del}
                      onClick={() => removeAgenda(a)}
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="mm-bottom">
          <MinutesWritingArea session={session} agenda={v.agenda} remote={remote} />
        </div>
      </div>

      <footer className="mm-foot">
        <MinutesUndoStack session={session} />
        <p className="mm-foot-note">
          <Rich parts={[t.noteA, t.noteB, t.noteC, t.noteD, t.noteE]} />
          <span className="warn">{t.noteF}</span>
        </p>
        <div className="mm-foot-row">
          <div className="mm-save-box">
            <span className="mm-save-meta">{savedMeta}</span>
            <span className="mm-keep-meta">{keptMeta}</span>
            {s.lastSavedPath && (
              <span className="mm-save-links">
                <button type="button" className="mm-mini-btn" onClick={() => void session.openSavedFile(s.lastSavedPath)}>
                  {t.openFile}
                </button>
                <button type="button" className="mm-mini-btn" onClick={() => void session.openSavedFolder(s.lastSavedPath)}>
                  {t.openFolder}
                </button>
              </span>
            )}
          </div>
          <button type="button" className="mm-btn-save" disabled={s.saving} onClick={() => void session.save()}>
            {s.saving ? (
              <>
                <i className="mm-spin" />
                {t.saving}
              </>
            ) : (
              t.saveBtn
            )}
          </button>
        </div>
      </footer>
    </aside>
  );
}
