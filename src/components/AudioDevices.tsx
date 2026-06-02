import { useCallback, useEffect, useState } from 'react';

const MIC_KEY = 'selectedMicId';
const SPEAKER_KEY = 'selectedSpeakerId';

export function getStoredMicId(): string | null {
  return localStorage.getItem(MIC_KEY);
}

export function getStoredSpeakerId(): string | null {
  return localStorage.getItem(SPEAKER_KEY);
}

export default function AudioDevices() {
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
        <h3>오디오 장치</h3>
        <button
          className="audio-refresh"
          onClick={() => void loadDevices()}
          title="장치 다시 검색"
        >
          ↻
        </button>
      </div>
      <div className="audio-panel-body">
        {needsPermission && (
          <div className="audio-perm">
            <p>마이크 권한을 허용하면 장치 이름이 보입니다.</p>
            <button className="btn btn-small" onClick={requestPermission}>
              권한 허용
            </button>
          </div>
        )}

        <div className="audio-field">
          <label htmlFor="mic-select">
            <span className="audio-icon">🎤</span>
            <span>마이크</span>
          </label>
          <select
            id="mic-select"
            value={selectedMic}
            onChange={(e) => handleMicChange(e.target.value)}
          >
            <option value="">시스템 기본값</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || `마이크 (${m.deviceId.slice(0, 6)})`}
              </option>
            ))}
          </select>
        </div>

        <div className="audio-field">
          <label htmlFor="speaker-select">
            <span className="audio-icon">🔊</span>
            <span>스피커</span>
          </label>
          <select
            id="speaker-select"
            value={selectedSpeaker}
            onChange={(e) => handleSpeakerChange(e.target.value)}
            disabled={!speakerSelectionSupported}
          >
            <option value="">시스템 기본값</option>
            {speakers.map((s) => (
              <option key={s.deviceId} value={s.deviceId}>
                {s.label || `스피커 (${s.deviceId.slice(0, 6)})`}
              </option>
            ))}
          </select>
          {!speakerSelectionSupported && (
            <p className="audio-hint">
              이 환경은 스피커 출력 선택을 지원하지 않습니다 (시스템 기본값 사용)
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
