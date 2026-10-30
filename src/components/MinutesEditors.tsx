// 회의록 «회의 내용» 쓰기 영역 — 글자 서식 도구줄 + 안건마다 흰 종이 한 장(Tiptap 편집기).
// 글은 Yjs(CRDT)로 모든 참석자와 실시간으로 합쳐진다: 안건 id 마다 Y.XmlFragment('agenda:'+id) 한 칸, Collaboration 확장이 그 칸에 붙는다.
// 서식은 워드처럼 «고른 글자» 단위: 굵게 · 기울임 · 글자 크기 4단계(화면 12/14/16/19px ↔ 엑셀 9/10.5/12/14pt) · 글자색 5가지.
// 붙여넣기는 일반 글자만 받고 맑은 고딕에 없는 글자는 바꾼다. innerHTML 은 쓰지 않는다.
// 겹침 확인: electron/minutesExcel.ts 와 다름 — 그건 메인의 엑셀 만들기이고, 이 파일은 렌더러에서 사람이 글을 쓰는 편집기 화면이다.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Bold } from '@tiptap/extension-bold';
import { Italic } from '@tiptap/extension-italic';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Collaboration } from '@tiptap/extension-collaboration';
import type * as Y from 'yjs';
import { useT } from '../i18n';
import type { MinutesSession } from '../lib/minutes/session';
import type { AgendaItem, MinutesRemoteActivity } from '../lib/minutes/types';
import { agendaFieldName } from '../lib/minutes/model';
import {
  DEFAULT_SIZE_PX,
  MINUTES_COLORS,
  MINUTES_SIZES,
  SYMBOL_GROUPS,
  circledNumber,
  colorHex,
  colorIdFromCss,
  MAX_PASTE_CHARS,
  clipPaste,
  sanitizePaste,
  sizePxFromCss,
} from '../lib/minutes/glyphs';

const STR = {
  ko: {
    contentTitle: '회의 내용',
    contentSub: '안건마다 적습니다(제목은 자동) · 엔터 한 번 = 엑셀 한 줄',
    toolbarAria: '글자 서식',
    sizeAria: '글자 크기',
    sizeNames: { 12: '작게', 14: '보통', 16: '크게', 19: '제목' } as Record<number, string>,
    bold: '굵게',
    italic: '기울임',
    symBtn: '※ 특수문자',
    symBtnAria: '특수문자 상자 열기',
    colorLabel: '글자색',
    colorAria: '글자 색',
    colorNames: { default: '기본', blue: '파랑', red: '빨강', green: '초록', orange: '주황' } as Record<string, string>,
    hintRed: '빨강',
    hintRedTail: '=문제·현상(NG)',
    hintBlue: '파랑',
    hintBlueTail: '=개선·결정',
    symAria: '특수문자',
    symGroups: { arrow: '화살표', mark: '네모·표시', judge: '판정', number: '번호', unit: '치수·단위' } as Record<string, string>,
    symHint:
      '누르면 글 커서 위치에 들어갑니다 (닫기: Esc) · 엑셀·인쇄에서 깨지지 않는 글자만 모았습니다 · 글자색은 엑셀에도 같은 색으로 나옵니다',
    symInsertAria: (ch: string) => `${ch} 넣기`,
    emptyA: '회의 내용은 안건마다 적습니다.',
    emptyB: '위에서 ',
    emptyBold: '＋ 안건 추가',
    emptyC: '를 누르면 이곳에 적을 칸이 생깁니다.',
    emptyD: '안건이 따로 없으면 «회의 내용» 처럼 한 줄만 적어 주세요.',
    noTitle: '(안건 제목을 입력하세요)',
    editorPh: '이 안건의 회의 내용을 적습니다',
    typingTag: (who: string) => `${who} 입력 중`,
    editorAria: (n: number) => `안건 ${n} 회의 내용`,
    pasteFixed: (pairs: string) => `엑셀에서 네모(□)로 깨지는 글자를 바꿨습니다: ${pairs}`,
    pasteEmoji: '이모지는 엑셀에서 깨질 수 있어 글자로 바꿔 쓰길 권합니다',
    pasteClipped: (n: number) => `붙여넣을 글이 너무 길어 앞의 ${n.toLocaleString('ko-KR')}자만 넣었습니다`,
  },
  en: {
    contentTitle: 'Notes',
    contentSub: 'Write per agenda item (title is automatic) · one Enter = one Excel line',
    toolbarAria: 'Text formatting',
    sizeAria: 'Text size',
    sizeNames: { 12: 'Small', 14: 'Normal', 16: 'Large', 19: 'Title' } as Record<number, string>,
    bold: 'Bold',
    italic: 'Italic',
    symBtn: '※ Symbols',
    symBtnAria: 'Open the symbol box',
    colorLabel: 'Color',
    colorAria: 'Text color',
    colorNames: { default: 'Default', blue: 'Blue', red: 'Red', green: 'Green', orange: 'Orange' } as Record<string, string>,
    hintRed: 'Red',
    hintRedTail: ' = problem / NG',
    hintBlue: 'Blue',
    hintBlueTail: ' = improvement / decision',
    symAria: 'Symbols',
    symGroups: { arrow: 'Arrows', mark: 'Marks', judge: 'Judgement', number: 'Numbers', unit: 'Units' } as Record<string, string>,
    symHint:
      'Click to insert at the cursor (close: Esc) · only characters that do not break in Excel or print · text colors appear the same in Excel',
    symInsertAria: (ch: string) => `Insert ${ch}`,
    emptyA: 'Notes are written per agenda item.',
    emptyB: 'Press ',
    emptyBold: '＋ Add item',
    emptyC: ' above and a writing box appears here.',
    emptyD: 'With no agenda, add one item such as "Notes" and write there.',
    noTitle: '(enter an agenda title)',
    editorPh: 'Write the notes for this agenda item',
    typingTag: (who: string) => `${who} typing`,
    editorAria: (n: number) => `Notes for agenda item ${n}`,
    pasteFixed: (pairs: string) => `Replaced characters that turn into boxes (□) in Excel: ${pairs}`,
    pasteEmoji: 'Emoji can break in Excel — please use plain characters instead',
    pasteClipped: (n: number) => `The pasted text was too long — only the first ${n.toLocaleString('en-US')} characters were inserted`,
  },
};

// ───────────────────────── 붙여넣기: 글자만, 줄마다 문단 ─────────────────────────

function insertPlainText(view: EditorView, text: string): void {
  const lines = text.split('\n');
  let tr = view.state.tr;
  if (!tr.selection.empty) tr = tr.deleteSelection();
  lines.forEach((line, i) => {
    if (i > 0) tr = tr.split(tr.selection.from);
    if (line) tr = tr.insertText(line);
  });
  view.dispatch(tr.scrollIntoView());
}

// ───────────────────────── 안건 하나의 편집기 ─────────────────────────

type AgendaEditorProps = {
  doc: Y.Doc;
  agendaId: string;
  placeholder: string;
  ariaLabel: string;
  onActivate: (ed: Editor) => void;
  /** 편집기가 만들어졌다(도구줄이 글 커서 없이도 첫 칸을 찾도록 «안건 id → 편집기» 표에 올림) */
  onReady: (id: string, ed: Editor) => void;
  onRelease: (id: string, ed: Editor) => void;
  onPasteNotice: (fixed: Array<[string, string]>, hasEmoji: boolean, clipped: boolean) => void;
};

function AgendaEditorInner({ doc, agendaId, placeholder, ariaLabel, onActivate, onReady, onRelease, onPasteNotice }: AgendaEditorProps) {
  const pasteRef = useRef(onPasteNotice);
  pasteRef.current = onPasteNotice;
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;

  const editor = useEditor(
    {
      immediatelyRender: true,
      // 타자로 친 *별표*·_밑줄_ 이 자동으로 기울임/굵게로 바뀌지 않게 한다(각주 «*1) …» 같은 공식 글자가 사용자 모르게 바뀐다).
      // 서식은 도구줄 단추와 Ctrl+B / Ctrl+I 로만 준다.
      enableInputRules: false,
      enablePasteRules: false,
      extensions: [
        Document,
        Paragraph,
        Text,
        HardBreak,
        Bold,
        Italic,
        TextStyle,
        Color,
        FontSize,
        Placeholder.configure({ placeholder }),
        Collaboration.configure({ document: doc, field: agendaFieldName(agendaId) }),
      ],
      editorProps: {
        attributes: { class: 'mm-editor', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' },
        // 붙여넣기는 «글자만». 남의 서식(HTML)은 받지 않고, 엑셀에서 깨지는 글자는 가까운 글자로 바꾼다.
        handlePaste: (view, event) => {
          event.preventDefault();
          const raw = event.clipboardData?.getData('text/plain') ?? '';
          if (!raw) return true;
          const { text: whole, fixed, hasEmoji } = sanitizePaste(raw);
          if (!whole) return true;
          const { text, clipped } = clipPaste(whole);
          insertPlainText(view, text);
          pasteRef.current(fixed, hasEmoji, clipped);
          return true;
        },
        // 바깥에서 끌어다 놓는 것(HTML·파일)은 받지 않는다. 칸 안에서 글자를 옮기는 것은 그대로 둔다.
        handleDrop: (_view, event, _slice, moved) => {
          if (moved) return false;
          event.preventDefault();
          return true;
        },
      },
      onFocus: ({ editor: ed }) => activateRef.current(ed),
      onSelectionUpdate: ({ editor: ed }) => {
        if (ed.isFocused) activateRef.current(ed);
      },
    },
    [doc, agendaId]
  );

  useEffect(() => {
    if (!editor) return;
    onReady(agendaId, editor);
    return () => onRelease(agendaId, editor);
  }, [editor, agendaId, onReady, onRelease]);

  useEffect(() => {
    if (!editor) return;
    try {
      editor.view.dom.setAttribute('aria-label', ariaLabel);
    } catch {
      // 아직 화면에 붙기 전
    }
  }, [editor, ariaLabel]);

  return <EditorContent editor={editor} />;
}
const AgendaEditor = memo(AgendaEditorInner);

// ───────────────────────── 쓰기 영역 전체 ─────────────────────────

type WritingAreaProps = {
  session: MinutesSession;
  agenda: AgendaItem[];
  remote: MinutesRemoteActivity | null;
};

export default function MinutesWritingArea({ session, agenda, remote }: WritingAreaProps) {
  const t = useT(STR);
  const activeRef = useRef<Editor | null>(null);
  const registry = useRef<Map<string, Editor>>(new Map());
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);
  const [symOpen, setSymOpen] = useState(false);
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
  const pasteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const onActivate = useCallback(
    (ed: Editor) => {
      activeRef.current = ed;
      bump();
    },
    [bump]
  );
  const onReady = useCallback(
    (id: string, ed: Editor) => {
      registry.current.set(id, ed);
      bump();
    },
    [bump]
  );
  const onRelease = useCallback(
    (id: string, ed: Editor) => {
      if (registry.current.get(id) === ed) registry.current.delete(id);
      if (activeRef.current === ed) activeRef.current = null;
      bump();
    },
    [bump]
  );
  const onPasteNotice = useCallback(
    (fixed: Array<[string, string]>, hasEmoji: boolean, clipped: boolean) => {
      const parts: string[] = [];
      if (clipped) parts.push(t.pasteClipped(MAX_PASTE_CHARS));
      if (fixed.length) parts.push(t.pasteFixed(fixed.map(([a, b]) => `${a}→${b}`).join(' ')));
      if (hasEmoji) parts.push(t.pasteEmoji);
      if (!parts.length) return;
      setPasteMsg(parts.join(' · '));
      if (pasteTimer.current) clearTimeout(pasteTimer.current);
      pasteTimer.current = setTimeout(() => setPasteMsg(null), 6000);
    },
    [t]
  );
  useEffect(
    () => () => {
      if (pasteTimer.current) clearTimeout(pasteTimer.current);
    },
    []
  );

  // 도구줄이 다루는 편집기: 글 커서가 있는(마지막으로 있던) 칸, 없으면 첫 칸
  const targetEditor = (): Editor | null => {
    const a = activeRef.current;
    if (a && !a.isDestroyed) return a;
    for (const item of agenda) {
      const ed = registry.current.get(item.id);
      if (ed && !ed.isDestroyed) return ed;
    }
    return null;
  };

  // 특수문자 상자: Esc / 바깥 클릭으로 닫기, 창 아래로 잘리지 않게 높이 제한
  useEffect(() => {
    if (!symOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSymOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setSymOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [symOpen]);
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!symOpen || !pop) return;
    const room = window.innerHeight - pop.getBoundingClientRect().top - 12;
    pop.style.maxHeight = `${Math.max(120, room)}px`;
  }, [symOpen]);

  const ed = targetEditor();
  const textStyle = ed ? (ed.getAttributes('textStyle') as { color?: unknown; fontSize?: unknown }) : {};
  const curPx = sizePxFromCss(textStyle.fontSize) ?? DEFAULT_SIZE_PX;
  const curColor = colorIdFromCss(textStyle.color);
  const isBold = !!ed && ed.isActive('bold');
  const isItalic = !!ed && ed.isActive('italic');

  const run = (fn: (e: Editor) => void) => {
    const e = targetEditor();
    if (!e) return;
    fn(e);
    bump();
  };
  const setSize = (px: number) =>
    run((e) => {
      if (px === DEFAULT_SIZE_PX) e.chain().focus().unsetFontSize().run();
      else e.chain().focus().setFontSize(`${px}px`).run();
    });
  const setColor = (id: string) =>
    run((e) => {
      if (id === 'default') e.chain().focus().unsetColor().run();
      else e.chain().focus().setColor(colorHex(id as 'blue')).run();
    });
  const insertSymbol = (ch: string) => run((e) => e.chain().focus().insertContent({ type: 'text', text: ch }).run());

  // 도구줄을 눌러도 글 커서가 편집칸에 그대로 남도록
  const keepFocus = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault();
  };

  const noAgenda = agenda.length === 0;

  return (
    <section className="mm-sec" data-sec="body">
      <h4 className="mm-h">
        {t.contentTitle} <span className="mm-sub">{t.contentSub}</span>
      </h4>
      <div
        ref={toolsRef}
        className={`mm-tools ${noAgenda ? 'is-off' : ''}`}
        role="toolbar"
        aria-label={t.toolbarAria}
        onMouseDown={keepFocus}
      >
        <div className="mm-tools-row">
          <div className="mm-seg" role="group" aria-label={t.sizeAria}>
            {MINUTES_SIZES.map((s) => (
              <button key={s.px} type="button" className={curPx === s.px ? 'on' : ''} onClick={() => setSize(s.px)}>
                {t.sizeNames[s.px]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`mm-tbtn mm-tb-bold ${isBold ? 'on' : ''}`}
            aria-pressed={isBold}
            onClick={() => run((e) => e.chain().focus().toggleBold().run())}
          >
            {t.bold}
          </button>
          <button
            type="button"
            className={`mm-tbtn mm-tb-italic ${isItalic ? 'on' : ''}`}
            aria-pressed={isItalic}
            onClick={() => run((e) => e.chain().focus().toggleItalic().run())}
          >
            {t.italic}
          </button>
          <button
            type="button"
            className="mm-tbtn mm-sym-btn"
            aria-expanded={symOpen}
            aria-label={t.symBtnAria}
            onClick={() => setSymOpen((v) => !v)}
          >
            {t.symBtn}
          </button>
        </div>
        <div className="mm-tools-row">
          <span className="mm-tl">{t.colorLabel}</span>
          <div className="mm-swatches" role="group" aria-label={t.colorAria}>
            {MINUTES_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`mm-sw ${curColor === c.id ? 'sel' : ''}`}
                style={{ ['--c' as string]: c.hex } as CSSProperties}
                aria-label={`${t.colorAria} ${t.colorNames[c.id]}`}
                aria-pressed={curColor === c.id}
                onClick={() => setColor(c.id)}
              >
                가
              </button>
            ))}
          </div>
          <p className="mm-tool-hint">
            <b className="h-red">{t.hintRed}</b>
            {t.hintRedTail}
            <br />
            <b className="h-blue">{t.hintBlue}</b>
            {t.hintBlueTail}
          </p>
        </div>
        {symOpen && (
          <div ref={popRef} className="mm-sym-pop" role="group" aria-label={t.symAria}>
            {SYMBOL_GROUPS.map((g) => (
              <div className="mm-sym-group" key={g.id}>
                <span className="gl">{t.symGroups[g.id]}</span>
                <div className="gb">
                  {g.chars.map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      className="mm-sy"
                      aria-label={t.symInsertAria(ch)}
                      onClick={() => insertSymbol(ch)}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="mm-sym-hint">{t.symHint}</div>
          </div>
        )}
      </div>

      <div className="mm-blocks">
        {noAgenda ? (
          <div className="mm-blocks-empty">
            {t.emptyA}
            <br />
            {t.emptyB}
            <b>{t.emptyBold}</b>
            {t.emptyC}
            <br />
            {t.emptyD}
          </div>
        ) : (
          agenda.map((a, i) => {
            const isRemote = remote?.section === `body:${a.id}`;
            return (
              <div
                key={a.id}
                className={`mm-ag-block ${isRemote ? 'mm-remote-edit' : ''}`}
                data-id={a.id}
                data-who={isRemote ? t.typingTag(remote?.who || '…') : undefined}
                style={isRemote ? ({ ['--who' as string]: remote?.color } as CSSProperties) : undefined}
              >
                <div className="mm-ag-block-h">
                  <span className="bn">{circledNumber(i)}</span>
                  <span className={`bt ${a.title.trim() ? '' : 'ph'}`}>{a.title.trim() ? `■ ${a.title}` : t.noTitle}</span>
                  {a.dept && <span className="bd">{a.dept}</span>}
                </div>
                <AgendaEditor
                  doc={session.doc}
                  agendaId={a.id}
                  placeholder={t.editorPh}
                  ariaLabel={t.editorAria(i + 1)}
                  onActivate={onActivate}
                  onReady={onReady}
                  onRelease={onRelease}
                  onPasteNotice={onPasteNotice}
                />
              </div>
            );
          })
        )}
      </div>
      {pasteMsg && (
        <p className="mm-help" role="status">
          <span className="mm-paste-fix">{pasteMsg}</span>
        </p>
      )}
    </section>
  );
}
