import { useEffect, useRef, useState } from 'react';
import Logo from './Logo';
import AudioDevices from './AudioDevices';

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
const LAST_NAME_KEY = 'lastDisplayName';

type SavedMeeting = {
  id: string;
  name: string;
  code: string;
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
  const [roomCounts, setRoomCounts] = useState<Record<string, number>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMeetingName, setNewMeetingName] = useState('');
  const [newMeetingCode, setNewMeetingCode] = useState('');
  const [error, setError] = useState('');
  const cancelledRef = useRef(false);

  useEffect(() => {
    setSavedMeetings(loadSaved());
    const lastName = localStorage.getItem(LAST_NAME_KEY);
    if (lastName) setDisplayName(lastName);
  }, []);

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
    onJoin(code, trimmedName);
  };

  const handleJoin = () => {
    if (!requireName()) return;
    if (!isValidCode(trimmedJoinCode)) {
      setError('참가 코드는 영문 대문자 + 숫자 4~10자입니다');
      return;
    }
    persistName(trimmedName);
    onJoin(trimmedJoinCode, trimmedName);
  };

  const handleQuickJoin = (m: SavedMeeting) => {
    if (!requireName()) return;
    persistName(trimmedName);
    onJoin(m.code, trimmedName, m.name);
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
      <div className="lobby-card">
        <div className="lobby-brand">
          <Logo size="lg" showWordmark={false} />
        </div>
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
      </div>

      <div className="lobby-right">
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
    </div>
  );
}
