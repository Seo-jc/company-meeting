import { useEffect, useState } from 'react';
import {
  autoDiagnose,
  BugReportRecord,
  fetchBugs,
  markBugAction,
} from '../lib/adminAuth';

type Props = {
  password: string;
  onClose: () => void;
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `방금 (${Math.floor(diff / 1000)}초 전)`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return new Date(ts).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SEVERITY_ICON: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '⚪',
};

const TYPE_LABEL: Record<string, string> = {
  'webrtc-failed': 'WebRTC 연결 실패',
  'webrtc-disconnected': 'WebRTC 연결 끊김',
  'js-error': '자바스크립트 에러',
  'unhandled-rejection': 'Promise 거부 미처리',
  'permission-denied': '권한 거부',
  'screen-share-failed': '화면 공유 실패',
  'file-transfer-failed': '파일 전송 실패',
  'update-failed': '업데이트 실패',
  manual: '사용자 신고',
  feedback: '의견 / 기능 제안',
  other: '기타',
};

const FEEDBACK_CAT_LABEL: Record<string, string> = {
  'feature-add': '🆕 기능 추가',
  improvement: '✨ 기존 기능 개선',
  usability: '🤔 사용성 문제',
  other: '💬 기타',
};

export default function BugViewerModal({ password, onClose }: Props) {
  const [reports, setReports] = useState<BugReportRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<BugReportRecord | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical' | 'feedback'>('all');

  const reload = async () => {
    setLoading(true);
    setError('');
    const data = await fetchBugs(password, 100, 0);
    if (!data) {
      setError('서버에서 보고서를 가져오지 못했습니다. 비밀번호가 만료됐을 수도 있습니다.');
      setLoading(false);
      return;
    }
    setReports(data.reports);
    setUnread(data.unread);
    setTotal(data.total);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selected) setSelected(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onClose]);

  const handleMarkRead = async (r: BugReportRecord) => {
    const ok = await markBugAction(password, r.id, 'read');
    if (ok) {
      setReports((prev) =>
        prev.map((x) => (x.id === r.id ? { ...x, read: true } : x))
      );
      setUnread((u) => Math.max(0, u - 1));
    }
  };

  const handleDelete = async (r: BugReportRecord) => {
    if (!confirm('이 보고서를 삭제하시겠습니까?')) return;
    const ok = await markBugAction(password, r.id, 'delete');
    if (ok) {
      setReports((prev) => prev.filter((x) => x.id !== r.id));
      if (selected?.id === r.id) setSelected(null);
      setTotal((t) => Math.max(0, t - 1));
      if (!r.read) setUnread((u) => Math.max(0, u - 1));
    }
  };

  const handleMarkAllRead = async () => {
    const unreadOnes = reports.filter((r) => !r.read);
    for (const r of unreadOnes) {
      // eslint-disable-next-line no-await-in-loop
      await markBugAction(password, r.id, 'read');
    }
    setReports((prev) => prev.map((r) => ({ ...r, read: true })));
    setUnread(0);
  };

  const filtered = reports.filter((r) => {
    if (filter === 'unread') return !r.read;
    if (filter === 'critical') return r.severity === 'critical';
    if (filter === 'feedback') return r.type === 'feedback';
    return true;
  });

  const feedbackCount = reports.filter((r) => r.type === 'feedback').length;

  if (selected) {
    return <BugDetailView report={selected} onBack={() => setSelected(null)} onDelete={() => handleDelete(selected)} />;
  }

  return (
    <div className="bug-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bug-modal" onClick={(e) => e.stopPropagation()}>
        <header className="bug-modal-header">
          <div>
            <h2>🐞 자동 수집 버그 보고서</h2>
            <div className="bug-modal-subtitle">
              총 {total}건 · 새 보고서 {unread}건
            </div>
          </div>
          <button className="bug-modal-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="bug-modal-toolbar">
          <div className="bug-filter-group">
            <button
              className={`bug-filter ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              전체 ({reports.length})
            </button>
            <button
              className={`bug-filter ${filter === 'unread' ? 'active' : ''}`}
              onClick={() => setFilter('unread')}
            >
              새것 ({unread})
            </button>
            <button
              className={`bug-filter ${filter === 'critical' ? 'active' : ''}`}
              onClick={() => setFilter('critical')}
            >
              🔴 심각
            </button>
            <button
              className={`bug-filter ${filter === 'feedback' ? 'active' : ''}`}
              onClick={() => setFilter('feedback')}
            >
              💡 의견 ({feedbackCount})
            </button>
          </div>
          <div className="bug-actions">
            <button className="btn btn-small" onClick={() => void reload()} disabled={loading}>
              🔄 새로고침
            </button>
            <button className="btn btn-small" onClick={() => void handleMarkAllRead()} disabled={unread === 0}>
              모두 읽음
            </button>
          </div>
        </div>

        <div className="bug-modal-body">
          {loading && <div className="bug-empty">불러오는 중...</div>}
          {error && <div className="bug-error">{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className="bug-empty">표시할 보고서가 없습니다.</div>
          )}
          {!loading && !error && filtered.map((r) => {
            const hint = autoDiagnose(r);
            return (
              <article key={r.id} className={`bug-item ${r.read ? '' : 'bug-item-unread'}`}>
                <div className="bug-item-main">
                  <div className="bug-item-row">
                    <span className="bug-sev">
                      {r.type === 'feedback' ? '💡' : SEVERITY_ICON[r.severity] ?? '⚪'}
                    </span>
                    {!r.read && <span className="bug-new-tag">새</span>}
                    <span className="bug-item-title">
                      {r.type === 'feedback' && r.feedbackCategory
                        ? FEEDBACK_CAT_LABEL[r.feedbackCategory] ?? '의견'
                        : TYPE_LABEL[r.type] ?? r.type}
                    </span>
                  </div>
                  <div className="bug-item-meta">
                    {timeAgo(r.ts)} · v{r.appVersion} · {r.os}
                    {r.submitterName && ` · ${r.submitterName}`}
                  </div>
                  <div className="bug-item-msg">
                    {r.userDescription || r.message}
                  </div>
                  {hint && <div className="bug-item-hint">{hint}</div>}
                </div>
                <div className="bug-item-actions">
                  <button className="btn-small" onClick={() => setSelected(r)}>
                    상세 →
                  </button>
                  {!r.read && (
                    <button className="btn-small" onClick={() => void handleMarkRead(r)}>
                      읽음
                    </button>
                  )}
                  <button className="btn-small bug-item-delete" onClick={() => void handleDelete(r)}>
                    ✕
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BugDetailView({
  report: r,
  onBack,
  onDelete,
}: {
  report: BugReportRecord;
  onBack: () => void;
  onDelete: () => void;
}) {
  const hint = autoDiagnose(r);
  return (
    <div className="bug-modal-backdrop" onClick={onBack} role="dialog" aria-modal="true">
      <div className="bug-modal" onClick={(e) => e.stopPropagation()}>
        <header className="bug-modal-header">
          <button className="bug-back" onClick={onBack}>← 목록으로</button>
          <button className="bug-modal-close" onClick={onBack} aria-label="닫기">
            ✕
          </button>
        </header>
        <div className="bug-modal-body bug-detail">
          <h2>
            {r.type === 'feedback' ? '💡' : SEVERITY_ICON[r.severity] ?? '⚪'}{' '}
            {r.type === 'feedback' && r.feedbackCategory
              ? FEEDBACK_CAT_LABEL[r.feedbackCategory] ?? '의견'
              : TYPE_LABEL[r.type] ?? r.type}
          </h2>
          <div className="bug-detail-time">
            {new Date(r.ts).toLocaleString('ko-KR')}
            {r.submitterName && ` · 보낸 사람: ${r.submitterName}`}
          </div>

          {hint && (
            <div className="bug-diagnose">
              <strong>자동 진단:</strong> {hint}
            </div>
          )}

          {r.userDescription && (
            <section className="bug-detail-section">
              <h3>사용자 메모</h3>
              <p className="bug-user-desc">{r.userDescription}</p>
            </section>
          )}

          <section className="bug-detail-section">
            <h3>에러 메시지</h3>
            <pre className="bug-msg-block">{r.message}</pre>
          </section>

          <section className="bug-detail-section">
            <h3>기본 정보</h3>
            <table className="bug-info-table">
              <tbody>
                <tr><td>앱 버전</td><td>{r.appVersion}</td></tr>
                <tr><td>운영체제</td><td>{r.os} {r.arch ? `(${r.arch})` : ''}</td></tr>
                <tr><td>지역/언어</td><td>{r.locale} / {r.tz}</td></tr>
                {r.roomCodeMasked && <tr><td>회의 코드</td><td>{r.roomCodeMasked}</td></tr>}
                {r.participantCount !== undefined && (
                  <tr><td>참가자 수</td><td>{r.participantCount}명</td></tr>
                )}
              </tbody>
            </table>
          </section>

          {r.details && Object.keys(r.details).length > 0 && (
            <section className="bug-detail-section">
              <h3>상세 정보</h3>
              <pre className="bug-msg-block">{JSON.stringify(r.details, null, 2)}</pre>
            </section>
          )}

          {r.logs && r.logs.length > 0 && (
            <section className="bug-detail-section">
              <h3>최근 로그 ({r.logs.length}개)</h3>
              <div className="bug-logs">
                {r.logs.map((l, i) => (
                  <div key={i} className={`bug-log bug-log-${l.level}`}>
                    <span className="bug-log-time">
                      {new Date(l.ts).toLocaleTimeString('ko-KR')}
                    </span>
                    <span className="bug-log-level">[{l.level}]</span>
                    <span className="bug-log-msg">{l.msg}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="bug-detail-footer">
            <button className="btn btn-small bug-item-delete" onClick={onDelete}>
              삭제
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
