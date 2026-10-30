// 회의록 — 렌더러 쪽 타입.
// 아래 «엑셀 저장 계약» 부분(MinutesColor ~ MinutesSaveResult)은 electron/minutesTypes.ts 와 «같은 내용» 으로 둔다.
// (electron/tsconfig 와 src tsconfig 가 달라 한 파일을 같이 쓸 수 없다. 한쪽을 고치면 다른 쪽도 반드시 같이 고칠 것.)
// 겹침 확인: electron/minutesTypes.ts 는 메인 프로세스용 사본이고, 이 파일은 렌더러용 + 화면 전용 타입(MinutesSnapshot 등)을 함께 둔다.

// ───────────────────────── 엑셀 저장 계약 (메인 프로세스와 동일) ─────────────────────────

export type MinutesColor = 'default' | 'blue' | 'red' | 'green' | 'orange';

export type MinutesRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: MinutesColor;
  /** 글자 크기(엑셀 pt) 4단계. 없으면 10.5 */
  size?: 9 | 10.5 | 12 | 14;
};

export type MinutesPara = { runs: MinutesRun[] };

export type MinutesExport = {
  company: {
    name: string;
    docNo: string;
    /** PNG·JPEG 바이트의 base64 (data: 머리 없이) */
    logoBase64: string | null;
    logoMime: 'image/png' | 'image/jpeg' | null;
  };
  purpose: string;
  /** 완성된 글. 예: «2026-10-30(금) 14:00 ~ 15:10 (KST)» */
  dateText: string;
  place: string;
  writer: string;
  attendees: {
    dept: string;
    rank: string;
    name: string;
    /** 비고 칸 «동석» */
    companion: boolean;
    /** 확인 칸 ○ (접속 기록 — 서명 아님) */
    confirmed: boolean;
  }[];
  agenda: { no: number; title: string; dept: string; paras: MinutesPara[] }[];
  /** 파일명용 «YYYYMMDD_HHmm» (한국시간) */
  fileStamp: string;
};

/** IPC 'minutes-save' 요청 */
export type MinutesSaveRequest = { dir: string; doc: MinutesExport };

/** IPC 'minutes-save' 결과 */
export type MinutesSaveResult =
  | { ok: true; filePath: string }
  | { ok: false; message: string };

// ───────────────────────── 화면·동기화 전용 타입 ─────────────────────────

/** 서버 «회사 양식 설정» (GET /api/company) */
export type CompanySettings = {
  name: string;
  docNo: string;
  /** data:image/png;base64,… 또는 data:image/jpeg;base64,… (없으면 null) */
  logo: string | null;
  updatedAt: number;
};

/** 시그널링으로 오가는 회의록 메시지 (계약 A) */
export type MinutesWireKind = 'sync1' | 'sync2' | 'update';
export type MinutesWire = {
  type: 'minutes';
  from: string;
  to?: string;
  kind: MinutesWireKind;
  /** base64 */
  data: string;
};

/** 참석자 한 줄. auto = 접속자(자동), with = 접속자와 «동석», other = 접속 안 한 «기타» */
export type AttendeeKind = 'auto' | 'with' | 'other';

export type AttendeeRow = {
  key: string;
  kind: AttendeeKind;
  name: string;
  dept: string;
  rank: string;
  /** with 줄이 붙어 있는 접속자 줄의 key */
  hostKey: string | null;
  firstSeen: number;
  /** 나간 시각(ms). null = 접속 중 */
  leftAt: number | null;
};

export type AgendaItem = {
  id: string;
  title: string;
  dept: string;
};

/** 회의록 문서의 «읽기 전용 사본» — 화면은 이것만 본다 */
export type MinutesDocView = {
  purpose: string;
  /** 사용자가 고친 회의장소. null = 자동(«웹 미팅») */
  place: string | null;
  date: string;
  start: string;
  end: string;
  endAuto: boolean;
  attendees: AttendeeRow[];
  agenda: AgendaItem[];
};

/** 연결 상태 (동기화) */
export type MinutesLinkState = 'live' | 'syncing' | 'offline';
export type MinutesLinkStatus = {
  state: MinutesLinkState;
  /** 연결이 끊긴 사이 내가 고친 횟수(맞추기 전까지) */
  pending: number;
  /** 끊겼다가 다시 맞춘 직후 몇 초 동안 true */
  justSynced: boolean;
  /** 한 번에 보내기엔 너무 큰 고침이 있었음 */
  oversize: boolean;
};

/** 화면에 띄우는 알림 (글자는 컴포넌트가 한/영으로 만든다) */
export type MinutesNotice =
  | {
      kind: 'saved';
      filePath: string;
      fileName: string;
      dir: string;
      offline: boolean;
      renamedHint: boolean;
      /** 너무 길어서 엑셀에 다 담지 못한 부분이 있다(안건 수·안건당 글자 수 한도) */
      truncated: boolean;
    }
  | { kind: 'save-failed'; message: string; dir: string }
  | { kind: 'empty' }
  | { kind: 'no-electron' }
  | { kind: 'restored' };

/** «10초 안에 되돌리기» 한 건 (세션이 들고 있어서 패널을 닫아도 남는다) */
export type MinutesUndoItem =
  | { id: number; kind: 'attendee'; name: string; extra: number; keys: string[] }
  | { id: number; kind: 'agenda'; title: string; hasBody: boolean; agendaId: string };

/** 회의에서 나간 뒤 로비에 보여 줄 회의록 저장 안내 */
export type MinutesLeftInfo = {
  filePath: string;
  fileName: string;
  dir: string;
  /** 마지막 저장 뒤에 고친 내용은 저장하지 않고 나왔다 */
  unsavedAfter: boolean;
};

/** 다른 사람이 고치는 중이라는 표시 */
export type MinutesRemoteActivity = {
  who: string;
  color: string;
  /** 'info' | 'att' | 'ag' | 'body:<안건 id>' */
  section: string;
  ts: number;
};

export type MinutesViewState = {
  doc: MinutesDocView;
  link: MinutesLinkStatus;
  /** 마지막 저장 뒤 내가 고쳤나 */
  editedSinceSave: boolean;
  /** 마지막 저장 시각(ms), 없으면 0 */
  lastSavedAt: number;
  savedCount: number;
  /** 이 PC 임시 보관 시각(ms), 없으면 0 */
  keptAt: number;
  saving: boolean;
  /** 패널을 닫은 사이 다른 사람이 고친 게 있나 */
  unseenRemote: boolean;
  /**
   * 이 PC 의 임시 저장본 복구 제안.
   *  restore = 지금 문서가 비어 있어 통째로 되살린다 / merge = 지금 회의록에 이미 내용이 있어, 저장본에만 있는 내용을 «합친다».
   *  label = 저장본의 회의 목적(없으면 첫 안건 제목). 무엇을 되살리는지 보여 주려고.
   */
  restoreOffer: { savedAt: number; mode: 'restore' | 'merge'; label: string } | null;
  /** 마지막으로 저장한 엑셀 파일 경로(없으면 '') — 저장 뒤에 계속 [파일 열기][폴더 열기] 를 보여 준다 */
  lastSavedPath: string;
  /** 되돌릴 수 있는 지움 목록(오래된 것부터) */
  undo: MinutesUndoItem[];
  /** 지금 같은 이름으로 «동시에» 접속한 사람이 둘 이상인 이름 — 참석자 표에서는 한 줄로 합쳐진다 */
  sameNames: { name: string; count: number }[];
  /** 내가 쓴 «작성자» 칸 값(null = 자동 = 내 이름) */
  writerOverride: string | null;
  myName: string;
  /** 내 자동 참석자 줄의 key */
  myKey: string;
  notice: MinutesNotice | null;
  remote: MinutesRemoteActivity | null;
};
