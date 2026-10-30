// 회의록 엑셀용 «글자 폭 재기» — 맑은 고딕 글꼴 파일(malgun.ttf·malgunbd.ttf)의 글자 폭 표(hmtx)를 직접 읽는다.
// 겹침 확인: build_minutes_form.py 와 다름 — 그건 파이썬(Pillow)으로 폭을 재는 시제품이고, 이 파일은 앱(Node)에서 같은 계산을 하는 TS 판이다.
//
// 왜 필요한가: 병합 칸은 엑셀이 줄 높이를 자동으로 맞추지 못하고, 한글은 글자 단위로 끊긴다. 그래서 글자 폭을 직접 재서
//   띄어쓰기에서 줄을 나누고(진짜 줄바꿈) 줄 수로 행 높이를 계산한다(minutesExcel.ts).
// 글꼴 파일이 없으면(맥·리눅스·글꼴 삭제) «보수적 폭 표» 로 대신한다 — 실제보다 넓게 잡아 줄이 일찍 나뉘고 행이 조금 높아질 뿐 잘리진 않는다.
// 외부 부품 없음(직접 구현 — ttf 의 head·hhea·maxp·hmtx·cmap(형식 4·12)만 읽는다).

import { readFileSync } from 'fs';
import { join } from 'path';

type Face = {
  upm: number;
  /** 글자 코드 → 진행 폭(글꼴 단위). 글꼴에 글자가 없으면 null */
  adv: (cp: number) => number | null;
};

function parseTtf(buf: Buffer): Face | null {
  try {
    let base = 0;
    if (buf.toString('latin1', 0, 4) === 'ttcf') base = buf.readUInt32BE(12); // 글꼴 모음 파일이면 첫 글꼴
    const numTables = buf.readUInt16BE(base + 4);
    const tables = new Map<string, { off: number; len: number }>();
    for (let i = 0; i < numTables; i++) {
      const p = base + 12 + i * 16;
      tables.set(buf.toString('latin1', p, p + 4), { off: buf.readUInt32BE(p + 8), len: buf.readUInt32BE(p + 12) });
    }
    const head = tables.get('head');
    const hhea = tables.get('hhea');
    const hmtx = tables.get('hmtx');
    const cmap = tables.get('cmap');
    if (!head || !hhea || !hmtx || !cmap) return null;
    const upm = buf.readUInt16BE(head.off + 18);
    const nHM = buf.readUInt16BE(hhea.off + 34);
    if (!upm || !nHM) return null;

    // cmap: 윈도 유니코드(3,10 형식 12) → (3,1 형식 4) → (0,* ) 차례로 고른다
    const nSub = buf.readUInt16BE(cmap.off + 2);
    let best: { off: number; fmt: number; rank: number } | null = null;
    for (let i = 0; i < nSub; i++) {
      const p = cmap.off + 4 + i * 8;
      const plat = buf.readUInt16BE(p);
      const enc = buf.readUInt16BE(p + 2);
      const off = cmap.off + buf.readUInt32BE(p + 4);
      const fmt = buf.readUInt16BE(off);
      let rank = -1;
      if (plat === 3 && enc === 10 && fmt === 12) rank = 4;
      else if (plat === 3 && enc === 1 && fmt === 4) rank = 3;
      else if (plat === 0 && fmt === 12) rank = 2;
      else if (plat === 0 && fmt === 4) rank = 1;
      if (rank > (best?.rank ?? 0)) best = { off, fmt, rank };
    }
    if (!best) return null;
    const sub = best;

    const glyphOf = (cp: number): number => {
      if (sub.fmt === 12) {
        const n = buf.readUInt32BE(sub.off + 12);
        let lo = 0;
        let hi = n - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const g = sub.off + 16 + mid * 12;
          const s = buf.readUInt32BE(g);
          const e = buf.readUInt32BE(g + 4);
          if (cp < s) hi = mid - 1;
          else if (cp > e) lo = mid + 1;
          else return buf.readUInt32BE(g + 8) + (cp - s);
        }
        return 0;
      }
      if (cp > 0xffff) return 0;
      const segX2 = buf.readUInt16BE(sub.off + 6);
      const seg = segX2 >> 1;
      const endP = sub.off + 14;
      const startP = endP + segX2 + 2;
      const deltaP = startP + segX2;
      const rangeP = deltaP + segX2;
      let lo = 0;
      let hi = seg - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const end = buf.readUInt16BE(endP + mid * 2);
        const start = buf.readUInt16BE(startP + mid * 2);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else {
          const delta = buf.readUInt16BE(deltaP + mid * 2);
          const ro = buf.readUInt16BE(rangeP + mid * 2);
          if (ro === 0) return (cp + delta) & 0xffff;
          const g = buf.readUInt16BE(rangeP + mid * 2 + ro + (cp - start) * 2);
          return g === 0 ? 0 : (g + delta) & 0xffff;
        }
      }
      return 0;
    };

    return {
      upm,
      adv: (cp: number) => {
        const gid = glyphOf(cp);
        if (!gid) return null;
        const idx = gid < nHM ? gid : nHM - 1;
        return buf.readUInt16BE(hmtx.off + idx * 4);
      },
    };
  } catch {
    return null;
  }
}

function loadFace(path: string): Face | null {
  try {
    return parseTtf(readFileSync(path));
  } catch {
    return null;
  }
}

/** ASCII(0x20~0x7E) 글자 폭(글자 크기의 몇 배) — 맑은 고딕 보통·굵게 중 넓은 쪽을 0.01 단위로 올림. 글꼴 파일이 없을 때의 «보수적» 표. */
const ASCII_EM = [
  0.36, 0.33, 0.48, 0.61, 0.58, 0.88, 0.86, 0.29, 0.36, 0.36, 0.46, 0.72, 0.27, 0.42, 0.27, 0.44, 0.58, 0.58, 0.58, 0.58, 0.58,
  0.58, 0.58, 0.58, 0.58, 0.58, 0.27, 0.27, 0.72, 0.72, 0.72, 0.46, 0.98, 0.71, 0.64, 0.64, 0.75, 0.54, 0.53, 0.73, 0.77, 0.32,
  0.44, 0.65, 0.52, 0.97, 0.8, 0.78, 0.62, 0.78, 0.66, 0.57, 0.59, 0.74, 0.68, 1.01, 0.66, 0.61, 0.62, 0.36, 0.77, 0.36, 0.72,
  0.43, 0.31, 0.55, 0.63, 0.49, 0.63, 0.55, 0.38, 0.63, 0.61, 0.28, 0.28, 0.56, 0.28, 0.93, 0.61, 0.62, 0.63, 0.63, 0.4, 0.47,
  0.39, 0.61, 0.54, 0.8, 0.54, 0.54, 0.49, 0.36, 0.31, 0.36, 0.72,
];

/** 글꼴 파일이 없을 때의 «보수적» 폭(글자 크기의 몇 배). 맑은 고딕 실측: 한글·한자 1.0 · 라틴 확장 최대 0.99 · 기호(U+2000~2BFF) 최대 1.28 */
function fallbackEm(cp: number): number {
  if (cp >= 0x20 && cp <= 0x7e) return ASCII_EM[cp - 0x20] + 0.015;
  if (cp < 0x20) return 0.4;
  if (cp <= 0x24f) return 1.0;
  if (cp >= 0x2000 && cp <= 0x2bff) return 1.3;
  return 1.03;
}

/** 맑은 고딕에 글자가 없을 때(엑셀이 다른 글꼴로 바꿔 그린다)의 폭 — 라틴 확장 추가(베트남어 ạ ế 등)는 라틴 글자 정도, 이모지는 넓게, 나머지는 한 글자 폭 */
function missingEm(cp: number): number {
  if (cp >= 0x1e00 && cp <= 0x1eff) return 0.8;
  if (cp >= 0x1f000) return 1.3;
  return 1.0;
}

export class TextMeter {
  /** 'malgun' = 글꼴 파일의 실제 폭 · 'fallback' = 보수적 표 */
  readonly source: 'malgun' | 'fallback';
  private regular: Face | null;
  private bold: Face | null;
  private cache = new Map<string, number>();

  constructor(fontDir: string | null) {
    const reg = fontDir ? loadFace(join(fontDir, 'malgun.ttf')) : null;
    const bd = fontDir ? loadFace(join(fontDir, 'malgunbd.ttf')) : null;
    this.regular = reg;
    this.bold = bd ?? reg;
    this.source = reg ? 'malgun' : 'fallback';
  }

  /** 글자 한 개의 폭(px, 96dpi). 엑셀(GDI)은 글자마다 정수 px 로 올리므로 올림해서 넉넉히 본다(파이썬 시제품과 같은 방식). */
  px(ch: string, size: number, bold: boolean): number {
    const key = ch + '|' + size + '|' + (bold ? 1 : 0);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const cp = ch.codePointAt(0) ?? 0x20;
    const ppem = (size * 96) / 72;
    const face = bold ? this.bold : this.regular;
    let w: number;
    const a = face ? face.adv(cp) : null;
    // 파이썬 시제품(Pillow)과 같은 방식: 8배 크기에서 정수로 반올림한 폭 ÷ 8 (3448개 글자·크기·굵기 조합이 시제품 값과 전부 같음을 확인)
    if (face && a !== null) w = Math.round((a * Math.round(ppem * 8)) / face.upm) / 8;
    else if (face) w = ppem * missingEm(cp);
    else w = ppem * fallbackEm(cp);
    const out = Math.max(1, Math.ceil(w - 0.2));
    this.cache.set(key, out);
    return out;
  }

  /** 이 글자가 맑은 고딕에 있나. 글꼴 파일을 못 읽었으면 null(모름) */
  hasGlyph(ch: string): boolean | null {
    if (!this.regular) return null;
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x0a || cp === 0x09 || cp === 0x0d) return true;
    return this.regular.adv(cp) !== null;
  }
}

function windowsFontDir(): string | null {
  if (process.platform !== 'win32') return null;
  const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  return join(win, 'Fonts');
}

let shared: TextMeter | null = null;

/** 앱에서 쓰는 공용 측정기(처음 부를 때 한 번 글꼴을 읽는다) */
export function getMeter(): TextMeter {
  if (!shared) shared = new TextMeter(windowsFontDir());
  return shared;
}

/** 시험용 — 글꼴 폴더를 지정(null 이면 보수적 표) */
export function createMeter(fontDir: string | null): TextMeter {
  return new TextMeter(fontDir);
}
