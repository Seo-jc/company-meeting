// 회의록 문서(Y.Doc) → 엑셀 저장 계약 MinutesExport (React·DOM 없음 → node 시험에서 그대로 불러 쓴다).
// 편집기(Tiptap)가 Y.XmlFragment 에 남기는 글자 서식(bold · italic · textStyle{color,fontSize})을 «런» 으로 옮긴다.
// 겹침 확인: electron/minutesExcel.ts 는 이 결과를 받아 엑셀 파일을 만드는 쪽(메인), 이 파일은 그 입력을 만드는 쪽(렌더러).

import * as Y from 'yjs';
import { DEFAULT_PLACE, agendaFieldName, metaOf, readAgenda, readAttendees } from './model';
import { colorIdFromCss, sizePtFromPx, sizePxFromCss } from './glyphs';
import { composeDateText, kstDateText, kstFileStamp, kstHHmm } from './kst';
import type { CompanySettings, MinutesColor, MinutesExport, MinutesPara, MinutesRun } from './types';

type DeltaPart = { insert?: unknown; attributes?: Record<string, unknown> };

/** y-tiptap 은 같은 이름 마크가 겹칠 수 있을 때 «이름--해시8자» 로 적는다. 해시를 떼고 이름만 본다. */
const markName = (k: string): string => k.replace(/--[A-Za-z0-9+/=]{8}$/, '');

function runFromDelta(text: string, attributes: Record<string, unknown> | undefined): MinutesRun {
  let bold = false;
  let italic = false;
  let color: MinutesColor = 'default';
  let px: number | null = null;
  for (const [k, v] of Object.entries(attributes ?? {})) {
    const name = markName(k);
    if (name === 'bold') bold = true;
    else if (name === 'italic') italic = true;
    else if (name === 'textStyle' && v && typeof v === 'object') {
      const st = v as { color?: unknown; fontSize?: unknown };
      color = colorIdFromCss(st.color);
      px = sizePxFromCss(st.fontSize);
    }
  }
  const run: MinutesRun = { text };
  if (bold) run.bold = true;
  if (italic) run.italic = true;
  if (color !== 'default') run.color = color;
  const pt = sizePtFromPx(px);
  if (pt !== undefined) run.size = pt;
  return run;
}

const sameStyle = (a: MinutesRun, b: MinutesRun): boolean =>
  !!a.bold === !!b.bold && !!a.italic === !!b.italic && a.color === b.color && a.size === b.size;

function runsOfContainer(container: Y.XmlFragment | Y.XmlElement): MinutesRun[] {
  const runs: MinutesRun[] = [];
  const push = (run: MinutesRun) => {
    const last = runs[runs.length - 1];
    if (last && last.text !== '\n' && run.text !== '\n' && sameStyle(last, run)) last.text += run.text;
    else runs.push(run);
  };
  for (const child of container.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const part of child.toDelta() as DeltaPart[]) {
        if (typeof part.insert === 'string') {
          if (part.insert) push(runFromDelta(part.insert, part.attributes));
        } else if (part.insert instanceof Y.XmlElement && part.insert.nodeName === 'hardBreak') {
          push({ text: '\n' });
        }
      }
    } else if (child instanceof Y.XmlElement) {
      if (child.nodeName === 'hardBreak') push({ text: '\n' });
      else for (const r of runsOfContainer(child)) push(r);
    }
  }
  return runs;
}

/**
 * 안건 내용 칸(Y.XmlFragment) → 문단 목록. 엔터 한 번 = 문단 하나 = 엑셀 한 줄.
 * Shift+Enter(줄바꿈)는 같은 문단 안의 '\n' 런으로 내보낸다(엑셀 쪽이 강제 줄바꿈으로 읽음).
 * 끝에 붙은 빈 문단은 뺀다(안 보이는 빈 줄이 엑셀 칸을 늘리지 않게).
 */
export function fragmentToParas(frag: Y.XmlFragment): MinutesPara[] {
  const paras: MinutesPara[] = [];
  for (const child of frag.toArray()) {
    if (child instanceof Y.XmlElement) {
      paras.push({ runs: runsOfContainer(child) });
    } else if (child instanceof Y.XmlText) {
      // 최상위에 글자가 바로 오는 경우는 편집기 문서 규칙상 없지만, 있어도 한 문단으로 읽는다
      const runs: MinutesRun[] = [];
      for (const part of child.toDelta() as DeltaPart[]) {
        if (typeof part.insert === 'string' && part.insert) runs.push(runFromDelta(part.insert, part.attributes));
      }
      paras.push({ runs });
    }
  }
  const isBlank = (p: MinutesPara): boolean => p.runs.every((r) => r.text.trim() === '');
  while (paras.length > 0 && isBlank(paras[paras.length - 1])) paras.pop();
  return paras;
}

const LOGO_RE = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

export function companyForExport(company: CompanySettings | null): MinutesExport['company'] {
  const m = company?.logo ? LOGO_RE.exec(company.logo) : null;
  return {
    name: company?.name ?? '',
    docNo: company?.docNo ?? '',
    logoBase64: m ? m[2] : null,
    logoMime: m ? (m[1] as 'image/png' | 'image/jpeg') : null,
  };
}

// 엑셀에 담는 양의 한도 — 참석자 한 명이 (또는 큰 붙여넣기가) 문서를 부풀려도 저장하는 PC 의 메인 프로세스가 오래 멈추지 않게.
// electron/minutesExcel.ts 의 normalize() 에도 «같은 값» 의 방어 한도가 있다(여기서 먼저 자르고 알리므로 거기서는 걸리지 않는다).
export const EXPORT_MAX_AGENDA = 50;
export const EXPORT_MAX_ATTENDEES = 200;
export const EXPORT_MAX_CHARS_PER_AGENDA = 50_000;
export const EXPORT_MAX_CHARS_TOTAL = 200_000;

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/** 문단 목록을 글자 수 한도로 자른다(문단 나눔은 1글자로 셈). 잘렸으면 cut=true. */
function capParas(paras: MinutesPara[], max: number): { paras: MinutesPara[]; chars: number; cut: boolean } {
  const out: MinutesPara[] = [];
  let used = 0;
  for (const p of paras) {
    if (used >= max) return { paras: out, chars: used, cut: true };
    const runs: MinutesRun[] = [];
    for (const r of p.runs) {
      const room = max - used;
      if (r.text.length <= room) {
        runs.push(r);
        used += r.text.length;
        continue;
      }
      let n = Math.max(0, room);
      if (n > 0 && isHighSurrogate(r.text.charCodeAt(n - 1))) n -= 1; // 글자(서로게이트 쌍)를 반으로 자르지 않는다
      if (n > 0) runs.push({ ...r, text: r.text.slice(0, n) });
      out.push({ runs });
      return { paras: out, chars: max, cut: true };
    }
    out.push({ runs });
    used += 1;
  }
  return { paras: out, chars: used, cut: false };
}

export type BuildExportOptions = {
  /** 회의 시작 시각(ms). 회의 정보 칸에 날짜·시작이 비어 있을 때만 쓴다. 기본 = now */
  startedAt?: number;
  /** 한도 때문에 일부를 잘랐으면 report.truncated 가 true 가 된다(저장 알림에 안내를 띄우려고) */
  report?: { truncated: boolean };
};

/**
 * 회의록 문서 → 엑셀 저장용 자료.
 * @param writer 작성자 — 자동이면 저장하는 사람 이름, 사람이 고쳤으면 그 값
 * @param now    지금 시각(ms). 끝 시각이 비어 있으면 이 시각으로 채우고, 파일 이름 도장(fileStamp)도 이 시각으로 만든다
 */
export function buildExport(
  doc: Y.Doc,
  company: CompanySettings | null,
  writer: string,
  now: number,
  opts: BuildExportOptions = {}
): MinutesExport {
  const meta = metaOf(doc);
  const s = (k: string): string => (typeof meta.get(k) === 'string' ? (meta.get(k) as string) : '');
  const startedAt = opts.startedAt ?? now;
  const date = s('date') || kstDateText(startedAt);
  const start = s('start') || kstHHmm(startedAt);
  const end = s('end') || kstHHmm(now);
  const place = s('place').trim() || DEFAULT_PLACE;

  let truncated = false;
  const allAttendees = readAttendees(doc).filter((r) => r.name.trim() !== '');
  if (allAttendees.length > EXPORT_MAX_ATTENDEES) truncated = true;
  const attendees = allAttendees.slice(0, EXPORT_MAX_ATTENDEES).map((r) => ({
    dept: r.dept.trim(),
    rank: r.rank.trim(),
    name: r.name.trim(),
    companion: r.kind !== 'auto',
    confirmed: r.kind === 'auto',
  }));

  const allAgenda = readAgenda(doc);
  if (allAgenda.length > EXPORT_MAX_AGENDA) truncated = true;
  let charsLeft = EXPORT_MAX_CHARS_TOTAL;
  const agenda = allAgenda.slice(0, EXPORT_MAX_AGENDA).map((a, i) => {
    const capped = capParas(
      fragmentToParas(doc.getXmlFragment(agendaFieldName(a.id))),
      Math.min(EXPORT_MAX_CHARS_PER_AGENDA, Math.max(0, charsLeft))
    );
    charsLeft -= capped.chars;
    if (capped.cut) truncated = true;
    return { no: i + 1, title: a.title.trim(), dept: a.dept.trim(), paras: capped.paras };
  });
  if (opts.report) opts.report.truncated = truncated;

  return {
    company: companyForExport(company),
    purpose: s('purpose').trim(),
    dateText: composeDateText(date, start, end),
    place,
    writer: writer.trim(),
    attendees,
    agenda,
    fileStamp: kstFileStamp(now),
  };
}
