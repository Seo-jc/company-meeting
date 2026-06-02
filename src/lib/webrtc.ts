import { SignalingClient } from './signaling';

const ICE_SERVERS: RTCIceServer[] = [
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
  text: string;
  ts: number;
};

type Callbacks = {
  onPeerUpdate: (peer: RemotePeer) => void;
  onPeerLeft: (peerId: string) => void;
  onSync: (validPeerIds: string[]) => void;
  onChat: (msg: ChatMessage) => void;
};

type PeerState = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
};

export class MeshConnection {
  private states = new Map<string, PeerState>();
  private remoteStreams = new Map<string, MediaStream>();
  private displayNames = new Map<string, string>();
  private screenSenders = new Map<string, RTCRtpSender>();
  private muteStates = new Map<string, boolean>();
  private currentMuted = false;

  constructor(
    private localStream: MediaStream,
    private signaling: SignalingClient,
    private myId: string,
    _myName: string,
    private cb: Callbacks
  ) {
    this.bindSignaling();
  }

  private bindSignaling() {
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
          displayName: this.displayNames.get(msg.from) ?? '참가자',
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
          displayName: this.displayNames.get(msg.from) ?? '참가자',
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
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const polite = this.myId < peerId;
    const state: PeerState = {
      pc,
      polite,
      makingOffer: false,
      isSettingRemoteAnswerPending: false,
    };
    this.states.set(peerId, state);
    console.log('[webrtc] created pc for', peerId, 'polite:', polite);

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
          displayName: this.displayNames.get(peerId) ?? '참가자',
          stream: stream!,
          muted: this.muteStates.get(peerId) ?? false,
        });
      });

      this.cb.onPeerUpdate({
        peerId,
        displayName: this.displayNames.get(peerId) ?? '참가자',
        stream,
        muted: this.muteStates.get(peerId) ?? false,
      });
    };

    pc.onconnectionstatechange = () => {
      console.log('[webrtc] connection state', peerId, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closePeer(peerId);
      }
    };

    pc.onsignalingstatechange = () => {
      console.log('[webrtc] signaling state', peerId, pc.signalingState);
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

    return pc;
  }

  private closePeer(peerId: string) {
    const state = this.states.get(peerId);
    if (state) {
      state.pc.close();
      this.states.delete(peerId);
      this.remoteStreams.delete(peerId);
      this.screenSenders.delete(peerId);
      this.muteStates.delete(peerId);
      this.cb.onPeerLeft(peerId);
    }
  }

  async startScreenShare(stream: MediaStream) {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;

    console.log('[webrtc] startScreenShare across', this.states.size, 'peers');
    for (const [peerId, state] of this.states) {
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
    for (const state of this.states.values()) state.pc.close();
    this.states.clear();
    this.remoteStreams.clear();
    this.screenSenders.clear();
    this.displayNames.clear();
    this.muteStates.clear();
  }
}
