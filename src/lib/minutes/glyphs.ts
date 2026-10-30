// 회의록 글자 서식 상수 — 화면(편집기·도구줄)과 엑셀 내보내기가 «같은 표» 를 쓴다.
// 값의 출처 = mockups/meeting_minutes_mockup.html (사장 확인본). 엑셀 쪽 색 값은 electron/minutesExcel.ts 의 COLOR_HEX 와 같다.
// 겹침 확인: 기존 코드에 글자색·크기 표는 없음.

import type { MinutesColor } from './types';

/** 글자색 5가지 — 엑셀 양식과 같은 값(흰 종이 위에서 그대로 읽힌다). 빨강=NG·현상, 파랑=개선·결정 */
export const MINUTES_COLORS: ReadonlyArray<{ id: MinutesColor; hex: string }> = [
  { id: 'default', hex: '#000000' },
  { id: 'blue', hex: '#3151A3' },
  { id: 'red', hex: '#C00000' },
  { id: 'green', hex: '#1E7B34' },
  { id: 'orange', hex: '#C55A11' },
];

/** 글자 크기 4단계: 화면 px ↔ 엑셀 pt (12→9, 14→10.5, 16→12, 19→14). 14px 가 기본(보통). */
export const MINUTES_SIZES: ReadonlyArray<{ px: 12 | 14 | 16 | 19; pt: 9 | 10.5 | 12 | 14 }> = [
  { px: 12, pt: 9 },
  { px: 14, pt: 10.5 },
  { px: 16, pt: 12 },
  { px: 19, pt: 14 },
];
export const DEFAULT_SIZE_PX = 14;

/** 안건 번호 표시: ①~⑩, 11번부터는 (11) */
export function circledNumber(index0: number): string {
  return index0 < 10 ? '①②③④⑤⑥⑦⑧⑨⑩'.charAt(index0) : `(${index0 + 1})`;
}

/** 맑은 고딕에 실제로 있는 글자만 모은 특수문자 39자 (그룹 이름은 컴포넌트가 한/영으로 붙인다) */
export const SYMBOL_GROUPS: ReadonlyArray<{ id: string; chars: readonly string[] }> = [
  { id: 'arrow', chars: ['→', '←', '↑', '↓', '⇒', '↔'] },
  { id: 'mark', chars: ['□', '■', '▣', '◇', '◆', '▶', '※', '★'] },
  { id: 'judge', chars: ['○', '●', '◎', '△', '▲', '×'] },
  { id: 'number', chars: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] },
  { id: 'unit', chars: ['Ø', '±', '≤', '≥', '℃', '㎜', '㎛', '㎏', '°'] },
];

/** 붙여넣기로 들어오면 엑셀에서 네모(□)로 깨지는 글자 → 가까운 글자 (목업 규칙) */
export const GLYPH_FIX: Readonly<Record<string, string>> = {
  '✓': '○',
  '✔': '○',
  '☑': '■',
  '☐': '□',
  '✕': '×',
  '✖': '×',
  '✗': '×',
  '➡': '→',
  '⬆': '↑',
  '⬇': '↓',
  '⇐': '←',
  '≈': '≒',
};
const GLYPH_RE = /[✓✔☑☐✕✖✗➡⬆⬇⇐≈]/g;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}]/u;
// 엑셀 xml 에 넣을 수 없는 제어 글자(줄바꿈·탭은 따로 처리)
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * 한 번에 붙여넣을 수 있는 글자 수. 이보다 길면 앞부분만 받는다 — 붙여넣은 글은 그대로 모든 참석자에게 전달되고 엑셀에도 담기므로,
 * 실수로(또는 일부러) 수십 MB 를 붙여 넣어 모두의 회의록을 못 쓰게 만드는 것을 막는다.
 */
export const MAX_PASTE_CHARS = 100_000;

/** 붙여넣을 글이 MAX_PASTE_CHARS 보다 길면 앞부분만(글자 하나를 반으로 자르지 않는다). */
export function clipPaste(text: string): { text: string; clipped: boolean } {
  if (text.length <= MAX_PASTE_CHARS) return { text, clipped: false };
  let n = MAX_PASTE_CHARS;
  const last = text.charCodeAt(n - 1);
  if (last >= 0xd800 && last <= 0xdbff) n -= 1; // 서로게이트 쌍의 앞 절반만 남지 않게
  return { text: text.slice(0, n), clipped: true };
}

export type PasteResult = {
  /** 붙여 넣을 글(줄바꿈은 \n 으로 통일) */
  text: string;
  /** 바꾼 글자 목록 [원래, 바뀐] */
  fixed: Array<[string, string]>;
  /** 이모지가 들어 있었나 */
  hasEmoji: boolean;
};

/** 붙여넣을 글을 «글자만» 받아 정리한다. 서식은 버리고, 엑셀에서 깨지는 글자는 가까운 글자로 바꾼다. */
export function sanitizePaste(raw: string): PasteResult {
  const fixed: Array<[string, string]> = [];
  let text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(CONTROL_RE, '')
    .replace(GLYPH_RE, (c) => {
      const to = GLYPH_FIX[c];
      if (!fixed.some((f) => f[0] === c)) fixed.push([c, to]);
      return to;
    });
  // 끝의 줄바꿈 하나는 «줄 복사» 때문에 붙는 것이라 버린다(빈 줄이 하나 더 생기지 않게)
  if (text.endsWith('\n')) text = text.slice(0, -1);
  return { text, fixed, hasEmoji: EMOJI_RE.test(text) };
}

// ───────────────── 편집기 표기 ↔ 내보내기 표기 ─────────────────

const HEX_TO_COLOR: Record<string, MinutesColor> = {};
for (const c of MINUTES_COLORS) HEX_TO_COLOR[c.hex.toUpperCase()] = c.id;

/** CSS 색 글(#C00000 / rgb(192, 0, 0)) → 5가지 중 하나. 모르는 색은 기본. */
export function colorIdFromCss(css: unknown): MinutesColor {
  if (typeof css !== 'string') return 'default';
  const s = css.trim();
  if (!s) return 'default';
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s);
  if (rgb) {
    const hex =
      '#' +
      [rgb[1], rgb[2], rgb[3]]
        .map((n) => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    return HEX_TO_COLOR[hex] ?? 'default';
  }
  let hex = s.toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(hex)) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  return HEX_TO_COLOR[hex] ?? 'default';
}

export function colorHex(id: MinutesColor): string {
  return MINUTES_COLORS.find((c) => c.id === id)?.hex ?? '#000000';
}

/** CSS 글자 크기 글(«16px») → 가장 가까운 화면 px 단계. 없으면 null(= 기본 크기). */
export function sizePxFromCss(css: unknown): 12 | 14 | 16 | 19 | null {
  if (typeof css !== 'string') return null;
  const m = /^\s*([\d.]+)\s*px\s*$/i.exec(css);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  let best = MINUTES_SIZES[0];
  for (const s of MINUTES_SIZES) if (Math.abs(s.px - v) < Math.abs(best.px - v)) best = s;
  return best.px;
}

/** 화면 px 단계 → 엑셀 pt. 기본 크기(14px)는 undefined(= 엑셀 기본 10.5). */
export function sizePtFromPx(px: number | null): 9 | 12 | 14 | undefined {
  if (px === null || px === DEFAULT_SIZE_PX) return undefined;
  const hit = MINUTES_SIZES.find((s) => s.px === px);
  if (!hit) return undefined;
  return hit.pt === 10.5 ? undefined : (hit.pt as 9 | 12 | 14);
}
