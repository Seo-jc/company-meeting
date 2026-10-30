// 회의에서 나온 직후 로비에 띄우는 회의록 저장 안내 — «엑셀로 저장하고 나가기» 를 누르면 방이 바로 사라져서 방 안의 저장 알림
// (MinutesToast)을 볼 수 없으므로, 저장 결과(파일 이름·위치)를 여기서 다시 보여 준다. 모양은 MinutesToast 와 같다.
// 목업(meeting_minutes_mockup.html)의 «회의에서 나갔습니다 · 회의록을 엑셀로 저장했습니다 + 파일 이름» 에 해당한다.
// 겹침 확인: MinutesToast.tsx 와 다름 — 그건 회의 중 저장 알림(세션 상태를 구독)이고, 이 파일은 방을 나온 뒤 App 이 들고 있는 한 번짜리 안내다.

import { useEffect } from 'react';
import { useT } from '../i18n';
import type { MinutesLeftInfo } from '../lib/minutes/types';

const STR = {
  ko: {
    title: '회의에서 나갔습니다',
    saved: '회의록을 엑셀로 저장했습니다',
    unsavedAfter: '마지막 저장 뒤에 고친 내용은 저장하지 않았습니다.',
    saveDir: (dir: string) => `저장 위치 · ${dir}`,
    openFile: '파일 열기',
    openFolder: '폴더 열기',
    close: '닫기',
  },
  en: {
    title: 'You left the meeting',
    saved: 'The minutes were saved as Excel',
    unsavedAfter: 'Changes made after the last save were not saved.',
    saveDir: (dir: string) => `Saved in · ${dir}`,
    openFile: 'Open file',
    openFolder: 'Open folder',
    close: 'Close',
  },
};

type Props = { info: MinutesLeftInfo; onClose: () => void };

export default function MinutesLeftNotice({ info, onClose }: Props) {
  const t = useT(STR);

  useEffect(() => {
    const id = setTimeout(onClose, 12_000);
    return () => clearTimeout(id);
  }, [info, onClose]);

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  return (
    <div className={`mm-toast ${info.unsavedAfter ? 'mm-toast-error' : 'mm-toast-success'}`} role="status">
      <div className="mm-toast-icon">💾</div>
      <div className="mm-toast-body">
        <strong>{t.title}</strong>
        <small>{t.saved}</small>
        <small className="fn">{info.fileName}</small>
        {info.dir && <small>{t.saveDir(info.dir)}</small>}
        {info.unsavedAfter && <small className="warn">{t.unsavedAfter}</small>}
        {api && (
          <div className="mm-toast-actions">
            <button type="button" className="mm-toast-btn" onClick={() => void api.openMinutesFile(info.filePath)}>
              {t.openFile}
            </button>
            <button type="button" className="mm-toast-btn" onClick={() => void api.openRecordingFolder(info.filePath)}>
              {t.openFolder}
            </button>
          </div>
        )}
      </div>
      <button type="button" className="mm-toast-close" onClick={onClose} aria-label={t.close}>
        ✕
      </button>
    </div>
  );
}
