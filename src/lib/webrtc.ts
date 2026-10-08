import { SignalingClient } from './signaling';
import { describeError, sendBugReport } from './bugReporter';
import { pickT } from '../i18n';

const STR = {
  ko: {
    defaultParticipant: '참가자',
    connectionClosed: '연결이 종료되었습니다',
    fileAssemblyFailed: '파일 조립 실패',
    fileTooLarge: (maxMb: number) => `파일 크기가 너무 큽니다 (최대 ${maxMb} MB)`,
    noConnectedPeers: '연결된 참가자가 없습니다',
  },
  en: {
    defaultParticipant: 'Participant',
    connectionClosed: 'Connection closed',
    fileAssemblyFailed: 'Failed to assemble file',
    fileTooLarge: (maxMb: number) => `File is too large (max ${maxMb} MB)`,
    noConnectedPeers: 'No connected participants',
  },
};

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type RemotePeer = {
  peerId: string;
  displayName: string;
  stream: MediaStream;
  muted: boolean;
};

export type ChatMessage = {
  from: string;
  fromName: string;
  ts: number;
  text?: string;
  file?: ChatFile;
};

export type ChatFile = {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** 0~100. Sender knows after their own send loop; receiver updates as bytes arrive. */
  progress: number;
  status: 'sending' | 'receiving' | 'done' | 'failed';
  /** Object URL valid for the lifetime of this session (revoked on leave). */
  blobUrl?: string;
  /** Human-readable reason populated when status === 'failed'. */
  failedReason?: string;
};

export type FileStartInfo = {
  id: string;
  from: string;
  fromName: string;
  name: string;
  size: number;
  mime: string;
};

type Callbacks = {
  onPeerUpdate: (peer: RemotePeer) => void;
  onPeerLeft: (peerId: string) => void;
  onSync: (validPeerIds: string[]) => void;
  onChat: (msg: ChatMessage) => void;
  onFileStart: (info: FileStartInfo) => void;
  onFileProgress: (info: { id: string; received: number; size: number }) => void;
  onFileComplete: (info: { id: string; blobUrl: string }) => void;
  onFileFailed: (info: { id: string; reason: string }) => void;
};

type PeerState = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  // Auto-recovery tracking
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  restartAttempts: number;
  closed: boolean;
  /** Delayed first restartIce() of the polite side (gives the impolite side a head start). */
  restartKickTimer: ReturnType<typeof setTimeout> | null;
  /** When the last restart attempt began (0 = none); used to coalesce duplicate triggers. */
  lastAttemptAt: number;
  /** When the current outage began (null = healthy); bounds the total retry time. */
  outageStartedAt: number | null;
  /** When the pc entered have-local-offer (null = not waiting for an answer). */
  localOfferSince: number | null;
  /** The 'webrtc-failed' report was already sent for this outage. */
  failureReported: boolean;
};

type IncomingFile = {
  id: string;
  peerId: string;
  name: string;
  size: number;
  mime: string;
  chunks: ArrayBuffer[];
  received: number;
};

const FILE_CHUNK_SIZE = 16 * 1024;          // 16 KB per chunk
const FILE_BACKPRESSURE_LIMIT = 1024 * 1024; // pause sending when buffer > 1 MB
const FILE_MAX_SIZE = 200 * 1024 * 1024;    // 200 MB cap

// ---- Auto-recovery (ICE restart) tuning ----
// The polite side waits this long before its FIRST restartIce() so the impolite
// side usually restarts first and the two offers don't collide (Perfect
// Negotiation resolves a collision anyway; this just avoids needless churn).
const RESTART_POLITE_FIRST_DELAY_MS = 2000;
// Interval between retries: 6s, 9s, 13.5s, 20s, then capped at 30s.
const RESTART_RETRY_BASE_MS = 6000;
const RESTART_RETRY_GROWTH = 1.5;
const RESTART_RETRY_MAX_MS = 30000;
// Retries continue for as long as the signaling server still lists the peer
// (peer-left / sync remove it). This is only a runaway safety net.
const RESTART_GIVE_UP_MS = 5 * 60 * 1000;
// 'failed' arrives on both connectionState and iceConnectionState back to back;
// restart triggers closer together than this count as one attempt.
const RESTART_COALESCE_MS = 1500;
// An offer unanswered for this long is presumed lost (e.g. sent while the
// signaling socket was down — SignalingClient.send() drops silently then).
const STALE_LOCAL_OFFER_MS = 5000;

function restartRetryDelay(attempt: number): number {
  return Math.min(
    RESTART_RETRY_BASE_MS * RESTART_RETRY_GROWTH ** (attempt - 1),
    RESTART_RETRY_MAX_MS
  );
}

export class MeshConnection {
  private states = new Map<string, PeerState>();
  private remoteStreams = new Map<string, MediaStream>();
  private displayNames = new Map<string, string>();
  private screenSenders = new Map<string, RTCRtpSender>();
  private muteStates = new Map<string, boolean>();
  private currentMuted = false;
  // Active screen-share stream, kept so late-joining peers also receive it.
  private localScreenStream: MediaStream | null = null;
  private dataChannels = new Map<string, RTCDataChannel>();
  private incomingFiles = new Map<string, IncomingFile>();
  private peerActiveFile = new Map<string, string>(); // peerId -> file id currently being received

  constructor(
    private localStream: MediaStream,
    private signaling: SignalingClient,
    private myId: string,
    _myName: string,
    private cb: Callbacks,
    private iceServers: RTCIceServer[] = FALLBACK_ICE_SERVERS
  ) {
    this.bindSignaling();
  }

  private bindSignaling() {
    // When the signaling socket transparently reconnects (e.g. after an idle
    // drop on a corporate network), rebuild media paths to every peer via ICE
    // restart so audio/screen recover without the user having to rejoin.
    this.signaling.onReconnect(() => {
      // When our old socket closed, the server told everyone else `peer-left`,
      // so they have already torn down their side of each connection. Restarting
      // ICE on our stale PCs would offer old DTLS state to peers that now hold
      // fresh ones, and the handshake cannot line up — that is the reconnect
      // failure seen in the field. Drop ours instead: the `peers` reply to our
      // re-hello then rebuilds every connection through the normal join path,
      // the same one each participant takes on entering (screen share included,
      // via the late-joiner branch in createPc).
      console.log('[webrtc] signaling reconnected → rebuilding all peer connections');
      for (const peerId of Array.from(this.states.keys())) {
        this.closePeer(peerId);
      }
    });

    this.signaling.on('peers', (msg) => {
      console.log('[webrtc] received peers list:', msg.peers);
      for (const p of msg.peers) {
        if (p.peerId !== this.myId && !this.states.has(p.peerId)) {
          this.displayNames.set(p.peerId, p.displayName);
          this.createPc(p.peerId);
          this.sendMuteStateTo(p.peerId);
        }
      }
    });

    this.signaling.on('peer-joined', (msg) => {
      console.log('[webrtc] peer-joined:', msg.peerId, msg.displayName);
      this.displayNames.set(msg.peerId, msg.displayName);
      this.sendMuteStateTo(msg.peerId);
      // Update peer UI if stream already created (race: offer arrived before peer-joined)
      const stream = this.remoteStreams.get(msg.peerId);
      if (stream) {
        this.cb.onPeerUpdate({
          peerId: msg.peerId,
          displayName: msg.displayName,
          stream,
          muted: this.muteStates.get(msg.peerId) ?? false,
        });
      }
    });

    this.signaling.on('peer-left', (msg) => {
      console.log('[webrtc] peer-left:', msg.peerId);
      this.closePeer(msg.peerId);
      this.displayNames.delete(msg.peerId);
    });

    this.signaling.on('sync', (msg) => {
      console.log('[webrtc] sync received:', msg.peers.map((p) => p.peerId));
      const currentIds = msg.peers.map((p) => p.peerId);
      const currentIdsSet = new Set(currentIds);
      // Remove peers no longer in server's list
      for (const peerId of Array.from(this.states.keys())) {
        if (!currentIdsSet.has(peerId)) {
          console.log('[webrtc] sync: removing stale peer', peerId);
          this.closePeer(peerId);
        }
      }
      // Update display names
      for (const p of msg.peers) {
        if (p.peerId !== this.myId) {
          this.displayNames.set(p.peerId, p.displayName);
        }
      }
      // Force UI to drop any peer not in server's authoritative list
      this.cb.onSync(currentIds);
    });

    this.signaling.on('offer', async (msg) => {
      if (msg.to !== this.myId) return;
      let state = this.states.get(msg.from);
      if (!state) {
        this.createPc(msg.from);
        state = this.states.get(msg.from)!;
      }
      const { pc } = state;

      const readyForOffer =
        !state.makingOffer &&
        (pc.signalingState === 'stable' || state.isSettingRemoteAnswerPending);
      const offerCollision = !readyForOffer;

      if (!state.polite && offerCollision) {
        console.log('[webrtc] impolite peer ignoring offer from', msg.from);
        return;
      }

      try {
        console.log('[webrtc] applying offer from', msg.from, 'collision:', offerCollision);
        await pc.setRemoteDescription(msg.sdp);
        await pc.setLocalDescription();
        this.signaling.send({
          type: 'answer',
          from: this.myId,
          to: msg.from,
          sdp: pc.localDescription!,
        });
        console.log('[webrtc] sent answer to', msg.from);
      } catch (err) {
        console.error('[webrtc] offer handling error', err);
      }
    });

    this.signaling.on('answer', async (msg) => {
      if (msg.to !== this.myId) return;
      const state = this.states.get(msg.from);
      if (!state) return;
      try {
        console.log('[webrtc] applying answer from', msg.from);
        state.isSettingRemoteAnswerPending = true;
        await state.pc.setRemoteDescription(msg.sdp);
      } catch (err) {
        console.error('[webrtc] answer handling error', err);
      } finally {
        state.isSettingRemoteAnswerPending = false;
      }
    });

    this.signaling.on('ice', async (msg) => {
      if (msg.to !== this.myId) return;
      const state = this.states.get(msg.from);
      if (!state) return;
      try {
        await state.pc.addIceCandidate(msg.candidate);
      } catch {
        // ignore late candidates
      }
    });

    this.signaling.on('screen-stop', (msg) => {
      if (msg.to !== this.myId) return;
      console.log('[webrtc] screen-stop from', msg.from);
      const stream = this.remoteStreams.get(msg.from);
      if (stream) {
        for (const track of stream.getVideoTracks()) {
          stream.removeTrack(track);
        }
        this.cb.onPeerUpdate({
          peerId: msg.from,
          displayName: this.displayNames.get(msg.from) ?? pickT(STR).defaultParticipant,
          stream,
          muted: this.muteStates.get(msg.from) ?? false,
        });
      }
    });

    this.signaling.on('mute-state', (msg) => {
      if (msg.to !== this.myId) return;
      console.log('[webrtc] mute-state from', msg.from, 'muted:', msg.muted);
      this.muteStates.set(msg.from, msg.muted);
      const stream = this.remoteStreams.get(msg.from);
      if (stream) {
        this.cb.onPeerUpdate({
          peerId: msg.from,
          displayName: this.displayNames.get(msg.from) ?? pickT(STR).defaultParticipant,
          stream,
          muted: msg.muted,
        });
      }
    });

    this.signaling.on('chat', (msg) => {
      if (msg.from === this.myId) return;
      this.cb.onChat({
        from: msg.from,
        fromName: msg.fromName,
        text: msg.text,
        ts: msg.ts,
      });
    });
  }

  sendChat(text: string, myName: string) {
    this.signaling.send({
      type: 'chat',
      from: this.myId,
      fromName: myName,
      text,
      ts: Date.now(),
    });
  }

  async replaceAudioTrack(newTrack: MediaStreamTrack) {
    this.localStream = new MediaStream([
      newTrack,
      ...this.localStream.getVideoTracks(),
    ]);
    for (const [peerId, state] of this.states) {
      const senders = state.pc.getSenders();
      for (const sender of senders) {
        if (sender.track?.kind === 'audio') {
          try {
            await sender.replaceTrack(newTrack);
          } catch (err) {
            console.error('[webrtc] replaceTrack failed for', peerId, err);
          }
          break;
        }
      }
    }
  }

  private sendMuteStateTo(peerId: string) {
    this.signaling.send({
      type: 'mute-state',
      from: this.myId,
      to: peerId,
      muted: this.currentMuted,
    });
  }

  setMuted(muted: boolean) {
    this.currentMuted = muted;
    for (const peerId of this.states.keys()) {
      this.sendMuteStateTo(peerId);
    }
  }

  private createPc(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const polite = this.myId < peerId;
    const state: PeerState = {
      pc,
      polite,
      makingOffer: false,
      isSettingRemoteAnswerPending: false,
      disconnectTimer: null,
      restartAttempts: 0,
      closed: false,
      restartKickTimer: null,
      lastAttemptAt: 0,
      outageStartedAt: null,
      localOfferSince: null,
      failureReported: false,
    };
    this.states.set(peerId, state);
    console.log('[webrtc] created pc for', peerId, 'polite:', polite);

    // Only the impolite peer creates the data channel; polite peer receives it
    // via ondatachannel. This avoids both sides creating duplicates.
    if (!polite) {
      try {
        const dc = pc.createDataChannel('files', { ordered: true });
        this.setupDataChannel(dc, peerId);
      } catch (err) {
        console.warn('[webrtc] createDataChannel failed', peerId, err);
      }
    }
    pc.ondatachannel = (e) => {
      this.setupDataChannel(e.channel, peerId);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.send({
          type: 'ice',
          from: this.myId,
          to: peerId,
          candidate: e.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (e) => {
      console.log('[webrtc] ontrack from', peerId, 'kind:', e.track.kind, 'id:', e.track.id);
      let stream = this.remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        this.remoteStreams.set(peerId, stream);
      }
      if (!stream.getTracks().includes(e.track)) {
        stream.addTrack(e.track);
      }

      e.track.addEventListener('ended', () => {
        console.log('[webrtc] track ended', peerId, e.track.kind);
        if (stream && stream.getTracks().includes(e.track)) {
          stream.removeTrack(e.track);
        }
        this.cb.onPeerUpdate({
          peerId,
          displayName: this.displayNames.get(peerId) ?? pickT(STR).defaultParticipant,
          stream: stream!,
          muted: this.muteStates.get(peerId) ?? false,
        });
      });

      this.cb.onPeerUpdate({
        peerId,
        displayName: this.displayNames.get(peerId) ?? pickT(STR).defaultParticipant,
        stream,
        muted: this.muteStates.get(peerId) ?? false,
      });
    };

    pc.onconnectionstatechange = () => {
      console.log('[webrtc] connection state', peerId, pc.connectionState);
      const st = this.states.get(peerId);
      if (!st) return;

      switch (pc.connectionState) {
        case 'connected':
          // Recovered (or first connect). Clear recovery state.
          if (st.disconnectTimer) {
            clearTimeout(st.disconnectTimer);
            st.disconnectTimer = null;
          }
          if (st.restartKickTimer) {
            clearTimeout(st.restartKickTimer);
            st.restartKickTimer = null;
          }
          st.restartAttempts = 0;
          st.outageStartedAt = null;
          st.lastAttemptAt = 0;
          st.failureReported = false;
          break;

        case 'disconnected':
          // Often a transient network blip — give it a few seconds to self-heal
          // before forcing an ICE restart.
          if (!st.disconnectTimer) {
            st.disconnectTimer = setTimeout(() => {
              st.disconnectTimer = null;
              const cs = st.pc.connectionState;
              if (cs !== 'connected' && cs !== 'closed') {
                this.attemptRestart(peerId);
              }
            }, 4000);
          }
          break;

        case 'failed':
          // Connection broke — try to recover via ICE restart instead of giving up.
          // Retries can now go on for minutes, so report once per outage, not once
          // per 'failed' transition (the server store is capped).
          if (!st.failureReported) {
            st.failureReported = true;
            void this.reportConnectionFailure(peerId, pc);
          }
          this.attemptRestart(peerId);
          break;

        case 'closed':
          this.closePeer(peerId);
          break;
      }
    };

    // ICE-level monitoring as a second signal (some browsers fire this earlier).
    pc.oniceconnectionstatechange = () => {
      const st = this.states.get(peerId);
      if (!st) return;
      if (pc.iceConnectionState === 'failed') {
        console.log('[webrtc] ICE failed for', peerId, '→ attempting restart');
        this.attemptRestart(peerId);
      }
    };

    pc.onsignalingstatechange = () => {
      console.log('[webrtc] signaling state', peerId, pc.signalingState);
      // Remember when we started waiting for an answer, so a lost offer can be
      // told apart from one that is merely in flight (see kickIceRestart).
      state.localOfferSince = pc.signalingState === 'have-local-offer' ? Date.now() : null;
    };

    pc.onnegotiationneeded = async () => {
      try {
        console.log('[webrtc] negotiationneeded for', peerId);
        state.makingOffer = true;
        await pc.setLocalDescription();
        this.signaling.send({
          type: 'offer',
          from: this.myId,
          to: peerId,
          sdp: pc.localDescription!,
        });
        console.log('[webrtc] sent offer to', peerId);
      } catch (err) {
        console.error('[webrtc] negotiationneeded error', err);
      } finally {
        state.makingOffer = false;
      }
    };

    for (const track of this.localStream.getTracks()) {
      pc.addTrack(track, this.localStream);
    }

    // If a screen share is already in progress, send it to this (late-joining) peer too.
    if (this.localScreenStream) {
      const screenTrack = this.localScreenStream.getVideoTracks()[0];
      if (screenTrack) {
        try {
          const sender = pc.addTrack(screenTrack, this.localScreenStream);
          this.screenSenders.set(peerId, sender);
          console.log('[webrtc] added in-progress screen track to late joiner', peerId);
        } catch (err) {
          console.error('[webrtc] addTrack screen (late joiner) failed for', peerId, err);
        }
      }
    }

    return pc;
  }

  private setupDataChannel(dc: RTCDataChannel, peerId: string) {
    dc.binaryType = 'arraybuffer';
    this.dataChannels.set(peerId, dc);

    dc.onopen = () => {
      console.log('[dc] open with', peerId);
    };
    dc.onclose = () => {
      console.log('[dc] close with', peerId);
      this.dataChannels.delete(peerId);
      const activeFileId = this.peerActiveFile.get(peerId);
      if (activeFileId) {
        const incoming = this.incomingFiles.get(activeFileId);
        this.reportFileTransferFailure('receive-closed', undefined, incoming?.size, peerId);
        this.cb.onFileFailed({ id: activeFileId, reason: pickT(STR).connectionClosed });
        this.incomingFiles.delete(activeFileId);
        this.peerActiveFile.delete(peerId);
      }
    };
    dc.onerror = (e) => {
      console.warn('[dc] error', peerId, e);
    };
    dc.onmessage = (e) => {
      this.handleDataMessage(peerId, e.data);
    };
  }

  private handleDataMessage(peerId: string, data: ArrayBuffer | string) {
    if (typeof data === 'string') {
      let msg: { type?: string; id?: string; name?: string; size?: number; mime?: string };
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (
        msg.type === 'file-meta' &&
        msg.id &&
        msg.name &&
        typeof msg.size === 'number'
      ) {
        const fromName = this.displayNames.get(peerId) ?? pickT(STR).defaultParticipant;
        const mime = msg.mime || 'application/octet-stream';
        this.incomingFiles.set(msg.id, {
          id: msg.id,
          peerId,
          name: msg.name,
          size: msg.size,
          mime,
          chunks: [],
          received: 0,
        });
        this.peerActiveFile.set(peerId, msg.id);
        this.cb.onFileStart({
          id: msg.id,
          from: peerId,
          fromName,
          name: msg.name,
          size: msg.size,
          mime,
        });
      } else if (msg.type === 'file-end' && msg.id) {
        const state = this.incomingFiles.get(msg.id);
        if (state) {
          try {
            const blob = new Blob(state.chunks, { type: state.mime });
            const url = URL.createObjectURL(blob);
            this.cb.onFileComplete({ id: msg.id, blobUrl: url });
          } catch (err) {
            console.error('[dc] blob assembly failed', err);
            this.reportFileTransferFailure('receive-assemble', err, state.size, peerId);
            this.cb.onFileFailed({ id: msg.id, reason: pickT(STR).fileAssemblyFailed });
          }
          this.incomingFiles.delete(msg.id);
          if (this.peerActiveFile.get(peerId) === msg.id) {
            this.peerActiveFile.delete(peerId);
          }
        }
      }
    } else if (data instanceof ArrayBuffer) {
      const fileId = this.peerActiveFile.get(peerId);
      if (!fileId) return;
      const state = this.incomingFiles.get(fileId);
      if (!state) return;
      state.chunks.push(data);
      state.received += data.byteLength;
      this.cb.onFileProgress({
        id: fileId,
        received: state.received,
        size: state.size,
      });
    }
  }

  async sendFile(
    file: File,
    id: string,
    onProgress?: (sent: number, total: number) => void
  ): Promise<void> {
    if (file.size > FILE_MAX_SIZE) {
      throw new Error(pickT(STR).fileTooLarge(FILE_MAX_SIZE / 1024 / 1024));
    }
    const channels = Array.from(this.dataChannels.values()).filter(
      (dc) => dc.readyState === 'open'
    );
    if (channels.length === 0) {
      throw new Error(pickT(STR).noConnectedPeers);
    }

    // The two checks above are user-level rejections (not failures worth a
    // report). Anything thrown while actually transferring is reported.
    try {
      await this.streamFile(file, id, channels, onProgress);
    } catch (err) {
      this.reportFileTransferFailure('send', err, file.size);
      throw err;
    }
  }

  private async streamFile(
    file: File,
    id: string,
    channels: RTCDataChannel[],
    onProgress?: (sent: number, total: number) => void
  ): Promise<void> {
    let chunkFailureReported = false;
    const meta = JSON.stringify({
      type: 'file-meta',
      id,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    });
    for (const dc of channels) {
      dc.send(meta);
    }

    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + FILE_CHUNK_SIZE, file.size);
      const buf = await file.slice(offset, end).arrayBuffer();

      for (const dc of channels) {
        if (dc.readyState !== 'open') continue;
        // Wait for buffer to drain to avoid runaway memory.
        while (dc.readyState === 'open' && dc.bufferedAmount > FILE_BACKPRESSURE_LIMIT) {
          await new Promise<void>((r) => setTimeout(r, 30));
        }
        try {
          dc.send(buf);
        } catch (err) {
          console.warn('[dc] send chunk failed', err);
          // Once per transfer: every remaining chunk would likely fail the same way.
          if (!chunkFailureReported) {
            chunkFailureReported = true;
            this.reportFileTransferFailure('send-chunk', err, file.size);
          }
        }
      }

      offset = end;
      onProgress?.(offset, file.size);
    }

    const endMsg = JSON.stringify({ type: 'file-end', id });
    for (const dc of channels) {
      if (dc.readyState === 'open') {
        try {
          dc.send(endMsg);
        } catch {
          // ignore
        }
      }
    }
  }

  private async reportConnectionFailure(
    peerId: string,
    pc: RTCPeerConnection
  ): Promise<void> {
    try {
      const candidates: string[] = [];
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (
          report.type === 'local-candidate' ||
          report.type === 'remote-candidate'
        ) {
          const r = report as RTCIceCandidatePairStats & {
            candidateType?: string;
          };
          if (r.candidateType) candidates.push(r.candidateType);
        }
      });
      const uniqueCandidates = Array.from(new Set(candidates));
      const hasRelay = uniqueCandidates.includes('relay');
      await sendBugReport({
        type: 'webrtc-failed',
        severity: 'critical',
        message: `WebRTC peer connection failed`,
        details: {
          peerIdHash: peerId.slice(0, 8),
          peerName: this.displayNames.get(peerId) ?? pickT(STR).defaultParticipant,
          iceState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          candidateTypes: uniqueCandidates,
          relayAvailable: hasRelay,
          totalPeers: this.states.size,
        },
      });
    } catch (err) {
      console.warn('[webrtc] failure report failed', err);
    }
  }

  /**
   * Report a failed file transfer. Deliberately carries no file name, only the
   * stage, a short path-free error text and the size. Throttled to one report
   * per minute by the type-level throttle in bugReporter.
   */
  private reportFileTransferFailure(
    stage: 'send' | 'send-chunk' | 'receive-closed' | 'receive-assemble',
    err: unknown,
    sizeBytes?: number,
    peerId?: string
  ): void {
    const e = err === undefined ? undefined : describeError(err);
    void sendBugReport({
      type: 'file-transfer-failed',
      severity: 'warning',
      message: 'File transfer failed',
      details: {
        stage,
        errorName: e?.name,
        error: e?.message,
        sizeMB: sizeBytes === undefined ? undefined : Math.round(sizeBytes / 1024 / 102.4) / 10,
        peerIdHash: peerId?.slice(0, 8),
        totalPeers: this.states.size,
      },
    });
  }

  /**
   * Try to recover a broken/dropped connection without making the user leave
   * and rejoin. Uses ICE restart (re-gathers network paths).
   *
   * BOTH sides restart. Earlier only the impolite side did, so the peer with the
   * smaller id (polite towards everyone) could never recover on its own. Doing it
   * from both ends is safe because the offer handler implements Perfect
   * Negotiation: colliding offers are resolved there (the polite side yields via
   * implicit rollback, the impolite side ignores the polite side's offer). To
   * reduce collisions the polite side delays only its FIRST restart a little.
   *
   * Retries keep going — with growing intervals up to a cap — for as long as the
   * peer still has a PeerState, i.e. until the server says the peer is gone
   * (peer-left / sync → closePeer). RESTART_GIVE_UP_MS is only a runaway guard.
   *
   * A signaling reconnect does not come through here — onReconnect rebuilds
   * every connection instead, because the far side has already dropped its own.
   */
  private attemptRestart(peerId: string) {
    const state = this.states.get(peerId);
    if (!state || state.closed) return;

    const cs = state.pc.connectionState;
    if (cs === 'connected') {
      state.restartAttempts = 0;
      state.outageStartedAt = null;
      return;
    }

    const now = Date.now();
    // 'failed' is signalled on connectionState AND iceConnectionState, plus the
    // disconnect timer may fire alongside: count those as a single attempt.
    if (now - state.lastAttemptAt < RESTART_COALESCE_MS) return;

    if (state.outageStartedAt === null) state.outageStartedAt = now;
    if (now - state.outageStartedAt >= RESTART_GIVE_UP_MS) {
      console.warn(
        '[webrtc] giving up on peer after',
        Math.round((now - state.outageStartedAt) / 1000),
        's of failed restarts',
        peerId
      );
      this.closePeer(peerId);
      return;
    }

    state.lastAttemptAt = now;
    state.restartAttempts += 1;
    const attempt = state.restartAttempts;
    const kickDelay = state.polite && attempt === 1 ? RESTART_POLITE_FIRST_DELAY_MS : 0;
    console.log(
      '[webrtc] ICE restart attempt',
      attempt,
      'for',
      peerId,
      'polite:',
      state.polite,
      'kick in',
      kickDelay,
      'ms'
    );

    if (state.restartKickTimer) {
      clearTimeout(state.restartKickTimer);
      state.restartKickTimer = null;
    }
    if (kickDelay > 0) {
      state.restartKickTimer = setTimeout(() => {
        state.restartKickTimer = null;
        void this.kickIceRestart(peerId, state);
      }, kickDelay);
    } else {
      void this.kickIceRestart(peerId, state);
    }

    // Re-check later; if still not connected, retry with a longer interval.
    if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
    state.disconnectTimer = setTimeout(() => {
      state.disconnectTimer = null;
      const s = this.states.get(peerId);
      if (!s || s.closed) return;
      const now = s.pc.connectionState;
      if (now === 'connected') {
        s.restartAttempts = 0;
        s.outageStartedAt = null;
        return;
      }
      this.attemptRestart(peerId);
    }, kickDelay + restartRetryDelay(attempt));
  }

  /**
   * The actual restartIce(). restartIce() flags the next negotiation to
   * regenerate ICE credentials → onnegotiationneeded fires → a new offer goes
   * out through the existing (unchanged) negotiation path.
   */
  private async kickIceRestart(peerId: string, state: PeerState): Promise<void> {
    if (state.closed || this.states.get(peerId) !== state) return;
    const pc = state.pc;

    // Nothing to do if it recovered meanwhile, or an ICE restart (ours or the
    // other side's) is already being checked — restarting again every few
    // seconds could keep a slow link from ever finishing. A stuck check ends in
    // 'failed', which triggers the next attempt.
    const cs = pc.connectionState;
    if (cs === 'connected' || cs === 'connecting' || cs === 'closed') {
      console.log('[webrtc] skip restartIce for', peerId, '— connection state', cs);
      // A skipped attempt must not swallow a real 'failed' event that follows.
      state.lastAttemptAt = 0;
      return;
    }

    // An earlier restart offer that never got an answer (dropped in transit, or
    // the other side was busy) leaves the pc in have-local-offer, and
    // restartIce() alone cannot produce a new offer from there. Roll the stale
    // offer back first. Never while an offer is being created or an answer is
    // being applied.
    const offerAgeMs = state.localOfferSince === null ? 0 : Date.now() - state.localOfferSince;
    const offerStale =
      pc.signalingState === 'have-local-offer' &&
      !state.makingOffer &&
      !state.isSettingRemoteAnswerPending &&
      offerAgeMs >= STALE_LOCAL_OFFER_MS;
    if (offerStale) {
      try {
        console.log('[webrtc] rolling back unanswered offer to', peerId, 'age ms:', offerAgeMs);
        await pc.setLocalDescription({ type: 'rollback' });
      } catch (err) {
        console.error('[webrtc] rollback of stale offer failed for', peerId, err);
      }
      if (state.closed || this.states.get(peerId) !== state) return;
    }

    try {
      pc.restartIce();
    } catch (err) {
      console.error('[webrtc] restartIce failed for', peerId, err);
    }
  }

  private closePeer(peerId: string) {
    const state = this.states.get(peerId);
    if (state) {
      state.closed = true;
      if (state.disconnectTimer) {
        clearTimeout(state.disconnectTimer);
        state.disconnectTimer = null;
      }
      if (state.restartKickTimer) {
        clearTimeout(state.restartKickTimer);
        state.restartKickTimer = null;
      }
      state.pc.close();
      this.states.delete(peerId);
      this.remoteStreams.delete(peerId);
      this.screenSenders.delete(peerId);
      this.muteStates.delete(peerId);
      this.dataChannels.delete(peerId);
      const activeFileId = this.peerActiveFile.get(peerId);
      if (activeFileId) {
        this.incomingFiles.delete(activeFileId);
        this.peerActiveFile.delete(peerId);
      }
      this.cb.onPeerLeft(peerId);
    }
  }

  async startScreenShare(stream: MediaStream) {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;

    // Remember the active screen stream so peers who join later also get it.
    this.localScreenStream = stream;

    // When the user stops sharing via the OS, clear our reference too.
    videoTrack.addEventListener('ended', () => {
      if (this.localScreenStream === stream) {
        this.localScreenStream = null;
      }
    });

    console.log('[webrtc] startScreenShare across', this.states.size, 'peers');
    for (const [peerId, state] of this.states) {
      // Skip peers that somehow already have a screen sender.
      if (this.screenSenders.has(peerId)) continue;
      try {
        const sender = state.pc.addTrack(videoTrack, stream);
        this.screenSenders.set(peerId, sender);
        console.log('[webrtc] added screen track to', peerId);
      } catch (err) {
        console.error('[webrtc] addTrack screen failed for', peerId, err);
      }
    }
  }

  async stopScreenShare() {
    console.log('[webrtc] stopScreenShare');
    this.localScreenStream = null;
    for (const [peerId, sender] of this.screenSenders) {
      const state = this.states.get(peerId);
      if (!state) continue;
      try {
        state.pc.removeTrack(sender);
      } catch {
        // peer already gone
      }
      this.signaling.send({
        type: 'screen-stop',
        from: this.myId,
        to: peerId,
      });
    }
    this.screenSenders.clear();
  }

  close() {
    for (const state of this.states.values()) {
      // Retries can now run for minutes: make sure no timer outlives the meeting.
      state.closed = true;
      if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
      if (state.restartKickTimer) clearTimeout(state.restartKickTimer);
      state.disconnectTimer = null;
      state.restartKickTimer = null;
      state.pc.close();
    }
    this.states.clear();
    this.remoteStreams.clear();
    this.screenSenders.clear();
    this.displayNames.clear();
    this.muteStates.clear();
    this.dataChannels.clear();
    this.incomingFiles.clear();
    this.peerActiveFile.clear();
  }
}
