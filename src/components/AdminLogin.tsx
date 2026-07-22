import { FormEvent, useState } from 'react';
import { setStoredPassword, verifyPassword } from '../lib/adminAuth';
import { useT } from '../i18n';

const STR = {
  ko: {
    title: '🔐 관리자 인증',
    close: '닫기',
    note: '버그 보고서를 보려면 관리자 비밀번호를 입력해 주세요.',
    noteSmall: '이 PC에 한 번만 저장됩니다.',
    placeholder: '비밀번호',
    cancel: '취소',
    loggingIn: '확인 중...',
    login: '로그인',
    errorMismatch: '비밀번호가 일치하지 않거나 서버에 ADMIN_PASSWORD가 아직 설정되지 않았습니다.',
  },
  en: {
    title: '🔐 Admin Authentication',
    close: 'Close',
    note: 'Please enter the admin password to view bug reports.',
    noteSmall: 'This will be saved on this PC only once.',
    placeholder: 'Password',
    cancel: 'Cancel',
    loggingIn: 'Verifying...',
    login: 'Log In',
    errorMismatch: 'The password does not match, or ADMIN_PASSWORD has not been set on the server yet.',
  },
};

type Props = {
  onSuccess: (password: string) => void;
  onCancel: () => void;
};

export default function AdminLogin({ onSuccess, onCancel }: Props) {
  const t = useT(STR);
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
      setError(t.errorMismatch);
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
          <h2>{t.title}</h2>
          <button className="bug-modal-close" onClick={onCancel} aria-label={t.close}>
            ✕
          </button>
        </header>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <p className="admin-login-note">
            {t.note}<br />
            <small>{t.noteSmall}</small>
          </p>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t.placeholder}
            disabled={busy}
          />
          {error && <div className="bug-error">{error}</div>}
          <div className="admin-login-actions">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              {t.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !password}>
              {busy ? t.loggingIn : t.login}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
