export async function getMicrophone(deviceId?: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
    video: false,
  });
}

/**
 * Create a silent audio MediaStream for listen-only mode.
 * Produces a real audio track that's permanently silent, so WebRTC
 * SDP negotiation works the same as with a real microphone.
 */
export function getSilentMicrophone(): MediaStream {
  const AudioCtxClass =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtxClass();
  const dst = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(dst);
  osc.start();
  return dst.stream;
}

export async function getScreenShareBrowser(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 15 },
    audio: false,
  });
}

export async function getScreenShareElectron(sourceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: 15,
      },
    } as MediaTrackConstraints,
  });
}
