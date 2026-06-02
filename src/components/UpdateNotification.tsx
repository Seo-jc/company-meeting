import { useEffect, useState } from 'react';

type Status =
  | { kind: 'idle' }
  | { kind: 'available'; version: string }
  | { kind: 'progress'; percent: number; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

export default function UpdateNotification() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onUpdateStatus) return;
    const off = api.onUpdateStatus((s) => {
      setStatus((prev) => {
        // Preserve version across progress events (electron-updater doesn't send version on progress)
        if (s.kind === 'progress' && prev.kind !== 'idle' && 'version' in prev && prev.version) {
          return { ...s, version: prev.version };
        }
        return s;
      });
      // New events reset dismissal so user sees the latest state
      setDismissed(false);
    });
    return off;
  }, []);

  if (dismissed || status.kind === 'idle') return null;

  if (status.kind === 'error') {
    return (
      <div className="update-banner update-banner-error">
        <span className="update-icon">⚠️</span>
        <div className="update-body">
          <strong>업데이트 확인 실패</strong>
          <small>{status.message}</small>
        </div>
        <button className="update-close" onClick={() => setDismissed(true)} aria-label="닫기">
          ✕
        </button>
      </div>
    );
  }

  if (status.kind === 'available') {
    return (
      <div className="update-banner update-banner-info">
        <span className="update-icon">🔔</span>
        <div className="update-body">
          <strong>새 버전 v{status.version} 발견</strong>
          <small>백그라운드에서 다운로드를 시작합니다...</small>
        </div>
      </div>
    );
  }

  if (status.kind === 'progress') {
    const pct = Math.max(0, Math.min(100, Math.round(status.percent)));
    return (
      <div className="update-banner update-banner-info">
        <span className="update-icon">⬇️</span>
        <div className="update-body">
          <strong>
            새 버전{status.version ? ` v${status.version}` : ''} 다운로드 중... {pct}%
          </strong>
          <div className="update-progress-track">
            <div className="update-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    );
  }

  // status.kind === 'downloaded'
  const handleApply = async () => {
    setApplying(true);
    try {
      await window.electronAPI?.applyUpdate();
    } catch (err) {
      console.error('[updater] apply failed', err);
      setApplying(false);
    }
  };

  return (
    <div className="update-banner update-banner-success">
      <span className="update-icon">✨</span>
      <div className="update-body">
        <strong>업데이트 준비 완료 · v{status.version}</strong>
        <small>지금 적용하시면 새 버전으로 즉시 재시작됩니다.</small>
      </div>
      <div className="update-actions">
        <button
          className="btn-small update-apply"
          onClick={handleApply}
          disabled={applying}
        >
          {applying ? '재시작 중...' : '지금 적용'}
        </button>
        <button
          className="btn-small update-later"
          onClick={() => setDismissed(true)}
        >
          나중에
        </button>
      </div>
    </div>
  );
}
