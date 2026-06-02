import { useEffect, useRef, useState } from 'react';

type Props = {
  onClose: () => void;
};

export default function Manual({ onClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);

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
          <h2>📖 사용자 메뉴얼</h2>
          <div className="manual-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={handlePrint}
              title="시스템 인쇄 대화상자를 열어 PDF로 저장하거나 인쇄할 수 있습니다"
            >
              🖨️ PDF 저장 / 인쇄
            </button>
            <button
              type="button"
              className="manual-close"
              onClick={onClose}
              title="닫기 (Esc)"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        </header>
        <div className="manual-body">
          {loading && (
            <div className="manual-loading">메뉴얼을 불러오는 중...</div>
          )}
          <iframe
            ref={iframeRef}
            src="./manual.html"
            className="manual-iframe"
            title="사용자 메뉴얼"
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    </div>
  );
}
