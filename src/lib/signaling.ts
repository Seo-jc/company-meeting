export type SignalingMessage =
  | { type: 'hello'; peerId: string; displayName: string }
  | { type: 'bye' }
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
  private unloadHandler = () => {
    this.sendBye();
    this.ws?.close();
  };

  connect(roomCode: string, peerId: string, displayName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${SIGNALING_URL}/room/${roomCode}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('시그널링 서버 연결 시간 초과'));
      }, 10000);

      ws.onopen = () => {
        clearTimeout(timer);
        this.send({ type: 'hello', peerId, displayName });
        window.addEventListener('beforeunload', this.unloadHandler);
        window.addEventListener('pagehide', this.unloadHandler);
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('시그널링 서버 연결 실패'));
      };

      ws.onmessage = (event) => {
        let msg: SignalingMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
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
    window.removeEventListener('beforeunload', this.unloadHandler);
    window.removeEventListener('pagehide', this.unloadHandler);
    this.sendBye();
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
    this.pending = [];
  }
}
