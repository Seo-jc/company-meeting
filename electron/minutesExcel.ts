// 회의록 → 엑셀(.xlsx) 파일 만들기·저장 (Electron 메인 프로세스 전용 · electron 모듈에는 의존하지 않는다 — 시험에서 그대로 불러 쓴다)
// 겹침 확인: build_minutes_form.py 와 다름 — 그건 사장 확인용 openpyxl 시제품(미추적)이고, 이 파일은 앱이 exceljs 로 «같은 모양» 을 만드는 제품 코드다(시제품의 격자·글자 폭·줄 높이 계산을 옮김).
//
// 양식 기준 = mockups/build_minutes_form.py 의 «예시» (사장 확인 · 36칸 격자 · 맑은 고딕 · 결재란 · 참석표 2단 · 안건표 · 내용표).
// 이 파일에는 회사 고유값(회사명·문서번호·로고)이 없다 — 전부 MinutesExport.company 로 들어온다(공개 저장소).
//
// 설계 요점(시제품과 같음)
//  * 36칸 «단위 격자»(한 칸 19px)로 모든 표를 병합해 짠다. 통합문서 «표준 글꼴» 을 맑은 고딕 11 로 못 박는다(열 너비의 기준 —
//    안 그러면 PC 마다 쪽 맞춤 배율이 달라진다). exceljs 는 표준 글꼴을 Calibri 로 고정해 두므로 styles 초기화를 한 번 덧씌운다(patchExcelJs).
//  * 병합 칸은 엑셀이 줄 높이를 안 맞춘다 → 맑은 고딕 글자 폭을 직접 재서(minutesMetrics.ts) 띄어쓰기에서 줄을 나누고(진짜 줄바꿈)
//    줄 수로 행 높이를 계산한다. 병합 칸마다 범위 안 «모든 칸» 에 테두리를 직접 칠한다.
//  * 서식 있는 글(rich text)은 조각마다 글꼴·크기·굵기·기울임·색을 전부 명시한다.
//  * 문서 속성 작성자는 비운다(실명·경로를 파일에 남기지 않는다).
//  * 시각은 렌더러가 한국시간으로 만들어 dateText·fileStamp 로 넘긴다 — 여기서는 시계를 읽지 않는다(파일명 보정 때만 UTC+9 로 계산).

import * as ExcelJS from 'exceljs';
import { promises as fsp } from 'fs';
import { basename, isAbsolute, join } from 'path';
import type { MinutesExport, MinutesSaveRequest, MinutesSaveResult } from './minutesTypes';
import { getMeter, type TextMeter } from './minutesMetrics';

// ───────────────────────── 상수 ─────────────────────────
const FONT = '맑은 고딕';
const NU = 36; // 단위 칸 수
const UNIT_W = 2.3125; // 열 너비(문자 단위) → 표준 글꼴(맑은 고딕 11)에서 19px
const UNIT_PX = 19;

type Span = readonly [number, number];
const C_LOGO: Span = [1, 8];
const C_TITLE: Span = [9, 19];
const C_SIGNLBL: Span = [20, 21];
const C_SIGN: Span[] = [
  [22, 26],
  [27, 31],
  [32, 36],
];
const C_LABEL: Span = [1, 7]; // 회의목적·회의일시·회의장소 이름표
const C_ATT_LBL: Span = [1, 2];
// 참석자 한쪽: 소속5·직급3·성명5·비고2·확인2
const C_ATT: Record<'L' | 'R', Span[]> = {
  L: [
    [3, 7],
    [8, 10],
    [11, 15],
    [16, 17],
    [18, 19],
  ],
  R: [
    [20, 24],
    [25, 27],
    [28, 32],
    [33, 34],
    [35, 36],
  ],
};
const C_WHEN: Span = [8, 21];
const C_AUTHOR_LBL: Span = [22, 26];
const C_AUTHOR: Span = [27, 36];
const C_NO: Span = [1, 2];
const C_AG_TITLE: Span = [3, 27];
const C_AG_DEPT: Span = [28, 36];
const C_CONTENT: Span = [3, 36];

const NAVY = '1F2F63';
const GRAY = '6B7280';
const BLACK = '000000';
const NOTE_GRAY = '9CA3AF'; // 이어지는 줄의 안건 번호(옅은 회색)
const DARK = '262626';
const MID = '7F7F7F';
const LINE = 'A6A6A6';
const FILL_LABEL = 'E9EEF7';
const FILL_HEAD = 'DDE5F3';
const FILL_SOFT = 'F6F8FC';
const BASE = 10.5; // 회의 내용 기본 글자 크기(pt)
const MIN_SHRINK_PT = 7.0; // «글자 줄여 맞춤» 이 허용하는 가장 작은 크기(검사용)
const RHO = 0.955; // 이 PC 의 엑셀은 행 높이를 PDF·인쇄로 낼 때 0.955 배로 줄인다(시제품 실측). 다른 PC 는 덜 줄 뿐이라 글이 잘리진 않는다
const MAX_ROW_PT = 409.5; // 엑셀 한 행 높이 상한
// 쪽 넘김 어림(PageSim): A4 세로 위아래 여백(0.6in + 0.75in)을 뺀 인쇄 높이. 폭맞춤 배율은 100% (표 폭 513pt ≤ 인쇄 폭 516pt)
const PAGE_PT = 841.89 - (0.6 + 0.75) * 72; // ≈ 744.7pt
const PAGE_CAP_PT = PAGE_PT / RHO; // 이 PC 의 엑셀은 행을 0.955 배로 줄여 찍으므로 실제로는 이만큼 들어간다(시제품 실측)
const SAFETY_PT = PAGE_CAP_PT - PAGE_PT; // 쪽 끝에서 문단을 나눌 땐 이만큼 여유를 둔다(다른 PC 에서 앞 조각이 통째로 밀리지 않게)
const SIZES = [9, 10.5, 12, 14];
const COLOR_HEX: Record<string, string> = {
  default: BLACK,
  blue: '3151A3',
  red: 'C00000',
  green: '1E7B34',
  orange: 'C55A11',
};
const CIRC = '①②③④⑤⑥⑦⑧⑨⑩';

type Edge = 'hair' | 'thin' | 'medium';
const RANK: Record<Edge, number> = { hair: 1, thin: 2, medium: 3 };
type Side = 'left' | 'right' | 'top' | 'bottom';

// ───────────────────────── exceljs 표준 글꼴 덧씌우기 ─────────────────────────
let fontPatched = false;
let corePatched = false;
/**
 * exceljs 4.4.0(package.json 에 고정)의 내부를 두 군데 덧씌운다. 실패하면(내부 구조가 바뀐 경우) 조용히 넘어가고
 * buildMinutesWorkbook 의 notes 에 남긴다 — 파일은 만들어지되 열 너비가 달라지거나 작성자에 공백 한 칸이 남을 뿐이다.
 *  1) 통합문서 0번 글꼴(표준 글꼴): exceljs 는 Calibri 로 만든다. 열 너비·쪽 맞춤의 기준이 되는 글꼴이라 맑은 고딕 11 로 바꿔야 한다
 *     → StylesXform.init 이 끝난 직후 0번 글꼴로 맑은 고딕을 먼저 넣는다.
 *  2) 문서 속성 작성자·마지막 수정자: exceljs 는 빈 값을 'ExcelJS' 로 바꾼다 → CoreXform.render 에서 빈 문자열로 쓴다(실명·경로를 파일에 남기지 않는다).
 */
function patchExcelJs(): { font: boolean; core: boolean } {
  if (!fontPatched) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('exceljs/lib/xlsx/xform/style/styles-xform');
      const proto = mod && mod.prototype;
      if (proto && typeof proto.init === 'function' && typeof proto._addFont === 'function') {
        const orig = proto.init;
        proto.init = function (this: { model?: { fonts?: unknown[] }; _addFont: (f: unknown) => void }): void {
          orig.call(this);
          if (this.model && Array.isArray(this.model.fonts) && this.model.fonts.length === 0) {
            this._addFont({ size: 11, name: FONT, family: 2, charset: 129 });
          }
        };
        fontPatched = true;
      }
    } catch {
      /* 아래에서 notes 로 알림 */
    }
  }
  if (!corePatched) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('exceljs/lib/xlsx/xform/core/core-xform');
      const proto = mod && mod.prototype;
      if (proto && typeof proto.render === 'function') {
        const orig = proto.render;
        proto.render = function (this: unknown, xmlStream: unknown, model: Record<string, unknown>): void {
          orig.call(this, xmlStream, { ...(model ?? {}), creator: '', lastModifiedBy: '' });
        };
        corePatched = true;
      }
    } catch {
      /* 아래에서 notes 로 알림 */
    }
  }
  return { font: fontPatched, core: corePatched };
}

// ───────────────────────── 글자·서식 ─────────────────────────
type Style = { size: number; b: boolean; i: boolean; color: string };
type Ch = { c: string; s: Style };
type Line = { chars: Ch[]; size: number; tail: Style };

const styleKey = (s: Style): string => `${s.size}|${s.b ? 1 : 0}|${s.i ? 1 : 0}|${s.color}`;
const BASE_STYLE: Style = { size: BASE, b: false, i: false, color: BLACK };

type FontSpec = Partial<ExcelJS.Font>;
function F(size = 10, b = false, color = BLACK, i = false): FontSpec {
  return { name: FONT, size, bold: b, italic: i, color: { argb: 'FF' + color }, family: 2, charset: 129 };
}
function runFont(s: Style): FontSpec {
  return F(s.size, s.b, s.color, s.i);
}

type AlignSpec = Partial<ExcelJS.Alignment>;
function AL(
  h: 'left' | 'center' | 'right' = 'left',
  o: { wrap?: boolean; indent?: number; shrink?: boolean } = {}
): AlignSpec {
  const a: AlignSpec = { horizontal: h, vertical: 'middle' };
  if (o.wrap) a.wrapText = true;
  if (o.indent) a.indent = o.indent;
  if (o.shrink) a.shrinkToFit = true;
  return a;
}

const fillOf = (hex: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF' + hex },
  bgColor: { argb: 'FF' + hex },
});

const colLetter = (n: number): string => {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

/** 한 줄 높이(pt) — 엑셀(GDI)이 맑은 고딕을 그리는 줄 간격은 글자 크기의 1.5배(시제품 실측), px 단위로 올림 */
const linePt = (size: number): number => Math.ceil((size * 96) / 72 * 1.5 - 1e-9) * 0.75;
/** 행 높이: 줄 높이 합 + 위아래 여백 5pt, 엑셀이 줄이는 만큼(RHO) 키워 두고 1px(0.75pt) 배수로 올림 */
const rowPt = (sumLines: number): number => Math.ceil(Math.max(22.5, (sumLines + 5) / RHO) / 0.75 - 1e-9) * 0.75;

// ───────────────────────── 입력 정리(렌더러가 보낸 값을 믿지 않는다) ─────────────────────────
// 엑셀(xml)에 넣을 수 없는 제어 글자·짝 없는 서로게이트 제거
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function clean(s: unknown): string {
  return String(s ?? '').replace(BAD_XML, '');
}
function oneLine(s: unknown, maxChars = 300): string {
  const t = clean(s).replace(/[\r\n\t]+/g, ' ').trim();
  const arr = Array.from(t);
  return arr.length > maxChars ? arr.slice(0, maxChars).join('') : t;
}
function normText(s: unknown): string {
  return clean(s).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
}

type NAgenda = { label: string; title: string; dept: string; chars: Ch[][] };
type NDoc = {
  companyName: string;
  docNo: string;
  logo: { buf: Buffer; w: number; h: number; ext: 'png' | 'jpeg' } | null;
  purpose: string;
  dateText: string;
  place: string;
  writer: string;
  attendees: { dept: string; rank: string; name: string; companion: boolean; confirmed: boolean }[];
  agenda: NAgenda[];
};

const circled = (no: number, idx: number): string => {
  const n = Number.isInteger(no) && no > 0 ? no : idx + 1;
  return n <= CIRC.length ? CIRC[n - 1] : String(n);
};

// 한도(방어용) — 렌더러의 src/lib/minutes/export.ts 가 «같은 값» 으로 먼저 잘라 알리므로 평소엔 여기서 걸리지 않는다.
// 렌더러가 보낸 값을 믿지 않는다: 엄청나게 큰 자료가 와도 이 프로세스가 오래 멈추지 않게.
const MAX_AGENDA = 50;
const MAX_ATTENDEES = 200;
const MAX_CHARS_PER_AGENDA = 50_000;
const MAX_CHARS_TOTAL = 200_000;

function runsToChars(runs: unknown, budget: { left: number }): Ch[] {
  const out: Ch[] = [];
  if (!Array.isArray(runs)) return out;
  for (const r of runs) {
    if (budget.left <= 0) break;
    if (!r || typeof r !== 'object') continue;
    const run = r as { text?: unknown; bold?: unknown; italic?: unknown; color?: unknown; size?: unknown };
    const text = normText(run.text);
    if (!text) continue;
    const size = SIZES.includes(Number(run.size)) ? Number(run.size) : BASE;
    const s: Style = {
      size,
      b: run.bold === true,
      i: run.italic === true,
      color: COLOR_HEX[String(run.color ?? 'default')] ?? BLACK,
    };
    for (const c of text) {
      if (budget.left <= 0) break;
      out.push({ c, s });
      budget.left -= 1;
    }
  }
  return out;
}

/** PNG·JPEG 머리에서 폭·높이를 읽는다(그림이 깨졌거나 다른 형식이면 null → 로고 칸을 비우고 저장은 계속) */
export function imageInfo(buf: Buffer): { w: number; h: number; ext: 'png' | 'jpeg' } | null {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a && buf.toString('latin1', 12, 16) === 'IHDR') {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      return w > 0 && h > 0 && w < 30000 && h < 30000 ? { w, h, ext: 'png' } : null;
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let p = 2;
      while (p + 9 < buf.length) {
        if (buf[p] !== 0xff) {
          p++;
          continue;
        }
        const m = buf[p + 1];
        if (m === 0xff) {
          p++;
          continue;
        }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
          p += 2;
          continue;
        }
        const len = buf.readUInt16BE(p + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          const h = buf.readUInt16BE(p + 5);
          const w = buf.readUInt16BE(p + 7);
          return w > 0 && h > 0 ? { w, h, ext: 'jpeg' } : null;
        }
        p += 2 + len;
      }
    }
  } catch {
    /* 아래 null */
  }
  return null;
}

function normalize(raw: MinutesExport): NDoc {
  const d = (raw ?? {}) as Partial<MinutesExport>;
  const c = (d.company ?? {}) as Partial<MinutesExport['company']>;
  let logo: NDoc['logo'] = null;
  if (typeof c.logoBase64 === 'string' && c.logoBase64.length > 0 && c.logoBase64.length <= 2_000_000) {
    const buf = Buffer.from(c.logoBase64, 'base64');
    const info = imageInfo(buf);
    if (info) logo = { buf, ...info };
  }
  const attendees = (Array.isArray(d.attendees) ? d.attendees : [])
    .slice(0, MAX_ATTENDEES)
    .map((a) => ({
      dept: oneLine(a?.dept, 60),
      rank: oneLine(a?.rank, 30),
      name: oneLine(a?.name, 60),
      companion: a?.companion === true,
      confirmed: a?.confirmed === true,
    }))
    .filter((a) => a.dept || a.rank || a.name); // 아무것도 안 적은 줄(눌러 놓고 안 채운 «동석자 추가»)은 명단에 넣지 않는다
  const total = { left: MAX_CHARS_TOTAL };
  const agenda: NAgenda[] = (Array.isArray(d.agenda) ? d.agenda : []).slice(0, MAX_AGENDA).map((a, idx) => {
    const budget = { left: Math.min(MAX_CHARS_PER_AGENDA, total.left) };
    const start = budget.left;
    const paras: Ch[][] = [];
    for (const p of Array.isArray(a?.paras) ? a.paras : []) {
      if (budget.left <= 0) break;
      paras.push(runsToChars(p?.runs, budget));
      budget.left -= 1; // 문단 나눔
    }
    total.left -= Math.min(start, start - budget.left);
    // 앞·뒤의 빈 문단은 뺀다(편집기는 안건마다 빈 문단 하나로 시작하므로, 안 빼면 제목 밑에 빈 줄이 남는다). 가운데의 빈 문단은 사용자가 둔 띄움이라 남긴다.
    const blank = (c: Ch[]): boolean => c.every((x) => x.c.trim() === '');
    while (paras.length && blank(paras[0])) paras.shift();
    while (paras.length && blank(paras[paras.length - 1])) paras.pop();
    return { label: circled(Number(a?.no), idx), title: oneLine(a?.title, 300), dept: oneLine(a?.dept, 100), chars: paras };
  });
  return {
    companyName: oneLine(c.name, 60),
    docNo: oneLine(c.docNo, 40),
    logo,
    purpose: oneLine(d.purpose),
    dateText: oneLine(d.dateText),
    place: oneLine(d.place),
    writer: oneLine(d.writer, 60),
    attendees,
    agenda,
  };
}

// ───────────────────────── 줄 나누기 ─────────────────────────
function lineOf(chars: Ch[], tail: Style): Line {
  const c = chars.slice();
  while (c.length && c[c.length - 1].c === ' ') c.pop(); // 줄 끝 띄어쓰기는 뺀다
  const size = c.length ? Math.max(...c.map((x) => x.s.size)) : tail.size;
  return { chars: c, size, tail: c.length ? c[c.length - 1].s : tail };
}

/** 띄어쓰기 단위로 줄을 나눈다(한 낱말이 한 줄보다 길 때만 글자 단위). 입력 chars 에 '\n' 이 있으면 강제 줄바꿈. */
function wrapChars(chars: Ch[], avail: number, meter: TextMeter): Line[] {
  const segs: Ch[][] = [[]];
  for (const ch of chars) {
    if (ch.c === '\n') segs.push([]);
    else segs[segs.length - 1].push(ch);
  }
  const lines: Line[] = [];
  let carry: Style = BASE_STYLE;
  for (const seg of segs) {
    if (seg.length === 0) {
      lines.push({ chars: [], size: carry.size, tail: carry });
      continue;
    }
    carry = seg[seg.length - 1].s;
    const words: Ch[][] = [];
    let w: Ch[] = [];
    for (const ch of seg) {
      w.push(ch);
      if (ch.c === ' ') {
        words.push(w);
        w = [];
      }
    }
    if (w.length) words.push(w);
    let cur: Ch[] = [];
    let curw = 0;
    for (const word of words) {
      const wi = word.map((x) => meter.px(x.c, x.s.size, x.s.b));
      const full = wi.reduce((a, b) => a + b, 0);
      let trail = 0;
      for (let k = word.length - 1; k >= 0 && word[k].c === ' '; k--) trail += wi[k];
      const need = full - trail;
      if (cur.length && curw + need > avail) {
        lines.push(lineOf(cur, carry));
        cur = [];
        curw = 0;
      }
      if (need > avail) {
        for (let k = 0; k < word.length; k++) {
          if (cur.length && curw + wi[k] > avail) {
            lines.push(lineOf(cur, carry));
            cur = [];
            curw = 0;
          }
          cur.push(word[k]);
          curw += wi[k];
        }
      } else {
        cur.push(...word);
        curw += full;
      }
    }
    if (cur.length) lines.push(lineOf(cur, carry));
  }
  // 글 끝의 빈 줄은 뺀다(한 줄은 남긴다)
  while (lines.length > 1 && lines[lines.length - 1].chars.length === 0) lines.pop();
  return lines;
}

/** 한 줄의 글자를 같은 서식끼리 묶어 서식 있는 글 조각으로. 마지막 줄이 아니면 진짜 줄바꿈(\n)을 붙인다. */
function toRichText(lines: Line[]): ExcelJS.CellRichTextValue | null {
  const runs: ExcelJS.RichText[] = [];
  let any = false;
  lines.forEach((ln, li) => {
    const last = li === lines.length - 1;
    const groups: { text: string; s: Style }[] = [];
    for (const ch of ln.chars) {
      any = true;
      const g = groups[groups.length - 1];
      if (g && styleKey(g.s) === styleKey(ch.s)) g.text += ch.c;
      else groups.push({ text: ch.c, s: ch.s });
    }
    if (!last) {
      if (groups.length) groups[groups.length - 1].text += '\n';
      else groups.push({ text: '\n', s: ln.tail });
    }
    for (const g of groups) runs.push({ text: g.text, font: runFont(g.s) });
  });
  return any ? { richText: runs } : null;
}

// ───────────────────────── 시트 조립 도구 ─────────────────────────
type CellFmt = { font?: FontSpec; fill?: string; al?: AlignSpec };
type Fit = { name: string; text: string; size: number; bold: boolean; px: number; shrink: boolean };

class SheetBuilder {
  readonly ws: ExcelJS.Worksheet;
  private edges = new Map<string, Partial<Record<Side, [Edge, string]>>>();
  private fmts = new Map<string, CellFmt>();
  readonly heights = new Map<number, number>();
  readonly fits: Fit[] = [];
  merges = 0;

  constructor(ws: ExcelJS.Worksheet, private meter: TextMeter) {
    this.ws = ws;
  }

  private edge(r: number, c: number, side: Side, style: Edge, color: string): void {
    const k = r + ',' + c;
    const d = this.edges.get(k) ?? {};
    const old = d[side];
    if (!old || RANK[style] >= RANK[old[0]]) d[side] = [style, color];
    this.edges.set(k, d);
  }

  outline(r1: number, c1: number, r2: number, c2: number, style: Edge, color: string): void {
    for (let c = c1; c <= c2; c++) {
      this.edge(r1, c, 'top', style, color);
      this.edge(r2, c, 'bottom', style, color);
    }
    for (let r = r1; r <= r2; r++) {
      this.edge(r, c1, 'left', style, color);
      this.edge(r, c2, 'right', style, color);
    }
  }

  /** r 줄 위쪽에 가로 구분선(위 줄의 아래쪽에도 같이 — 두 칸이 엇갈리지 않게) */
  hsep(r: number, style: Edge = 'medium', color = DARK): void {
    for (let c = 1; c <= NU; c++) {
      this.edge(r, c, 'top', style, color);
      this.edge(r - 1, c, 'bottom', style, color);
    }
  }

  put(
    r1: number,
    c1: number,
    r2: number,
    c2: number,
    o: {
      value?: ExcelJS.CellValue | null;
      font?: FontSpec;
      bg?: string;
      al?: AlignSpec;
      bd?: [Edge, string] | null;
      name?: string;
      fit?: [number, boolean];
    } = {}
  ): void {
    if (r1 !== r2 || c1 !== c2) {
      this.ws.mergeCells(r1, c1, r2, c2);
      this.merges++;
    }
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        this.fmts.set(r + ',' + c, { font: o.font, fill: o.bg, al: o.al });
      }
    }
    if (o.value !== undefined && o.value !== null) this.ws.getCell(r1, c1).value = o.value;
    const bd = o.bd === undefined ? (['thin', MID] as [Edge, string]) : o.bd;
    if (bd) this.outline(r1, c1, r2, c2, bd[0], bd[1]);
    if (o.fit && typeof o.value === 'string' && o.value) {
      const px = (c2 - c1 + 1) * UNIT_PX - 6 - (o.al?.indent ? 10 : 0);
      this.fits.push({
        name: o.name ?? o.value.slice(0, 12),
        text: o.value,
        size: o.fit[0],
        bold: o.fit[1],
        px,
        shrink: !!o.al?.shrinkToFit,
      });
    }
  }

  height(r: number, pt: number): void {
    this.ws.getRow(r).height = pt;
    this.heights.set(r, pt);
  }

  /** 칸마다 서식을 «새 객체» 로 통째로 넣는다(exceljs 는 병합 칸 서식을 왼쪽 위 칸과 같은 객체로 묶어 두므로, 칸별로 따로 넣어야 테두리가 칸마다 맞는다) */
  finalize(): void {
    const keys = new Set<string>([...this.fmts.keys(), ...this.edges.keys()]);
    for (const k of keys) {
      const [r, c] = k.split(',').map(Number);
      const cell = this.ws.getCell(r, c);
      const st: Partial<ExcelJS.Style> = {};
      const f = this.fmts.get(k);
      if (f?.font) st.font = f.font;
      if (f?.fill) st.fill = fillOf(f.fill);
      if (f?.al) st.alignment = f.al;
      const e = this.edges.get(k);
      if (e) {
        const b: Partial<ExcelJS.Borders> = {};
        for (const side of ['left', 'right', 'top', 'bottom'] as Side[]) {
          const v = e[side];
          if (v) b[side] = { style: v[0], color: { argb: 'FF' + v[1] } };
        }
        st.border = b;
      }
      cell.style = st as ExcelJS.Style;
    }
  }

  textPx(text: string, size: number, bold: boolean): number {
    let sum = 0;
    for (const ch of Array.from(text)) sum += this.meter.px(ch, size, bold);
    return sum;
  }
}

/** 행 높이를 차례로 쌓아 쪽 넘김을 어림한다(인쇄 제목 줄은 «내용 머리» 줄을 지난 뒤의 쪽마다 맨 위에 되풀이). 엑셀은 행을 쪽 사이에서 쪼개지 못한다. */
class PageSim {
  y = 0;
  private titleH = 0;
  private titleOn = false;
  base(): number {
    return this.titleOn ? this.titleH : 0;
  }
  setTitle(h: number): void {
    this.titleH = h;
    this.titleOn = true;
  }
  remaining(): number {
    return PAGE_CAP_PT - this.y;
  }
  newPage(): void {
    this.y = this.base();
  }
  add(h: number): void {
    if (this.y + h > PAGE_CAP_PT && this.y > this.base()) this.newPage();
    this.y += h;
  }
}

// ───────────────────────── 양식 만들기 ─────────────────────────
export type BuildResult = {
  buffer: Buffer;
  /** 한 줄에 안 들어가는 칸 등 — 저장은 계속된다 */
  warnings: string[];
  notes: string[];
  lastRow: number;
  contentHeaderRow: number;
  attendeeRows: number;
  agendaRows: number;
  contentRows: number;
  rowHeightTotal: number;
  meterSource: 'malgun' | 'fallback';
};

type ContentRow = { label: string; first: boolean; lines: Line[] };

export async function buildMinutesWorkbook(raw: MinutesExport, opts: { meter?: TextMeter } = {}): Promise<BuildResult> {
  const meter = opts.meter ?? getMeter();
  const notes: string[] = [];
  const patch = patchExcelJs();
  if (!patch.font) notes.push('표준 글꼴을 맑은 고딕으로 바꾸지 못함(exceljs 내부 구조 변경?) — 열 너비가 달라질 수 있다');
  if (!patch.core) notes.push('문서 속성 작성자를 비우지 못함(exceljs 내부 구조 변경?) — 공백 한 칸이 남는다');
  const d = normalize(raw);

  const wb = new ExcelJS.Workbook();
  wb.creator = ' '; // exceljs 는 빈 문자열을 'ExcelJS' 로 바꿔 버린다 → 공백 한 칸을 넣고, 실제 파일엔 patchExcelJs 가 빈 값으로 쓴다
  wb.lastModifiedBy = ' ';
  wb.title = '회의록';
  const ws = wb.addWorksheet('회의록', {
    properties: { defaultRowHeight: 19.5 },
    views: [{ state: 'normal', showGridLines: false, zoomScale: 100 }],
  });
  for (let c = 1; c <= NU; c++) ws.getColumn(c).width = UNIT_W;
  const S = new SheetBuilder(ws, meter);

  // ── 머리: 로고 | 회 의 록 | 결재 ──
  S.height(1, 18.75); // 행 높이는 전부 0.75pt(=1px)의 배수 — 엑셀이 px 로 깎아 쪽 수가 달라지는 일을 막는다
  S.height(2, 37.5);
  S.height(3, 16.5);
  S.put(1, C_LOGO[0], 3, C_LOGO[1], { font: F(10), bg: 'FFFFFF', al: AL('center'), bd: ['thin', DARK], name: '로고' });
  S.put(1, C_TITLE[0], 3, C_TITLE[1], {
    value: '회  의  록',
    font: F(24, true, NAVY),
    bg: 'FFFFFF',
    al: AL('center'),
    bd: ['thin', DARK],
    name: '제목',
  });
  S.put(1, C_SIGNLBL[0], 3, C_SIGNLBL[1], {
    value: '결\n재',
    font: F(10, true),
    bg: FILL_LABEL,
    al: AL('center', { wrap: true }),
    bd: ['thin', DARK],
    name: '결재 이름표',
  });
  ['작  성', '검  토', '승  인'].forEach((nm, k) => {
    const [a, b] = C_SIGN[k];
    S.put(1, a, 1, b, { value: nm, font: F(10, true), bg: FILL_LABEL, al: AL('center'), bd: ['thin', DARK], name: '결재 머리 ' + nm });
    S.put(2, a, 2, b, { font: F(10), bg: 'FFFFFF', al: AL('center'), bd: ['thin', DARK], name: '서명칸 ' + nm }); // 서명칸은 빈칸
    S.put(3, a, 3, a + 2, {
      value: k === 0 && d.writer ? d.writer : undefined, // 작성 이름만 자동(검토·승인은 손으로)
      font: F(9, true),
      bg: 'FFFFFF',
      al: AL('center', { shrink: true }),
      bd: ['thin', DARK],
      name: '서명 아래 이름 ' + nm,
      fit: [9, true],
    });
    S.put(3, a + 3, 3, b, { value: '/', font: F(9, false, GRAY), bg: 'FFFFFF', al: AL('center'), bd: ['thin', DARK], name: '서명 아래 날짜 ' + nm });
  });

  // ── 회의 정보 ──
  S.height(4, 24);
  S.height(5, 24);
  S.height(6, 24);
  const lbl = (rr: number, c1: number, c2: number, t: string): void =>
    S.put(rr, c1, rr, c2, { value: t, font: F(10, true), bg: FILL_LABEL, al: AL('center'), name: '이름표 ' + t });
  const val = (rr: number, c1: number, c2: number, t: string, nm: string): void =>
    S.put(rr, c1, rr, c2, {
      value: t || undefined,
      font: F(10),
      bg: 'FFFFFF',
      al: AL('left', { indent: 1, shrink: true }),
      name: nm,
      fit: [10, false],
    });
  lbl(4, C_LABEL[0], C_LABEL[1], '회의목적');
  val(4, 8, 36, d.purpose, '회의목적 값');
  lbl(5, C_LABEL[0], C_LABEL[1], '회의일시');
  val(5, C_WHEN[0], C_WHEN[1], d.dateText, '회의일시 값');
  lbl(5, C_AUTHOR_LBL[0], C_AUTHOR_LBL[1], '작 성 자');
  val(5, C_AUTHOR[0], C_AUTHOR[1], d.writer, '작성자 값');
  lbl(6, C_LABEL[0], C_LABEL[1], '회의장소');
  val(6, 8, 36, d.place, '회의장소 값');

  // ── 참석인원 ──
  const att = d.attendees;
  const n = att.length;
  const R = Math.max(4, Math.ceil(n / 2));
  const ah0 = 7;
  S.height(ah0, 21);
  S.put(ah0, C_ATT_LBL[0], ah0 + R, C_ATT_LBL[1], {
    value: '참\n석\n인\n원',
    font: F(10, true),
    bg: FILL_LABEL,
    al: AL('center', { wrap: true }),
    name: '참석인원 이름표',
  });
  for (const side of ['L', 'R'] as const) {
    ['소  속', '직  급', '성  명', '비고', '확인'].forEach((t, j) => {
      const [a, b] = C_ATT[side][j];
      S.put(ah0, a, ah0, b, { value: t, font: F(10, true), bg: FILL_HEAD, al: AL('center'), name: '참석 머리 ' + t, fit: [10, true] });
    });
  }
  for (let k = 0; k < R; k++) {
    const rr = ah0 + 1 + k;
    S.height(rr, 25.5);
    for (const [side, idx] of [
      ['L', k],
      ['R', R + k],
    ] as const) {
      const who = idx < n ? att[idx] : null;
      const cells = who ? [who.dept, who.rank, who.name, who.companion ? '동석' : '', who.confirmed ? '○' : ''] : ['', '', '', '', ''];
      cells.forEach((txt, j) => {
        const [a, b] = C_ATT[side][j];
        const isNote = j === 3;
        S.put(rr, a, rr, b, {
          value: txt || undefined,
          font: F(isNote ? 9 : 10, false, isNote ? GRAY : BLACK),
          bg: 'FFFFFF',
          al: AL('center', { shrink: j < 3 }),
          name: '참석 값',
          fit: [isNote ? 9 : 10, false],
        });
      });
    }
  }
  const tr = ah0 + R + 1;
  S.height(tr, 18);
  const nWith = att.filter((a) => a.companion).length;
  const nConn = n - nWith;
  S.put(tr, 1, tr, 18, {
    value: '○ = 웹 접속 기록으로 확인 (서명 아님)',
    font: F(8.5, false, GRAY),
    bg: FILL_SOFT,
    al: AL('left', { indent: 1 }),
    name: '확인 풀이',
    fit: [8.5, false],
  });
  S.put(tr, 19, tr, NU, {
    value: `총 인원 ${n}명  (접속 ${nConn}명 · 동석 ${nWith}명)`,
    font: F(9.5, false, '374151'),
    bg: FILL_SOFT,
    al: AL('right', { indent: 1 }),
    name: '총 인원',
  });

  // ── 회의 안건 ──
  const gh = tr + 1;
  S.height(gh, 21);
  S.put(gh, C_NO[0], gh, C_NO[1], { value: '번호', font: F(10, true), bg: FILL_HEAD, al: AL('center'), name: '안건 머리 번호' });
  S.put(gh, C_AG_TITLE[0], gh, C_AG_TITLE[1], { value: '회 의 안 건', font: F(10, true), bg: FILL_HEAD, al: AL('center'), name: '안건 머리' });
  S.put(gh, C_AG_DEPT[0], gh, C_AG_DEPT[1], {
    value: '주관부서(담당/지원)',
    font: F(10, true),
    bg: FILL_HEAD,
    al: AL('center'),
    name: '안건 머리 부서',
    fit: [10, true],
  });
  const ag = d.agenda;
  const A = Math.max(3, ag.length);
  for (let k = 0; k < A; k++) {
    const rr = gh + 1 + k;
    S.height(rr, 24);
    const it = k < ag.length ? ag[k] : null;
    S.put(rr, C_NO[0], rr, C_NO[1], { value: it ? it.label : undefined, font: F(11, true, NAVY), bg: FILL_SOFT, al: AL('center'), name: '안건 번호' });
    S.put(rr, C_AG_TITLE[0], rr, C_AG_TITLE[1], {
      value: it?.title || undefined,
      font: F(10.5),
      bg: 'FFFFFF',
      al: AL('left', { indent: 1, shrink: true }),
      name: '안건 값',
      fit: [10.5, false],
    });
    S.put(rr, C_AG_DEPT[0], rr, C_AG_DEPT[1], {
      value: it?.dept || undefined,
      font: F(10),
      bg: 'FFFFFF',
      al: AL('center', { shrink: true }),
      name: '안건 부서',
      fit: [10, false],
    });
  }

  // ── 회의 내용 ──
  const ch = gh + A + 1;
  S.height(ch, 21);
  S.put(ch, C_NO[0], ch, C_NO[1], { value: '안건', font: F(10, true), bg: FILL_HEAD, al: AL('center'), name: '내용 머리 안건' });
  S.put(ch, C_CONTENT[0], ch, C_CONTENT[1], { value: '회  의  내  용', font: F(10, true), bg: FILL_HEAD, al: AL('center'), name: '내용 머리' });
  const cwPx = (C_CONTENT[1] - C_CONTENT[0] + 1) * UNIT_PX;
  const avail = (cwPx - 10 - 6) * 0.97; // 들여쓰기 1 + 안쪽 여백 + 안전 여유

  // 행 만들기 — 안건 제목줄은 첫 문단 칸의 «첫 줄» 로 합친다(제목만 쪽 끝에 홀로 남는 일이 없다).
  // 한 행은 409.5pt 를 못 넘으므로 줄 단위로 여러 행으로 나눈다(이어지는 행은 안건 번호를 옅은 회색으로 되풀이).
  // 엑셀은 행을 쪽 사이에서 쪼개지 못해 «한 쪽에 안 들어가는 긴 문단» 이 통째로 다음 쪽으로 밀려 앞 쪽이 크게 비므로,
  // 위쪽 행 높이로 쪽 넘김을 미리 어림해(PageSim) 쪽 끝에서 문단을 줄 단위로 나눠 쪽을 채운다.
  const rows: ContentRow[] = [];
  const sim = new PageSim();
  for (let r = 1; r <= ch; r++) sim.add(S.heights.get(r) ?? 0);
  sim.setTitle(S.heights.get(ch) ?? 0);
  const sumPt = (ls: Line[]): number => ls.reduce((acc, ln) => acc + linePt(ln.size), 0);
  /** ls 의 앞에서부터, 높이가 limit 이하인 줄 수 */
  const fitCount = (ls: Line[], limit: number): number => {
    let k = 0;
    let s = 0;
    while (k < ls.length && rowPt(s + linePt(ls[k].size)) <= limit) {
      s += linePt(ls[k].size);
      k++;
    }
    return k;
  };
  const place = (label: string, first: boolean, ls: Line[]): void => {
    rows.push({ label, first, lines: ls });
    sim.add(Math.min(MAX_ROW_PT, rowPt(sumPt(ls))));
  };
  const planPara = (label: string, first: boolean, lines: Line[]): void => {
    let rest = lines;
    let isFirst = first;
    while (rest.length) {
      const rem = sim.remaining();
      if (rowPt(sumPt(rest)) <= Math.min(rem, MAX_ROW_PT)) {
        place(label, isFirst, rest); // 이 쪽에 통째로 들어간다
        return;
      }
      // 안 들어간다 → 쪽 끝에서 줄 단위로 나눈다(앞 조각 2줄 이상 · 뒷 조각 2줄 이상). 나눌 때는 안전 여유(SAFETY)를 둔다 —
      // 다른 PC 가 쪽을 조금 짧게 잡아도 앞 조각이 통째로 다음 쪽으로 밀리지 않게.
      let take = fitCount(rest, Math.min(rem - SAFETY_PT, MAX_ROW_PT));
      if (rest.length - take === 1) take--;
      if (take < 2 || rest.length - take < 2) {
        if (sim.y > sim.base()) {
          sim.newPage(); // 쪽 맨 위에서 다시 계획
          continue;
        }
        // 쪽 맨 위인데도 한 쪽·409.5pt 보다 큰 문단 → 들어가는 만큼 자른다
        take = Math.max(1, fitCount(rest, Math.min(PAGE_PT - sim.base(), MAX_ROW_PT)));
        if (rest.length - take === 1 && take > 1) take--;
      }
      place(label, isFirst, rest.slice(0, take));
      rest = rest.slice(take);
      isFirst = false;
    }
  };
  for (const a of ag) {
    const title = a.title ? wrapChars(Array.from('■ ' + a.title).map((c) => ({ c, s: { size: 12, b: true, i: false, color: NAVY } })), avail, meter) : [];
    const paras = a.chars.map((p) => wrapChars(p, avail, meter));
    if (paras.length === 0) {
      planPara(a.label, true, title.length ? title : [{ chars: [], size: BASE, tail: BASE_STYLE }]);
      continue;
    }
    planPara(a.label, true, title.concat(paras[0]));
    for (let k = 1; k < paras.length; k++) planPara(a.label, false, paras[k]);
  }
  let rr = ch;
  if (rows.length === 0) {
    // 안건이 없으면 손으로 적을 수 있게 빈 줄을 몇 개 둔다
    for (let k = 0; k < 6; k++) {
      rr++;
      S.height(rr, 22.5);
      S.put(rr, C_NO[0], rr, C_NO[1], { font: F(10.5), bg: FILL_SOFT, al: AL('center'), bd: ['thin', LINE], name: '내용 안건' });
      S.put(rr, C_CONTENT[0], rr, C_CONTENT[1], { font: F(BASE), bg: 'FFFFFF', al: AL('left', { indent: 1, wrap: true }), bd: ['thin', LINE], name: '내용 값' });
    }
  }
  const missing = new Set<string>();
  for (const row of rows) {
    rr++;
    const sum = row.lines.reduce((acc, ln) => acc + linePt(ln.size), 0);
    S.height(rr, Math.min(MAX_ROW_PT, rowPt(sum)));
    S.put(rr, C_NO[0], rr, C_NO[1], {
      value: row.label || undefined,
      font: row.first ? F(11, true, NAVY) : F(9, false, NOTE_GRAY),
      bg: FILL_SOFT,
      al: AL('center'),
      bd: ['thin', LINE],
      name: '내용 안건',
    });
    S.put(rr, C_CONTENT[0], rr, C_CONTENT[1], {
      value: toRichText(row.lines),
      font: F(BASE),
      bg: 'FFFFFF',
      al: AL('left', { indent: 1, wrap: true }),
      bd: ['thin', LINE],
      name: '내용 값',
    });
    for (const ln of row.lines) for (const x of ln.chars) if (meter.hasGlyph(x.c) === false) missing.add(x.c);
  }
  const last = rr;

  // ── 큰 구분선 · 바깥 테두리 ──
  S.outline(1, 1, last, NU, 'medium', DARK);
  for (const sep of [4, ah0, gh, ch]) S.hsep(sep);
  S.finalize();

  // ── 로고(비율 유지, 왼쪽 위 칸 안에 가운데) ──
  if (d.logo) {
    const cellW = (C_LOGO[1] - C_LOGO[0] + 1) * UNIT_PX;
    const cellH = ([1, 2, 3].reduce((acc, r) => acc + (S.heights.get(r) ?? 0), 0) * 96) / 72;
    let w = cellW - 18;
    let h = (w * d.logo.h) / d.logo.w;
    if (h > cellH - 14) {
      h = cellH - 14;
      w = (h * d.logo.w) / d.logo.h;
    }
    const dx = (cellW - w) / 2;
    const dy = (cellH - h) / 2;
    const imageId = wb.addImage({ buffer: d.logo.buf as unknown as ExcelJS.Buffer, extension: d.logo.ext });
    ws.addImage(imageId, {
      tl: { nativeCol: 0, nativeColOff: Math.round(dx * 9525), nativeRow: 0, nativeRowOff: Math.round(dy * 9525) },
      ext: { width: w, height: h },
      editAs: 'oneCell',
    } as unknown as ExcelJS.ImageRange);
  }

  // ── 인쇄 설정 ──
  Object.assign(ws.pageSetup, {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.55, right: 0.55, top: 0.6, bottom: 0.75, header: 0.3, footer: 0.33 },
    printArea: `A$1:${colLetter(NU)}$${last}`,
    printTitlesRow: `${ch}:${ch}`,
  });
  // 바닥글: 왼쪽=문서번호 · 가운데=회사명 · 오른쪽=PAGE &P/&N (글꼴 코드를 크기 코드 뒤에 두어, 문서번호가 숫자로 시작해도 크기 숫자와 붙지 않는다)
  const esc = (t: string): string => t.replace(/&/g, '&&');
  const FT = `&9&"${FONT},Regular"`;
  ws.headerFooter.oddFooter = `&L${FT}${esc(d.docNo)}&C${FT}${esc(d.companyName)}&R${FT}PAGE &P/&N`;

  // ── 한 줄에 들어가는지(알림용) ──
  const warnings: string[] = [];
  for (const f of S.fits) {
    const wpx = S.textPx(f.text, f.size, f.bold);
    if (wpx > f.px) {
      if (f.shrink && (f.size * f.px) / wpx >= MIN_SHRINK_PT) {
        notes.push(`글자 줄여 맞춤: ${f.name} «${f.text}» ${wpx}px > ${f.px}px → 약 ${((f.size * f.px) / wpx).toFixed(1)}pt`);
      } else {
        warnings.push(`한 줄에 안 들어감: ${f.name} «${f.text}» ${wpx}px > ${f.px}px`);
      }
    }
  }
  if (missing.size) warnings.push(`맑은 고딕에 없는 글자 ${missing.size}종(엑셀이 다른 글꼴로 바꿔 그림): ${Array.from(missing).join('')}`);
  if (meter.source === 'fallback') notes.push('맑은 고딕 글꼴 파일을 못 읽어 보수적 글자 폭 표로 줄 높이를 계산함(행이 조금 높게 나올 수 있다)');

  const out = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(out as unknown as ArrayBuffer),
    warnings,
    notes,
    lastRow: last,
    contentHeaderRow: ch,
    attendeeRows: R,
    agendaRows: A,
    contentRows: rows.length,
    rowHeightTotal: Array.from(S.heights.values()).reduce((a, b) => a + b, 0),
    meterSource: meter.source,
  };
}

// ───────────────────────── 저장 ─────────────────────────
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 파일 이름 조각 정리 — 금지 글자 제거·공백 정리·끝의 점/공백 제거·글자 수 제한. 비면 fallback. */
export function sanitizeFileNamePart(s: unknown, maxChars: number, fallback: string): string {
  let t = String(s ?? '').replace(FORBIDDEN_NAME, ' ').replace(/\s+/g, ' ').trim();
  t = Array.from(t).slice(0, maxChars).join('');
  t = t.replace(/[. ]+$/g, '').trim();
  return t || fallback;
}

/** 한국시간(UTC+9, 서머타임 없음)의 «YYYYMMDD_HHmm» — toISOString().slice 는 하루 밀리므로 쓰지 않는다 */
function kstStampNow(): string {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (x: number, w = 2): string => String(x).padStart(w, '0');
  return `${p(k.getUTCFullYear(), 4)}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}_${p(k.getUTCHours())}${p(k.getUTCMinutes())}`;
}

export function minutesFileBaseName(doc: Pick<MinutesExport, 'fileStamp' | 'purpose'>): string {
  const stamp = /^\d{8}_\d{4}$/.test(String(doc?.fileStamp ?? '')) ? String(doc.fileStamp) : kstStampNow();
  const purpose = sanitizeFileNamePart(doc?.purpose, 20, '회의록');
  return basename(`회의록_${stamp}_${purpose}`);
}

function describeFsError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return '이 폴더에 저장할 권한이 없습니다. 다른 폴더를 골라 주세요.';
    case 'ENOSPC':
      return '저장 공간이 부족합니다. 공간을 확보하거나 다른 폴더를 골라 주세요.';
    case 'ENOENT':
    case 'ENOTDIR':
      return '저장 폴더를 만들 수 없습니다. 폴더 위치를 다시 골라 주세요.';
    case 'EEXIST':
      return '저장 폴더와 같은 이름의 파일이 있어 폴더를 만들 수 없습니다. 다른 폴더를 골라 주세요.';
    case 'EBUSY':
      return '파일이 다른 프로그램에서 사용 중이라 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
    case 'ENAMETOOLONG':
      return '폴더 경로가 너무 깁니다. 더 짧은 위치를 골라 주세요.';
    default:
      return '엑셀 파일을 저장하지 못했습니다.' + (code ? ` (오류 ${code})` : '');
  }
}

/** 덮어쓰지 않고 «이름», «이름 (2)», «이름 (3)» … 로 배타 생성('wx') 해서 쓴다. 쓰다 실패하면 방금 만든 불완전 파일만 정리한다. */
async function writeExclusive(dir: string, baseName: string, ext: string, data: Buffer): Promise<string> {
  for (let n = 1; n <= 999; n++) {
    const name = n === 1 ? `${baseName}${ext}` : `${baseName} (${n})${ext}`;
    const full = join(dir, name);
    let fh: import('fs/promises').FileHandle;
    try {
      fh = await fsp.open(full, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') continue;
      throw err;
    }
    try {
      await fh.writeFile(data);
      await fh.close();
      return full;
    } catch (err) {
      try {
        await fh.close();
      } catch {
        /* 무시 */
      }
      try {
        await fsp.unlink(full); // 이 저장이 방금 만든 불완전 파일만 지운다(기존 파일은 'wx' 라 여기까지 오지 않는다)
      } catch {
        /* 무시 */
      }
      throw err;
    }
  }
  throw Object.assign(new Error('too many files'), { code: 'EEXIST_MANY' });
}

export async function saveMinutesFile(req: MinutesSaveRequest, defaultDir: string): Promise<MinutesSaveResult> {
  try {
    const doc = req?.doc;
    if (!doc || typeof doc !== 'object') return { ok: false, message: '저장할 회의록 내용이 없습니다.' };
    let dir = typeof req.dir === 'string' && req.dir.trim() ? req.dir.trim() : defaultDir;
    if (dir.includes('\u0000') || !isAbsolute(dir)) return { ok: false, message: '저장 폴더 경로가 올바르지 않습니다. 폴더를 다시 골라 주세요.' };
    dir = dir.replace(/[\\/]+$/, '') || dir;

    let built: BuildResult;
    try {
      built = await buildMinutesWorkbook(doc);
    } catch (err) {
      console.error('[minutes] build failed', err instanceof Error ? err.message : err);
      return { ok: false, message: '엑셀 파일을 만들지 못했습니다. 내용을 확인한 뒤 다시 시도해 주세요.' };
    }

    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch (err) {
      return { ok: false, message: describeFsError(err) };
    }
    try {
      const filePath = await writeExclusive(dir, minutesFileBaseName(doc), '.xlsx', built.buffer);
      return { ok: true, filePath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'EEXIST_MANY') {
        return { ok: false, message: '같은 이름의 회의록 파일이 너무 많습니다. 다른 폴더를 골라 주세요.' };
      }
      return { ok: false, message: describeFsError(err) };
    }
  } catch (err) {
    console.error('[minutes] save failed', err instanceof Error ? err.message : err);
    return { ok: false, message: '엑셀 파일을 저장하지 못했습니다.' };
  }
}
