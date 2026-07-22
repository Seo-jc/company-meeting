import { useEffect, useRef, useState } from 'react';
import {
  countryName,
  fetchPresence,
  fetchStats,
  PresenceParticipant,
  UsageStats,
} from '../lib/adminAuth';
import { useT } from '../i18n';

type Props = {
  password: string;
  onClose: () => void;
};

const REFRESH_MS = 10000;

const STR = {
  ko: {
    title: '👥 접속 현황 (관리자 전용)',
    subtitle: '실시간 정보는 저장되지 않으며, 통계는 익명 숫자만 집계됩니다',
    close: '닫기',
    tabLive: (n: number) => `🟢 현재 접속 (${n})`,
    tabStats: '📊 사용 통계',
    refresh: '🔄 새로고침',
    loading: '불러오는 중...',
    fetchError: '접속 현황을 가져오지 못했습니다.',
    noParticipants: '현재 접속 중인 사용자가 없습니다.',
    peopleUnit: '명',
    liveNote: '⏱ 10초마다 자동 새로고침 · 이 정보는 어디에도 저장되지 않습니다',
    totalJoins: '누적 접속 횟수',
    totalMinutes: '누적 사용 시간',
    byCountry: '국가별 접속',
    noData: '아직 데이터가 없습니다',
    last7Days: '최근 7일',
    colDate: '날짜',
    colJoins: '접속',
    colDuration: '사용 시간',
    timesUnit: '회',
    statsNote: '📊 이름·IP 없는 익명 통계입니다 (90일 보관 후 자동 삭제)',
    secAgo: (n: number) => `${n}초째`,
    minAgo: (n: number) => `${n}분째`,
    hourMinAgo: (h: number, m: number) => `${h}시간 ${m}분째`,
    minutesShort: (n: number) => `${n}분`,
    hoursShort: (n: number) => `${n}시간`,
    hoursMinutesShort: (h: number, m: number) => `${h}시간 ${m}분`,
  },
  en: {
    title: '👥 Presence (Admin Only)',
    subtitle: 'Live data is not stored; statistics only aggregate anonymous counts',
    close: 'Close',
    tabLive: (n: number) => `🟢 Currently Online (${n})`,
    tabStats: '📊 Usage Stats',
    refresh: '🔄 Refresh',
    loading: 'Loading...',
    fetchError: 'Failed to load presence data.',
    noParticipants: 'No users are currently online.',
    peopleUnit: '',
    liveNote: '⏱ Auto-refreshes every 10 seconds · this information is not stored anywhere',
    totalJoins: 'Total Joins',
    totalMinutes: 'Total Usage Time',
    byCountry: 'By Country',
    noData: 'No data yet',
    last7Days: 'Last 7 Days',
    colDate: 'Date',
    colJoins: 'Joins',
    colDuration: 'Duration',
    timesUnit: '',
    statsNote: '📊 Anonymous stats with no names or IPs (auto-deleted after 90 days)',
    secAgo: (n: number) => `${n}s`,
    minAgo: (n: number) => `${n}m`,
    hourMinAgo: (h: number, m: number) => `${h}h ${m}m`,
    minutesShort: (n: number) => `${n}m`,
    hoursShort: (n: number) => `${n}h`,
    hoursMinutesShort: (h: number, m: number) => `${h}h ${m}m`,
  },
};

function elapsed(connectedAt: number | null, now: number, t: typeof STR.ko): string {
  if (!connectedAt) return '-';
  const diff = Math.max(0, now - connectedAt);
  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  if (min === 0) return t.secAgo(sec);
  if (min < 60) return t.minAgo(min);
  const h = Math.floor(min / 60);
  return t.hourMinAgo(h, min % 60);
}

function formatMinutes(total: number, t: typeof STR.ko): string {
  if (total < 60) return t.minutesShort(total);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? t.hoursShort(h) : t.hoursMinutesShort(h, m);
}

export default function PresenceModal({ password, onClose }: Props) {
  const t = useT(STR);
  const [tab, setTab] = useState<'live' | 'stats'>('live');
  const [participants, setParticipants] = useState<PresenceParticipant[]>([]);
  const [now, setNow] = useState(Date.now());
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timerRef = useRef<number | null>(null);

  const loadLive = async () => {
    const data = await fetchPresence(password);
    if (data === null) {
      setError(t.fetchError);
      return;
    }
    setError('');
    setParticipants(data.participants);
    setNow(data.now);
  };

  const loadStats = async () => {
    const data = await fetchStats(password);
    if (data) setStats(data);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    void Promise.all([loadLive(), loadStats()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh live tab.
  useEffect(() => {
    if (tab !== 'live') {
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    timerRef.current = window.setInterval(() => void loadLive(), REFRESH_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Group live participants by room.
  const byRoom = participants.reduce<Record<string, PresenceParticipant[]>>((acc, p) => {
    (acc[p.roomCode] = acc[p.roomCode] ?? []).push(p);
    return acc;
  }, {});

  const recentDays = stats
    ? Object.entries(stats.byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7)
    : [];
  const maxCountry = stats
    ? Math.max(1, ...Object.values(stats.byCountry))
    : 1;

  return (
    <div className="bug-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bug-modal" onClick={(e) => e.stopPropagation()}>
        <header className="bug-modal-header" style={{ background: 'linear-gradient(135deg, #1f3a4d 0%, #1d2026 100%)' }}>
          <div>
            <h2>{t.title}</h2>
            <div className="bug-modal-subtitle">
              {t.subtitle}
            </div>
          </div>
          <button className="bug-modal-close" onClick={onClose} aria-label={t.close}>
            ✕
          </button>
        </header>

        <div className="bug-modal-toolbar">
          <div className="bug-filter-group">
            <button
              className={`bug-filter ${tab === 'live' ? 'active' : ''}`}
              onClick={() => setTab('live')}
            >
              {t.tabLive(participants.length)}
            </button>
            <button
              className={`bug-filter ${tab === 'stats' ? 'active' : ''}`}
              onClick={() => setTab('stats')}
            >
              {t.tabStats}
            </button>
          </div>
          {tab === 'live' && (
            <button className="btn btn-small" onClick={() => void loadLive()}>
              {t.refresh}
            </button>
          )}
        </div>

        <div className="bug-modal-body">
          {loading && <div className="bug-empty">{t.loading}</div>}
          {error && <div className="bug-error">{error}</div>}

          {!loading && tab === 'live' && (
            <>
              {participants.length === 0 ? (
                <div className="bug-empty">
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💤</div>
                  {t.noParticipants}
                </div>
              ) : (
                Object.entries(byRoom).map(([code, list]) => (
                  <div key={code} className="presence-room-group">
                    <div className="presence-room-header">
                      <span className="presence-room-code">{code}</span>
                      <span className="presence-room-count">{list.length}{t.peopleUnit}</span>
                    </div>
                    {list.map((p, i) => (
                      <div key={i} className="presence-item">
                        <span className="presence-dot" />
                        <div className="presence-info">
                          <div className="presence-name">{p.displayName}</div>
                          <div className="presence-meta">
                            {countryName(p.country)}
                            {p.city ? ` · ${p.city}` : ''} · {p.ipMasked}
                          </div>
                        </div>
                        <div className="presence-elapsed">
                          {elapsed(p.connectedAt, now, t)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
              <div className="presence-note">
                {t.liveNote}
              </div>
            </>
          )}

          {!loading && tab === 'stats' && stats && (
            <div className="stats-view">
              <div className="stats-cards">
                <div className="stats-card">
                  <div className="stats-card-value">{stats.totalJoins}</div>
                  <div className="stats-card-label">{t.totalJoins}</div>
                </div>
                <div className="stats-card">
                  <div className="stats-card-value">{formatMinutes(stats.totalMinutes, t)}</div>
                  <div className="stats-card-label">{t.totalMinutes}</div>
                </div>
              </div>

              <section className="stats-section">
                <h3>{t.byCountry}</h3>
                {Object.keys(stats.byCountry).length === 0 ? (
                  <p className="stats-empty">{t.noData}</p>
                ) : (
                  Object.entries(stats.byCountry)
                    .sort((a, b) => b[1] - a[1])
                    .map(([code, count]) => (
                      <div key={code} className="stats-bar-row">
                        <span className="stats-bar-label">{countryName(code)}</span>
                        <div className="stats-bar-track">
                          <div
                            className="stats-bar-fill"
                            style={{ width: `${(count / maxCountry) * 100}%` }}
                          />
                        </div>
                        <span className="stats-bar-value">{count}</span>
                      </div>
                    ))
                )}
              </section>

              <section className="stats-section">
                <h3>{t.last7Days}</h3>
                {recentDays.length === 0 ? (
                  <p className="stats-empty">{t.noData}</p>
                ) : (
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th>{t.colDate}</th>
                        <th>{t.colJoins}</th>
                        <th>{t.colDuration}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentDays.map(([day, d]) => (
                        <tr key={day}>
                          <td>{day}</td>
                          <td>{d.joins}{t.timesUnit}</td>
                          <td>{formatMinutes(d.minutes, t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <div className="presence-note">
                {t.statsNote}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
