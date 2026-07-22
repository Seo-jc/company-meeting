import { useCallback, useEffect, useState } from 'react';
import AudioTestControls from './AudioTestControls';
import { useT } from '../i18n';

const STR = {
  ko: {
    audioDevices: '오디오 장치',
    refreshDevices: '장치 다시 검색',
    permHint: '마이크 권한을 허용하면 장치 이름이 보입니다.',
    allowPermission: '권한 허용',
    mic: '마이크',
    speaker: '스피커',
    systemDefault: '시스템 기본값',
    micFallback: (id: string) => `마이크 (${id})`,
    speakerFallback: (id: string) => `스피커 (${id})`,
    speakerNotSupported: '이 환경은 스피커 출력 선택을 지원하지 않습니다 (시스템 기본값 사용)',
  },
  en: {
    audioDevices: 'Audio Devices',
    refreshDevices: 'Refresh devices',
    permHint: 'Allow microphone permission to see device names.',
    allowPermission: 'Allow Permission',
    mic: 'Microphone',
    speaker: 'Speaker',
    systemDefault: 'System Default',
    micFallback: (id: string) => `Microphone (${id})`,
    speakerFallback: (id: string) => `Speaker (${id})`,
    speakerNotSupported: 'This environment does not support speaker output selection (using system default)',
  },
};

const MIC_KEY = 'selectedMicId';
const SPEAKER_KEY = 'selectedSpeakerId';

export function getStoredMicId(): string | null {
  return localStorage.getItem(MIC_KEY);
}

export function getStoredSpeakerId(): string | null {
  return localStorage.getItem(SPEAKER_KEY);
}

export default function AudioDevices() {
  const t = useT(STR);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [needsPermission, setNeedsPermission] = useState(false);
  const [speakerSelectionSupported, setSpeakerSelectionSupported] = useState(true);

  const loadDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const m = devices.filter((d) => d.kind === 'audioinput');
      const s = devices.filter((d) => d.kind === 'audiooutput');
      setMics(m);
      setSpeakers(s);

      // Labels are empty until microphone permission is granted
      const labelsAvailable = m.some((d) => d.label) || s.some((d) => d.label);
      setNeedsPermission(!labelsAvailable);

      // Speaker output selection support (Chromium has it)
      const dummy = document.createElement('audio');
      setSpeakerSelectionSupported(typeof (dummy as any).setSinkId === 'function');
    } catch (e) {
      console.warn('[audio] enumerate failed', e);
    }
  }, []);

  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await loadDevices();
    } catch {
      // user denied — keep prompt visible
    }
  };

  useEffect(() => {
    setSelectedMic(localStorage.getItem(MIC_KEY) ?? '');
    setSelectedSpeaker(localStorage.getItem(SPEAKER_KEY) ?? '');
    void loadDevices();

    const handler = () => void loadDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', handler);
    return () => {
      navigator.mediaDevices.removeEventListener?.('devicechange', handler);
    };
  }, [loadDevices]);

  const handleMicChange = (id: string) => {
    setSelectedMic(id);
    if (id) localStorage.setItem(MIC_KEY, id);
    else localStorage.removeItem(MIC_KEY);
  };

  const handleSpeakerChange = (id: string) => {
    setSelectedSpeaker(id);
    if (id) localStorage.setItem(SPEAKER_KEY, id);
    else localStorage.removeItem(SPEAKER_KEY);
  };

  return (
    <aside className="lobby-audio-panel">
      <div className="audio-panel-header">
        <h3>{t.audioDevices}</h3>
        <button
          className="audio-refresh"
          onClick={() => void loadDevices()}
          title={t.refreshDevices}
        >
          ↻
        </button>
      </div>
      <div className="audio-panel-body">
        {needsPermission && (
          <div className="audio-perm">
            <p>{t.permHint}</p>
            <button className="btn btn-small" onClick={requestPermission}>
              {t.allowPermission}
            </button>
          </div>
        )}

        <div className="audio-field">
          <label htmlFor="mic-select">
            <span className="audio-icon">🎤</span>
            <span>{t.mic}</span>
          </label>
          <select
            id="mic-select"
            value={selectedMic}
            onChange={(e) => handleMicChange(e.target.value)}
          >
            <option value="">{t.systemDefault}</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || t.micFallback(m.deviceId.slice(0, 6))}
              </option>
            ))}
          </select>
        </div>

        <div className="audio-field">
          <label htmlFor="speaker-select">
            <span className="audio-icon">🔊</span>
            <span>{t.speaker}</span>
          </label>
          <select
            id="speaker-select"
            value={selectedSpeaker}
            onChange={(e) => handleSpeakerChange(e.target.value)}
            disabled={!speakerSelectionSupported}
          >
            <option value="">{t.systemDefault}</option>
            {speakers.map((s) => (
              <option key={s.deviceId} value={s.deviceId}>
                {s.label || t.speakerFallback(s.deviceId.slice(0, 6))}
              </option>
            ))}
          </select>
          {!speakerSelectionSupported && (
            <p className="audio-hint">
              {t.speakerNotSupported}
            </p>
          )}
        </div>

        <AudioTestControls
          micDeviceId={selectedMic}
          speakerDeviceId={selectedSpeaker}
          variant="lobby"
        />
      </div>
    </aside>
  );
}
