import { FormEvent, useEffect, useState } from 'react';
import { FeedbackCategory, sendBugReport } from '../lib/bugReporter';
import { useT } from '../i18n';

type Props = {
  defaultName?: string;
  onClose: () => void;
};

const STR = {
  ko: {
    catFeatureAddLabel: '기능 추가',
    catFeatureAddHint: '새로운 기능을 제안합니다',
    catImprovementLabel: '기존 기능 개선',
    catImprovementHint: '있는 기능을 더 좋게 만들고 싶습니다',
    catUsabilityLabel: '사용성 문제',
    catUsabilityHint: '불편한 점이나 헷갈리는 부분이 있습니다',
    catOtherLabel: '기타',
    catOtherHint: '의견, 칭찬, 일반적인 피드백',
    errDescRequired: '내용을 입력해 주세요.',
    errSendFailed: '전송에 실패했습니다. 네트워크를 확인해 주세요.',
    defaultCatFallback: '의견',
    successTitle: '💚 의견 전달 완료',
    close: '닫기',
    successThanks: '소중한 의견 감사합니다.',
    successNote1: '검토 후 반영 가능한 부분은 향후 업데이트에 적용하겠습니다.',
    successNote2: '긴급한 사항이면 별도로 알려주세요.',
    confirm: '확인',
    modalTitle: '💡 의견 / 기능 제안',
    modalSubtitle: '사용하시면서 느낀 점이나 제안을 자유롭게 보내주세요',
    categoryLabel: '종류',
    titleLabel: '한 줄 요약',
    optional: '(선택)',
    required: '*',
    titlePlaceholder: '예: 회의 녹화 기능이 있으면 좋겠습니다',
    descLabel: '자세한 내용',
    descPlaceholder: '어떤 기능이 필요한지, 왜 필요한지, 어떻게 동작하면 좋을지 등 자유롭게 작성해 주세요.',
    nameLabel: '이름',
    namePlaceholder: '이름을 적으시면 필요 시 추가 문의 가능합니다',
    footerNote: '앱 버전, OS 정보가 자동으로 첨부됩니다. 회의 내용/채팅/파일은 절대 수집되지 않습니다.',
    cancel: '취소',
    sending: '전송 중...',
    send: '전송',
  },
  en: {
    catFeatureAddLabel: 'New feature',
    catFeatureAddHint: 'Suggest a new feature',
    catImprovementLabel: 'Improvement',
    catImprovementHint: 'Make an existing feature better',
    catUsabilityLabel: 'Usability issue',
    catUsabilityHint: 'Something is inconvenient or confusing',
    catOtherLabel: 'Other',
    catOtherHint: 'Comments, praise, or general feedback',
    errDescRequired: 'Please enter a description.',
    errSendFailed: 'Failed to send. Please check your network connection.',
    defaultCatFallback: 'Feedback',
    successTitle: '💚 Feedback sent',
    close: 'Close',
    successThanks: 'Thank you for your valuable feedback.',
    successNote1: 'We will review it and apply any actionable items in a future update.',
    successNote2: 'For urgent matters, please let us know separately.',
    confirm: 'OK',
    modalTitle: '💡 Feedback / Feature request',
    modalSubtitle: 'Feel free to share anything you noticed or would like to suggest',
    categoryLabel: 'Category',
    titleLabel: 'Summary',
    optional: '(optional)',
    required: '*',
    titlePlaceholder: 'e.g., It would be great to have a meeting recording feature',
    descLabel: 'Details',
    descPlaceholder: 'Please describe what feature you need, why you need it, and how it should work.',
    nameLabel: 'Name',
    namePlaceholder: 'Enter your name if you’d like us to follow up with you',
    footerNote: 'App version and OS info are attached automatically. Meeting content, chat, and files are never collected.',
    cancel: 'Cancel',
    sending: 'Sending...',
    send: 'Send',
  },
};

export default function FeedbackModal({ defaultName, onClose }: Props) {
  const t = useT(STR);
  const CATEGORIES: Array<{
    value: FeedbackCategory;
    icon: string;
    label: string;
    hint: string;
  }> = [
    {
      value: 'feature-add',
      icon: '🆕',
      label: t.catFeatureAddLabel,
      hint: t.catFeatureAddHint,
    },
    {
      value: 'improvement',
      icon: '✨',
      label: t.catImprovementLabel,
      hint: t.catImprovementHint,
    },
    {
      value: 'usability',
      icon: '🤔',
      label: t.catUsabilityLabel,
      hint: t.catUsabilityHint,
    },
    {
      value: 'other',
      icon: '💬',
      label: t.catOtherLabel,
      hint: t.catOtherHint,
    },
  ];
  const [category, setCategory] = useState<FeedbackCategory>('feature-add');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitterName, setSubmitterName] = useState(defaultName ?? '');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'success' | 'error'>('edit');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setErrorMsg(t.errDescRequired);
      return;
    }
    setBusy(true);
    setErrorMsg('');
    const cat = CATEGORIES.find((c) => c.value === category);
    const oneLineSummary = title.trim() || description.trim().slice(0, 80);
    const combined =
      `[${cat?.label ?? category}]\n${title.trim() ? title.trim() + '\n\n' : ''}${description.trim()}`;
    const ok = await sendBugReport({
      type: 'feedback',
      severity: 'info',
      message: `[${cat?.label ?? t.defaultCatFallback}] ${oneLineSummary}`,
      userDescription: combined,
      feedbackCategory: category,
      submitterName: submitterName.trim() || undefined,
    });
    setBusy(false);
    if (ok) {
      setPhase('success');
    } else {
      setPhase('error');
      setErrorMsg(t.errSendFailed);
    }
  };

  if (phase === 'success') {
    return (
      <div className="bug-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
        <div className="bug-modal feedback-modal-success" onClick={(e) => e.stopPropagation()}>
          <header className="bug-modal-header" style={{ background: 'linear-gradient(135deg, #1a2e26 0%, #1d2026 100%)' }}>
            <h2>{t.successTitle}</h2>
            <button className="bug-modal-close" onClick={onClose} aria-label={t.close}>✕</button>
          </header>
          <div className="bug-modal-body" style={{ alignItems: 'center', textAlign: 'center', padding: '2.5rem 2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.8rem' }}>🙏</div>
            <p style={{ fontSize: '1.05rem', fontWeight: 600, color: '#e8e8ea', marginBottom: '0.5rem' }}>
              {t.successThanks}
            </p>
            <p style={{ color: '#a0a4ad', fontSize: '0.9rem', lineHeight: 1.5 }}>
              {t.successNote1}<br />
              {t.successNote2}
            </p>
            <button className="btn btn-primary" onClick={onClose} style={{ marginTop: '1.5rem', minWidth: '120px' }}>
              {t.confirm}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bug-modal-backdrop" onClick={busy ? undefined : onClose} role="dialog" aria-modal="true">
      <div className="bug-modal feedback-modal" onClick={(e) => e.stopPropagation()}>
        <header className="bug-modal-header" style={{ background: 'linear-gradient(135deg, #1f3a4d 0%, #1d2026 100%)' }}>
          <div>
            <h2>{t.modalTitle}</h2>
            <div className="bug-modal-subtitle">
              {t.modalSubtitle}
            </div>
          </div>
          <button className="bug-modal-close" onClick={onClose} aria-label={t.close} disabled={busy}>
            ✕
          </button>
        </header>

        <form className="feedback-form" onSubmit={handleSubmit}>
          <label className="feedback-label">{t.categoryLabel}</label>
          <div className="feedback-category-grid">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`feedback-cat ${category === c.value ? 'feedback-cat-active' : ''}`}
                onClick={() => setCategory(c.value)}
                disabled={busy}
              >
                <span className="feedback-cat-icon">{c.icon}</span>
                <span className="feedback-cat-name">{c.label}</span>
                <span className="feedback-cat-hint">{c.hint}</span>
              </button>
            ))}
          </div>

          <label className="feedback-label" htmlFor="fb-title">{t.titleLabel} <span className="feedback-optional">{t.optional}</span></label>
          <input
            id="fb-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.titlePlaceholder}
            maxLength={80}
            disabled={busy}
          />

          <label className="feedback-label" htmlFor="fb-desc">{t.descLabel} <span className="feedback-required">{t.required}</span></label>
          <textarea
            id="fb-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.descPlaceholder}
            rows={6}
            maxLength={1000}
            disabled={busy}
            required
          />
          <div className="feedback-char-count">
            {description.length} / 1000
          </div>

          <label className="feedback-label" htmlFor="fb-name">{t.nameLabel} <span className="feedback-optional">{t.optional}</span></label>
          <input
            id="fb-name"
            type="text"
            value={submitterName}
            onChange={(e) => setSubmitterName(e.target.value)}
            placeholder={t.namePlaceholder}
            maxLength={30}
            disabled={busy}
          />

          {errorMsg && <div className="bug-error" style={{ marginTop: '0.5rem' }}>{errorMsg}</div>}

          <div className="feedback-footer-note">
            {t.footerNote}
          </div>

          <div className="feedback-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              {t.cancel}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !description.trim()}
            >
              {busy ? t.sending : t.send}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
