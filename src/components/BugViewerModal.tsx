import { useEffect, useState } from 'react';
import {
  autoDiagnose,
  BugReportRecord,
  fetchBugs,
  markBugAction,
} from '../lib/adminAuth';
import { useT } from '../i18n';

type Props = {
  password: string;
  onClose: () => void;
};

const STR = {
  ko: {
    justNow: (sec: number) => `방금 (${sec}초 전)`,
    minutesAgo: (m: number) => `${m}분 전`,
    hoursAgo: (h: number) => `${h}시간 전`,
    typeWebrtcFailed: 'WebRTC 연결 실패',
    typeWebrtcDisconnected: 'WebRTC 연결 끊김',
    typeJsError: '자바스크립트 에러',
    typeUnhandledRejection: 'Promise 거부 미처리',
    typePermissionDenied: '권한 거부',
    typeScreenShareFailed: '화면 공유 실패',
    typeFileTransferFailed: '파일 전송 실패',
    typeUpdateFailed: '업데이트 실패',
    typeManual: '사용자 신고',
    typeFeedback: '의견 / 기능 제안',
    typeOther: '기타',
    feedbackCatFeatureAdd: '🆕 기능 추가',
    feedbackCatImprovement: '✨ 기존 기능 개선',
    feedbackCatUsability: '🤔 사용성 문제',
    feedbackCatOther: '💬 기타',
    feedbackFallback: '의견',
    fetchError: '서버에서 보고서를 가져오지 못했습니다. 비밀번호가 만료됐을 수도 있습니다.',
    confirmDelete: '이 보고서를 삭제하시겠습니까?',
    title: '🐞 자동 수집 버그 보고서',
    subtitle: (total: number, unread: number) => `총 ${total}건 · 새 보고서 ${unread}건`,
    close: '닫기',
    filterAll: (n: number) => `전체 (${n})`,
    filterUnread: (n: number) => `새것 (${n})`,
    filterCritical: '🔴 심각',
    filterFeedback: (n: number) => `💡 의견 (${n})`,
    refresh: '🔄 새로고침',
    markAllRead: '모두 읽음',
    loading: '불러오는 중...',
    empty: '표시할 보고서가 없습니다.',
    newTag: '새',
    detail: '상세 →',
    markRead: '읽음',
    backToList: '← 목록으로',
    sentBy: (name: string) => ` · 보낸 사람: ${name}`,
    autoDiagnoseLabel: '자동 진단:',
    userNoteSection: '사용자 메모',
    errorMessageSection: '에러 메시지',
    basicInfoSection: '기본 정보',
    appVersionLabel: '앱 버전',
    osLabel: '운영체제',
    localeLabel: '지역/언어',
    roomCodeLabel: '회의 코드',
    participantCountLabel: '참가자 수',
    participantUnit: '명',
    detailsSection: '상세 정보',
    logsSection: (n: number) => `최근 로그 (${n}개)`,
    delete: '삭제',
  },
  en: {
    justNow: (sec: number) => `Just now (${sec}s ago)`,
    minutesAgo: (m: number) => `${m}m ago`,
    hoursAgo: (h: number) => `${h}h ago`,
    typeWebrtcFailed: 'WebRTC connection failed',
    typeWebrtcDisconnected: 'WebRTC connection dropped',
    typeJsError: 'JavaScript error',
    typeUnhandledRejection: 'Unhandled promise rejection',
    typePermissionDenied: 'Permission denied',
    typeScreenShareFailed: 'Screen share failed',
    typeFileTransferFailed: 'File transfer failed',
    typeUpdateFailed: 'Update failed',
    typeManual: 'User report',
    typeFeedback: 'Feedback / feature request',
    typeOther: 'Other',
    feedbackCatFeatureAdd: '🆕 New feature',
    feedbackCatImprovement: '✨ Improve existing feature',
    feedbackCatUsability: '🤔 Usability issue',
    feedbackCatOther: '💬 Other',
    feedbackFallback: 'Feedback',
    fetchError: 'Could not fetch reports from the server. The password may have expired.',
    confirmDelete: 'Delete this report?',
    title: '🐞 Auto-collected Bug Reports',
    subtitle: (total: number, unread: number) => `${total} total · ${unread} new`,
    close: 'Close',
    filterAll: (n: number) => `All (${n})`,
    filterUnread: (n: number) => `New (${n})`,
    filterCritical: '🔴 Critical',
    filterFeedback: (n: number) => `💡 Feedback (${n})`,
    refresh: '🔄 Refresh',
    markAllRead: 'Mark all read',
    loading: 'Loading...',
    empty: 'No reports to show.',
    newTag: 'New',
    detail: 'Detail →',
    markRead: 'Mark read',
    backToList: '← Back to list',
    sentBy: (name: string) => ` · Sent by: ${name}`,
    autoDiagnoseLabel: 'Auto diagnosis:',
    userNoteSection: 'User note',
    errorMessageSection: 'Error message',
    basicInfoSection: 'Basic info',
    appVersionLabel: 'App version',
    osLabel: 'OS',
    localeLabel: 'Locale/Timezone',
    roomCodeLabel: 'Meeting code',
    participantCountLabel: 'Participants',
    participantUnit: '',
    detailsSection: 'Details',
    logsSection: (n: number) => `Recent logs (${n})`,
    delete: 'Delete',
  },
};

function timeAgo(ts: number, t: ReturnType<typeof useT<typeof STR>>): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t.justNow(Math.floor(diff / 1000));
  if (diff < 3_600_000) return t.minutesAgo(Math.floor(diff / 60_000));
  if (diff < 86_400_000) return t.hoursAgo(Math.floor(diff / 3_600_000));
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

type T = ReturnType<typeof useT<typeof STR>>;

function typeLabel(t: T, type: string): string {
  const map: Record<string, string> = {
    'webrtc-failed': t.typeWebrtcFailed,
    'webrtc-disconnected': t.typeWebrtcDisconnected,
    'js-error': t.typeJsError,
    'unhandled-rejection': t.typeUnhandledRejection,
    'permission-denied': t.typePermissionDenied,
    'screen-share-failed': t.typeScreenShareFailed,
    'file-transfer-failed': t.typeFileTransferFailed,
    'update-failed': t.typeUpdateFailed,
    manual: t.typeManual,
    feedback: t.typeFeedback,
    other: t.typeOther,
  };
  return map[type] ?? type;
}

function feedbackCatLabel(t: T, cat: string | undefined): string {
  const map: Record<string, string> = {
    'feature-add': t.feedbackCatFeatureAdd,
    improvement: t.feedbackCatImprovement,
    usability: t.feedbackCatUsability,
    other: t.feedbackCatOther,
  };
  return (cat && map[cat]) ?? t.feedbackFallback;
}

export default function BugViewerModal({ password, onClose }: Props) {
  const t = useT(STR);
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
      setError(t.fetchError);
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
    if (!confirm(t.confirmDelete)) return;
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
            <h2>{t.title}</h2>
            <div className="bug-modal-subtitle">
              {t.subtitle(total, unread)}
            </div>
          </div>
          <button className="bug-modal-close" onClick={onClose} aria-label={t.close}>
            ✕
          </button>
        </header>

        <div className="bug-modal-toolbar">
          <div className="bug-filter-group">
            <button
              className={`bug-filter ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              {t.filterAll(reports.length)}
            </button>
            <button
              className={`bug-filter ${filter === 'unread' ? 'active' : ''}`}
              onClick={() => setFilter('unread')}
            >
              {t.filterUnread(unread)}
            </button>
            <button
              className={`bug-filter ${filter === 'critical' ? 'active' : ''}`}
              onClick={() => setFilter('critical')}
            >
              {t.filterCritical}
            </button>
            <button
              className={`bug-filter ${filter === 'feedback' ? 'active' : ''}`}
              onClick={() => setFilter('feedback')}
            >
              {t.filterFeedback(feedbackCount)}
            </button>
          </div>
          <div className="bug-actions">
            <button className="btn btn-small" onClick={() => void reload()} disabled={loading}>
              {t.refresh}
            </button>
            <button className="btn btn-small" onClick={() => void handleMarkAllRead()} disabled={unread === 0}>
              {t.markAllRead}
            </button>
          </div>
        </div>

        <div className="bug-modal-body">
          {loading && <div className="bug-empty">{t.loading}</div>}
          {error && <div className="bug-error">{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className="bug-empty">{t.empty}</div>
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
                    {!r.read && <span className="bug-new-tag">{t.newTag}</span>}
                    <span className="bug-item-title">
                      {r.type === 'feedback'
                        ? feedbackCatLabel(t, r.feedbackCategory)
                        : typeLabel(t, r.type)}
                    </span>
                  </div>
                  <div className="bug-item-meta">
                    {timeAgo(r.ts, t)} · v{r.appVersion} · {r.os}
                    {r.submitterName && ` · ${r.submitterName}`}
                  </div>
                  <div className="bug-item-msg">
                    {r.userDescription || r.message}
                  </div>
                  {hint && <div className="bug-item-hint">{hint}</div>}
                </div>
                <div className="bug-item-actions">
                  <button className="btn-small" onClick={() => setSelected(r)}>
                    {t.detail}
                  </button>
                  {!r.read && (
                    <button className="btn-small" onClick={() => void handleMarkRead(r)}>
                      {t.markRead}
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
  const t = useT(STR);
  const hint = autoDiagnose(r);
  return (
    <div className="bug-modal-backdrop" onClick={onBack} role="dialog" aria-modal="true">
      <div className="bug-modal" onClick={(e) => e.stopPropagation()}>
        <header className="bug-modal-header">
          <button className="bug-back" onClick={onBack}>{t.backToList}</button>
          <button className="bug-modal-close" onClick={onBack} aria-label={t.close}>
            ✕
          </button>
        </header>
        <div className="bug-modal-body bug-detail">
          <h2>
            {r.type === 'feedback' ? '💡' : SEVERITY_ICON[r.severity] ?? '⚪'}{' '}
            {r.type === 'feedback'
              ? feedbackCatLabel(t, r.feedbackCategory)
              : typeLabel(t, r.type)}
          </h2>
          <div className="bug-detail-time">
            {new Date(r.ts).toLocaleString('ko-KR')}
            {r.submitterName && t.sentBy(r.submitterName)}
          </div>

          {hint && (
            <div className="bug-diagnose">
              <strong>{t.autoDiagnoseLabel}</strong> {hint}
            </div>
          )}

          {r.userDescription && (
            <section className="bug-detail-section">
              <h3>{t.userNoteSection}</h3>
              <p className="bug-user-desc">{r.userDescription}</p>
            </section>
          )}

          <section className="bug-detail-section">
            <h3>{t.errorMessageSection}</h3>
            <pre className="bug-msg-block">{r.message}</pre>
          </section>

          <section className="bug-detail-section">
            <h3>{t.basicInfoSection}</h3>
            <table className="bug-info-table">
              <tbody>
                <tr><td>{t.appVersionLabel}</td><td>{r.appVersion}</td></tr>
                <tr><td>{t.osLabel}</td><td>{r.os} {r.arch ? `(${r.arch})` : ''}</td></tr>
                <tr><td>{t.localeLabel}</td><td>{r.locale} / {r.tz}</td></tr>
                {r.roomCodeMasked && <tr><td>{t.roomCodeLabel}</td><td>{r.roomCodeMasked}</td></tr>}
                {r.participantCount !== undefined && (
                  <tr><td>{t.participantCountLabel}</td><td>{r.participantCount}{t.participantUnit}</td></tr>
                )}
              </tbody>
            </table>
          </section>

          {r.details && Object.keys(r.details).length > 0 && (
            <section className="bug-detail-section">
              <h3>{t.detailsSection}</h3>
              <pre className="bug-msg-block">{JSON.stringify(r.details, null, 2)}</pre>
            </section>
          )}

          {r.logs && r.logs.length > 0 && (
            <section className="bug-detail-section">
              <h3>{t.logsSection(r.logs.length)}</h3>
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
              {t.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
