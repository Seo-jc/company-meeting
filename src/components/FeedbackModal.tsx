import { FormEvent, useEffect, useState } from 'react';
import { FeedbackCategory, sendBugReport } from '../lib/bugReporter';

type Props = {
  defaultName?: string;
  onClose: () => void;
};

const CATEGORIES: Array<{
  value: FeedbackCategory;
  icon: string;
  label: string;
  hint: string;
}> = [
  {
    value: 'feature-add',
    icon: '🆕',
    label: '기능 추가',
    hint: '새로운 기능을 제안합니다',
  },
  {
    value: 'improvement',
    icon: '✨',
    label: '기존 기능 개선',
    hint: '있는 기능을 더 좋게 만들고 싶습니다',
  },
  {
    value: 'usability',
    icon: '🤔',
    label: '사용성 문제',
    hint: '불편한 점이나 헷갈리는 부분이 있습니다',
  },
  {
    value: 'other',
    icon: '💬',
    label: '기타',
    hint: '의견, 칭찬, 일반적인 피드백',
  },
];

export default function FeedbackModal({ defaultName, onClose }: Props) {
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
      setErrorMsg('내용을 입력해 주세요.');
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
      message: `[${cat?.label ?? '의견'}] ${oneLineSummary}`,
      userDescription: combined,
      feedbackCategory: category,
      submitterName: submitterName.trim() || undefined,
    });
    setBusy(false);
    if (ok) {
      setPhase('success');
    } else {
      setPhase('error');
      setErrorMsg('전송에 실패했습니다. 네트워크를 확인해 주세요.');
    }
  };

  if (phase === 'success') {
    return (
      <div className="bug-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
        <div className="bug-modal feedback-modal-success" onClick={(e) => e.stopPropagation()}>
          <header className="bug-modal-header" style={{ background: 'linear-gradient(135deg, #1a2e26 0%, #1d2026 100%)' }}>
            <h2>💚 의견 전달 완료</h2>
            <button className="bug-modal-close" onClick={onClose} aria-label="닫기">✕</button>
          </header>
          <div className="bug-modal-body" style={{ alignItems: 'center', textAlign: 'center', padding: '2.5rem 2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.8rem' }}>🙏</div>
            <p style={{ fontSize: '1.05rem', fontWeight: 600, color: '#e8e8ea', marginBottom: '0.5rem' }}>
              소중한 의견 감사합니다.
            </p>
            <p style={{ color: '#a0a4ad', fontSize: '0.9rem', lineHeight: 1.5 }}>
              검토 후 반영 가능한 부분은 향후 업데이트에 적용하겠습니다.<br />
              긴급한 사항이면 별도로 알려주세요.
            </p>
            <button className="btn btn-primary" onClick={onClose} style={{ marginTop: '1.5rem', minWidth: '120px' }}>
              확인
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
            <h2>💡 의견 / 기능 제안</h2>
            <div className="bug-modal-subtitle">
              사용하시면서 느낀 점이나 제안을 자유롭게 보내주세요
            </div>
          </div>
          <button className="bug-modal-close" onClick={onClose} aria-label="닫기" disabled={busy}>
            ✕
          </button>
        </header>

        <form className="feedback-form" onSubmit={handleSubmit}>
          <label className="feedback-label">종류</label>
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

          <label className="feedback-label" htmlFor="fb-title">한 줄 요약 <span className="feedback-optional">(선택)</span></label>
          <input
            id="fb-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 회의 녹화 기능이 있으면 좋겠습니다"
            maxLength={80}
            disabled={busy}
          />

          <label className="feedback-label" htmlFor="fb-desc">자세한 내용 <span className="feedback-required">*</span></label>
          <textarea
            id="fb-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="어떤 기능이 필요한지, 왜 필요한지, 어떻게 동작하면 좋을지 등 자유롭게 작성해 주세요."
            rows={6}
            maxLength={1000}
            disabled={busy}
            required
          />
          <div className="feedback-char-count">
            {description.length} / 1000
          </div>

          <label className="feedback-label" htmlFor="fb-name">이름 <span className="feedback-optional">(선택)</span></label>
          <input
            id="fb-name"
            type="text"
            value={submitterName}
            onChange={(e) => setSubmitterName(e.target.value)}
            placeholder="이름을 적으시면 필요 시 추가 문의 가능합니다"
            maxLength={30}
            disabled={busy}
          />

          {errorMsg && <div className="bug-error" style={{ marginTop: '0.5rem' }}>{errorMsg}</div>}

          <div className="feedback-footer-note">
            앱 버전, OS 정보가 자동으로 첨부됩니다. 회의 내용/채팅/파일은 절대 수집되지 않습니다.
          </div>

          <div className="feedback-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              취소
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !description.trim()}
            >
              {busy ? '전송 중...' : '전송'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
