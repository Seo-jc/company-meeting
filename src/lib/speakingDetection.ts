import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Detects which participants are currently speaking by sampling
 * audio level (Web Audio API AnalyserNode) on each MediaStream.
 *
 * Returns a Set of stream IDs that are currently above the
 * speaking threshold (with hold time to avoid flicker).
 */
type StreamEntry = { id: string; stream: MediaStream };

const SPEAKING_THRESHOLD = 16; // 0-255 byte frequency average
const SPEAKING_HOLD_MS = 600;  // keep "speaking" status for this long after silence
const SAMPLE_INTERVAL_MS = 90; // ~11 Hz sampling

export function useSpeakingDetection(streams: StreamEntry[]): Set<string> {
  const [speakers, setSpeakers] = useState<Set<string>>(new Set());
  const speakersRef = useRef<Set<string>>(new Set());

  // Stable key for re-init: changes only when set of stream IDs changes.
  const key = useMemo(
    () => streams.map((s) => s.id).sort().join('|'),
    [streams]
  );

  useEffect(() => {
    if (streams.length === 0) return;

    let stopped = false;
    let ctx: AudioContext | null = null;
    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AudioCtx();
    } catch (err) {
      console.warn('[speaking] AudioContext unavailable', err);
      return;
    }

    type Item = {
      id: string;
      analyser: AnalyserNode;
      source: MediaStreamAudioSourceNode;
      data: Uint8Array<ArrayBuffer>;
    };

    const items: Item[] = [];
    for (const entry of streams) {
      if (!entry.stream || entry.stream.getAudioTracks().length === 0) continue;
      try {
        const source = ctx.createMediaStreamSource(entry.stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.35;
        source.connect(analyser);
        const buf = new ArrayBuffer(analyser.frequencyBinCount);
        items.push({
          id: entry.id,
          analyser,
          source,
          data: new Uint8Array(buf),
        });
      } catch (err) {
        console.warn('[speaking] failed to attach analyser for', entry.id, err);
      }
    }

    const lastSpokeAt = new Map<string, number>();

    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      const next = new Set(speakersRef.current);
      let changed = false;

      for (const item of items) {
        item.analyser.getByteFrequencyData(item.data);
        let sum = 0;
        for (let i = 0; i < item.data.length; i++) sum += item.data[i];
        const avg = sum / item.data.length;

        if (avg > SPEAKING_THRESHOLD) {
          lastSpokeAt.set(item.id, now);
          if (!next.has(item.id)) {
            next.add(item.id);
            changed = true;
          }
        } else {
          const last = lastSpokeAt.get(item.id) ?? 0;
          if (next.has(item.id) && now - last > SPEAKING_HOLD_MS) {
            next.delete(item.id);
            changed = true;
          }
        }
      }

      if (changed) {
        speakersRef.current = next;
        setSpeakers(next);
      }
    };

    const interval = window.setInterval(tick, SAMPLE_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      for (const item of items) {
        try {
          item.source.disconnect();
        } catch {
          // ignore
        }
      }
      if (ctx) ctx.close().catch(() => undefined);
      // Drop any stale speaking state on teardown
      speakersRef.current = new Set();
      setSpeakers(new Set());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return speakers;
}
