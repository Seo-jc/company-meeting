// 회의록 엑셀 저장 계약 타입 — 렌더러의 src/lib/minutes/types.ts 와 «같은 내용» 으로 둔다.
// (electron/tsconfig 와 src tsconfig 가 달라 한 파일을 같이 쓸 수 없다. 한쪽을 고치면 다른 쪽도 반드시 같이 고칠 것.)
// 겹침 확인: build_minutes_form.py 와 다름 — 그건 사장 확인용 openpyxl 시제품(예시 양식 생성기·미추적)이고, 이 파일은 앱(Electron 메인)이 쓰는 타입 정의다.

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
