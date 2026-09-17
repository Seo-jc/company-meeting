import type { AnnotationBody } from './signaling';

// ---------------------------------------------------------------------------
// Coordinate math (technical design, confirmed — do not change the formulas).
//
// The shared-screen <video> uses object-fit: contain, so it can have letterbox
// margins inside its box. All annotation coordinates are stored/sent as (u, v)
// normalized to the VIDEO CONTENT area (0~1), never to the outer box, so every
// participant can re-derive pixel positions locally regardless of their own
// zoom/pan/tile size.
// ---------------------------------------------------------------------------

export type ContentRect = {
  W: number;
  H: number;
  offX: number;
  offY: number;
  dispW: number;
  dispH: number;
};

/** Computes the displayed video-content rectangle inside a `.tile` box (letterbox-aware). */
export function getContentRect(
  tileEl: HTMLElement,
  video: HTMLVideoElement
): ContentRect | null {
  const W = tileEl.clientWidth;
  const H = tileEl.clientHeight;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!W || !H || !vw || !vh) return null;

  const boxRatio = W / H;
  const vidRatio = vw / vh;
  let dispW: number, dispH: number, offX: number, offY: number;
  if (vidRatio > boxRatio) {
    dispW = W;
    dispH = W / vidRatio;
    offX = 0;
    offY = (H - dispH) / 2;
  } else {
    dispH = H;
    dispW = H * vidRatio;
    offY = 0;
    offX = (W - dispW) / 2;
  }
  return { W, H, offX, offY, dispW, dispH };
}

/** Screen (client) coordinates -> normalized content (u, v), or null if outside the video content / letterbox. */
export function screenToContentUV(
  clientX: number,
  clientY: number,
  canvasEl: HTMLElement,
  rect: ContentRect | null
): { u: number; v: number } | null {
  if (!rect) return null;
  const box = canvasEl.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const fx = (clientX - box.left) / box.width;
  const fy = (clientY - box.top) / box.height;
  const u = (fx * rect.W - rect.offX) / rect.dispW;
  const v = (fy * rect.H - rect.offY) / rect.dispH;
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

/** Normalized content (u, v) -> local CSS-pixel position inside the tile (pre-transform). */
export function contentUVToLocalPx(
  u: number,
  v: number,
  rect: ContentRect
): { x: number; y: number } {
  return { x: rect.offX + u * rect.dispW, y: rect.offY + v * rect.dispH };
}

/** Rounds a normalized coordinate to 4 decimal places before sending over the wire. */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function distance(u1: number, v1: number, u2: number, v2: number): number {
  return Math.hypot(u2 - u1, v2 - v1);
}

// ---------------------------------------------------------------------------
// Per-user color (deterministic hash — never transmitted, computed locally by
// every client so everyone renders the same peer in the same color).
// ---------------------------------------------------------------------------

export const PEER_COLORS = [
  '#1abc9c',
  '#4f7df3',
  '#f3a14f',
  '#a44cf3',
  '#ec4899',
  '#22d3ee',
  '#84cc16',
  '#f43f5e',
];

export function getPeerColor(peerId: string): string {
  let hash = 0;
  for (let i = 0; i < peerId.length; i++) {
    hash = (hash * 31 + peerId.charCodeAt(i)) | 0;
  }
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
}

/** '#rrggbb' -> 'rgba(r,g,b,alpha)'. Used for the active-tool highlight / text caret color. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return `rgba(79, 125, 243, ${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Throttle: the server drops more than 40 annotation messages/sec per
// connection, so laser/pen updates must be rate-limited client-side. Always
// forwards the MOST RECENT value once the interval allows (trailing edge),
// never queues a backlog.
// ---------------------------------------------------------------------------

export type ThrottledSender<T> = {
  call: (value: T) => void;
  cancel: () => void;
};

export function createThrottledSender<T>(
  minIntervalMs: number,
  send: (value: T) => void
): ThrottledSender<T> {
  let lastSentAt = 0;
  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (pending !== null) {
      const value = pending;
      pending = null;
      lastSentAt = Date.now();
      send(value);
    }
  };

  const call = (value: T) => {
    const now = Date.now();
    const elapsed = now - lastSentAt;
    if (elapsed >= minIntervalMs) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      lastSentAt = now;
      send(value);
    } else {
      pending = value;
      if (!timer) {
        timer = setTimeout(flush, minIntervalMs - elapsed);
      }
    }
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  return { call, cancel };
}

// ---------------------------------------------------------------------------
// Live annotation state store, one instance per meeting (created once in
// MeetingRoom.tsx and shared by every AnnotationCanvas via props). Keyed by
// screenOwnerId — the peerId of whoever's shared screen the marks belong to.
//
// Network messages already have self-echo filtered out by webrtc.ts (same
// pattern as onChat), so `apply()` is called both:
//   - locally, optimistically, the instant the local user draws something
//     (fromPeerId = my own id), and
//   - on receipt of another participant's message (fromPeerId = their id).
// ---------------------------------------------------------------------------

export type StrokeAnno = { id: string; peerId: string; points: number[]; done: boolean };
export type ShapeAnno = {
  id: string;
  peerId: string;
  tool: 'arrow' | 'rect';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
export type TextAnno = { id: string; peerId: string; x: number; y: number; text: string };
export type LaserAnno = { peerId: string; x: number; y: number; ts: number };

export type OwnerAnnotations = {
  strokes: Map<string, StrokeAnno>;
  shapes: Map<string, ShapeAnno>;
  texts: Map<string, TextAnno>;
  lasers: Map<string, LaserAnno>;
  allowed: boolean;
};

/** How long (ms) a laser point stays visible after the last point received for that peer. */
export const LASER_FADE_MS = 1200;
/** Client-side cap on points per pen stroke (well under the server's 800-point limit). */
export const MAX_STROKE_POINTS = 400;

function emptyOwner(): OwnerAnnotations {
  return {
    strokes: new Map(),
    shapes: new Map(),
    texts: new Map(),
    lasers: new Map(),
    allowed: true,
  };
}

export class AnnotationHub {
  private owners = new Map<string, OwnerAnnotations>();
  private listeners = new Map<string, Set<() => void>>();

  getOwner(ownerId: string): OwnerAnnotations {
    let o = this.owners.get(ownerId);
    if (!o) {
      o = emptyOwner();
      this.owners.set(ownerId, o);
    }
    return o;
  }

  /** Subscribe to changes for one screenOwnerId's state. Returns an unsubscribe fn. */
  subscribe(ownerId: string, fn: () => void): () => void {
    let set = this.listeners.get(ownerId);
    if (!set) {
      set = new Set();
      this.listeners.set(ownerId, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  private notify(ownerId: string) {
    this.listeners.get(ownerId)?.forEach((fn) => fn());
  }

  apply(ownerId: string, fromPeerId: string, body: AnnotationBody) {
    const o = this.getOwner(ownerId);
    switch (body.kind) {
      case 'point':
        o.lasers.set(fromPeerId, { peerId: fromPeerId, x: body.x, y: body.y, ts: Date.now() });
        break;
      case 'stroke':
        o.strokes.set(body.id, {
          id: body.id,
          peerId: fromPeerId,
          points: body.pts,
          done: body.phase === 'end',
        });
        break;
      case 'shape':
        o.shapes.set(body.id, {
          id: body.id,
          peerId: fromPeerId,
          tool: body.tool,
          x1: body.x1,
          y1: body.y1,
          x2: body.x2,
          y2: body.y2,
        });
        break;
      case 'text':
        o.texts.set(body.id, {
          id: body.id,
          peerId: fromPeerId,
          x: body.x,
          y: body.y,
          text: body.text,
        });
        break;
      case 'clear':
        if (body.scope === 'all') {
          o.strokes.clear();
          o.shapes.clear();
          o.texts.clear();
          o.lasers.clear();
        } else {
          for (const [id, s] of o.strokes) if (s.peerId === fromPeerId) o.strokes.delete(id);
          for (const [id, s] of o.shapes) if (s.peerId === fromPeerId) o.shapes.delete(id);
          for (const [id, s] of o.texts) if (s.peerId === fromPeerId) o.texts.delete(id);
          o.lasers.delete(fromPeerId);
        }
        break;
      case 'permission':
        o.allowed = body.allowed;
        break;
    }
    this.notify(ownerId);
  }

  /** Wipe all marks for a screen owner (see auto-delete rules in MeetingRoom.tsx). */
  resetOwner(ownerId: string) {
    this.owners.set(ownerId, emptyOwner());
    this.notify(ownerId);
  }
}

// ---------------------------------------------------------------------------
// Shared drawing helpers. Used by BOTH the live on-screen overlay
// (AnnotationCanvas.tsx) and the recording compositor (lib/recorder.ts) so the
// two never drift apart. Callers pass a `ContentRect`:
//   - live view: the letterbox-aware rect from getContentRect() (may have
//     offX/offY margins).
//   - recording: a full-bleed rect { W, H, offX: 0, offY: 0, dispW: W, dispH: H }
//     covering the whole recording canvas (zoom/pan are never applied there).
// ---------------------------------------------------------------------------

function haloStroke(ctx: CanvasRenderingContext2D, color: string, width: number) {
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = width + 2.5;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: number[],
  color: string,
  rect: ContentRect
) {
  if (points.length < 4) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    const { x, y } = contentUVToLocalPx(points[i], points[i + 1], rect);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  haloStroke(ctx, color, 3);
  ctx.restore();
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: { tool: 'arrow' | 'rect'; x1: number; y1: number; x2: number; y2: number },
  color: string,
  rect: ContentRect
) {
  const p1 = contentUVToLocalPx(shape.x1, shape.y1, rect);
  const p2 = contentUVToLocalPx(shape.x2, shape.y2, rect);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (shape.tool === 'rect') {
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 5.5;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
  } else {
    const headLen = 14;
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const drawLineAndHead = (strokeStyle: string, lineWidth: number) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(
        p2.x - headLen * Math.cos(angle - Math.PI / 6),
        p2.y - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(
        p2.x - headLen * Math.cos(angle + Math.PI / 6),
        p2.y - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();
    };
    drawLineAndHead('rgba(0, 0, 0, 0.45)', 5.5);
    drawLineAndHead(color, 3);
  }
  ctx.restore();
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: { x: number; y: number; text: string },
  color: string,
  rect: ContentRect
) {
  const { x, y } = contentUVToLocalPx(text.x, text.y, rect);
  ctx.save();
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.strokeText(text.text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text.text, x, y);
  ctx.restore();
}

export function drawLaser(
  ctx: CanvasRenderingContext2D,
  laser: { x: number; y: number },
  color: string,
  rect: ContentRect,
  alpha: number
) {
  const { x, y } = contentUVToLocalPx(laser.x, laser.y, rect);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}
