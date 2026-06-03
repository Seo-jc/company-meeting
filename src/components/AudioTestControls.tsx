import { useEffect, useState } from 'react';
import { playSpeakerTone, useMicLevel } from '../lib/audioTest';

const SEGMENT_COUNT = 12;
const MIC_TEST_TIMEOUT_MS = 15000;

type Props = {
  micDeviceId: string;
  speakerDeviceId: string;
  /** "lobby" lays out wider; "popover" is more compact. */
  variant?: 'lobby' | 'popover';
};

export default function AudioTestControls({
  micDeviceId,
  speakerDeviceId,
  variant = 'lobby',
}: Props) {
  const [micActive, setMicActive] = useState(false);
  const [speakerPlaying, setSpeakerPlaying] = useState(false);
  const level = useMicLevel(micDeviceId || null, micActive);

  // Auto-stop mic test after timeout so we don't keep the device open forever.
  useEffect(() => {
    if (!micActive) return;
    const t = window.setTimeout(() => setMicActive(false), MIC_TEST_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [micActive]);

  // Restart mic test if the user changes device while test is on.
  useEffect(() => {
    if (micActive) setMicActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micDeviceId]);

  const handleSpeakerTest = async () => {
    if (speakerPlaying) return;
    setSpeakerPlaying(true);
    try {
      await playSpeakerTone(speakerDeviceId || null);
    } finally {
      setSpeakerPlaying(false);
    }
  };

  return (
    <div className={`audio-test audio-test-${variant}`}>
      <div className="audio-test-row">
        <button
          type="button"
          className={`audio-test-btn ${micActive ? 'audio-test-btn-active' : ''}`}
          onClick={() => setMicActive((v) => !v)}
          aria-pressed={micActive}
        >
          {micActive ? '⏹ 마이크 테스트 중지' : '▶ 마이크 테스트'}
        </button>
        <div className="audio-meter" aria-hidden="true">
          {Array.from({ length: SEGMENT_COUNT }).map((_, i) => {
            const threshold = ((i + 1) / SEGMENT_COUNT) * 100;
            const filled = level >= threshold;
            let cls = 'audio-meter-seg';
            if (i >= 9) cls += ' audio-meter-seg-high';
            else if (i >= 6) cls += ' audio-meter-seg-mid';
            else cls += ' audio-meter-seg-low';
            if (filled) cls += ' audio-meter-seg-on';
            return <span key={i} className={cls} />;
          })}
        </div>
      </div>
      {micActive && (
        <div className="audio-test-hint">
          말해 보세요. 막대가 움직이면 마이크가 정상입니다 (15초 후 자동 중지)
        </div>
      )}

      <div className="audio-test-row" style={{ marginTop: '0.5rem' }}>
        <button
          type="button"
          className={`audio-test-btn ${speakerPlaying ? 'audio-test-btn-active' : ''}`}
          onClick={handleSpeakerTest}
          disabled={speakerPlaying}
        >
          {speakerPlaying ? '🔊 재생 중...' : '▶ 스피커 테스트'}
        </button>
        <span className="audio-test-note">
          {speakerPlaying ? '두 번의 짧은 신호음이 들려야 합니다' : '클릭 시 신호음 재생'}
        </span>
      </div>
    </div>
  );
}
