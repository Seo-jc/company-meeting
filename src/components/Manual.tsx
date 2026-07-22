import { useEffect, useRef, useState } from 'react';
import { useT, useLang } from '../i18n';

type Props = {
  onClose: () => void;
};

const STR = {
  ko: {
    title: '📖 사용자 메뉴얼',
    printBtn: '🖨️ PDF 저장 / 인쇄',
    printTitle: '시스템 인쇄 대화상자를 열어 PDF로 저장하거나 인쇄할 수 있습니다',
    closeTitle: '닫기 (Esc)',
    closeLabel: '닫기',
    iframeTitle: '사용자 메뉴얼',
    loading: '메뉴얼을 불러오는 중...',
  },
  en: {
    title: '📖 User Manual',
    printBtn: '🖨️ Save as PDF / Print',
    printTitle: 'Opens the system print dialog to save as PDF or print',
    closeTitle: 'Close (Esc)',
    closeLabel: 'Close',
    iframeTitle: 'User Manual',
    loading: 'Loading manual...',
  },
};

export default function Manual({ onClose }: Props) {
  const t = useT(STR);
  const { lang } = useLang();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const manualSrc = lang === 'en' ? './manual.en.html' : './manual.html';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.focus();
      win.print();
    }
  };

  return (
    <div className="manual-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="manual-modal" onClick={(e) => e.stopPropagation()}>
        <header className="manual-header">
          <h2>{t.title}</h2>
          <div className="manual-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={handlePrint}
              title={t.printTitle}
            >
              {t.printBtn}
            </button>
            <button
              type="button"
              className="manual-close"
              onClick={onClose}
              title={t.closeTitle}
              aria-label={t.closeLabel}
            >
              ✕
            </button>
          </div>
        </header>
        <div className="manual-body">
          {loading && (
            <div className="manual-loading">{t.loading}</div>
          )}
          <iframe
            ref={iframeRef}
            src={manualSrc}
            className="manual-iframe"
            title={t.iframeTitle}
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    </div>
  );
}
