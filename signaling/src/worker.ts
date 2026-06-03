export interface Env {
  ROOMS: DurableObjectNamespace;
  BUG_REPORTS: DurableObjectNamespace;
  GEMINI_API_KEY?: string;
  ADMIN_PASSWORD?: string;
  TURN_TOKEN_ID?: string;
  TURN_TOKEN_SECRET?: string;
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

    if (url.pathname === '/summarize/status') {
      return new Response(
        JSON.stringify({ configured: !!env.GEMINI_API_KEY }),
        { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    if (url.pathname === '/summarize/key') {
      // Returns the API key for client-side Gemini calls.
      // Workaround: Cloudflare Workers' edge IPs are blocked by Gemini API.
      // Client calls Gemini directly from user's location (which is supported).
      const apiKey = (env.GEMINI_API_KEY ?? '').trim();
      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: 'not configured' }),
          { status: 503, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }
      return new Response(
        JSON.stringify({ key: apiKey }),
        { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    if (url.pathname === '/summarize' && request.method === 'POST') {
      return handleSummarize(request, env);
    }

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

type Attachment = { peerId: string; displayName: string } | null;

export class Room {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

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

    if (msg.type === 'hello') {
      console.log('[Room] hello from', msg.peerId, msg.displayName);
      ws.serializeAttachment({ peerId: msg.peerId, displayName: msg.displayName });

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
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ) {
    const att = this.getAttachment(ws);
    console.log('[Room] webSocketClose', { code, reason, wasClean, peerId: att?.peerId });
    if (att) {
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
