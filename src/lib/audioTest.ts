import { useEffect, useState } from 'react';

/**
 * Reads the live microphone input level (0-100) for the given device.
 * Stream is opened only when `active` is true and released on cleanup.
 */
export function useMicLevel(deviceId: string | null, active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }

    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let interval: number | null = null;
    let stopped = false;

    (async () => {
      try {
        const constraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        };
        if (deviceId) {
          (constraints as MediaTrackConstraints & { deviceId: { exact: string } }).deviceId = {
            exact: deviceId,
          };
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: constraints,
          video: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);

        const buf = new ArrayBuffer(analyser.frequencyBinCount);
        const data = new Uint8Array(buf);

        interval = window.setInterval(() => {
          if (stopped) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          // Normalize. Typical conversational voice ~12-40 byte avg.
          // Scale so quiet speech registers ~30-50%, loud ~80-100%.
          const pct = Math.min(100, Math.round(avg * 2.0));
          setLevel(pct);
        }, 60);
      } catch (err) {
        console.warn('[mic-test] failed', err);
      }
    })();

    return () => {
      stopped = true;
      if (interval !== null) clearInterval(interval);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => undefined);
      setLevel(0);
    };
  }, [active, deviceId]);

  return level;
}

/**
 * Play a brief two-tone chime through the selected speaker.
 * Returns a promise that resolves when the chime finishes.
 */
export async function playSpeakerTone(sinkId: string | null): Promise<void> {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const dest = ctx.createMediaStreamDestination();

  const playTone = (freq: number, startOffset: number, duration: number) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + startOffset;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.35, t0 + 0.02);
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(t0);
    osc.stop(t0 + duration);
  };

  // Two-tone chime: 800Hz then 1200Hz
  playTone(800, 0, 0.28);
  playTone(1200, 0.25, 0.32);

  const audio = new Audio();
  audio.srcObject = dest.stream;
  if (sinkId) {
    const setSink = (audio as unknown as { setSinkId?: (id: string) => Promise<void> }).setSinkId;
    if (typeof setSink === 'function') {
      try {
        await setSink.call(audio, sinkId);
      } catch (err) {
        console.warn('[speaker-test] setSinkId failed', err);
      }
    }
  }

  try {
    await audio.play();
  } catch (err) {
    console.warn('[speaker-test] play failed', err);
  }

  // Wait for the chime to finish (650ms total + buffer), then clean up.
  await new Promise<void>((r) => setTimeout(r, 750));
  audio.pause();
  audio.srcObject = null;
  await ctx.close().catch(() => undefined);
}
