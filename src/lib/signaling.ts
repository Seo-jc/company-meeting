export type SignalingMessage =
  | { type: 'hello'; peerId: string; displayName: string }
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
  | { type: 'chat'; from: string; fromName: string; text: string; ts: number };

const SIGNALING_URL =
  (import.meta as any).env?.VITE_SIGNALING_URL ??
  'wss://meet-sig.jcseo.workers.dev';

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
  private intentionalClose = false;
  private reconnectAttempts = 0;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Called after a successful RE-connect (not the first connect) so the mesh
  // can re-establish media paths (ICE restart) through the restored signaling.
  private reconnectHandler: (() => void) | null = null;

  private unloadHandler = () => {
    this.sendBye();
    this.intentionalClose = true;
    this.ws?.close();
  };

  connect(roomCode: string, peerId: string, displayName: string): Promise<void> {
    this.roomCode = roomCode;
    this.peerId = peerId;
    this.displayName = displayName;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    return this.openSocket(false);
  }

  /** Register a callback invoked after the WebSocket transparently reconnects. */
  onReconnect(cb: () => void) {
    this.reconnectHandler = cb;
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
        this.send({ type: 'hello', peerId: this.peerId, displayName: this.displayName });
        window.addEventListener('beforeunload', this.unloadHandler);
        window.addEventListener('pagehide', this.unloadHandler);
        this.startKeepalive();
        if (isReconnect) {
          console.log('[signaling] reconnected, re-hello sent');
          try {
            this.reconnectHandler?.();
          } catch (err) {
            console.error('[signaling] reconnect handler error', err);
          }
        }
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timer);
        // For the very first connect, surface the error. For reconnects,
        // onclose will schedule another attempt.
        if (!isReconnect) reject(new Error('시그널링 서버 연결 실패'));
      };

      ws.onclose = () => {
        this.stopKeepalive();
        if (!this.intentionalClose) {
          console.warn('[signaling] websocket closed unexpectedly → reconnecting');
          this.scheduleReconnect();
        }
      };

      ws.onmessage = (event) => {
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
    this.pending = [];
  }
}
