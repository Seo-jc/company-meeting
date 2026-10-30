// «회사 양식 설정» (관리자 전용) — 회의록 엑셀의 머리에 들어가는 회사 로고·회사명·문서번호를 한 번 정해 서버에 둔다.
// 모든 PC 가 이 값을 받아 쓰고(캐시), 설정이 없으면 로고 칸을 비운 채로 저장된다. 회사 고유값은 소스에 없고 여기서만 들어온다(공개 저장소).
// 로고는 고른 그림을 폭 600px 이하 PNG 로 줄여 서버(상한 400,000자)에 올린다.
// 겹침 확인: AdminLogin.tsx 와 다름 — 그건 관리자 비밀번호를 확인하는 창이고, 이 파일은 로그인한 뒤 회사 양식 값을 고치는 창이다(모양만 같은 모달 틀을 씀).

import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import {
  COMPANY_DOCNO_MAX,
  COMPANY_NAME_MAX,
  refreshCompany,
  saveCompany,
  shrinkLogoToDataUrl,
  type SaveCompanyResult,
} from '../lib/minutes/company';

const STR = {
  ko: {
    title: '🏢 회사 양식 설정',
    subtitle: '회의록 엑셀의 머리에 들어갑니다. 한 번 정하면 모든 PC 가 받아 씁니다.',
    close: '닫기',
    name: '회사명',
    namePh: '엑셀 바닥글 가운데에 들어갑니다',
    docNo: '문서번호',
    docNoPh: '엑셀 바닥글 왼쪽에 들어갑니다',
    logo: '회사 로고',
    logoNone: '로고 없음',
    logoPick: '그림 고르기…',
    logoRemove: '로고 지우기',
    logoHint: '고른 그림은 폭 600px 이하 PNG 로 자동으로 줄여 올립니다. 로고가 없어도 회의록 저장은 됩니다.',
    loading: '현재 설정을 불러오는 중…',
    save: '저장',
    saving: '저장 중…',
    cancel: '닫기',
    ok: '저장했습니다. 다른 PC 에는 몇 분 안에 반영됩니다.',
    logoReadFail: '그림을 읽을 수 없습니다. PNG 나 JPG 파일을 골라 주세요.',
    forbidden: '관리자 비밀번호가 맞지 않습니다. 로비에서 관리자 로그인을 다시 해 주세요.',
    locked: (min: number) => `시도가 너무 많아 잠시 막혔습니다. 약 ${min}분 뒤에 다시 시도해 주세요.`,
    tooLarge: '로고 그림이 너무 큽니다. 더 작은 그림을 골라 주세요.',
    invalid: '입력 값이 서버 규칙에 맞지 않습니다. 회사명·문서번호의 길이와 글자를 확인해 주세요.',
    network: '서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.',
    server: '서버에서 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요(서버에 관리자 비밀번호가 아직 설정되지 않은 경우에도 이 안내가 나옵니다).',
  },
  en: {
    title: '🏢 Company form settings',
    subtitle: 'Goes into the header of the minutes Excel. Set once; every PC picks it up.',
    close: 'Close',
    name: 'Company name',
    namePh: 'Goes in the center of the Excel footer',
    docNo: 'Document no.',
    docNoPh: 'Goes in the left of the Excel footer',
    logo: 'Company logo',
    logoNone: 'No logo',
    logoPick: 'Choose image…',
    logoRemove: 'Remove logo',
    logoHint: 'The image is shrunk to a PNG at most 600px wide before uploading. Minutes can be saved without a logo.',
    loading: 'Loading current settings…',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Close',
    ok: 'Saved. Other PCs pick it up within a few minutes.',
    logoReadFail: 'Could not read the image. Please choose a PNG or JPG file.',
    forbidden: 'The admin password is not accepted. Please log in as admin again from the lobby.',
    locked: (min: number) => `Too many attempts. Try again in about ${min} minute(s).`,
    tooLarge: 'The logo image is too large. Please choose a smaller image.',
    invalid: 'A value does not meet the server rules. Check the length and characters of the name and document number.',
    network: 'Could not reach the server. Check your connection and try again.',
    server: 'The server could not save it. Please try again shortly (this also appears when the server has no admin password configured yet).',
  },
};

type Props = {
  /** 관리자 비밀번호(로비에서 로그인한 값) */
  password: string;
  onClose: () => void;
  /** 비밀번호가 거절되었을 때(저장된 비밀번호를 지우도록 알린다) */
  onAuthFailed?: () => void;
};

export default function CompanyFormSettings({ password, onClose, onAuthFailed }: Props) {
  const t = useT(STR);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [docNo, setDocNo] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const c = await refreshCompany({ fresh: true });
      if (!alive) return;
      if (c) {
        setName(c.name);
        setDocNo(c.docNo);
        setLogo(c.logo);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await shrinkLogoToDataUrl(file);
      setLogo(url);
      setStatus(null);
    } catch {
      setStatus({ kind: 'err', text: t.logoReadFail });
    }
  };

  const message = (r: Extract<SaveCompanyResult, { ok: false }>): string => {
    switch (r.reason) {
      case 'forbidden':
        return t.forbidden;
      case 'locked':
        return t.locked(Math.max(1, Math.ceil((r.retryAfter ?? 600) / 60)));
      case 'too-large':
        return t.tooLarge;
      case 'invalid':
        return t.invalid;
      case 'network':
        return t.network;
      default:
        return t.server;
    }
  };

  const handleSave = async () => {
    setBusy(true);
    setStatus(null);
    const r = await saveCompany(password, { name: name.trim(), docNo: docNo.trim(), logo });
    if (r.ok) {
      // 저장 직후에는 브라우저 캐시를 건너뛰고 서버가 실제로 들고 있는 값을 다시 읽어 보여 준다(캐시 60초 때문에 옛 값이 보이지 않게)
      const c = await refreshCompany({ fresh: true, timeoutMs: 5000 });
      if (c) {
        setName(c.name);
        setDocNo(c.docNo);
        setLogo(c.logo);
      }
      setBusy(false);
      setStatus({ kind: 'ok', text: t.ok });
      return;
    }
    setBusy(false);
    if (r.reason === 'forbidden') onAuthFailed?.();
    setStatus({ kind: 'err', text: message(r) });
  };

  return (
    <div className="bug-modal-backdrop" onClick={busy ? undefined : onClose} role="dialog" aria-modal="true" aria-label={t.title}>
      <div className="bug-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <header className="bug-modal-header">
          <div>
            <h2>{t.title}</h2>
            <div className="bug-modal-subtitle">{t.subtitle}</div>
          </div>
          <button className="bug-modal-close" onClick={onClose} disabled={busy} aria-label={t.close}>
            ✕
          </button>
        </header>
        <div className="mm-company-body">
          {loading && <div className="mm-company-hint">{t.loading}</div>}
          <div className="mm-company-field">
            <label htmlFor="mm-company-name">{t.name}</label>
            <input
              id="mm-company-name"
              type="text"
              value={name}
              maxLength={COMPANY_NAME_MAX}
              placeholder={t.namePh}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="mm-company-field">
            <label htmlFor="mm-company-docno">{t.docNo}</label>
            <input
              id="mm-company-docno"
              type="text"
              value={docNo}
              maxLength={COMPANY_DOCNO_MAX}
              placeholder={t.docNoPh}
              disabled={busy}
              onChange={(e) => setDocNo(e.target.value)}
            />
          </div>
          <div className="mm-company-field">
            <label>{t.logo}</label>
            <div className="mm-company-logo">
              <div className="mm-company-logo-preview">{logo ? <img src={logo} alt={t.logo} /> : t.logoNone}</div>
              <div className="mm-company-logo-actions">
                <button type="button" className="btn-small" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {t.logoPick}
                </button>
                {logo && (
                  <button type="button" className="btn-small" disabled={busy} onClick={() => setLogo(null)}>
                    {t.logoRemove}
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    void pickLogo(f);
                  }}
                />
              </div>
            </div>
            <div className="mm-company-hint">{t.logoHint}</div>
          </div>
          <div className={`mm-company-status ${status?.kind === 'ok' ? 'ok' : status?.kind === 'err' ? 'err' : ''}`} role="status">
            {status?.text ?? ''}
          </div>
        </div>
        <div className="record-confirm-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={busy || loading}>
            {busy ? t.saving : t.save}
          </button>
        </div>
      </div>
    </div>
  );
}
