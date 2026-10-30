// 한국시간(Asia/Seoul) 날짜·시각 도구 — 회의록은 어느 나라 PC 에서 열어도 한국시간으로 적는다.
// ⚠️ toISOString().slice(0,10) 은 쓰지 않는다(UTC 라서 한국시간 오전 9시 전에 «어제» 가 나온다).
// 겹침 확인: 기존 코드에 한국시간 도구는 없음(MeetingRoom 의 MeetingTime 은 PC 시계의 현지시간만 보여 줌).

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

let formatter: Intl.DateTimeFormat | null = null;
function getFormatter(): Intl.DateTimeFormat {
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  return formatter;
}

export type KstParts = {
  year: number;
  month: number; // 1~12
  day: number;
  hour: number; // 0~23
  minute: number;
  second: number;
  /** 0=일 … 6=토 */
  weekday: number;
};

const pad2 = (n: number): string => (n < 10 ? '0' : '') + n;

/** 요일: 년·월·일 숫자만으로 계산한다(시간대 변환을 거치지 않으니 하루가 밀리지 않는다). */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** ms 시각 → 한국시간 각 부분 */
export function kstParts(ts: number): KstParts {
  const parts = getFormatter().formatToParts(new Date(ts));
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? parseInt(p.value, 10) : 0;
  };
  const year = get('year');
  const month = get('month');
  const day = get('day');
  let hour = get('hour');
  if (hour === 24) hour = 0; // 일부 환경은 자정을 24 로 준다
  return {
    year,
    month,
    day,
    hour,
    minute: get('minute'),
    second: get('second'),
    weekday: weekdayOf(year, month, day),
  };
}

/** «2026-10-30(금)» */
export function kstDateText(ts: number): string {
  const p = kstParts(ts);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}(${WEEKDAYS_KO[p.weekday]})`;
}

/** «14:05» */
export function kstHHmm(ts: number): string {
  const p = kstParts(ts);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** «20261030» — 임시 저장 키용 */
export function kstDateKey(ts: number): string {
  const p = kstParts(ts);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}`;
}

/** «20261030_1405» — 파일 이름용 */
export function kstFileStamp(ts: number): string {
  const p = kstParts(ts);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}_${pad2(p.hour)}${pad2(p.minute)}`;
}

/**
 * 사람이 친 날짜 글 → «YYYY-MM-DD(요일)». 요일은 앱이 계산한다.
 * 날짜로 읽을 수 없거나 없는 날짜(2월 30일 등)면 입력을 그대로 돌려준다.
 */
export function normalizeDateInput(v: string): string {
  const m = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(v);
  if (!m) return v;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return v;
  return `${y}-${pad2(mo)}-${pad2(d)}(${WEEKDAYS_KO[dt.getUTCDay()]})`;
}

/** 사람이 친 시각 글 → «HH:MM». 읽을 수 없으면 입력 그대로. */
export function normalizeTimeInput(v: string): string {
  const s = v.trim();
  let m = /^(\d{1,2})\s*[:.시]\s*(\d{1,2})\s*분?$/.exec(s);
  if (!m) m = /^(\d{2})(\d{2})$/.exec(s);
  if (!m) return v;
  const h = +m[1];
  const mi = +m[2];
  if (h > 23 || mi > 59) return v;
  return `${pad2(h)}:${pad2(mi)}`;
}

/** 엑셀에 들어갈 회의일시 글: «2026-10-30(금) 14:00 ~ 15:10 (KST)» */
export function composeDateText(date: string, start: string, end: string): string {
  const d = date.trim();
  const s = start.trim();
  const e = end.trim();
  let range = '';
  if (s && e) range = `${s} ~ ${e}`;
  else if (s) range = `${s} ~`;
  else if (e) range = `~ ${e}`;
  return `${[d, range].filter(Boolean).join(' ')} (KST)`.trim();
}
