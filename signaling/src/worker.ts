export interface Env {
  ROOMS: DurableObjectNamespace;
  GEMINI_API_KEY?: string;
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
