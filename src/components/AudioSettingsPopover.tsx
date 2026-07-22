import { useCallback, useEffect, useRef, useState } from 'react';
import AudioTestControls from './AudioTestControls';
import { useT } from '../i18n';

const STR = {
  ko: {
    audioDevices: '오디오 장치',
    mic: '마이크',
    switching: '전환 중...',
    systemDefault: '시스템 기본값',
    micLabel: (id: string) => `마이크 (${id})`,
    speaker: '스피커',
    speakerLabel: (id: string) => `스피커 (${id})`,
    speakerUnsupportedHint: '스피커 출력 선택 미지원 환경',
  },
  en: {
    audioDevices: 'Audio Devices',
    mic: 'Microphone',
    switching: 'Switching...',
    systemDefault: 'System default',
    micLabel: (id: string) => `Microphone (${id})`,
    speaker: 'Speaker',
    speakerLabel: (id: string) => `Speaker (${id})`,
    speakerUnsupportedHint: 'Speaker output selection is not supported in this environment',
  },
};

const MIC_KEY = 'selectedMicId';
const SPEAKER_KEY = 'selectedSpeakerId';

type Props = {
  onClose: () => void;
  onMicChange: (deviceId: string) => Promise<void> | void;
  onSpeakerChange: (deviceId: string) => void;
};

export default function AudioSettingsPopover({
  onClose,
  onMicChange,
  onSpeakerChange,
}: Props) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [switchingMic, setSwitchingMic] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const t = useT(STR);

  const loadDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMics(devices.filter((d) => d.kind === 'audioinput'));
      setSpeakers(devices.filter((d) => d.kind === 'audiooutput'));
    } catch (e) {
      console.warn('[audio] enumerate failed', e);
    }
  }, []);

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

  // Close on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const handleMicChange = async (id: string) => {
    setSelectedMic(id);
    if (id) localStorage.setItem(MIC_KEY, id);
    else localStorage.removeItem(MIC_KEY);
    setSwitchingMic(true);
    try {
      await onMicChange(id);
    } finally {
      setSwitchingMic(false);
    }
  };

  const handleSpeakerChange = (id: string) => {
    setSelectedSpeaker(id);
    if (id) localStorage.setItem(SPEAKER_KEY, id);
    else localStorage.removeItem(SPEAKER_KEY);
    onSpeakerChange(id);
  };

  const speakerSupported =
    typeof (document.createElement('audio') as any).setSinkId === 'function';

  return (
    <div className="audio-popover" ref={popoverRef} role="dialog">
      <div className="audio-popover-arrow" />
      <div className="audio-popover-title">{t.audioDevices}</div>

      <div className="audio-field">
        <label>
          <span className="audio-icon">🎤</span>
          <span>{t.mic}</span>
          {switchingMic && <span className="audio-switching">{t.switching}</span>}
        </label>
        <select
          value={selectedMic}
          onChange={(e) => void handleMicChange(e.target.value)}
          disabled={switchingMic}
        >
          <option value="">{t.systemDefault}</option>
          {mics.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || t.micLabel(m.deviceId.slice(0, 6))}
            </option>
          ))}
        </select>
      </div>

      <div className="audio-field">
        <label>
          <span className="audio-icon">🔊</span>
          <span>{t.speaker}</span>
        </label>
        <select
          value={selectedSpeaker}
          onChange={(e) => handleSpeakerChange(e.target.value)}
          disabled={!speakerSupported}
        >
          <option value="">{t.systemDefault}</option>
          {speakers.map((s) => (
            <option key={s.deviceId} value={s.deviceId}>
              {s.label || t.speakerLabel(s.deviceId.slice(0, 6))}
            </option>
          ))}
        </select>
        {!speakerSupported && (
          <p className="audio-hint">{t.speakerUnsupportedHint}</p>
        )}
      </div>

      <AudioTestControls
        micDeviceId={selectedMic}
        speakerDeviceId={selectedSpeaker}
        variant="popover"
      />
    </div>
  );
}
