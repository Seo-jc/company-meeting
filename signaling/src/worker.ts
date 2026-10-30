export interface Env {
  ROOMS: DurableObjectNamespace;
  BUG_REPORTS: DurableObjectNamespace;
  PRESENCE: DurableObjectNamespace;
  SETTINGS: DurableObjectNamespace;
  GEMINI_API_KEY?: string;
  ADMIN_PASSWORD?: string;
  TURN_TOKEN_ID?: string;
  TURN_TOKEN_SECRET?: string;
}

/**
 * Mask an IP address for display. Keeps enough to distinguish networks/ISPs
 * without exposing the full address. IPv4: keep first 3 octets. IPv6: keep first 3 groups.
 */
function maskIp(ip: string | null): string {
  if (!ip) return '알 수 없음';
  if (ip.includes(':')) {
    // IPv6
    const groups = ip.split(':');
    return groups.slice(0, 3).join(':') + ':****';
  }
  const octets = ip.split('.');
  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.x`;
  }
  return ip;
}

/** Ceiling on annotation messages per connection per second. */
const ANNOTATION_MAX_PER_SEC = 40;
const ANNOTATION_KINDS = ['point', 'stroke', 'shape', 'text', 'clear', 'permission'];
const ANNOTATION_MAX_POINTS = 800;
const ANNOTATION_MAX_TEXT = 200;

/** A normalized coordinate: a finite number inside the video frame. */
function isUnit(n: unknown): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

/**
 * Annotations are relayed untouched, so anything malformed is dropped here
 * rather than left for every client to defend against.
 */
function isValidAnnotation(msg: any): boolean {
  if (typeof msg.screenOwnerId !== 'string' || !msg.screenOwnerId) return false;
  const body = msg.body;
  if (!body || typeof body !== 'object') return false;
  if (!ANNOTATION_KINDS.includes(body.kind)) return false;

  switch (body.kind) {
    case 'point':
      return isUnit(body.x) && isUnit(body.y);
    case 'stroke':
      if (typeof body.id !== 'string') return false;
      if (body.phase !== 'update' && body.phase !== 'end') return false;
      if (!Array.isArray(body.pts)) return false;
      if (body.pts.length === 0 || body.pts.length % 2 !== 0) return false;
      if (body.pts.length > ANNOTATION_MAX_POINTS * 2) return false;
      return body.pts.every(isUnit);
    case 'shape':
      if (typeof body.id !== 'string') return false;
      if (body.tool !== 'arrow' && body.tool !== 'rect') return false;
      return isUnit(body.x1) && isUnit(body.y1) && isUnit(body.x2) && isUnit(body.y2);
    case 'text':
      if (typeof body.id !== 'string') return false;
      if (typeof body.text !== 'string' || body.text.length > ANNOTATION_MAX_TEXT) return false;
      return isUnit(body.x) && isUnit(body.y);
    case 'clear':
      return body.scope === 'mine' || body.scope === 'all';
    case 'permission':
      return typeof body.allowed === 'boolean';
    default:
      return false;
  }
}

/**
 * Meeting minutes (Yjs) relay. The server never stores or inspects the content:
 * it only checks the envelope, caps the size and rate, and forwards it. `data`
 * is the base64 of a Yjs state vector (sync1) / diff (sync2) / update (update).
 */
const MINUTES_KINDS = ['sync1', 'sync2', 'update'];
const MINUTES_MAX_PER_SEC = 30;
const MINUTES_MAX_DATA_SYNC2 = 1_500_000;
const MINUTES_MAX_DATA_OTHER = 200_000;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

function isValidMinutes(msg: any): boolean {
  if (typeof msg.kind !== 'string' || !MINUTES_KINDS.includes(msg.kind)) return false;
  // `to` is optional (absent/null = broadcast); when present it must name a peer.
  if (msg.to != null && (typeof msg.to !== 'string' || msg.to.length === 0)) return false;
  if (typeof msg.data !== 'string' || msg.data.length === 0) return false;
  const max = msg.kind === 'sync2' ? MINUTES_MAX_DATA_SYNC2 : MINUTES_MAX_DATA_OTHER;
  if (msg.data.length > max) return false;
  return BASE64_BODY.test(msg.data);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SUMMARY_PROMPT = `너는 한국어 회의록 요약 보조자다. 주어진 한국어 회의 발화록을 읽고 핵심 안건과 Action Item을 추출한다.

규칙:
- 출력은 반드시 JSON 객체. 다른 텍스트나 마크다운 금지.
- 형식: {"bullets":["핵심1","핵심2",...],"actions":["담당자: 할 일 (기한)",...]}
- bullets: 회의에서 논의된 주요 안건/결정사항. 3~6개. 각 항목 1줄, 50자 이내.
- actions: 명확하게 "누가 무엇을 한다"가 드러나는 항목만. 없으면 빈 배열 [].
- 발화록에 없는 내용은 추측하지 말 것.
- 정중한 어조의 명사형 종결 ("논의함", "검토 예정").

발화록:
`;

async function handleSummarize(request: Request, env: Env): Promise<Response> {
  const apiKey = (env.GEMINI_API_KEY ?? '').trim();
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const items = Array.isArray(body?.transcripts) ? body.transcripts : [];
  if (items.length === 0) {
    return new Response(
      JSON.stringify({ bullets: [], actions: [] }),
      { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const transcriptText = items
    .map((t: any) => `[${t.time}] ${t.speaker}: ${t.text}`)
    .join('\n');

  const fullPrompt = SUMMARY_PROMPT + transcriptText;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const geminiBody = {
    contents: [{ parts: [{ text: fullPrompt }] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  };

  try {
    const geminiResp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error('Gemini API error', geminiResp.status, errText);
      return new Response(
        JSON.stringify({ error: `Gemini API ${geminiResp.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const result: any = await geminiResp.json();
    const text =
      result?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';

    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to extract JSON from text
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          parsed = {};
        }
      }
    }

    const bullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];

    return new Response(JSON.stringify({ bullets, actions }), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err) {
    console.error('Summarize error', err);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
}

/** logo <= 400,000 chars + name/docNo/password and JSON overhead, with headroom. */
const COMPANY_MAX_BODY_BYTES = 450_000;

/**
 * Read a request body as text, giving up (null) once it exceeds `maxBytes`.
 * Checks Content-Length first, then counts while streaming, so a chunked body
 * with no declared length cannot be buffered without bound.
 */
async function readTextLimited(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/health') {
      return new Response('ok');
    }

    // ============== AI summary: not wired up ==============
    // The summary routes are intentionally not exposed. The client must never
    // receive GEMINI_API_KEY — credentials stay server-side. When this feature
    // is built for real, call Gemini from the Worker and put the route behind
    // authentication, the way /api/bugs and /api/presence are.
    // handleSummarize()/SUMMARY_PROMPT are kept below only as a starting point.

    // ============== TURN credentials proxy ==============
    if (url.pathname === '/api/turn-credentials' && request.method === 'GET') {
      const tokenId = (env.TURN_TOKEN_ID ?? '').trim();
      const tokenSecret = (env.TURN_TOKEN_SECRET ?? '').trim();
      if (!tokenId || !tokenSecret) {
        return new Response(JSON.stringify({ enabled: false }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      try {
        const resp = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/generate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenSecret}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ttl: 86400 }),
          }
        );
        if (!resp.ok) {
          const txt = await resp.text();
          console.error('TURN credential gen failed', resp.status, txt);
          return new Response(JSON.stringify({ enabled: false, error: 'upstream' }), {
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          });
        }
        const data = (await resp.json()) as {
          iceServers?: { urls?: string | string[]; username?: string; credential?: string };
        };
        return new Response(JSON.stringify({ enabled: true, iceServers: data.iceServers }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      } catch (err) {
        console.error('TURN credential error', err);
        return new Response(JSON.stringify({ enabled: false, error: 'exception' }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
    }
    // ============== End TURN ==============

    // ============== Bug reports API ==============
    if (url.pathname === '/api/report' && request.method === 'POST') {
      const id = env.BUG_REPORTS.idFromName('global');
      const obj = env.BUG_REPORTS.get(id);
      const body = await request.text();
      const resp = await obj.fetch(
        new Request('https://internal/add', { method: 'POST', body })
      );
      const text = await resp.text();
      return new Response(text, {
        status: resp.status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (url.pathname === '/api/bugs' && request.method === 'POST') {
      let payload: { password?: string; limit?: number; offset?: number } = {};
      try {
        payload = await request.json();
      } catch {
        // ignore
      }
      const admin = (env.ADMIN_PASSWORD ?? '').trim();
      if (!admin || payload.password !== admin) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      const id = env.BUG_REPORTS.idFromName('global');
      const obj = env.BUG_REPORTS.get(id);
      const qs = new URLSearchParams({
        limit: String(payload.limit ?? 50),
        offset: String(payload.offset ?? 0),
      });
      const resp = await obj.fetch(new Request(`https://internal/list?${qs}`));
      const text = await resp.text();
      return new Response(text, {
        status: resp.status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (url.pathname.startsWith('/api/bugs/') && request.method === 'POST') {
      let payload: { password?: string; action?: 'read' | 'delete' } = {};
      try {
        payload = await request.json();
      } catch {
        // ignore
      }
      const admin = (env.ADMIN_PASSWORD ?? '').trim();
      if (!admin || payload.password !== admin) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      const reportId = url.pathname.split('/')[3];
      const id = env.BUG_REPORTS.idFromName('global');
      const obj = env.BUG_REPORTS.get(id);
      const action = payload.action ?? 'read';
      const resp = await obj.fetch(
        new Request(`https://internal/${action}/${reportId}`, { method: 'POST' })
      );
      const text = await resp.text();
      return new Response(text, {
        status: resp.status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (url.pathname === '/api/auth' && request.method === 'POST') {
      let payload: { password?: string } = {};
      try {
        payload = await request.json();
      } catch {
        // ignore
      }
      const admin = (env.ADMIN_PASSWORD ?? '').trim();
      if (!admin) {
        return new Response(JSON.stringify({ error: 'admin not configured' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      if (payload.password !== admin) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
    // ============== End bug reports API ==============

    // ============== Presence (realtime, NOT persisted) ==============
    if (url.pathname === '/api/presence' && request.method === 'POST') {
      let payload: { password?: string } = {};
      try {
        payload = await request.json();
      } catch {
        // ignore
      }
      const admin = (env.ADMIN_PASSWORD ?? '').trim();
      if (!admin || payload.password !== admin) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      // 1) Ask PresenceDO which rooms currently have participants (codes only).
      const presId = env.PRESENCE.idFromName('global');
      const pres = env.PRESENCE.get(presId);
      const activeResp = await pres.fetch(new Request('https://internal/active-rooms'));
      const { rooms } = (await activeResp.json()) as { rooms: string[] };

      // 2) Fan out to each active room and collect LIVE participant info.
      //    This data lives only in the live WebSocket attachment — nothing stored.
      const all: Array<Record<string, unknown>> = [];
      await Promise.all(
        rooms.map(async (code) => {
          try {
            const rid = env.ROOMS.idFromName(code);
            const r = env.ROOMS.get(rid);
            const resp = await r.fetch(new Request('https://internal/presence'));
            if (!resp.ok) return;
            const data = (await resp.json()) as { participants: Array<Record<string, unknown>> };
            for (const p of data.participants) {
              all.push({ ...p, roomCode: code });
            }
          } catch {
            // room may have just emptied; skip
          }
        })
      );

      return new Response(
        JSON.stringify({ now: Date.now(), participants: all }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...CORS_HEADERS,
          },
        }
      );
    }

    if (url.pathname === '/api/stats' && request.method === 'POST') {
      let payload: { password?: string } = {};
      try {
        payload = await request.json();
      } catch {
        // ignore
      }
      const admin = (env.ADMIN_PASSWORD ?? '').trim();
      if (!admin || payload.password !== admin) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      const presId = env.PRESENCE.idFromName('global');
      const pres = env.PRESENCE.get(presId);
      const resp = await pres.fetch(new Request('https://internal/stats'));
      const text = await resp.text();
      return new Response(text, {
        status: resp.status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
    // ============== End presence/stats ==============

    // ============== Company form settings (logo / name / doc no.) ==============
    // Public read (every PC fetches it, then caches); admin-only write.
    if (url.pathname === '/api/company' && request.method === 'GET') {
      const obj = env.SETTINGS.get(env.SETTINGS.idFromName('global'));
      const resp = await obj.fetch(new Request('https://internal/get'));
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      };
      if (resp.ok) headers['Cache-Control'] = 'max-age=60';
      return new Response(await resp.text(), { status: resp.status, headers });
    }

    if (url.pathname === '/api/company' && request.method === 'POST') {
      // Cap the body before buffering it: only the logo is large (<= 400,000 chars).
      const text = await readTextLimited(request, COMPANY_MAX_BODY_BYTES);
      if (text === null) {
        return new Response(JSON.stringify({ error: 'payload too large' }), {
          status: 413,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      const obj = env.SETTINGS.get(env.SETTINGS.idFromName('global'));
      const resp = await obj.fetch(
        new Request('https://internal/set', {
          method: 'POST',
          body: text,
          // Set here, never taken from the caller: it keys the failed-attempt limit.
          headers: { 'X-Client-Ip': request.headers.get('CF-Connecting-IP') ?? 'unknown' },
        })
      );
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...CORS_HEADERS,
      };
      const retryAfter = resp.headers.get('Retry-After');
      if (retryAfter) headers['Retry-After'] = retryAfter;
      return new Response(await resp.text(), { status: resp.status, headers });
    }
    // ============== End company settings ==============

    const debugMatch = url.pathname.match(/^\/room\/([A-Z0-9]{4,10})\/debug$/);
    if (debugMatch) {
      const id = env.ROOMS.idFromName(debugMatch[1]);
      return env.ROOMS.get(id).fetch(request);
    }

    const match = url.pathname.match(/^\/room\/([A-Z0-9]{4,10})$/);
    if (!match) return new Response('Not found', { status: 404 });

    const roomCode = match[1];
    const id = env.ROOMS.idFromName(roomCode);
    const room = env.ROOMS.get(id);
    return room.fetch(request);
  },
};

type Geo = {
  country: string | null;
  city: string | null;
  region: string | null;
  ipMasked: string;
};

type Attachment =
  | {
      peerId: string;
      displayName: string;
      geo?: Geo;
      connectedAt?: number;
    }
  | null;

export class Room {
  private state: DurableObjectState;
  private env: Env;
  private roomCode = '';
  // Temporary geo holding for connections that haven't sent 'hello' yet.
  private pendingGeo: Geo | null = null;
  // Annotation flood protection, per connection. Cleared when the socket closes.
  private annotationRate = new Map<WebSocket, { count: number; windowStart: number }>();
  // Same idea for meeting-minutes sync messages.
  private minutesRate = new Map<WebSocket, { count: number; windowStart: number }>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal: live presence list for this room (admin fan-out). Not persisted.
    if (url.pathname === '/presence') {
      const participants = this.state
        .getWebSockets()
        .map((ws) => {
          const att = this.getAttachment(ws);
          if (!att?.peerId) return null;
          return {
            displayName: att.displayName,
            country: att.geo?.country ?? null,
            city: att.geo?.city ?? null,
            region: att.geo?.region ?? null,
            ipMasked: att.geo?.ipMasked ?? '알 수 없음',
            connectedAt: att.connectedAt ?? null,
          };
        })
        .filter((p) => p !== null);
      return new Response(JSON.stringify({ participants }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    if (url.pathname.endsWith('/debug') && request.method === 'GET') {
      const sockets = this.state.getWebSockets();
      // Only count peers that completed 'hello' (have attachment) — real participants.
      const peers = sockets
        .map((ws) => {
          const att = this.getAttachment(ws);
          return { peerId: att?.peerId ?? null, displayName: att?.displayName ?? null };
        })
        .filter((p) => p.peerId !== null);
      return new Response(
        JSON.stringify({ wsCount: peers.length, peers }, null, 2),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...CORS_HEADERS,
          },
        }
      );
    }

    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 });
    }

    // Capture room code from URL (/room/CODE) so we can report to presence.
    const codeMatch = url.pathname.match(/\/room\/([A-Z0-9]{4,10})/);
    if (codeMatch) this.roomCode = codeMatch[1];

    // Capture geo from Cloudflare edge metadata (available on the upgrade request).
    const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
    this.pendingGeo = {
      country: (cf?.country as string) ?? null,
      city: (cf?.city as string) ?? null,
      region: (cf?.region as string) ?? null,
      ipMasked: maskIp(request.headers.get('CF-Connecting-IP')),
    };

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);
    console.log('[Room] accepted new WebSocket, total:', this.state.getWebSockets().length);
    return new Response(null, { status: 101, webSocket: client });
  }

  private getAttachment(ws: WebSocket): Attachment {
    try {
      const a = ws.deserializeAttachment();
      return a && typeof a === 'object' && 'peerId' in a ? (a as Attachment) : null;
    } catch {
      return null;
    }
  }

  private async reportPresence(
    action: 'join' | 'leave',
    info: { country: string | null; durationMs?: number }
  ): Promise<void> {
    if (!this.roomCode) return;
    try {
      const presId = this.env.PRESENCE.idFromName('global');
      const pres = this.env.PRESENCE.get(presId);
      await pres.fetch(
        new Request(`https://internal/${action}`, {
          method: 'POST',
          body: JSON.stringify({ roomCode: this.roomCode, ...info }),
        })
      );
    } catch (err) {
      console.error('[Room] presence report failed', err);
    }
  }

  private broadcastExcept(skip: WebSocket, payload: unknown) {
    const text = JSON.stringify(payload);
    let sent = 0;
    for (const ws of this.state.getWebSockets()) {
      if (ws === skip) continue;
      try {
        ws.send(text);
        sent++;
      } catch (err) {
        console.error('[Room] broadcast send failed', err);
      }
    }
    console.log('[Room] broadcast', (payload as any).type, 'to', sent, 'peers');
  }

  private broadcastSync() {
    const peers: Array<{ peerId: string; displayName: string }> = [];
    for (const ws of this.state.getWebSockets()) {
      const att = this.getAttachment(ws);
      if (att) peers.push({ peerId: att.peerId, displayName: att.displayName });
    }
    const text = JSON.stringify({ type: 'sync', peers });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // ignore
      }
    }
    console.log('[Room] broadcast sync with', peers.length, 'peers');
  }

  private sendToPeerId(targetPeerId: string, payload: unknown) {
    const text = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      const att = this.getAttachment(ws);
      if (att?.peerId === targetPeerId) {
        try {
          ws.send(text);
        } catch (err) {
          console.error('[Room] sendToPeerId failed', err);
        }
        return;
      }
    }
    console.warn('[Room] sendToPeerId: target not found', targetPeerId);
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    let msg: any;
    try {
      const text =
        typeof message === 'string' ? message : new TextDecoder().decode(message);
      msg = JSON.parse(text);
    } catch {
      return;
    }

    // Keepalive: client pings periodically to keep the (otherwise idle) WebSocket
    // alive through NAT/proxy idle timeouts. Reply with pong.
    if (msg.type === 'ping') {
      try {
        ws.send(JSON.stringify({ type: 'pong' }));
      } catch {
        // ignore
      }
      return;
    }

    if (msg.type === 'hello') {
      console.log('[Room] hello from', msg.peerId, msg.displayName);

      // Retire any earlier session of this same peer. A dropped network leaves
      // the old socket half-open here until a send to it fails; when it finally
      // closes, announcing `peer-left` then would tear down the connections the
      // peer has just rebuilt over its new socket. Announce the old session's
      // exit now — before the fresh offers arrive, so everyone drops their stale
      // connection first — and detach it so its eventual close stays silent.
      const retired = new Set<WebSocket>();
      for (const other of this.state.getWebSockets()) {
        if (other === ws) continue;
        const prev = this.getAttachment(other);
        if (!prev || prev.peerId !== msg.peerId) continue;
        other.serializeAttachment(null);
        this.annotationRate.delete(other);
        this.minutesRate.delete(other);
        void this.reportPresence('leave', {
          country: prev.geo?.country ?? null,
          durationMs: prev.connectedAt ? Date.now() - prev.connectedAt : 0,
        });
        try {
          other.close(1000, 'replaced by a newer session');
        } catch {
          // already gone
        }
        retired.add(other);
      }
      if (retired.size > 0) {
        console.log('[Room] retired', retired.size, 'stale session(s) of', msg.peerId);
        const leftText = JSON.stringify({ type: 'peer-left', peerId: msg.peerId });
        for (const other of this.state.getWebSockets()) {
          if (other === ws || retired.has(other)) continue;
          try {
            other.send(leftText);
          } catch {
            // a dead socket is cleaned up by its own close
          }
        }
      }

      const connectedAt = Date.now();
      const geo = this.pendingGeo ?? undefined;
      this.pendingGeo = null;
      ws.serializeAttachment({
        peerId: msg.peerId,
        displayName: msg.displayName,
        geo,
        connectedAt,
      });
      // Report to presence/stats (anonymous: only country + duration counters).
      void this.reportPresence('join', { country: geo?.country ?? null });

      const others: Array<{ peerId: string; displayName: string }> = [];
      for (const other of this.state.getWebSockets()) {
        if (other === ws) continue;
        const a = this.getAttachment(other);
        if (a) others.push({ peerId: a.peerId, displayName: a.displayName });
      }

      try {
        ws.send(JSON.stringify({ type: 'peers', peers: others }));
      } catch {
        // ignore
      }

      this.broadcastExcept(ws, {
        type: 'peer-joined',
        peerId: msg.peerId,
        displayName: msg.displayName,
      });
      this.broadcastSync();
      return;
    }

    if (msg.type === 'bye') {
      const att = this.getAttachment(ws);
      console.log('[Room] bye from', att?.peerId);
      if (att) {
        const durationMs = att.connectedAt ? Date.now() - att.connectedAt : 0;
        void this.reportPresence('leave', {
          country: att.geo?.country ?? null,
          durationMs,
        });
        ws.serializeAttachment(null);
        this.broadcastExcept(ws, { type: 'peer-left', peerId: att.peerId });
      }
      try {
        ws.close(1000, 'bye');
      } catch {
        // ignore
      }
      this.broadcastSync();
      return;
    }

    if (
      msg.type === 'offer' ||
      msg.type === 'answer' ||
      msg.type === 'ice' ||
      msg.type === 'screen-stop' ||
      msg.type === 'mute-state'
    ) {
      if (typeof msg.to === 'string') {
        this.sendToPeerId(msg.to, msg);
      }
      return;
    }

    if (msg.type === 'chat' || msg.type === 'transcript') {
      this.broadcastExcept(ws, msg);
      return;
    }

    // Screen annotations. Relayed rather than stored, like chat: a peer joining
    // later does not see marks drawn before it arrived.
    if (msg.type === 'annotation') {
      if (!this.allowAnnotation(ws)) return;
      // The sender does not get to claim someone else's identity.
      const att = this.getAttachment(ws);
      if (!att?.peerId || msg.from !== att.peerId) return;
      if (!isValidAnnotation(msg)) return;
      this.broadcastExcept(ws, msg);
      return;
    }

    // Someone started or stopped recording. Everyone in the room is told, so
    // nobody is recorded without a visible indicator.
    if (msg.type === 'recording') {
      const att = this.getAttachment(ws);
      if (!att?.peerId || msg.from !== att.peerId) return;
      if (typeof msg.active !== 'boolean') return;
      this.broadcastExcept(ws, { type: 'recording', from: msg.from, active: msg.active });
      return;
    }

    // Meeting-minutes (Yjs) sync. Relayed only — never stored and never logged,
    // since the content is the meeting itself. Rebuilt from the checked fields so
    // nothing else the sender attached rides along.
    if (msg.type === 'minutes') {
      if (!this.allowRate(this.minutesRate, ws, MINUTES_MAX_PER_SEC)) return;
      // The sender does not get to claim someone else's identity.
      const att = this.getAttachment(ws);
      if (!att?.peerId || msg.from !== att.peerId) return;
      if (!isValidMinutes(msg)) return;
      const out: Record<string, unknown> = {
        type: 'minutes',
        from: att.peerId,
        kind: msg.kind,
        data: msg.data,
      };
      if (msg.to != null) {
        if (msg.to === att.peerId) return;
        out.to = msg.to;
        this.sendToPeerId(msg.to, out);
      } else {
        this.broadcastToPeersExcept(ws, out);
      }
      return;
    }
  }

  /**
   * Like broadcastExcept, but only to connections that have completed 'hello':
   * a socket that merely opened the room URL must not receive meeting content.
   */
  private broadcastToPeersExcept(skip: WebSocket, payload: unknown) {
    const text = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      if (ws === skip) continue;
      if (!this.getAttachment(ws)?.peerId) continue;
      try {
        ws.send(text);
      } catch {
        // a dead socket is cleaned up by its own close
      }
    }
  }

  /**
   * Fixed one-second window, per connection. Clients throttle themselves well
   * below these caps; they only stop a runaway or hostile sender.
   */
  private allowRate(
    buckets: Map<WebSocket, { count: number; windowStart: number }>,
    ws: WebSocket,
    maxPerSec: number
  ): boolean {
    const now = Date.now();
    const bucket = buckets.get(ws);
    if (!bucket || now - bucket.windowStart >= 1000) {
      buckets.set(ws, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= maxPerSec) return false;
    bucket.count++;
    return true;
  }

  /** Per-connection cap on annotation messages. */
  private allowAnnotation(ws: WebSocket): boolean {
    return this.allowRate(this.annotationRate, ws, ANNOTATION_MAX_PER_SEC);
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ) {
    const att = this.getAttachment(ws);
    console.log('[Room] webSocketClose', { code, reason, wasClean, peerId: att?.peerId });
    this.annotationRate.delete(ws);
    this.minutesRate.delete(ws);
    if (att) {
      const durationMs = att.connectedAt ? Date.now() - att.connectedAt : 0;
      void this.reportPresence('leave', {
        country: att.geo?.country ?? null,
        durationMs,
      });
      ws.serializeAttachment(null);
      this.broadcastExcept(ws, { type: 'peer-left', peerId: att.peerId });
    }
    this.broadcastSync();
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    const att = this.getAttachment(ws);
    console.log('[Room] webSocketError', { peerId: att?.peerId, error: String(error) });
    await this.webSocketClose(ws, 1006, 'error', false);
  }
}

// ============== Bug Reports Durable Object ==============
const MAX_REPORTS = 500; // trim oldest beyond this

export class BugReportsDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/add' && request.method === 'POST') {
      let report: Record<string, unknown> = {};
      try {
        report = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400 });
      }
      const id =
        (typeof report.id === 'string' && report.id) || crypto.randomUUID();
      const ts =
        (typeof report.ts === 'number' && report.ts) || Date.now();
      // Sort key: 15-digit zero-padded ts so list() with reverse returns newest first.
      const key = `report:${ts.toString().padStart(15, '0')}:${id}`;
      const stored = { ...report, id, ts, read: false };
      await this.state.storage.put(key, stored);

      // Trim oldest reports beyond MAX_REPORTS.
      const all = await this.state.storage.list<unknown>({ prefix: 'report:' });
      if (all.size > MAX_REPORTS) {
        const keys = Array.from(all.keys()).sort();
        const toDelete = keys.slice(0, all.size - MAX_REPORTS);
        await this.state.storage.delete(toDelete);
      }

      return new Response(JSON.stringify({ id, ts }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/list' && request.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') ?? '50');
      const offset = parseInt(url.searchParams.get('offset') ?? '0');
      const items = await this.state.storage.list<Record<string, unknown>>({
        prefix: 'report:',
        reverse: true,
        limit: limit + offset,
      });
      const reports: Array<Record<string, unknown>> = [];
      let i = 0;
      for (const [, value] of items) {
        if (i++ < offset) continue;
        reports.push(value);
      }
      // Count unread
      const allItems = await this.state.storage.list<Record<string, unknown>>({
        prefix: 'report:',
      });
      let unread = 0;
      let total = 0;
      for (const [, value] of allItems) {
        total++;
        if (!(value as { read?: boolean }).read) unread++;
      }
      return new Response(JSON.stringify({ reports, unread, total }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const readMatch = path.match(/^\/read\/(.+)$/);
    if (readMatch && request.method === 'POST') {
      const targetId = readMatch[1];
      const items = await this.state.storage.list<Record<string, unknown>>({
        prefix: 'report:',
      });
      for (const [key, value] of items) {
        if ((value as { id?: string }).id === targetId) {
          await this.state.storage.put(key, { ...value, read: true });
          return new Response(JSON.stringify({ ok: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }

    const deleteMatch = path.match(/^\/delete\/(.+)$/);
    if (deleteMatch && request.method === 'POST') {
      const targetId = deleteMatch[1];
      const items = await this.state.storage.list<Record<string, unknown>>({
        prefix: 'report:',
      });
      for (const [key, value] of items) {
        if ((value as { id?: string }).id === targetId) {
          await this.state.storage.delete(key);
          return new Response(JSON.stringify({ ok: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }

    return new Response('Not found', { status: 404 });
  }
}

// ============== Presence Durable Object ==============
// Tracks ONLY:
//   - active room codes + per-room participant counts (codes/numbers — not personal)
//   - anonymous aggregate stats (counters by country/day — no names, no IPs)
// Realtime personal data (name/IP/location) is NEVER stored here; it lives only
// in each Room's live WebSocket attachment and is fetched on-demand by admin.
const STATS_DAY_RETENTION = 90; // keep last 90 days of daily stats, auto-trim

type StatsShape = {
  totalJoins: number;
  totalMinutes: number;
  byCountry: Record<string, number>;
  byDay: Record<string, { joins: number; minutes: number }>;
  byHour: Record<string, number>; // 0-23 → join count
};

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

export class PresenceDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private async getStats(): Promise<StatsShape> {
    const s = await this.state.storage.get<StatsShape>('stats');
    return (
      s ?? {
        totalJoins: 0,
        totalMinutes: 0,
        byCountry: {},
        byDay: {},
        byHour: {},
      }
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/join' && request.method === 'POST') {
      const body = (await request.json()) as { roomCode?: string; country?: string | null };
      const code = body.roomCode;
      if (code) {
        const counts =
          (await this.state.storage.get<Record<string, number>>('roomCounts')) ?? {};
        counts[code] = (counts[code] ?? 0) + 1;
        await this.state.storage.put('roomCounts', counts);
      }
      // Anonymous stats
      const now = Date.now();
      const stats = await this.getStats();
      stats.totalJoins += 1;
      const country = body.country ?? 'UNKNOWN';
      stats.byCountry[country] = (stats.byCountry[country] ?? 0) + 1;
      const dk = dayKey(now);
      stats.byDay[dk] = stats.byDay[dk] ?? { joins: 0, minutes: 0 };
      stats.byDay[dk].joins += 1;
      const hk = String(new Date(now).getUTCHours());
      stats.byHour[hk] = (stats.byHour[hk] ?? 0) + 1;
      // Trim old days
      const days = Object.keys(stats.byDay).sort();
      if (days.length > STATS_DAY_RETENTION) {
        for (const d of days.slice(0, days.length - STATS_DAY_RETENTION)) {
          delete stats.byDay[d];
        }
      }
      await this.state.storage.put('stats', stats);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/leave' && request.method === 'POST') {
      const body = (await request.json()) as {
        roomCode?: string;
        country?: string | null;
        durationMs?: number;
      };
      const code = body.roomCode;
      if (code) {
        const counts =
          (await this.state.storage.get<Record<string, number>>('roomCounts')) ?? {};
        if (counts[code]) {
          counts[code] -= 1;
          if (counts[code] <= 0) delete counts[code];
          await this.state.storage.put('roomCounts', counts);
        }
      }
      const minutes = Math.max(0, Math.round((body.durationMs ?? 0) / 60000));
      if (minutes > 0) {
        const stats = await this.getStats();
        stats.totalMinutes += minutes;
        const dk = dayKey(Date.now());
        stats.byDay[dk] = stats.byDay[dk] ?? { joins: 0, minutes: 0 };
        stats.byDay[dk].minutes += minutes;
        await this.state.storage.put('stats', stats);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/active-rooms') {
      const counts =
        (await this.state.storage.get<Record<string, number>>('roomCounts')) ?? {};
      const rooms = Object.keys(counts).filter((c) => counts[c] > 0);
      return new Response(JSON.stringify({ rooms }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/stats') {
      const stats = await this.getStats();
      return new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }
}

// ============== Settings Durable Object (company form: logo / name / doc no.) ==============
// One record, shared by every PC. Holds the only thing the server persists for the
// minutes feature — the letterhead — never any meeting content.
// Failed admin attempts are counted per client here (not in the Worker) because a
// Worker isolate's memory is neither shared nor durable, so a limit kept there
// would not hold.
const COMPANY_NAME_MAX = 60;
const COMPANY_DOCNO_MAX = 40;
const COMPANY_LOGO_MAX = 400_000;
const COMPANY_LOGO_PREFIXES = ['data:image/png;base64,', 'data:image/jpeg;base64,'];
const COMPANY_FAIL_MAX = 10; // failed password attempts allowed per window
const COMPANY_FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_PRUNE_EVERY_MS = 60 * 1000;

type CompanyRecord = { name: string; docNo: string; logo: string | null; updatedAt: number };
type FailRecord = { count: number; windowStart: number };

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Compares digests of both sides, so neither the value nor its length leaks via timing. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

export class SettingsDO {
  private state: DurableObjectState;
  private env: Env;
  private lastPrune = 0;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/get' && request.method === 'GET') return this.get();
    if (path === '/set' && request.method === 'POST') return this.set(request);
    return new Response('Not found', { status: 404 });
  }

  private async get(): Promise<Response> {
    const rec = await this.state.storage.get<CompanyRecord>('company');
    return jsonResponse(200, {
      name: rec?.name ?? '',
      docNo: rec?.docNo ?? '',
      logo: rec?.logo ?? null,
      updatedAt: rec?.updatedAt ?? 0,
    });
  }

  private async set(request: Request): Promise<Response> {
    let body: any;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return jsonResponse(400, { error: 'invalid json' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse(400, { error: 'invalid body' });
    }

    const admin = (this.env.ADMIN_PASSWORD ?? '').trim();
    if (!admin) return jsonResponse(503, { error: 'admin not configured' });

    // Everything that needs a non-storage await comes first. The storage steps
    // below then run back to back, so concurrent attempts cannot both read the
    // same failure count and undercount.
    const given = typeof body.password === 'string' ? body.password : '';
    const clientIp = request.headers.get('X-Client-Ip') ?? 'unknown';
    const [match, ipDigest] = await Promise.all([safeEqual(given, admin), sha256(clientIp)]);
    // Only a digest of the address is kept, and only for the length of the window.
    const failKey =
      'fail:' +
      Array.from(ipDigest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');

    const now = Date.now();
    const stored = await this.state.storage.get<FailRecord>(failKey);
    const rec = stored && now - stored.windowStart < COMPANY_FAIL_WINDOW_MS ? stored : null;

    // Locked out: refuse even a correct password until the window has passed.
    if (rec && rec.count >= COMPANY_FAIL_MAX) {
      const retryAfter = Math.max(
        1,
        Math.ceil((rec.windowStart + COMPANY_FAIL_WINDOW_MS - now) / 1000)
      );
      return jsonResponse(
        429,
        { error: 'too many attempts', retryAfter },
        { 'Retry-After': String(retryAfter) }
      );
    }

    if (!match) {
      await this.state.storage.put<FailRecord>(failKey, {
        count: (rec?.count ?? 0) + 1,
        windowStart: rec?.windowStart ?? now,
      });
      await this.pruneFailures(now);
      return jsonResponse(403, { error: 'forbidden' });
    }
    if (stored) await this.state.storage.delete(failKey);

    // Authenticated. A request that is wrong in shape is the caller's bug, not an attack.
    const { name, docNo, logo } = body;
    if (typeof name !== 'string' || typeof docNo !== 'string') {
      return jsonResponse(400, { error: 'name and docNo must be strings' });
    }
    const cleanName = name.trim();
    const cleanDocNo = docNo.trim();
    if (cleanName.length > COMPANY_NAME_MAX) return jsonResponse(400, { error: 'name too long' });
    if (cleanDocNo.length > COMPANY_DOCNO_MAX) return jsonResponse(400, { error: 'docNo too long' });
    // These end up in the workbook's header/footer, where a line break would break the layout.
    if (/[\u0000-\u001f\u007f]/.test(cleanName) || /[\u0000-\u001f\u007f]/.test(cleanDocNo)) {
      return jsonResponse(400, { error: 'control characters not allowed' });
    }
    if (logo !== null) {
      if (typeof logo !== 'string') return jsonResponse(400, { error: 'logo must be null or string' });
      const prefix = COMPANY_LOGO_PREFIXES.find((p) => logo.startsWith(p));
      if (!prefix) return jsonResponse(400, { error: 'logo must be a PNG or JPEG data URL' });
      if (logo.length > COMPANY_LOGO_MAX) return jsonResponse(400, { error: 'logo too large' });
      if (!BASE64_BODY.test(logo.slice(prefix.length))) {
        return jsonResponse(400, { error: 'logo is not valid base64' });
      }
    }

    const updatedAt = Date.now();
    await this.state.storage.put<CompanyRecord>('company', {
      name: cleanName,
      docNo: cleanDocNo,
      logo,
      updatedAt,
    });
    return jsonResponse(200, { ok: true, updatedAt });
  }

  /** Drops expired failure counters, at most once a minute. */
  private async pruneFailures(now: number): Promise<void> {
    if (now - this.lastPrune < FAIL_PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    const all = await this.state.storage.list<FailRecord>({ prefix: 'fail:' });
    const expired: string[] = [];
    for (const [key, value] of all) {
      if (now - value.windowStart >= COMPANY_FAIL_WINDOW_MS) expired.push(key);
    }
    if (expired.length > 0) await this.state.storage.delete(expired);
  }
}
