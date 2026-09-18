import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { AnnotationBody } from '../lib/signaling';
import {
  AnnotationHub,
  LASER_FADE_MS,
  MAX_STROKE_POINTS,
  type ContentRect,
  type ShapeAnno,
  contentUVToLocalPx,
  createThrottledSender,
  distance,
  drawLaser,
  drawShape,
  drawStroke,
  drawText,
  getContentRect,
  getPeerColor,
  hexToRgba,
  round4,
  screenToContentUV,
} from '../lib/annotations';
import { useT } from '../i18n';

const STR = {
  ko: {
    select: '선택',
    laser: '레이저',
    pen: '펜',
    arrow: '화살표',
    rect: '네모',
    text: '글자',
    eraser: '지우개',
    eraseMine: '내 주석만 지우기',
    eraseAll: '전체 지우기',
    eraseAllConfirm: '정말 지울까요? 한 번 더 클릭',
    myColor: '내 색상',
    lockOthers: '다른 사람 그리기 잠그기',
    unlockOthers: '다른 사람 그리기 허용',
    lockedMsg: '발표자가 그리기를 잠갔습니다',
    textPlaceholder: '입력 후 Enter',
  },
  en: {
    select: 'Select',
    laser: 'Laser',
    pen: 'Pen',
    arrow: 'Arrow',
    rect: 'Rectangle',
    text: 'Text',
    eraser: 'Eraser',
    eraseMine: 'Erase my annotations',
    eraseAll: 'Erase all',
    eraseAllConfirm: 'Erase all? Click again to confirm',
    myColor: 'My color',
    lockOthers: 'Lock drawing for others',
    unlockOthers: 'Allow others to draw',
    lockedMsg: 'The presenter has locked drawing',
    textPlaceholder: 'Type and press Enter',
  },
};

type Tool = 'select' | 'laser' | 'pen' | 'arrow' | 'rect' | 'text';

type Props = {
  /** peerId of whoever's shared screen this canvas overlays. */
  screenOwnerId: string;
  /** peerId of the local user (this client). */
  myId: string;
  videoRef: RefObject<HTMLVideoElement>;
  tileRef: RefObject<HTMLElement>;
  hub: AnnotationHub;
  /** Whether THIS tile is currently the expanded/focused one — gates the toolbar. */
  focused: boolean;
  /**
   * Whether annotation mode is turned on (via the control-bar 주석 toggle).
   * Gates the toolbar + drawing/pointer input alongside `focused`. Does NOT
   * gate the draw loop below — incoming strokes/shapes/text/laser marks from
   * anyone always keep rendering regardless of this flag, so turning this
   * off only hides your own tools; it never hides what others drew (like a
   * chat window: seeing is always on, composing is opt-in).
   */
  annotateOn: boolean;
  sendAnnotation: (screenOwnerId: string, body: AnnotationBody) => void;
};

type TextDraft = { u: number; v: number; value: string };

export default function AnnotationCanvas({
  screenOwnerId,
  myId,
  videoRef,
  tileRef,
  hub,
  focused,
  annotateOn,
  sendAnnotation,
}: Props) {
  const t = useT(STR);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rectRef = useRef<ContentRect | null>(null);

  const isOwner = screenOwnerId === myId;
  const myColor = getPeerColor(myId);

  const [tool, setTool] = useState<Tool>('select');
  const [allowed, setAllowed] = useState(true);
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);

  const canDraw = isOwner || allowed;

  // Reflect permission changes (from hub, local or remote) into React state
  // so the toolbar can react (lock message / lock icon).
  useEffect(() => {
    setAllowed(hub.getOwner(screenOwnerId).allowed);
    return hub.subscribe(screenOwnerId, () => {
      setAllowed(hub.getOwner(screenOwnerId).allowed);
    });
  }, [hub, screenOwnerId]);

  // Leaving focus, or turning annotation mode off (the control-bar 주석
  // toggle), always drops back to the non-interactive "select" tool so
  // pointer-events go back to none — this is what lets double-click-to-expand,
  // wheel-zoom and drag-pan work again underneath once the toolbar is closed.
  useEffect(() => {
    if (!focused || !annotateOn) {
      setTool('select');
      setEraserMenuOpen(false);
      setTextDraft(null);
    }
  }, [focused, annotateOn]);
  useEffect(() => {
    if (!canDraw) setTool('select');
  }, [canDraw]);

  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, []);

  // ---------------- sizing: keep canvas backing store + content rect in sync ----------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const tile = tileRef.current;
    if (!canvas || !video || !tile) return;

    const recompute = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = tile.clientWidth;
      const h = tile.clientHeight;
      if (w && h) {
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvas.width !== bw) canvas.width = bw;
        if (canvas.height !== bh) canvas.height = bh;
      }
      rectRef.current = getContentRect(tile, video);
    };
    recompute();

    const ro = new ResizeObserver(recompute);
    ro.observe(tile);
    video.addEventListener('resize', recompute);
    video.addEventListener('loadedmetadata', recompute);
    return () => {
      ro.disconnect();
      video.removeEventListener('resize', recompute);
      video.removeEventListener('loadedmetadata', recompute);
    };
  }, [videoRef, tileRef]);

  // ---------------- draw loop (imperative canvas — not React state, for perf) ----------------
  const previewShapeRef = useRef<ShapeAnno | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // The tile and the incoming video both settle after this component mounts,
    // and a 'loadedmetadata' that fired before the listener was attached is
    // never replayed — a remote screen share reliably lands in that gap. Derive
    // the rect here instead of trusting that an event arrived, or a stale null
    // leaves the overlay blank for the whole call.
    const video = videoRef.current;
    const tile = tileRef.current;
    let rect = rectRef.current;
    if (video && tile && (!rect || rect.W !== tile.clientWidth || rect.H !== tile.clientHeight)) {
      rect = getContentRect(tile, video);
      rectRef.current = rect;
    }
    if (!rect) return;

    const owner = hub.getOwner(screenOwnerId);
    const now = Date.now();

    for (const stroke of owner.strokes.values()) {
      drawStroke(ctx, stroke.points, getPeerColor(stroke.peerId), rect);
    }
    for (const shape of owner.shapes.values()) {
      drawShape(ctx, shape, getPeerColor(shape.peerId), rect);
    }
    if (previewShapeRef.current) {
      drawShape(ctx, previewShapeRef.current, myColor, rect);
    }
    for (const text of owner.texts.values()) {
      drawText(ctx, text, getPeerColor(text.peerId), rect);
    }
    for (const laser of owner.lasers.values()) {
      const age = now - laser.ts;
      if (age > LASER_FADE_MS) continue;
      drawLaser(ctx, laser, getPeerColor(laser.peerId), rect, 1 - age / LASER_FADE_MS);
    }
  }, [hub, screenOwnerId, myColor, videoRef, tileRef]);

  useEffect(() => {
    let raf = requestAnimationFrame(function loop() {
      draw();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // ---------------- network throttles ----------------
  // Lazy-init (not `useRef(createThrottledSender(...))`) so a fresh timer/closure
  // isn't allocated on every render — only ever constructed once per mount.
  const laserSenderRef = useRef<ReturnType<typeof createThrottledSender<{ x: number; y: number }>> | null>(
    null
  );
  if (!laserSenderRef.current) {
    laserSenderRef.current = createThrottledSender<{ x: number; y: number }>(40, (v) => {
      sendAnnotation(screenOwnerId, { kind: 'point', x: v.x, y: v.y });
    });
  }
  const penSenderRef = useRef<ReturnType<
    typeof createThrottledSender<{ id: string; pts: number[] }>
  > | null>(null);
  if (!penSenderRef.current) {
    penSenderRef.current = createThrottledSender<{ id: string; pts: number[] }>(50, (v) => {
      sendAnnotation(screenOwnerId, { kind: 'stroke', id: v.id, phase: 'update', pts: v.pts });
    });
  }

  const laserActiveRef = useRef(false);
  const strokeRef = useRef<{ id: string; points: number[] } | null>(null);
  const shapeStartRef = useRef<{ u: number; v: number } | null>(null);

  const getUV = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return screenToContentUV(clientX, clientY, canvas, rectRef.current);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'select') return;
    e.stopPropagation();
    const uv = getUV(e.clientX, e.clientY);
    if (!uv) return;

    if (tool === 'laser') {
      laserActiveRef.current = true;
      hub.apply(screenOwnerId, myId, { kind: 'point', x: uv.u, y: uv.v });
      laserSenderRef.current!.call({ x: round4(uv.u), y: round4(uv.v) });
    } else if (tool === 'pen') {
      const id = crypto.randomUUID();
      strokeRef.current = { id, points: [uv.u, uv.v] };
      const pts = [round4(uv.u), round4(uv.v)];
      hub.apply(screenOwnerId, myId, { kind: 'stroke', id, phase: 'update', pts });
      penSenderRef.current!.call({ id, pts });
    } else if (tool === 'arrow' || tool === 'rect') {
      shapeStartRef.current = { u: uv.u, v: uv.v };
      previewShapeRef.current = { id: '', peerId: myId, tool, x1: uv.u, y1: uv.v, x2: uv.u, y2: uv.v };
    } else if (tool === 'text') {
      setTextDraft({ u: uv.u, v: uv.v, value: '' });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'select') return;
    const uv = getUV(e.clientX, e.clientY);
    if (!uv) return;

    if (tool === 'laser' && laserActiveRef.current) {
      hub.apply(screenOwnerId, myId, { kind: 'point', x: uv.u, y: uv.v });
      laserSenderRef.current!.call({ x: round4(uv.u), y: round4(uv.v) });
    } else if (tool === 'pen' && strokeRef.current) {
      const buf = strokeRef.current;
      if (buf.points.length / 2 >= MAX_STROKE_POINTS) return;
      const n = buf.points.length;
      if (distance(buf.points[n - 2], buf.points[n - 1], uv.u, uv.v) < 0.002) return;
      buf.points.push(uv.u, uv.v);
      const pts = buf.points.map(round4);
      hub.apply(screenOwnerId, myId, { kind: 'stroke', id: buf.id, phase: 'update', pts });
      penSenderRef.current!.call({ id: buf.id, pts });
    } else if ((tool === 'arrow' || tool === 'rect') && shapeStartRef.current) {
      previewShapeRef.current = {
        id: '',
        peerId: myId,
        tool,
        x1: shapeStartRef.current.u,
        y1: shapeStartRef.current.v,
        x2: uv.u,
        y2: uv.v,
      };
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'laser') {
      laserActiveRef.current = false;
    } else if (tool === 'pen' && strokeRef.current) {
      const buf = strokeRef.current;
      const pts = buf.points.map(round4);
      penSenderRef.current!.cancel();
      const body: AnnotationBody = { kind: 'stroke', id: buf.id, phase: 'end', pts };
      hub.apply(screenOwnerId, myId, body);
      sendAnnotation(screenOwnerId, body);
      strokeRef.current = null;
    } else if ((tool === 'arrow' || tool === 'rect') && shapeStartRef.current) {
      const uv = getUV(e.clientX, e.clientY) ?? {
        u: previewShapeRef.current?.x2 ?? shapeStartRef.current.u,
        v: previewShapeRef.current?.y2 ?? shapeStartRef.current.v,
      };
      const body: AnnotationBody = {
        kind: 'shape',
        id: crypto.randomUUID(),
        tool,
        x1: round4(shapeStartRef.current.u),
        y1: round4(shapeStartRef.current.v),
        x2: round4(uv.u),
        y2: round4(uv.v),
      };
      hub.apply(screenOwnerId, myId, body);
      sendAnnotation(screenOwnerId, body);
      shapeStartRef.current = null;
      previewShapeRef.current = null;
    }
  };

  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const value = textDraft?.value.trim();
      if (value && textDraft) {
        const body: AnnotationBody = {
          kind: 'text',
          id: crypto.randomUUID(),
          x: round4(textDraft.u),
          y: round4(textDraft.v),
          text: value.slice(0, 200),
        };
        hub.apply(screenOwnerId, myId, body);
        sendAnnotation(screenOwnerId, body);
      }
      setTextDraft(null);
    } else if (e.key === 'Escape') {
      setTextDraft(null);
    }
  };

  const handleEraseMine = () => {
    const body: AnnotationBody = { kind: 'clear', scope: 'mine' };
    hub.apply(screenOwnerId, myId, body);
    sendAnnotation(screenOwnerId, body);
    setEraserMenuOpen(false);
    setConfirmAll(false);
  };

  const handleEraseAll = () => {
    if (!confirmAll) {
      setConfirmAll(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmAll(false), 3000);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmAll(false);
    const body: AnnotationBody = { kind: 'clear', scope: 'all' };
    hub.apply(screenOwnerId, myId, body);
    sendAnnotation(screenOwnerId, body);
    setEraserMenuOpen(false);
  };

  const togglePermission = () => {
    const next = !allowed;
    const body: AnnotationBody = { kind: 'permission', allowed: next };
    hub.apply(screenOwnerId, myId, body);
    sendAnnotation(screenOwnerId, body);
  };

  const textPos = textDraft && rectRef.current ? contentUVToLocalPx(textDraft.u, textDraft.v, rectRef.current) : null;
  const toolbarVars = {
    ['--annotation-my-color' as string]: myColor,
    ['--annotation-my-color-bg' as string]: hexToRgba(myColor, 0.18),
  } as React.CSSProperties;

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`annotation-layer ${tool !== 'select' ? 'drawing-active' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      {textDraft && textPos && (
        <input
          autoFocus
          className="annotation-text-input"
          style={{ left: textPos.x, top: textPos.y, ...toolbarVars, borderColor: myColor }}
          maxLength={200}
          placeholder={t.textPlaceholder}
          value={textDraft.value}
          onChange={(e) => setTextDraft((d) => (d ? { ...d, value: e.target.value } : d))}
          onKeyDown={handleTextKeyDown}
          onBlur={() => setTextDraft(null)}
        />
      )}
      {focused && annotateOn && (
        <div className="annotation-toolbar" style={toolbarVars}>
          {!canDraw ? (
            <span className="annotation-lock-msg">🔒 {t.lockedMsg}</span>
          ) : (
            <>
              <span className="annotation-color-dot" style={{ background: myColor }} title={t.myColor} />
              <span className="annotation-toolbar-divider" />
              <ToolButton active={tool === 'select'} title={t.select} onClick={() => setTool('select')}>
                🖱️
              </ToolButton>
              <ToolButton active={tool === 'laser'} title={t.laser} onClick={() => setTool('laser')}>
                🔴
              </ToolButton>
              <ToolButton active={tool === 'pen'} title={t.pen} onClick={() => setTool('pen')}>
                ✏️
              </ToolButton>
              <ToolButton active={tool === 'arrow'} title={t.arrow} onClick={() => setTool('arrow')}>
                ➡️
              </ToolButton>
              <ToolButton active={tool === 'rect'} title={t.rect} onClick={() => setTool('rect')}>
                ▭
              </ToolButton>
              <ToolButton active={tool === 'text'} title={t.text} onClick={() => setTool('text')}>
                🔤
              </ToolButton>
              <span className="annotation-toolbar-divider" />
              <div className="annotation-eraser">
                <ToolButton
                  active={eraserMenuOpen}
                  title={t.eraser}
                  onClick={() => setEraserMenuOpen((v) => !v)}
                >
                  🧹
                </ToolButton>
                {eraserMenuOpen && (
                  <div className="annotation-eraser-menu">
                    <button type="button" onClick={handleEraseMine}>
                      {t.eraseMine}
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        className={confirmAll ? 'danger' : ''}
                        onClick={handleEraseAll}
                      >
                        {confirmAll ? t.eraseAllConfirm : t.eraseAll}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          {isOwner && canDraw && (
            <>
              <span className="annotation-toolbar-divider" />
              <ToolButton
                active={false}
                title={allowed ? t.lockOthers : t.unlockOthers}
                onClick={togglePermission}
              >
                {allowed ? '🔓' : '🔒'}
              </ToolButton>
            </>
          )}
        </div>
      )}
    </>
  );
}

function ToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? 'active' : ''}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
