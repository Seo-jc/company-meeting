import { FormEvent, useEffect, useState } from 'react';
import { useT } from '../i18n';

const STR = {
  ko: {
    title: '📌 저장된 회의로 추가',
    subtitle: '나중에 알아보기 쉬운 이름으로 저장하세요',
    close: '닫기',
    codeLabel: '회의 코드',
    nameLabel: '회의 이름',
    namePlaceholder: '예: 본사/VINA 주간회의',
    cancel: '취소',
    save: '저장',
  },
  en: {
    title: '📌 Save meeting',
    subtitle: 'Give it a name you\'ll recognize later',
    close: 'Close',
    codeLabel: 'Meeting code',
    nameLabel: 'Meeting name',
    namePlaceholder: 'e.g. HQ/VINA weekly meeting',
    cancel: 'Cancel',
    save: 'Save',
  },
};

type Props = {
  /** Pre-filled in the input (usually the existing meeting name or code). */
  defaultName: string;
  /** Read-only display of the code being saved. */
  code: string;
  onCancel: () => void;
  onSave: (name: string) => void;
};

export default function PromoteRenameDialog({
  defaultName,
  code,
  onCancel,
  onSave,
}: Props) {
  const t = useT(STR);
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
  };

  return (
    <div className="bug-modal-backdrop" onClick={onCancel} role="dialog" aria-modal="true">
      <div
        className="bug-modal"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bug-modal-header" style={{ background: 'linear-gradient(135deg, #1a2e26 0%, #1d2026 100%)' }}>
          <div>
            <h2>{t.title}</h2>
            <div className="bug-modal-subtitle">
              {t.subtitle}
            </div>
          </div>
          <button className="bug-modal-close" onClick={onCancel} aria-label={t.close}>
            ✕
          </button>
        </header>
        <form className="promote-form" onSubmit={handleSubmit}>
          <div className="promote-code-row">
            <span className="promote-code-label">{t.codeLabel}</span>
            <span className="promote-code-value">{code}</span>
          </div>
          <label className="promote-name-label" htmlFor="promote-name">
            {t.nameLabel}
          </label>
          <input
            id="promote-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            maxLength={30}
            autoFocus
          />
          <div className="promote-actions">
            <button type="button" className="btn" onClick={onCancel}>
              {t.cancel}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim()}
            >
              {t.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
