// Meeting recording: audio mixing (local mic + every peer) + compositing the
// shared screen with live annotations burned in + MediaRecorder + disk writing.
//
// Design notes (see MeetingRoom.tsx for the UI wiring):
// - Audio is mixed via WebAudio (AudioMixer) so muting/joining/leaving is
//   reflected live without restarting the recording.
// - Video (when a screen is shared) is NOT the raw share track — it is
//   redrawn onto an offscreen canvas every frame together with whatever
//   annotations are currently visible for that screen (AnnotationCompositor),
//   using the exact same draw* functions as the live on-screen overlay
//   (lib/annotations.ts) so recording and live view never drift apart.
// - Chunks are streamed out via `RecordingWriter` (Electron: IPC-append to
//   disk; browser/dev fallback: buffered in memory and downloaded at the end)
//   so a long meeting never sits entirely in renderer memory in the Electron
//   path.

import {
  AnnotationHub,
  LASER_FADE_MS,
  drawLaser,
  drawShape,
  drawText,
  drawStroke,
  getPeerColor,
  type ContentRect,
} from './annotations';

// --------------------------------- mime type / file naming ---------------------------------

// Preference order confirmed against Chromium's MediaRecorder.isTypeSupported:
// mp4 first (friendlier file extension for a non-technical audience), webm as
// the guaranteed-working fallback. Always probed at runtime — Electron 33
// (Chromium 130) may not support the mp4 candidates yet, in which case this
// silently (and correctly) falls through to webm.
const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const AUDIO_MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined';
}

export function pickMimeType(hasVideo: boolean): string {
  const candidates = hasVideo ? VIDEO_MIME_CANDIDATES : AUDIO_MIME_CANDIDATES;
  if (isRecordingSupported()) {
    for (const c of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(c)) return c;
      } catch {
        // isTypeSupported should never throw, but never let a bad candidate abort selection.
      }
    }
  }
  return hasVideo ? 'video/webm' : 'audio/webm';
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) {
    return mimeType.startsWith('audio/') ? 'm4a' : 'mp4';
  }
  return 'webm';
}

/** Human label for the recording-done dialog, e.g. "MP4" / "WebM" / "M4A". */
export function formatLabelForMimeType(mimeType: string): string {
  return extensionForMimeType(mimeType).toUpperCase();
}

/** Local-time (never UTC — see js-date-utc-offbyone pitfall) file name. */
export function buildRecordingFileName(
  roomCode: string,
  mimeType: string,
  date: Date = new Date()
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const safeCode = (roomCode || 'meeting').replace(/[^a-zA-Z0-9-_]/g, '') || 'meeting';
  const ext = extensionForMimeType(mimeType);
  return `PikMeeting_${safeCode}_${y}${mo}${d}_${h}${mi}.${ext}`;
}

// --------------------------------- saved-folder preference ---------------------------------

const RECORDING_DIR_KEY = 'pikmeeting.recordingSaveDir';

export function getStoredRecordingDir(): string | null {
  try {
    return localStorage.getItem(RECORDING_DIR_KEY);
  } catch {
    return null;
  }
}

export function setStoredRecordingDir(dir: string): void {
  try {
    localStorage.setItem(RECORDING_DIR_KEY, dir);
  } catch {
    // ignore quota/availability errors — folder just won't be remembered
  }
}

/** Stored folder if the user has picked one before, else the app default (Electron only). */
export async function getEffectiveRecordingDir(): Promise<string | null> {
  const stored = getStoredRecordingDir();
  if (stored) return stored;
  try {
    return (await window.electronAPI?.getDefaultRecordingFolder()) ?? null;
  } catch {
    return null;
  }
}

// --------------------------------- audio mixing ---------------------------------

export type MixablePeer = { peerId: string; stream: MediaStream };

/**
 * Mixes the local microphone + every peer's incoming audio into a single
 * MediaStreamAudioDestinationNode output. Membership is updated live via
 * updatePeers()/setLocalStream() so participants joining/leaving mid-recording
 * (or a mic switch) are reflected without restarting the recording. A track
 * that is `enabled = false` (muted) already renders as silence through
 * WebAudio, so mute state needs no special-casing here.
 */
export class AudioMixer {
  private ctx: AudioContext;
  private dest: MediaStreamAudioDestinationNode;
  private localStream: MediaStream | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private peerSources = new Map<string, { stream: MediaStream; source: MediaStreamAudioSourceNode }>();

  constructor() {
    const AudioCtxClass: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtxClass();
    this.dest = this.ctx.createMediaStreamDestination();
    void this.ctx.resume().catch(() => {
      // best-effort — if suspended, connected nodes just stay silent until it resumes
    });
  }

  get outputStream(): MediaStream {
    return this.dest.stream;
  }

  setLocalStream(stream: MediaStream | null): void {
    if (this.localStream === stream) return;
    if (this.localSource) {
      try {
        this.localSource.disconnect();
      } catch {
        // already disconnected
      }
      this.localSource = null;
    }
    this.localStream = stream;
    if (stream && stream.getAudioTracks().length > 0) {
      try {
        this.localSource = this.ctx.createMediaStreamSource(stream);
        this.localSource.connect(this.dest);
      } catch (err) {
        console.error('[recorder] failed to connect local audio', err);
      }
    }
  }

  updatePeers(peers: MixablePeer[]): void {
    const currentIds = new Set(peers.map((p) => p.peerId));
    for (const [peerId, entry] of this.peerSources) {
      if (!currentIds.has(peerId)) {
        try {
          entry.source.disconnect();
        } catch {
          // already disconnected
        }
        this.peerSources.delete(peerId);
      }
    }
    for (const p of peers) {
      const existing = this.peerSources.get(p.peerId);
      if (existing) {
        if (existing.stream === p.stream) continue; // already wired to this exact stream
        try {
          existing.source.disconnect();
        } catch {
          // already disconnected
        }
        this.peerSources.delete(p.peerId);
      }
      if (p.stream.getAudioTracks().length === 0) continue; // audio track not present yet
      try {
        const source = this.ctx.createMediaStreamSource(p.stream);
        source.connect(this.dest);
        this.peerSources.set(p.peerId, { stream: p.stream, source });
      } catch (err) {
        console.error('[recorder] failed to connect peer audio', p.peerId, err);
      }
    }
  }

  close(): void {
    try {
      this.localSource?.disconnect();
    } catch {
      // ignore
    }
    for (const entry of this.peerSources.values()) {
      try {
        entry.source.disconnect();
      } catch {
        // ignore
      }
    }
    this.peerSources.clear();
    this.localSource = null;
    this.localStream = null;
    try {
      void this.ctx.close();
    } catch {
      // ignore
    }
  }
}

// --------------------------------- annotated video compositor ---------------------------------

function waitForVideoDimensions(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth && video.videoHeight) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('resize', onReady);
      resolve();
    };
    const onReady = () => {
      if (video.videoWidth && video.videoHeight) done();
    };
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('resize', onReady);
    // Safety timeout — never let a stuck stream hang recording start forever.
    setTimeout(done, 3000);
  });
}

export type CompositorOptions = {
  /** The shared-screen video track to render (self or a peer's — same track object). */
  sourceTrack: MediaStreamTrack;
  hub: AnnotationHub;
  /** Owner key into the AnnotationHub for this screen (myId for self, peerId for a peer). */
  ownerId: string;
  /** Frames per second for the composite canvas. 15-24 recommended. */
  fps?: number;
  /** Downscale if the source is wider than this (aspect ratio preserved). */
  maxWidth?: number;
};

/**
 * Draws the shared screen + its live annotations onto an offscreen canvas at
 * a fixed interval, and exposes the canvas as a MediaStreamTrack via
 * captureStream(). Always renders the FULL source resolution — the on-screen
 * zoom/pan controls are a per-viewer convenience and must never affect what
 * gets recorded.
 *
 * Only ever instantiated while a recording with video is active; the render
 * loop is torn down in stop() so it never runs otherwise.
 */
export class AnnotationCompositor {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sourceStream: MediaStream;
  private hub: AnnotationHub;
  private ownerId: string;
  private fps: number;
  private maxWidth: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(opts: CompositorOptions) {
    this.hub = opts.hub;
    this.ownerId = opts.ownerId;
    this.fps = opts.fps ?? 20;
    this.maxWidth = opts.maxWidth ?? 2560;

    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    // Same track, second container — does not disturb the tile that's already
    // rendering it on screen.
    this.sourceStream = new MediaStream([opts.sourceTrack]);
    this.video.srcObject = this.sourceStream;

    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  /** Starts the render loop and returns the composited video track. */
  async start(): Promise<MediaStreamTrack> {
    await this.video.play().catch((err) => {
      console.warn('[recorder] compositor source video play() rejected', err);
    });
    await waitForVideoDimensions(this.video);

    const vw = this.video.videoWidth || 1280;
    const vh = this.video.videoHeight || 720;
    const scale = vw > this.maxWidth ? this.maxWidth / vw : 1;
    this.canvas.width = Math.max(2, Math.round(vw * scale));
    this.canvas.height = Math.max(2, Math.round(vh * scale));

    this.running = true;
    this.renderFrame();
    this.timer = setInterval(() => this.renderFrame(), 1000 / this.fps);

    const captureStream = (
      this.canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }
    ).captureStream;
    if (typeof captureStream !== 'function') {
      throw new Error('canvas.captureStream unsupported');
    }
    const outStream = captureStream.call(this.canvas, this.fps);
    const track = outStream.getVideoTracks()[0];
    if (!track) throw new Error('captureStream produced no video track');
    return track;
  }

  private renderFrame(): void {
    if (!this.running) return;
    const { ctx, canvas, video } = this;
    const W = canvas.width;
    const H = canvas.height;
    try {
      ctx.drawImage(video, 0, 0, W, H);
    } catch (err) {
      console.warn('[recorder] compositor drawImage failed', err);
      return;
    }
    // Full-bleed rect — recording has no letterbox and never applies the
    // viewer's zoom/pan, so offX/offY are always 0 here (see getContentRect()
    // in lib/annotations.ts for the live, letterbox-aware counterpart).
    const rect: ContentRect = { W, H, offX: 0, offY: 0, dispW: W, dispH: H };
    const owner = this.hub.getOwner(this.ownerId);
    const now = Date.now();
    for (const stroke of owner.strokes.values()) {
      drawStroke(ctx, stroke.points, getPeerColor(stroke.peerId), rect);
    }
    for (const shape of owner.shapes.values()) {
      drawShape(ctx, shape, getPeerColor(shape.peerId), rect);
    }
    for (const text of owner.texts.values()) {
      drawText(ctx, text, getPeerColor(text.peerId), rect);
    }
    for (const laser of owner.lasers.values()) {
      const age = now - laser.ts;
      if (age > LASER_FADE_MS) continue;
      drawLaser(ctx, laser, getPeerColor(laser.peerId), rect, 1 - age / LASER_FADE_MS);
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.video.pause();
    } catch {
      // ignore
    }
    this.video.srcObject = null;
  }
}

// --------------------------------- disk / download writers ---------------------------------

export type RecordingResult = {
  fileName: string;
  filePath?: string;
  /** Present only for the Electron writer. */
  openFolder?: () => void;
};

export type RecordingWriter = {
  write(chunk: Blob): Promise<void>;
  finish(): Promise<RecordingResult>;
  /** Best-effort cleanup when recording is aborted before finish(). */
  abort(): void;
};

export async function createElectronWriter(
  dir: string,
  fileName: string
): Promise<
  | { ok: true; writer: RecordingWriter }
  | { ok: false; error: 'permission' | 'unknown'; message: string }
> {
  const api = window.electronAPI;
  if (!api) return { ok: false, error: 'unknown', message: 'electronAPI unavailable' };
  const res = await api.startRecording(dir, fileName);
  if (!res.ok) return res;

  const writer: RecordingWriter = {
    async write(chunk: Blob) {
      const buf = await chunk.arrayBuffer();
      const r = await api.appendRecordingChunk(buf);
      if (!r.ok) throw new Error(r.message);
    },
    async finish() {
      const r = await api.stopRecording();
      if (!r.ok) throw new Error(r.message);
      return {
        fileName,
        filePath: r.filePath,
        openFolder: () => {
          api.openRecordingFolder(r.filePath).catch((err) => {
            console.error('[recording] open folder failed', err);
          });
        },
      };
    },
    abort() {
      api.stopRecording().catch(() => {
        // best-effort — main process handle is closed either way on next start
      });
    },
  };
  return { ok: true, writer };
}

/** Dev/browser fallback (no Electron IPC): buffers chunks in memory and downloads at the end. */
export function createBrowserWriter(fileName: string, mimeType: string): RecordingWriter {
  const chunks: Blob[] = [];
  return {
    async write(chunk: Blob) {
      chunks.push(chunk);
    },
    async finish() {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { fileName };
    },
    abort() {
      chunks.length = 0;
    },
  };
}

// --------------------------------- MediaRecorder orchestration ---------------------------------

export type RecordingStartOptions = {
  audioMixer: AudioMixer;
  videoTrack: MediaStreamTrack | null;
  writer: RecordingWriter;
  mimeType: string;
  timesliceMs?: number;
  /** Called at most once: on a chunk-write failure, MediaRecorder error, or finish() failure. */
  onError: (message: string) => void;
};

/**
 * Wraps a MediaRecorder + a RecordingWriter. Chunks are written through a
 * serialized queue so writes to disk never overlap/interleave. On any write
 * failure the underlying MediaRecorder is stopped immediately (no point
 * continuing to capture data we can no longer persist) and onError fires
 * exactly once; the caller (MeetingRoom) owns all further cleanup (mixer,
 * compositor, UI state) so this class stays focused on the recorder itself.
 */
export class MeetingRecorder {
  private recorder: MediaRecorder | null = null;
  private writer: RecordingWriter | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private failed = false;
  private onError: ((message: string) => void) | null = null;

  start(opts: RecordingStartOptions): { ok: true } | { ok: false; message: string } {
    const tracks: MediaStreamTrack[] = [];
    if (opts.videoTrack) tracks.push(opts.videoTrack);
    const audioTrack = opts.audioMixer.outputStream.getAudioTracks()[0];
    if (audioTrack) tracks.push(audioTrack);
    if (tracks.length === 0) {
      return { ok: false, message: 'no audio/video tracks to record' };
    }

    const stream = new MediaStream(tracks);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: opts.mimeType });
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    this.writer = opts.writer;
    this.onError = opts.onError;
    this.failed = false;
    this.writeChain = Promise.resolve();

    recorder.ondataavailable = (e: BlobEvent) => {
      if (!e.data || e.data.size === 0 || !this.writer || this.failed) return;
      const writer = this.writer;
      this.writeChain = this.writeChain
        .then(() => writer.write(e.data))
        .catch((err) => {
          if (this.failed) return;
          this.failed = true;
          console.error('[recorder] chunk write failed', err);
          try {
            recorder.stop();
          } catch {
            // already stopped
          }
          this.onError?.(err instanceof Error ? err.message : String(err));
        });
    };
    recorder.onerror = (e: Event) => {
      console.error('[recorder] MediaRecorder error', e);
      if (this.failed) return;
      this.failed = true;
      this.onError?.('MediaRecorder error');
    };

    this.recorder = recorder;
    recorder.start(opts.timesliceMs ?? 1000);
    return { ok: true };
  }

  /** User-initiated stop: flushes pending writes and finalizes via the writer. */
  async stop(): Promise<RecordingResult | null> {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder) return null;

    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        try {
          recorder.stop();
        } catch {
          resolve();
        }
      });
    }
    try {
      await this.writeChain;
    } catch {
      // already reported via onError
    }

    if (this.failed || !this.writer) return null;
    const writer = this.writer;
    this.writer = null;
    try {
      return await writer.finish();
    } catch (err) {
      console.error('[recorder] finish failed', err);
      this.onError?.(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /** Best-effort teardown without finishing the file (e.g. component unmount). */
  abort(): void {
    const recorder = this.recorder;
    this.recorder = null;
    try {
      recorder?.stop();
    } catch {
      // ignore
    }
    const writer = this.writer;
    this.writer = null;
    try {
      writer?.abort();
    } catch {
      // ignore
    }
  }
}
