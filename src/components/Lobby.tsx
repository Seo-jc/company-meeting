import { useEffect, useRef, useState } from 'react';
import Logo from './Logo';
import AudioDevices from './AudioDevices';
import Manual from './Manual';
import AdminLogin from './AdminLogin';
import BugViewerModal from './BugViewerModal';
import FeedbackModal from './FeedbackModal';
import PromoteRenameDialog from './PromoteRenameDialog';
import PresenceModal from './PresenceModal';
import {
  fetchBugs,
  getStoredPassword,
  clearStoredPassword,
} from '../lib/adminAuth';

const SIGNALING_HTTP_BASE =
  (import.meta as any).env?.VITE_SIGNALING_URL?.replace(
    /^wss:/i,
    'https:'
  )?.replace(/\/?$/, '') ?? 'https://meet-sig.jcseo.workers.dev';

const STATUS_POLL_MS = 8000;

const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MIN_CODE_LENGTH = 4;
const MAX_CODE_LENGTH = 10;
const DEFAULT_CODE_LENGTH = 6;
const SAVED_KEY = 'savedMeetings:v1';
const RECENT_KEY = 'recentMeetings:v1';
const LAST_NAME_KEY = 'lastDisplayName';
const MAX_RECENT = 10;

type SavedMeeting = {
  id: string;
  name: string;
  code: string;
};

type RecentMeeting = {
  id: string;
  name: string;
  code: string;
  joinedAt: number;
};

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < DEFAULT_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function isValidCode(code: string): boolean {
  return /^[A-Z0-9]{4,10}$/.test(code);
}

function loadSaved(): SavedMeeting[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSaved(list: SavedMeeting[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

function loadRecent(): RecentMeeting[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistRecent(list: RecentMeeting[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

function withRecent(
  current: RecentMeeting[],
  item: { name: string; code: string }
): RecentMeeting[] {
  const idx = current.findIndex((r) => r.code === item.code);
  const now = Date.now();
  let next: RecentMeeting[];
  if (idx >= 0) {
    next = current.slice();
    next[idx] = {
      ...next[idx],
      name: item.name || next[idx].name,
      joinedAt: now,
    };
  } else {
    next = [
      { id: crypto.randomUUID(), name: item.name, code: item.code, joinedAt: now },
      ...current,
    ];
  }
  next.sort((a, b) => b.joinedAt - a.joinedAt);
  return next.slice(0, MAX_RECENT);
}

type Props = {
  onJoin: (
    roomCode: string,
    displayName: string,
    meetingTitle?: string
  ) => void;
};

export default function Lobby({ onJoin }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [savedMeetings, setSavedMeetings] = useState<SavedMeeting[]>([]);
  const [recentMeetings, setRecentMeetings] = useState<RecentMeeting[]>([]);
  const [roomCounts, setRoomCounts] = useState<Record<string, number>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMeetingName, setNewMeetingName] = useState('');
  const [newMeetingCode, setNewMeetingCode] = useState('');
  const [error, setError] = useState('');
  const [showManual, setShowManual] = useState(false);
  // Admin bug viewer
  const [adminPassword, setAdminPassword] = useState<string | null>(
    () => getStoredPassword()
  );
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showBugViewer, setShowBugViewer] = useState(false);
  const [showPresence, setShowPresence] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [renamingMeeting, setRenamingMeeting] = useState<RecentMeeting | null>(null);
  const [bugUnread, setBugUnread] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    setSavedMeetings(loadSaved());
    setRecentMeetings(loadRecent());
    const lastName = localStorage.getItem(LAST_NAME_KEY);
    if (lastName) setDisplayName(lastName);
  }, []);

  // Hidden activation shortcut: Ctrl+Shift+B opens admin login (or viewer if already auth'd)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault();
        if (adminPassword) {
          setShowBugViewer(true);
        } else {
          setShowAdminLogin(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adminPassword]);

  // Periodically refresh unread count for admin users.
  useEffect(() => {
    if (!adminPassword) return;
    let stopped = false;
    const refresh = async () => {
      const data = await fetchBugs(adminPassword, 1, 0);
      if (stopped) return;
      if (data === null) {
        // Password no longer valid → reset auth
        clearStoredPassword();
        setAdminPassword(null);
        setBugUnread(0);
        return;
      }
      setBugUnread(data.unread);
    };
    void refresh();
    const t = window.setInterval(() => void refresh(), 60_000);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [adminPassword]);

  const recordRecent = (name: string, code: string) => {
    const next = withRecent(recentMeetings, { name, code });
    setRecentMeetings(next);
    persistRecent(next);
  };

  // Hide recent entries that are already in the saved list (avoid duplicate display).
  const savedCodes = new Set(savedMeetings.map((m) => m.code));
  const visibleRecent = recentMeetings.filter((r) => !savedCodes.has(r.code));

  // Poll participant counts for saved meetings.
  useEffect(() => {
    cancelledRef.current = false;
    if (savedMeetings.length === 0) {
      setRoomCounts({});
      return;
    }

    const fetchCounts = async () => {
      const next: Record<string, number> = {};
      await Promise.all(
        savedMeetings.map(async (m) => {
          try {
            const res = await fetch(
              `${SIGNALING_HTTP_BASE}/room/${m.code}/debug`,
              { cache: 'no-store' }
            );
            if (res.ok) {
              const data = await res.json();
              next[m.code] = typeof data.wsCount === 'number' ? data.wsCount : 0;
            } else {
              next[m.code] = 0;
            }
          } catch {
            next[m.code] = 0;
          }
        })
      );
      if (!cancelledRef.current) setRoomCounts(next);
    };

    fetchCounts();
    const interval = setInterval(fetchCounts, STATUS_POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [savedMeetings]);

  const trimmedName = displayName.trim();
  const trimmedCustomCode = customCode.trim().toUpperCase();
  const trimmedJoinCode = joinCode.trim().toUpperCase();

  const persistName = (name: string) => {
    try {
      localStorage.setItem(LAST_NAME_KEY, name);
    } catch {
      // ignore
    }
  };

  const requireName = (): boolean => {
    if (!trimmedName) {
      setError('이름을 먼저 입력해주세요');
      return false;
    }
    setError('');
    return true;
  };

  const handleCreate = () => {
    if (!requireName()) return;
    if (trimmedCustomCode && !isValidCode(trimmedCustomCode)) {
      setError('회의 코드는 영문 대문자 + 숫자 4~10자입니다');
      return;
    }
    const code = trimmedCustomCode || generateRoomCode();
    persistName(trimmedName);
    recordRecent('', code);
    onJoin(code, trimmedName);
  };

  const handleJoin = () => {
    if (!requireName()) return;
    if (!isValidCode(trimmedJoinCode)) {
      setError('참가 코드는 영문 대문자 + 숫자 4~10자입니다');
      return;
    }
    persistName(trimmedName);
    recordRecent('', trimmedJoinCode);
    onJoin(trimmedJoinCode, trimmedName);
  };

  const handleQuickJoin = (m: SavedMeeting) => {
    if (!requireName()) return;
    persistName(trimmedName);
    onJoin(m.code, trimmedName, m.name);
  };

  const handleJoinRecent = (r: RecentMeeting) => {
    if (!requireName()) return;
    persistName(trimmedName);
    recordRecent(r.name, r.code);
    onJoin(r.code, trimmedName, r.name || undefined);
  };

  const handleDeleteRecent = (id: string) => {
    const next = recentMeetings.filter((r) => r.id !== id);
    setRecentMeetings(next);
    persistRecent(next);
  };

  const handlePromoteToSaved = (r: RecentMeeting) => {
    // If already in saved (by code), just remove from recent.
    if (savedMeetings.some((s) => s.code === r.code)) {
      handleDeleteRecent(r.id);
      return;
    }
    // Open rename dialog so the user can give it a meaningful name.
    setRenamingMeeting(r);
  };

  const handleConfirmPromote = (name: string) => {
    if (!renamingMeeting) return;
    const newSaved = [
      ...savedMeetings,
      { id: crypto.randomUUID(), name, code: renamingMeeting.code },
    ];
    persistSaved(newSaved);
    setSavedMeetings(newSaved);
    handleDeleteRecent(renamingMeeting.id);
    setRenamingMeeting(null);
  };

  const handleAddSaved = () => {
    const name = newMeetingName.trim();
    const code = newMeetingCode.trim().toUpperCase();
    if (!name) {
      setError('회의 이름을 입력해주세요');
      return;
    }
    if (!isValidCode(code)) {
      setError('코드는 영문 대문자 + 숫자 4~10자입니다');
      return;
    }
    if (savedMeetings.some((m) => m.code === code)) {
      setError('이미 저장된 코드입니다');
      return;
    }
    const newList = [...savedMeetings, { id: crypto.randomUUID(), name, code }];
    persistSaved(newList);
    setSavedMeetings(newList);
    setNewMeetingName('');
    setNewMeetingCode('');
    setShowAddForm(false);
    setError('');
  };

  const handleDelete = (id: string) => {
    const newList = savedMeetings.filter((m) => m.id !== id);
    persistSaved(newList);
    setSavedMeetings(newList);
  };

  const cancelAddForm = () => {
    setShowAddForm(false);
    setNewMeetingName('');
    setNewMeetingCode('');
    setError('');
  };

  return (
    <div className="lobby">
      {adminPassword && (
        <div className="lobby-admin-bar">
          <button
            type="button"
            className="lobby-bug-btn"
            onClick={() => setShowPresence(true)}
            title="접속 현황 보기 (관리자 전용)"
          >
            👥 접속 현황
          </button>
          <button
            type="button"
            className="lobby-bug-btn"
            onClick={() => setShowBugViewer(true)}
            title="버그 보고서 보기 (관리자 전용)"
          >
            🐞 버그 확인
            {bugUnread > 0 && (
              <span className="lobby-bug-badge">
                {bugUnread > 99 ? '99+' : bugUnread}
              </span>
            )}
          </button>
        </div>
      )}
      <div className="lobby-card">
        <div className="lobby-brand">
          <Logo size="lg" showWordmark={false} />
        </div>
        <h1 className="lobby-product-name">픽미팅</h1>
        <p className="subtitle">사내 음성 회의 + 화면 공유</p>

        <div className="field">
          <label htmlFor="name">이름</label>
          <input
            id="name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="회의에서 표시될 이름"
            autoFocus
            maxLength={20}
          />
        </div>

        {error && <div className="lobby-error">{error}</div>}

        <div className="lobby-section">
          <div className="lobby-section-title">새 회의 만들기</div>
          <input
            type="text"
            value={customCode}
            onChange={(e) =>
              setCustomCode(e.target.value.toUpperCase().slice(0, MAX_CODE_LENGTH))
            }
            placeholder="고정 코드 (비워두면 랜덤)"
            maxLength={MAX_CODE_LENGTH}
            className="code-input"
          />
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!trimmedName}
          >
            만들기
          </button>
        </div>

        <div className="divider">
          <span>또는</span>
        </div>

        <div className="lobby-section">
          <div className="lobby-section-title">코드로 참가</div>
          <input
            type="text"
            value={joinCode}
            onChange={(e) =>
              setJoinCode(e.target.value.toUpperCase().slice(0, MAX_CODE_LENGTH))
            }
            placeholder="회의 코드"
            maxLength={MAX_CODE_LENGTH}
            className="code-input"
          />
          <button
            className="btn"
            onClick={handleJoin}
            disabled={!trimmedName || trimmedJoinCode.length < MIN_CODE_LENGTH}
          >
            참가
          </button>
        </div>

        <button
          type="button"
          className="lobby-manual-btn"
          onClick={() => setShowManual(true)}
          title="사용자 메뉴얼을 봅니다"
        >
          📖 사용자 메뉴얼
        </button>

        <button
          type="button"
          className="lobby-feedback-btn"
          onClick={() => setShowFeedback(true)}
          title="기능 제안이나 의견을 보냅니다"
        >
          💡 의견 보내기
        </button>
      </div>

      <div className="lobby-right">
      <aside className="lobby-recent-panel">
        <div className="saved-panel-header">
          <h3>최근 회의</h3>
        </div>
        <div className="saved-panel-body">
          {visibleRecent.length === 0 ? (
            <div className="saved-empty">
              <div className="saved-empty-icon">🕒</div>
              <div className="saved-empty-text">
                참여했던 회의가
                <br />이곳에 표시됩니다
              </div>
            </div>
          ) : (
            <ul className="saved-list">
              {visibleRecent.map((r) => (
                <li key={r.id} className="saved-item">
                  <button
                    className="saved-join"
                    onClick={() => handleJoinRecent(r)}
                    disabled={!trimmedName}
                    title={trimmedName ? '클릭해서 다시 참가' : '이름을 먼저 입력하세요'}
                  >
                    <div className="saved-info">
                      <div className="saved-name">
                        {r.name || <span className="recent-no-name">이름 없음</span>}
                      </div>
                      <div className="saved-code">{r.code}</div>
                    </div>
                  </button>
                  <button
                    className="recent-promote"
                    onClick={() => handlePromoteToSaved(r)}
                    title="저장된 회의로 추가"
                    aria-label="저장"
                  >
                    📌
                  </button>
                  <button
                    className="saved-delete"
                    onClick={() => handleDeleteRecent(r.id)}
                    title="삭제"
                    aria-label="삭제"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
      <aside className="lobby-saved-panel">
        <div className="saved-panel-header">
          <h3>저장된 회의</h3>
          {!showAddForm && (
            <button
              className="saved-add-btn"
              onClick={() => {
                setShowAddForm(true);
                setError('');
              }}
              title="회의 추가"
            >
              + 추가
            </button>
          )}
        </div>

        <div className="saved-panel-body">
          {showAddForm && (
            <div className="saved-add-form">
              <input
                type="text"
                value={newMeetingName}
                onChange={(e) => setNewMeetingName(e.target.value)}
                placeholder="회의 이름 (예: 주간 회의)"
                maxLength={30}
                autoFocus
              />
              <input
                type="text"
                value={newMeetingCode}
                onChange={(e) =>
                  setNewMeetingCode(
                    e.target.value.toUpperCase().slice(0, MAX_CODE_LENGTH)
                  )
                }
                placeholder="고정 코드 (예: WEEKLY)"
                maxLength={MAX_CODE_LENGTH}
                className="code-input"
              />
              <div className="saved-add-actions">
                <button className="btn btn-primary" onClick={handleAddSaved}>
                  저장
                </button>
                <button className="btn" onClick={cancelAddForm}>
                  취소
                </button>
              </div>
            </div>
          )}

          {savedMeetings.length === 0 && !showAddForm && (
            <div className="saved-empty">
              <div className="saved-empty-icon">📌</div>
              <div className="saved-empty-text">
                자주 쓰는 회의를 저장하면
                <br />한 번에 참가할 수 있습니다
              </div>
            </div>
          )}

          {savedMeetings.length > 0 && (
            <ul className="saved-list">
              {savedMeetings.map((m) => {
                const count = roomCounts[m.code] ?? 0;
                const active = count > 0;
                return (
                  <li
                    key={m.id}
                    className={`saved-item ${active ? 'saved-item-active' : ''}`}
                  >
                    <button
                      className="saved-join"
                      onClick={() => handleQuickJoin(m)}
                      disabled={!trimmedName}
                      title={
                        trimmedName
                          ? '클릭해서 참가'
                          : '이름을 먼저 입력하세요'
                      }
                    >
                      <span
                        className={`status-dot ${active ? 'active' : ''}`}
                        aria-hidden="true"
                      />
                      <div className="saved-info">
                        <div className="saved-name">{m.name}</div>
                        <div className="saved-code">{m.code}</div>
                      </div>
                      <div className="saved-count">
                        {active ? (
                          <>
                            <span className="count-num">{count}</span>
                            <span className="count-unit">명</span>
                          </>
                        ) : (
                          <span className="count-empty">비어 있음</span>
                        )}
                      </div>
                    </button>
                    <button
                      className="saved-delete"
                      onClick={() => handleDelete(m.id)}
                      title="삭제"
                      aria-label="삭제"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
      <AudioDevices />
      </div>
      {showManual && <Manual onClose={() => setShowManual(false)} />}
      {showFeedback && (
        <FeedbackModal
          defaultName={displayName}
          onClose={() => setShowFeedback(false)}
        />
      )}
      {renamingMeeting && (
        <PromoteRenameDialog
          defaultName={renamingMeeting.name || renamingMeeting.code}
          code={renamingMeeting.code}
          onCancel={() => setRenamingMeeting(null)}
          onSave={handleConfirmPromote}
        />
      )}
      {showAdminLogin && (
        <AdminLogin
          onSuccess={(pwd) => {
            setAdminPassword(pwd);
            setShowAdminLogin(false);
            setShowBugViewer(true);
          }}
          onCancel={() => setShowAdminLogin(false)}
        />
      )}
      {showPresence && adminPassword && (
        <PresenceModal
          password={adminPassword}
          onClose={() => setShowPresence(false)}
        />
      )}
      {showBugViewer && adminPassword && (
        <BugViewerModal
          password={adminPassword}
          onClose={() => setShowBugViewer(false)}
        />
      )}
    </div>
  );
}
