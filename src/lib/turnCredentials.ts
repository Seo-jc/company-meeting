/**
 * Fetches ICE servers (STUN + TURN) for WebRTC.
 * STUN is always included as a fallback.
 * TURN is fetched from the signaling Worker, which proxies Cloudflare Calls TURN.
 * If TURN is not configured server-side, only STUN is returned.
 */

const SIGNALING_HTTP =
  (import.meta as unknown as { env?: { VITE_SIGNALING_URL?: string } }).env
    ?.VITE_SIGNALING_URL?.replace(/^wss:/i, 'https:')
    ?.replace(/\/?$/, '') ?? 'https://meet-sig.jcseo.workers.dev';

const DEFAULT_STUN: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

type CachedCreds = {
  iceServers: RTCIceServer[];
  expiresAt: number;
};

let cache: CachedCreds | null = null;
// Inflight promise to avoid duplicate fetches on rapid mounts.
let inflight: Promise<RTCIceServer[]> | null = null;

export async function getIceServers(): Promise<RTCIceServer[]> {
  // Cache hit
  if (cache && cache.expiresAt > Date.now()) {
    return cache.iceServers;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500);
      let resp: Response;
      try {
        resp = await fetch(`${SIGNALING_HTTP}/api/turn-credentials`, {
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      if (!resp.ok) {
        console.warn('[turn] credentials fetch http', resp.status);
        return DEFAULT_STUN;
      }
      const data = (await resp.json()) as {
        enabled?: boolean;
        iceServers?:
          | { urls?: string | string[]; username?: string; credential?: string }
          | Array<{ urls?: string | string[]; username?: string; credential?: string }>;
      };
      if (!data.enabled) {
        console.log('[turn] TURN server not configured on Worker, using STUN only');
        return DEFAULT_STUN;
      }

      // Normalize: Cloudflare returns a single object with all URLs in an array.
      const turn: RTCIceServer[] = [];
      const items = Array.isArray(data.iceServers)
        ? data.iceServers
        : data.iceServers
        ? [data.iceServers]
        : [];
      for (const item of items) {
        if (!item.urls) continue;
        turn.push({
          urls: item.urls,
          username: item.username,
          credential: item.credential,
        });
      }

      const combined = [...DEFAULT_STUN, ...turn];
      // Cache for 23 hours (TTL of 24h - 1 hour buffer)
      cache = {
        iceServers: combined,
        expiresAt: Date.now() + 23 * 60 * 60 * 1000,
      };
      console.log('[turn] using TURN with', turn.length, 'TURN server entries');
      return combined;
    } catch (err) {
      console.warn('[turn] fetch failed, falling back to STUN', err);
      return DEFAULT_STUN;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** For diagnostic/UI purposes. */
export function hasTurnCached(): boolean {
  if (!cache) return false;
  return cache.iceServers.length > DEFAULT_STUN.length;
}

/** Clear cache (e.g. on connection failure to force re-fetch). */
export function clearIceCache(): void {
  cache = null;
}
