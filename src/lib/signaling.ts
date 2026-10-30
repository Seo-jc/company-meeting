import type { MinutesWire } from './minutes/types';

// Screen-annotation payload shapes. MUST match the server's validation exactly
// (signaling/src/worker.ts) — messages that don't match are silently dropped.
export type AnnotationBody =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'stroke'; id: string; phase: 'update' | 'end'; pts: number[] }
  | { kind: 'shape'; id: string; tool: 'arrow' | 'rect'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'text'; id: string; x: number; y: number; text: string }
  | { kind: 'clear'; scope: 'mine' | 'all' }
  | { kind: 'permission'; allowed: boolean };

export type SignalingMessage =
  // sessionKey: a random secret this client makes once per peerId (kept across its own reconnects). The server
  // lets a new connection take over an existing peerId only if the key matches, so a peerId alone (which
  // every peer is told) cannot be used to kick someone out and speak as them. See signaling/src/worker.ts.
  | { type: 'hello'; peerId: string; displayName: string; sessionKey?: string }
  | { type: 'bye' }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'peers'; peers: Array<{ peerId: string; displayName: string }> }
  | { type: 'sync'; peers: Array<{ peerId: string; displayName: string }> }
  | { type: 'peer-joined'; peerId: string; displayName: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: 'screen-stop'; from: string; to: string }
  | { type: 'mute-state'; from: string; to: string; muted: boolean }
  | { type: 'chat'; from: string; fromName: string; text: string; ts: number }
  | { type: 'annotation'; from: string; screenOwnerId: string; body: AnnotationBody }
  // Broadcasts "I started/stopped recording" so every participant is shown a
  // notice. `from` must equal the sender's own peerId and `active` a boolean,
  // or the server silently drops the message (see signaling/src/worker.ts).
  | { type: 'recording'; from: string; active: boolean }
  // Meeting-minutes (Yjs) sync. The server only relays it (never stores or logs it);
  // `from` must equal the sender's own peerId. See src/lib/minutes/provider.ts.
  | MinutesWire;

const SIGNALING_URL =
  (import.meta as any).env?.VITE_SIGNALING_URL ??
  'wss://meet-sig.jcseo.workers.dev';

/** 16+ chars of [A-Za-z0-9_-] (the server checks that shape). */
function makeSessionKey(): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    if (c && typeof c.getRandomValues === 'function') {
      return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const KEEPALIVE_INTERVAL_MS = 25000; // ping to keep idle WS alive through NAT/proxy
const MAX_RECONNECT_DELAY_MS = 10000;

type Handler<T extends SignalingMessage['type']> = (
  msg: Extract<SignalingMessage, { type: T }>
) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Handler<any>>();
  // Messages that arrive before a matching handler is registered are queued here
  // and flushed when the handler appears. Defense against handler-binding races
  // (e.g. the server's 'peers' list arriving before the mesh registers handlers).
  private pending: SignalingMessage[] = [];

  // Connection params remembered so we can transparently reconnect.
  private roomCode = '';
  private peerId = '';
  private displayName = '';
  private sessionKey = '';
  private intentionalClose = false;
  private reconnectAttempts = 0;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Called after a successful RE-connect (not the first connect) so the mesh
  // can re-establish media paths (ICE restart) through the restored signaling.
  // A set, not a single slot: the meeting-minutes sync wants to hear about it too.
  private reconnectHandlers = new Set<() => void>();
  // Passive listeners: see every message of a type IN ADDITION to the one handler
  // registered with on(). They never take part in the pending queue.
  private listeners = new Map<string, Set<(msg: any) => void>>();
  // Told when the socket becomes usable (true) or unusable (false).
  private openListeners = new Set<(open: boolean) => void>();

  private unloadHandler = () => {
    this.sendBye();
    this.intentionalClose = true;
    this.ws?.close();
  };

  connect(roomCode: string, peerId: string, displayName: string): Promise<void> {
    this.roomCode = roomCode;
    // A new key for a new peerId; the same key for every reconnect of this peerId.
    if (peerId !== this.peerId || !this.sessionKey) this.sessionKey = makeSessionKey();
    this.peerId = peerId;
    this.displayName = displayName;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    return this.openSocket(false);
  }

  /**
   * Register a callback invoked after the WebSocket transparently reconnects.
   * Several can be registered; the returned function removes this one.
   */
  onReconnect(cb: () => void): () => void {
    this.reconnectHandlers.add(cb);
    return () => {
      this.reconnectHandlers.delete(cb);
    };
  }

  /** True while the WebSocket is open. */
  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Be told when the socket opens (true) or closes (false). The returned function unsubscribes. */
  onOpenChange(cb: (open: boolean) => void): () => void {
    this.openListeners.add(cb);
    return () => {
      this.openListeners.delete(cb);
    };
  }

  /**
   * Passively listen to every message of `type`. Unlike on(), this does not replace
   * the single handler another module registered, and nothing is queued for it.
   * The returned function unsubscribes.
   */
  listen<T extends SignalingMessage['type']>(type: T, handler: Handler<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler as (msg: any) => void);
    return () => {
      this.listeners.get(type)?.delete(handler as (msg: any) => void);
    };
  }

  private notifyOpen(open: boolean) {
    for (const cb of Array.from(this.openListeners)) {
      try {
        cb(open);
      } catch (err) {
        console.error('[signaling] open listener error', err);
      }
    }
  }

  private openSocket(isReconnect: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${SIGNALING_URL}/room/${this.roomCode}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error('시그널링 서버 연결 시간 초과'));
      }, 10000);

      ws.onopen = () => {
        clearTimeout(timer);
        this.reconnectAttempts = 0;
        this.send({ type: 'hello', peerId: this.peerId, displayName: this.displayName, sessionKey: this.sessionKey });
        window.addEventListener('beforeunload', this.unloadHandler);
        window.addEventListener('pagehide', this.unloadHandler);
        this.startKeepalive();
        if (isReconnect) {
          console.log('[signaling] reconnected, re-hello sent');
          for (const handler of Array.from(this.reconnectHandlers)) {
            try {
              handler();
            } catch (err) {
              console.error('[signaling] reconnect handler error', err);
            }
          }
        }
        this.notifyOpen(true);
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timer);
        // For the very first connect, surface the error. For reconnects,
        // onclose will schedule another attempt.
        if (!isReconnect) reject(new Error('시그널링 서버 연결 실패'));
      };

      ws.onclose = () => {
        // A socket we have already moved on from is no concern of ours. The
        // server closes a peer's earlier socket when the same peer re-hellos on
        // a new one; reconnecting on that close would open yet another socket,
        // retire the current one, and chain into a reconnect storm.
        if (ws !== this.ws) return;
        this.stopKeepalive();
        this.notifyOpen(false);
        if (!this.intentionalClose) {
          console.warn('[signaling] websocket closed unexpectedly → reconnecting');
          this.scheduleReconnect();
        }
      };

      ws.onmessage = (event) => {
        // A late message on a superseded socket would describe a session we
        // have already replaced.
        if (ws !== this.ws) return;
        let msg: SignalingMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'pong' || msg.type === 'ping') {
          // keepalive — nothing to do
          return;
        }
        const watchers = this.listeners.get(msg.type);
        if (watchers && watchers.size > 0) {
          for (const watcher of Array.from(watchers)) {
            try {
              watcher(msg);
            } catch (err) {
              console.error('[signaling] listener error', msg.type, err);
            }
          }
        }
        const handler = this.handlers.get(msg.type);
        if (handler) {
          handler(msg);
        } else {
          // No handler yet — queue and replay once one registers.
          this.pending.push(msg);
        }
      };
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.intentionalClose) return;
    const delay = Math.min(
      1000 * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS
    );
    this.reconnectAttempts += 1;
    console.log('[signaling] reconnect attempt in', delay, 'ms');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalClose) return;
      this.openSocket(true).catch(() => {
        // failed again → schedule another attempt
        this.scheduleReconnect();
      });
    }, delay);
  }

  private startKeepalive() {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // ignore
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  on<T extends SignalingMessage['type']>(type: T, handler: Handler<T>) {
    this.handlers.set(type, handler);
    // Flush any queued messages of this type that arrived before binding.
    if (this.pending.length > 0) {
      const remaining: SignalingMessage[] = [];
      for (const msg of this.pending) {
        if (msg.type === type) {
          (handler as Handler<any>)(msg);
        } else {
          remaining.push(msg);
        }
      }
      this.pending = remaining;
    }
  }

  /** Stop the single handler registered with on() for `type` (listen() subscribers are unaffected). */
  off(type: SignalingMessage['type']) {
    this.handlers.delete(type);
  }

  send(msg: SignalingMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private sendBye() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'bye' }));
      } catch {
        // ignore
      }
    }
  }

  close() {
    this.intentionalClose = true;
    this.stopKeepalive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    window.removeEventListener('beforeunload', this.unloadHandler);
    window.removeEventListener('pagehide', this.unloadHandler);
    this.sendBye();
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
    this.listeners.clear();
    this.openListeners.clear();
    this.reconnectHandlers.clear();
    this.pending = [];
  }
}
