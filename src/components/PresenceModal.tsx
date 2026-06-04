import { useEffect, useRef, useState } from 'react';
import {
  countryName,
  fetchPresence,
  fetchStats,
  PresenceParticipant,
  UsageStats,
} from '../lib/adminAuth';

type Props = {
  password: string;
  onClose: () => void;
};

const REFRESH_MS = 10000;

function elapsed(connectedAt: number | null, now: number): string {
  if (!connectedAt) return '-';
  const diff = Math.max(0, now - connectedAt);
  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  if (min === 0) return `${sec}초째`;
  if (min < 60) return `${min}분째`;
  const h = Math.floor(min / 60);
  return `${h}시간 ${min % 60}분째`;
}

function formatMinutes(total: number): string {
  if (total < 60) return `${total}분`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export default function PresenceModal({ password, onClose }: Props) {
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
      setError('접속 현황을 가져오지 못했습니다.');
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
            <h2>👥 접속 현황 (관리자 전용)</h2>
            <div className="bug-modal-subtitle">
              실시간 정보는 저장되지 않으며, 통계는 익명 숫자만 집계됩니다
            </div>
          </div>
          <button className="bug-modal-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="bug-modal-toolbar">
          <div className="bug-filter-group">
            <button
              className={`bug-filter ${tab === 'live' ? 'active' : ''}`}
              onClick={() => setTab('live')}
            >
              🟢 현재 접속 ({participants.length})
            </button>
            <button
              className={`bug-filter ${tab === 'stats' ? 'active' : ''}`}
              onClick={() => setTab('stats')}
            >
              📊 사용 통계
            </button>
          </div>
          {tab === 'live' && (
            <button className="btn btn-small" onClick={() => void loadLive()}>
              🔄 새로고침
            </button>
          )}
        </div>

        <div className="bug-modal-body">
          {loading && <div className="bug-empty">불러오는 중...</div>}
          {error && <div className="bug-error">{error}</div>}

          {!loading && tab === 'live' && (
            <>
              {participants.length === 0 ? (
                <div className="bug-empty">
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💤</div>
                  현재 접속 중인 사용자가 없습니다.
                </div>
              ) : (
                Object.entries(byRoom).map(([code, list]) => (
                  <div key={code} className="presence-room-group">
                    <div className="presence-room-header">
                      <span className="presence-room-code">{code}</span>
                      <span className="presence-room-count">{list.length}명</span>
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
                          {elapsed(p.connectedAt, now)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
              <div className="presence-note">
                ⏱ 10초마다 자동 새로고침 · 이 정보는 어디에도 저장되지 않습니다
              </div>
            </>
          )}

          {!loading && tab === 'stats' && stats && (
            <div className="stats-view">
              <div className="stats-cards">
                <div className="stats-card">
                  <div className="stats-card-value">{stats.totalJoins}</div>
                  <div className="stats-card-label">누적 접속 횟수</div>
                </div>
                <div className="stats-card">
                  <div className="stats-card-value">{formatMinutes(stats.totalMinutes)}</div>
                  <div className="stats-card-label">누적 사용 시간</div>
                </div>
              </div>

              <section className="stats-section">
                <h3>국가별 접속</h3>
                {Object.keys(stats.byCountry).length === 0 ? (
                  <p className="stats-empty">아직 데이터가 없습니다</p>
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
                <h3>최근 7일</h3>
                {recentDays.length === 0 ? (
                  <p className="stats-empty">아직 데이터가 없습니다</p>
                ) : (
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>접속</th>
                        <th>사용 시간</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentDays.map(([day, d]) => (
                        <tr key={day}>
                          <td>{day}</td>
                          <td>{d.joins}회</td>
                          <td>{formatMinutes(d.minutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <div className="presence-note">
                📊 이름·IP 없는 익명 통계입니다 (90일 보관 후 자동 삭제)
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
