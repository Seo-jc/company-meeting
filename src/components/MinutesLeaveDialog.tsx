// 회의에서 나가기(📞) 때 «회의록을 아직 저장하지 않았습니다» 확인창.
// 마지막 저장 뒤 내가 고쳤고 내용이 있을 때만 뜬다(판단은 MinutesSession.needsLeaveConfirm()).
//   [엑셀로 저장하고 나가기]  [저장 안 하고 나가기]  [취소 (회의로 돌아가기)]
// 겹침 확인: electron/minutesExcel.ts 와 다름 — 그건 메인의 엑셀 만들기이고, 이 파일은 나가기 직전에 뜨는 확인 대화상자 화면이다.

import { useEffect, useRef } from 'react';
import { useT } from '../i18n';

const STR = {
  ko: {
    title: '💾 회의록을 아직 저장하지 않았습니다',
    body: '마지막 저장 뒤에 고친 내용이 있습니다. 엑셀로 저장하지 않고 나가면 이 회의록은 다시 볼 수 없을 수 있습니다.',
    saveAndLeave: '엑셀로 저장하고 나가기',
    saving: '저장 중…',
    leave: '저장 안 하고 나가기',
    cancel: '취소 (회의로 돌아가기)',
    aria: '회의록을 저장하지 않았습니다',
  },
  en: {
    title: '💾 The minutes are not saved yet',
    body: 'You made changes after the last save. If you leave without saving as Excel, these minutes may be lost.',
    saveAndLeave: 'Save as Excel and leave',
    saving: 'Saving…',
    leave: 'Leave without saving',
    cancel: 'Cancel (back to the meeting)',
    aria: 'The minutes are not saved',
  },
};

type Props = {
  busy: boolean;
  onSaveAndLeave: () => void;
  onLeaveWithoutSave: () => void;
  onCancel: () => void;
};

export default function MinutesLeaveDialog({ busy, onSaveAndLeave, onLeaveWithoutSave, onCancel }: Props) {
  const t = useT(STR);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="mm-dlg-back" role="dialog" aria-modal="true" aria-label={t.aria}>
      <div className="mm-dlg">
        <h4>{t.title}</h4>
        <p>{t.body}</p>
        <div className="mm-dlg-actions">
          <button ref={primary} type="button" className="mm-dlg-btn primary" disabled={busy} onClick={onSaveAndLeave}>
            {busy ? t.saving : t.saveAndLeave}
          </button>
          <button type="button" className="mm-dlg-btn danger" disabled={busy} onClick={onLeaveWithoutSave}>
            {t.leave}
          </button>
          <button type="button" className="mm-dlg-btn ghost" disabled={busy} onClick={onCancel}>
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
