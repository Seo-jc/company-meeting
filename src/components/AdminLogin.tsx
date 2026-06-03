import { FormEvent, useState } from 'react';
import { setStoredPassword, verifyPassword } from '../lib/adminAuth';

type Props = {
  onSuccess: (password: string) => void;
  onCancel: () => void;
};

export default function AdminLogin({ onSuccess, onCancel }: Props) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    const ok = await verifyPassword(password);
    setBusy(false);
    if (ok) {
      setStoredPassword(password);
      onSuccess(password);
    } else {
      setError('비밀번호가 일치하지 않거나 서버에 ADMIN_PASSWORD가 아직 설정되지 않았습니다.');
    }
  };

  return (
    <div className="bug-modal-backdrop" onClick={onCancel} role="dialog" aria-modal="true">
      <div
        className="bug-modal"
        style={{ maxWidth: 380 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bug-modal-header">
          <h2>🔐 관리자 인증</h2>
          <button className="bug-modal-close" onClick={onCancel} aria-label="닫기">
            ✕
          </button>
        </header>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <p className="admin-login-note">
            버그 보고서를 보려면 관리자 비밀번호를 입력해 주세요.<br />
            <small>이 PC에 한 번만 저장됩니다.</small>
          </p>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            disabled={busy}
          />
          {error && <div className="bug-error">{error}</div>}
          <div className="admin-login-actions">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              취소
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !password}>
              {busy ? '확인 중...' : '로그인'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
