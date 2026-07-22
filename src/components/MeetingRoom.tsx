import { Fragment, ReactNode, useEffect, useRef, useState } from 'react';
import { SignalingClient } from '../lib/signaling';
import { ChatMessage, MeshConnection, RemotePeer } from '../lib/webrtc';
import {
  getMicrophone,
  getScreenShareBrowser,
  getScreenShareElectron,
  getSilentMicrophone,
} from '../lib/media';
import { getStoredMicId, getStoredSpeakerId } from './AudioDevices';
import SourcePicker from './SourcePicker';
import ChatPanel from './ChatPanel';
import ChatTab from './ChatTab';
import Logo from './Logo';
import AudioSettingsPopover from './AudioSettingsPopover';
import { useSpeakingDetection } from '../lib/speakingDetection';
import { getIceServers } from '../lib/turnCredentials';
import { useLang, useT } from '../i18n';

const STR = {
  ko: {
    errNoMic:
      '마이크를 찾을 수 없습니다. PC에 마이크가 연결되어 있는지, Windows 설정에서 앱의 마이크 접근이 허용되어 있는지 확인해 주세요.',
    errStaleMic: '이전에 선택한 마이크 장치를 찾을 수 없습니다. 마이크 설정을 다시 선택해 주세요.',
    errMicDenied:
      '마이크 접근이 거부되었습니다. Windows 설정에서 "데스크톱 앱이 마이크에 액세스하도록 허용"을 켠 후 다시 시도해 주세요.',
    errMicInUse:
      '마이크가 다른 프로그램에서 사용 중입니다. 다른 화상회의/녹음 프로그램을 종료한 후 다시 시도해 주세요.',
    errUnknownConnect: '연결에 실패했습니다',
    shareFailPrefix: '화면 공유 실패: ',
    noRecipients: '받을 사람이 없습니다. 다른 참가자가 입장한 후 다시 시도해 주세요.',
    unknownError: '알 수 없는 오류',
    errTitlePermission: '마이크 권한이 필요합니다',
    errTitleNoDevice: '마이크를 찾을 수 없습니다',
    errTitleInUse: '마이크가 사용 중입니다',
    errTitleNetwork: '서버 연결 실패',
    errTitleUnknown: '연결 실패',
    errHint: '설정에서 권한을 변경한 후 "다시 시도"를 눌러주세요.',
    errHintListen: '지금 듣기/채팅만 사용하실 수도 있습니다.',
    openMicSettings: 'Windows 마이크 설정 열기',
    retry: '다시 시도',
    joinListenOnly: '🎧 마이크 없이 입장 (듣기/채팅만)',
    backToLobby: '로비로 돌아가기',
    connecting: '회의에 연결 중...',
    allowMicHint: '마이크 권한을 허용해 주세요',
    roomCodeLabel: '회의 코드',
    clickToCopy: '클릭해서 복사',
    copied: '복사됨',
    copy: '복사',
    participantCount: (n: number) => `참가자 ${n}명`,
    listenOnlyBanner:
      '🎧 듣기 전용 모드 · 마이크 없이 입장하여 음성 발신은 불가하지만 다른 사람의 음성과 채팅은 정상적으로 이용 가능합니다.',
    dblClickExpand: '더블클릭으로 확대',
    zoomOutTip: '축소 (마우스 휠 아래로도 가능)',
    zoomOutAria: '축소',
    zoomResetTip: '원래 크기로 (100%)',
    zoomInTip: '확대 (마우스 휠 위로도 가능)',
    zoomInAria: '확대',
    audioDeviceSettings: '오디오 장치 설정',
    micNoSendTitle: '마이크가 없어 음성 발신이 불가합니다',
    unmute: '음소거 해제',
    mute: '음소거',
    noMic: '마이크 없음',
    shareStop: '화면 공유 중지',
    share: '화면 공유',
    shareStopLabel: '공유 중지',
    chatClose: '채팅 닫기',
    chatOpen: '채팅 열기',
    chat: '채팅',
    leave: '나가기',
    currentTimeTip: '현재 시간 · 회의 진행 시간',
    selfSuffix: '(나)',
    listenOnlyBadge: '듣기 전용',
    mutedBadge: '음소거',
    mySharingScreen: '내 화면 (공유 중)',
  },
  en: {
    errNoMic:
      'Microphone not found. Please check that a microphone is connected to your PC and that the app has microphone access in Windows Settings.',
    errStaleMic: 'The previously selected microphone could not be found. Please choose a microphone again.',
    errMicDenied:
      'Microphone access was denied. Please enable "Allow desktop apps to access your microphone" in Windows Settings, then try again.',
    errMicInUse:
      'The microphone is in use by another program. Please close other video call or recording apps and try again.',
    errUnknownConnect: 'Connection failed',
    shareFailPrefix: 'Screen share failed: ',
    noRecipients: 'No one to send to. Please try again after another participant joins.',
    unknownError: 'Unknown error',
    errTitlePermission: 'Microphone permission required',
    errTitleNoDevice: 'Microphone not found',
    errTitleInUse: 'Microphone is in use',
    errTitleNetwork: 'Server connection failed',
    errTitleUnknown: 'Connection failed',
    errHint: 'Please change the permission in Settings, then click "Retry".',
    errHintListen: 'You can also join now with listening/chat only.',
    openMicSettings: 'Open Windows microphone settings',
    retry: 'Retry',
    joinListenOnly: '🎧 Join without mic (listen/chat only)',
    backToLobby: 'Back to lobby',
    connecting: 'Connecting to meeting...',
    allowMicHint: 'Please allow microphone access',
    roomCodeLabel: 'Meeting code',
    clickToCopy: 'Click to copy',
    copied: 'Copied',
    copy: 'Copy',
    participantCount: (n: number) => `${n} participant${n === 1 ? '' : 's'}`,
    listenOnlyBanner:
      '🎧 Listen-only mode · You joined without a microphone so you cannot send audio, but you can still hear others and use chat normally.',
    dblClickExpand: 'Double-click to expand',
    zoomOutTip: 'Zoom out (mouse wheel down also works)',
    zoomOutAria: 'Zoom out',
    zoomResetTip: 'Reset to original size (100%)',
    zoomInTip: 'Zoom in (mouse wheel up also works)',
    zoomInAria: 'Zoom in',
    audioDeviceSettings: 'Audio device settings',
    micNoSendTitle: 'No microphone, so you cannot send audio',
    unmute: 'Unmute',
    mute: 'Mute',
    noMic: 'No mic',
    shareStop: 'Stop screen share',
    share: 'Share screen',
    shareStopLabel: 'Stop sharing',
    chatClose: 'Close chat',
    chatOpen: 'Open chat',
    chat: 'Chat',
    leave: 'Leave',
    currentTimeTip: 'Current time · Meeting duration',
    selfSuffix: '(You)',
    listenOnlyBadge: 'Listen only',
    mutedBadge: 'Muted',
    mySharingScreen: 'My screen (sharing)',
  },
};

type Props = {
  roomCode: string;
  displayName: string;
  meetingTitle?: string;
  onLeave: () => void;
};

type Status = 'connecting' | 'connected' | 'error';
type ErrorKind = 'permission' | 'no-device' | 'in-use' | 'network' | 'unknown';

const SELF_ID = '__self__';
const SCREEN_SELF_ID = '__screen_self__';

const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

function classifyError(
  e: unknown,
  t: (typeof STR)['ko']
): { kind: ErrorKind; msg: string } {
  if (e instanceof DOMException) {
    switch (e.name) {
      case 'NotFoundError':
        return {
          kind: 'no-device',
          msg: t.errNoMic,
        };
      case 'OverconstrainedError':
        return {
          kind: 'no-device',
          msg: t.errStaleMic,
        };
      case 'NotAllowedError':
      case 'SecurityError':
        return {
          kind: 'permission',
          msg: t.errMicDenied,
        };
      case 'NotReadableError':
      case 'TrackStartError':
        return {
          kind: 'in-use',
          msg: t.errMicInUse,
        };
    }
  }
  if (e instanceof Error) {
    if (e.message.includes('시그널링') || e.message.includes('signaling')) {
      return { kind: 'network', msg: e.message };
    }
    return { kind: 'unknown', msg: e.message };
  }
  return { kind: 'unknown', msg: t.errUnknownConnect };
}

export default function MeetingRoom({
  roomCode,
  displayName,
  meetingTitle,
  onLeave,
}: Props) {
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [status, setStatus] = useState<Status>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [errorKind, setErrorKind] = useState<ErrorKind>('unknown');
  const [retryNonce, setRetryNonce] = useState(0);
  const [listenOnly, setListenOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Right (chat) panel state
  const [chatOpen, setChatOpen] = useState(false);
  const [showAudioPopover, setShowAudioPopover] = useState(false);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastReadChatIndex, setLastReadChatIndex] = useState(0);

  const [myId, setMyId] = useState<string>('');
  const [meetingStartTs] = useState(Date.now());

  const t = useT(STR);

  const meshRef = useRef<MeshConnection | null>(null);
  const signalingRef = useRef<SignalingClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const unreadChat = chatOpen ? 0 : messages.length - lastReadChatIndex;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const localStream = listenOnly
          ? getSilentMicrophone()
          : await getMicrophone(getStoredMicId());
        if (cancelled) {
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = localStream;

        // Fetch ICE servers (STUN + TURN if available) BEFORE connecting to signaling.
        // CRITICAL: this must happen before signaling.connect() so there is no async
        // gap between 'hello' (which makes the server send the existing-peers list)
        // and the MeshConnection being ready to handle that 'peers' message.
        // Otherwise the peers list can arrive while no handler is registered and get
        // dropped — causing some existing participants to never connect (race bug).
        const iceServers = await getIceServers();
        if (cancelled) {
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }

        const signaling = new SignalingClient();
        signalingRef.current = signaling;
        const generatedId = crypto.randomUUID();
        setMyId(generatedId);

        const mesh = new MeshConnection(
          localStream,
          signaling,
          generatedId,
          displayName,
          {
            onPeerUpdate: (peer) =>
              setPeers((prev) => {
                if (prev.find((p) => p.peerId === peer.peerId)) {
                  return prev.map((p) =>
                    p.peerId === peer.peerId ? peer : p
                  );
                }
                return [...prev, peer];
              }),
            onPeerLeft: (peerId) =>
              setPeers((prev) => prev.filter((p) => p.peerId !== peerId)),
            onSync: (validPeerIds) => {
              const valid = new Set(validPeerIds);
              setPeers((prev) => prev.filter((p) => valid.has(p.peerId)));
            },
            onChat: (msg) => {
              setMessages((prev) => [...prev, msg]);
            },
            onFileStart: ({ id, from, fromName, name, size, mime }) => {
              setMessages((prev) => [
                ...prev,
                {
                  from,
                  fromName,
                  ts: Date.now(),
                  file: {
                    id,
                    name,
                    size,
                    mime,
                    progress: 0,
                    status: 'receiving',
                  },
                },
              ]);
            },
            onFileProgress: ({ id, received, size }) => {
              const pct = Math.min(100, Math.round((received / size) * 100));
              setMessages((prev) =>
                prev.map((m) =>
                  m.file && m.file.id === id
                    ? { ...m, file: { ...m.file, progress: pct } }
                    : m
                )
              );
            },
            onFileComplete: ({ id, blobUrl }) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.file && m.file.id === id
                    ? {
                        ...m,
                        file: { ...m.file, status: 'done', progress: 100, blobUrl },
                      }
                    : m
                )
              );
            },
            onFileFailed: ({ id }) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.file && m.file.id === id
                    ? { ...m, file: { ...m.file, status: 'failed' } }
                    : m
                )
              );
            },
          },
          iceServers
        );
        meshRef.current = mesh;

        // Connect AFTER the mesh has registered its signaling handlers, so the
        // server's 'peers' (existing participants) response is never missed.
        await signaling.connect(roomCode, generatedId, displayName);
        if (cancelled) {
          mesh.close();
          signaling.close();
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }

        setStatus('connected');
      } catch (e) {
        console.error('[meeting] connection failed', e);
        const { kind, msg } = classifyError(e, t);
        if (kind === 'no-device' && e instanceof DOMException && e.name === 'OverconstrainedError') {
          // Stale saved deviceId - clear it so retry uses default
          localStorage.removeItem('selectedMicId');
        }
        setErrorKind(kind);
        setErrorMsg(msg);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      meshRef.current?.close();
      signalingRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [roomCode, displayName, retryNonce, listenOnly]);

  // Speaking detection runs against whatever streams are currently available.
  // MUST be called before any conditional early returns to keep React hook order stable.
  const speakingStreams = (() => {
    const list: Array<{ id: string; stream: MediaStream }> = [];
    if (status === 'connected' && localStreamRef.current && !listenOnly) {
      list.push({ id: SELF_ID, stream: localStreamRef.current });
    }
    if (status === 'connected') {
      for (const p of peers) {
        list.push({ id: p.peerId, stream: p.stream });
      }
    }
    return list;
  })();
  const speakers = useSpeakingDetection(speakingStreams);

  // Zoom state for focused (expanded) tile — controlled by mouse wheel / buttons / drag.
  // MUST be declared before any conditional early returns to keep React hook order stable.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<
    { x: number; y: number; bx: number; by: number } | null
  >(null);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDragStart(null);
  }, [expandedId]);

  const handleRetry = () => {
    setListenOnly(false);
    setStatus('connecting');
    setErrorMsg('');
    setRetryNonce((n) => n + 1);
  };

  const handleJoinListenOnly = () => {
    setListenOnly(true);
    setStatus('connecting');
    setErrorMsg('');
    setRetryNonce((n) => n + 1);
  };

  const handleOpenMicSettings = async () => {
    try {
      await window.electronAPI?.openMicSettings();
    } catch (err) {
      console.error('[mic-settings] open failed', err);
    }
  };

  useEffect(() => {
    if (!screenStream) return;
    const videoTrack = screenStream.getVideoTracks()[0];
    if (!videoTrack) return;
    const onEnded = () => {
      meshRef.current?.stopScreenShare();
      setScreenStream(null);
      setSharing(false);
    };
    videoTrack.addEventListener('ended', onEnded);
    return () => videoTrack.removeEventListener('ended', onEnded);
  }, [screenStream]);

  useEffect(() => {
    if (!expandedId) return;
    if (expandedId === SELF_ID) return;
    if (expandedId === SCREEN_SELF_ID) {
      if (!screenStream) setExpandedId(null);
      return;
    }
    if (!peers.find((p) => p.peerId === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, peers, screenStream]);

  // Mark chat as read when chat panel is open
  useEffect(() => {
    if (chatOpen) {
      setLastReadChatIndex(messages.length);
    }
  }, [chatOpen, messages.length]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const newMuted = !muted;
    track.enabled = !newMuted;
    setMuted(newMuted);
    meshRef.current?.setMuted(newMuted);
  };

  const handleMicSwitch = async (deviceId: string) => {
    try {
      const newStream = await getMicrophone(deviceId || null);
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;
      await meshRef.current?.replaceAudioTrack(newTrack);
      const oldStream = localStreamRef.current;
      oldStream?.getAudioTracks().forEach((t) => t.stop());
      const newLocalStream = new MediaStream([
        newTrack,
        ...(oldStream?.getVideoTracks() ?? []),
      ]);
      localStreamRef.current = newLocalStream;
      newTrack.enabled = !muted;
    } catch (e) {
      console.error('[mic-switch] failed', e);
    }
  };

  const handleSpeakerSwitch = (deviceId: string) => {
    const audios = document.querySelectorAll<HTMLAudioElement>(
      '.tile audio, .right-panel audio'
    );
    audios.forEach((a) => {
      if ('setSinkId' in a) {
        (a as any).setSinkId(deviceId || '').catch(() => {});
      }
    });
  };

  const startSharing = async (stream: MediaStream) => {
    await meshRef.current?.startScreenShare(stream);
    setScreenStream(stream);
    setSharing(true);
    setShareError(null);
  };

  const reportShareError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/permission denied|aborted|not allowed|cancel|abort/i.test(msg)) {
      setShareError(t.shareFailPrefix + msg);
      setTimeout(() => setShareError(null), 6000);
    }
  };

  const toggleScreenShare = async () => {
    if (sharing) {
      await meshRef.current?.stopScreenShare();
      screenStream?.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
      setSharing(false);
      return;
    }

    if (isElectron) {
      setShowPicker(true);
      return;
    }

    try {
      const stream = await getScreenShareBrowser();
      await startSharing(stream);
    } catch (e) {
      reportShareError(e);
    }
  };

  const handlePickSource = async (sourceId: string) => {
    setShowPicker(false);
    try {
      const stream = await getScreenShareElectron(sourceId);
      await startSharing(stream);
    } catch (e) {
      reportShareError(e);
    }
  };

  const sendChat = (text: string) => {
    if (!meshRef.current || !myId) return;
    const localMsg: ChatMessage = {
      from: myId,
      fromName: displayName,
      text,
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, localMsg]);
    meshRef.current.sendChat(text, displayName);
  };

  const handleSendFile = async (file: File) => {
    if (!meshRef.current || !myId) return;

    // Pre-check: if there are no other participants, fail fast with a clear reason.
    if (peers.length === 0) {
      const reason = t.noRecipients;
      const fileId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        {
          from: myId,
          fromName: displayName,
          ts: Date.now(),
          file: {
            id: fileId,
            name: file.name,
            size: file.size,
            mime: file.type || 'application/octet-stream',
            progress: 0,
            status: 'failed',
            failedReason: reason,
          },
        },
      ]);
      return;
    }

    const fileId = crypto.randomUUID();
    const mime = file.type || 'application/octet-stream';
    const blobUrl = URL.createObjectURL(file);

    // Optimistically show in local chat as "sending"
    const localMsg: ChatMessage = {
      from: myId,
      fromName: displayName,
      ts: Date.now(),
      file: {
        id: fileId,
        name: file.name,
        size: file.size,
        mime,
        progress: 0,
        status: 'sending',
        blobUrl,
      },
    };
    setMessages((prev) => [...prev, localMsg]);

    try {
      await meshRef.current.sendFile(file, fileId, (sent, total) => {
        const pct = Math.min(100, Math.round((sent / total) * 100));
        setMessages((prev) =>
          prev.map((m) =>
            m.file && m.file.id === fileId
              ? { ...m, file: { ...m.file, progress: pct } }
              : m
          )
        );
      });
      // Mark sender's message as done; keep blobUrl so they can re-download
      setMessages((prev) =>
        prev.map((m) =>
          m.file && m.file.id === fileId
            ? { ...m, file: { ...m.file, status: 'done', progress: 100 } }
            : m
        )
      );
    } catch (err) {
      console.error('[file] send failed', err);
      const reason = err instanceof Error ? err.message : t.unknownError;
      setMessages((prev) =>
        prev.map((m) =>
          m.file && m.file.id === fileId
            ? { ...m, file: { ...m.file, status: 'failed', failedReason: reason } }
            : m
        )
      );
    }
  };

  const copyCode = async () => {
    let success = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(roomCode);
        success = true;
      }
    } catch (err) {
      console.warn('[copy] navigator.clipboard failed, trying fallback', err);
    }
    if (!success) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = roomCode;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
        textArea.select();
        textArea.setSelectionRange(0, roomCode.length);
        success = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (err) {
        console.error('[copy] fallback failed', err);
      }
    }
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (status === 'error') {
    const showSettings =
      isElectron && (errorKind === 'permission' || errorKind === 'no-device');
    const allowListenOnly =
      errorKind === 'permission' || errorKind === 'no-device' || errorKind === 'in-use';
    const errorTitle =
      errorKind === 'permission'
        ? t.errTitlePermission
        : errorKind === 'no-device'
        ? t.errTitleNoDevice
        : errorKind === 'in-use'
        ? t.errTitleInUse
        : errorKind === 'network'
        ? t.errTitleNetwork
        : t.errTitleUnknown;
    return (
      <div className="centered">
        <div className="card error-card">
          <h2>{errorTitle}</h2>
          <p className="error-text">{errorMsg}</p>
          {showSettings && (
            <p className="error-hint">
              {t.errHint}
              <br />
              {t.errHintListen}
            </p>
          )}
          <div className="error-actions">
            {showSettings && (
              <button className="btn btn-primary" onClick={handleOpenMicSettings}>
                {t.openMicSettings}
              </button>
            )}
            <button className="btn btn-primary" onClick={handleRetry}>
              {t.retry}
            </button>
            {allowListenOnly && (
              <button className="btn btn-listen-only" onClick={handleJoinListenOnly}>
                {t.joinListenOnly}
              </button>
            )}
            <button className="btn" onClick={onLeave}>
              {t.backToLobby}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className="centered">
        <div className="card">
          <h2>{t.connecting}</h2>
          <p className="subtitle">{t.allowMicHint}</p>
        </div>
      </div>
    );
  }

  // Self is considered "speaking" only when not muted and not listen-only.
  const selfSpeaking = !muted && !listenOnly && speakers.has(SELF_ID);

  const tiles: Array<{ id: string; node: ReactNode }> = [];
  tiles.push({
    id: SELF_ID,
    node: (
      <SelfTile
        name={displayName}
        muted={muted}
        listenOnly={listenOnly}
        speaking={selfSpeaking}
        focused={expandedId === SELF_ID}
        onDoubleClick={() => toggleExpand(SELF_ID)}
      />
    ),
  });
  if (screenStream) {
    tiles.push({
      id: SCREEN_SELF_ID,
      node: (
        <SelfScreenTile
          stream={screenStream}
          focused={expandedId === SCREEN_SELF_ID}
          onDoubleClick={() => toggleExpand(SCREEN_SELF_ID)}
        />
      ),
    });
  }
  for (const peer of peers) {
    const isSpeaking = !peer.muted && speakers.has(peer.peerId);
    tiles.push({
      id: peer.peerId,
      node: (
        <PeerTile
          peer={peer}
          speaking={isSpeaking}
          focused={expandedId === peer.peerId}
          onDoubleClick={() => toggleExpand(peer.peerId)}
        />
      ),
    });
  }

  const focusedTile = expandedId
    ? tiles.find((t) => t.id === expandedId)
    : null;
  const otherTiles = expandedId
    ? tiles.filter((t) => t.id !== expandedId)
    : tiles;

  // ----- Zoom / pan for focused screen-share content -----
  const focusHasVideo = (() => {
    if (!expandedId) return false;
    if (expandedId === SCREEN_SELF_ID) return true;
    const p = peers.find((pp) => pp.peerId === expandedId);
    return !!(p && p.stream.getVideoTracks().length > 0);
  })();

  const handleZoomWheel = (e: React.WheelEvent) => {
    if (!focusHasVideo) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setZoom((z) => {
      const next = Math.max(1, Math.min(5, z + delta));
      if (next <= 1.01) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handlePanStart = (e: React.MouseEvent) => {
    if (!focusHasVideo || zoom <= 1) return;
    setDragStart({ x: e.clientX, y: e.clientY, bx: pan.x, by: pan.y });
  };
  const handlePanMove = (e: React.MouseEvent) => {
    if (!dragStart) return;
    setPan({
      x: dragStart.bx + (e.clientX - dragStart.x),
      y: dragStart.by + (e.clientY - dragStart.y),
    });
  };
  const handlePanEnd = () => setDragStart(null);

  const zoomIn = () => setZoom((z) => Math.min(5, z + 0.25));
  const zoomOut = () =>
    setZoom((z) => {
      const next = Math.max(1, z - 0.25);
      if (next <= 1.01) setPan({ x: 0, y: 0 });
      return next;
    });
  const zoomReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className={`meeting ${chatOpen ? 'chat-open' : ''}`}>
      <header className="meeting-header">
        <div className="meeting-header-brand">
          <Logo size="sm" showWordmark={false} />
          <MeetingTime startTs={meetingStartTs} />
        </div>
        {meetingTitle && (
          <div className="meeting-title-display" title={meetingTitle}>
            {meetingTitle}
          </div>
        )}
        <div className="meeting-header-right">
          <div className="room-info">
            <span className="label">{t.roomCodeLabel}</span>
            <button
              className="code-pill"
              onClick={copyCode}
              title={t.clickToCopy}
            >
              <span className="code-text">{roomCode}</span>
              <span className="copy-icon" aria-hidden="true">
                {copied ? (
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path
                      fill="currentColor"
                      d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path
                      fill="currentColor"
                      d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"
                    />
                  </svg>
                )}
              </span>
              <span className="copy-label">{copied ? t.copied : t.copy}</span>
            </button>
          </div>
          <div className="participant-count">{t.participantCount(peers.length + 1)}</div>
        </div>
      </header>

      {listenOnly && (
        <div className="banner banner-info">
          {t.listenOnlyBanner}
        </div>
      )}
      {shareError && <div className="banner banner-error">{shareError}</div>}

      <main className={`meeting-area ${expandedId ? 'has-focus' : ''}`}>
        {focusedTile && (
          <section
            className={`focus-area ${focusHasVideo ? 'focus-area-zoomable' : ''}`}
            key={focusedTile.id}
            onWheel={handleZoomWheel}
            onMouseDown={handlePanStart}
            onMouseMove={handlePanMove}
            onMouseUp={handlePanEnd}
            onMouseLeave={handlePanEnd}
            style={
              focusHasVideo
                ? ({
                    ['--zoom' as string]: zoom,
                    ['--pan-x' as string]: `${pan.x}px`,
                    ['--pan-y' as string]: `${pan.y}px`,
                    cursor: zoom > 1 ? (dragStart ? 'grabbing' : 'grab') : 'default',
                  } as React.CSSProperties)
                : undefined
            }
          >
            {focusedTile.node}
            {focusHasVideo && (
              <div className="zoom-controls">
                <button
                  type="button"
                  onClick={zoomOut}
                  disabled={zoom <= 1}
                  title={t.zoomOutTip}
                  aria-label={t.zoomOutAria}
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={zoomReset}
                  title={t.zoomResetTip}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={zoomIn}
                  disabled={zoom >= 5}
                  title={t.zoomInTip}
                  aria-label={t.zoomInAria}
                >
                  +
                </button>
              </div>
            )}
          </section>
        )}
        <section className={expandedId ? 'thumbnails' : 'meeting-grid'}>
          {otherTiles.map((t) => (
            <Fragment key={t.id}>{t.node}</Fragment>
          ))}
        </section>
      </main>

      <footer className="control-bar">
        <div className="control-item control-item-mic">
          <button
            className={`audio-chevron ${showAudioPopover ? 'open' : ''}`}
            onClick={() => setShowAudioPopover((v) => !v)}
            title={t.audioDeviceSettings}
            aria-label={t.audioDeviceSettings}
          >
            <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true">
              <path
                d="M1.5 6.5 L6 2 L10.5 6.5"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className={`btn-circle ${listenOnly ? 'btn-disabled' : muted ? 'btn-danger' : ''}`}
            onClick={listenOnly ? undefined : toggleMute}
            disabled={listenOnly}
            title={
              listenOnly
                ? t.micNoSendTitle
                : muted
                ? t.unmute
                : t.mute
            }
          >
            {listenOnly ? '🎧' : muted ? '🔇' : '🎤'}
          </button>
          <span className="control-label">
            {listenOnly ? t.noMic : muted ? t.unmute : t.mute}
          </span>
          {showAudioPopover && (
            <AudioSettingsPopover
              onClose={() => setShowAudioPopover(false)}
              onMicChange={handleMicSwitch}
              onSpeakerChange={handleSpeakerSwitch}
            />
          )}
        </div>
        <div className="control-item">
          <button
            className={`btn-circle ${sharing ? 'btn-active' : ''}`}
            onClick={toggleScreenShare}
            title={sharing ? t.shareStop : t.share}
          >
            🖥️
          </button>
          <span className="control-label">{sharing ? t.shareStopLabel : t.share}</span>
        </div>
        <div className="control-item">
          <button
            className={`btn-circle ${chatOpen ? 'btn-active' : ''}`}
            onClick={() => setChatOpen((v) => !v)}
            title={chatOpen ? t.chatClose : t.chatOpen}
          >
            💬
            {unreadChat > 0 && (
              <span className="badge-count">
                {unreadChat > 99 ? '99+' : unreadChat}
              </span>
            )}
          </button>
          <span className="control-label">{t.chat}</span>
        </div>
        <div className="control-item">
          <button className="btn-circle btn-leave" onClick={onLeave} title={t.leave}>
            📞
          </button>
          <span className="control-label">{t.leave}</span>
        </div>
      </footer>

      {chatOpen && (
        <ChatPanel onClose={() => setChatOpen(false)}>
          <ChatTab
            messages={messages}
            myId={myId}
            onSend={sendChat}
            onSendFile={handleSendFile}
          />
        </ChatPanel>
      )}

      {showPicker && (
        <SourcePicker
          onPick={handlePickSource}
          onCancel={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

function MeetingTime({ startTs }: { startTs: number }) {
  const [now, setNow] = useState(Date.now());
  const t = useT(STR);
  const { lang } = useLang();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = new Date(now).toLocaleTimeString(lang === 'ko' ? 'ko-KR' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const elapsedSec = Math.max(0, Math.floor((now - startTs) / 1000));
  const hh = Math.floor(elapsedSec / 3600);
  const mm = Math.floor((elapsedSec % 3600) / 60);
  const ss = elapsedSec % 60;
  const elapsedStr =
    hh > 0
      ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  return (
    <div className="meeting-time" title={t.currentTimeTip}>
      <span className="time-now">{timeStr}</span>
      <span className="time-divider">·</span>
      <span className="time-elapsed">⏱ {elapsedStr}</span>
    </div>
  );
}

function SelfTile({
  name,
  muted,
  listenOnly,
  speaking,
  focused,
  onDoubleClick,
}: {
  name: string;
  muted: boolean;
  listenOnly: boolean;
  speaking: boolean;
  focused?: boolean;
  onDoubleClick?: () => void;
}) {
  const t = useT(STR);
  return (
    <div
      className={`tile tile-self ${focused ? 'tile-focused' : ''} ${speaking ? 'tile-speaking' : ''}`}
      onDoubleClick={onDoubleClick}
      title={t.dblClickExpand}
    >
      <div className="tile-avatar">{name.slice(0, 1).toUpperCase()}</div>
      <div className="tile-name">
        {name} {t.selfSuffix}{' '}
        {listenOnly ? (
          <span className="muted-badge listen-only-badge">{t.listenOnlyBadge}</span>
        ) : (
          muted && <span className="muted-badge">{t.mutedBadge}</span>
        )}
      </div>
    </div>
  );
}

function SelfScreenTile({
  stream,
  focused,
  onDoubleClick,
}: {
  stream: MediaStream;
  focused?: boolean;
  onDoubleClick?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const t = useT(STR);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div
      className={`tile tile-screen-preview ${focused ? 'tile-focused' : ''}`}
      onDoubleClick={onDoubleClick}
      title={t.dblClickExpand}
    >
      <video ref={videoRef} autoPlay playsInline muted />
      <div className="tile-name">{t.mySharingScreen}</div>
    </div>
  );
}

function PeerTile({
  peer,
  speaking,
  focused,
  onDoubleClick,
}: {
  peer: RemotePeer;
  speaking: boolean;
  focused?: boolean;
  onDoubleClick?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const t = useT(STR);

  useEffect(() => {
    if (audioRef.current && audioRef.current.srcObject !== peer.stream) {
      audioRef.current.srcObject = peer.stream;
    }
    const sinkId = getStoredSpeakerId();
    if (sinkId && audioRef.current && 'setSinkId' in audioRef.current) {
      (audioRef.current as any).setSinkId(sinkId).catch(() => {});
    }
  }, [peer.stream]);

  useEffect(() => {
    const videoTracks = peer.stream.getVideoTracks();
    setHasVideo(videoTracks.length > 0);
  }, [peer]);

  useEffect(() => {
    if (videoRef.current && hasVideo) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [hasVideo, peer.stream]);

  return (
    <div
      className={`tile ${focused ? 'tile-focused' : ''} ${speaking ? 'tile-speaking' : ''}`}
      onDoubleClick={onDoubleClick}
      title={t.dblClickExpand}
    >
      <audio ref={audioRef} autoPlay />
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted />
      ) : (
        <div className="tile-avatar">{peer.displayName.slice(0, 1).toUpperCase()}</div>
      )}
      <div className="tile-name">
        {peer.displayName}
        {peer.muted && <span className="muted-badge">{t.mutedBadge}</span>}
      </div>
    </div>
  );
}
