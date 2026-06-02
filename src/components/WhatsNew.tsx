import { useEffect, useState } from 'react';
import { ReleaseNote, RELEASE_NOTES, getNotesAfter } from '../releaseNotes';

const SEEN_KEY = 'lastSeenVersion';

type Props = {
  /** If provided, modal opens for that version on mount. Otherwise auto-detects. */
  forceShow?: boolean;
  onClose?: () => void;
};

export default function WhatsNew({ forceShow, onClose }: Props) {
  const currentVersion = __APP_VERSION__;
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (forceShow) {
      setNotes(RELEASE_NOTES);
      setShowAll(true);
      setOpen(true);
      return;
    }

    const seen = localStorage.getItem(SEEN_KEY);
    // First-ever launch: silently record version, no popup.
    if (!seen) {
      localStorage.setItem(SEEN_KEY, currentVersion);
      return;
    }
    // Version unchanged: nothing to show.
    if (seen === currentVersion) return;
    // Version moved forward: show notes between previous and current.
    const newNotes = getNotesAfter(seen);
    if (newNotes.length === 0) return;
    setNotes(newNotes);
    setOpen(true);
  }, [forceShow, currentVersion]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleClose = () => {
    localStorage.setItem(SEEN_KEY, currentVersion);
    setOpen(false);
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="whatsnew-backdrop" onClick={handleClose} role="dialog" aria-modal="true">
      <div className="whatsnew-modal" onClick={(e) => e.stopPropagation()}>
        <header className="whatsnew-header">
          <div>
            <div className="whatsnew-eyebrow">🎉 업데이트 완료</div>
            <h2>버전 {currentVersion} 변경 사항</h2>
          </div>
          <button
            type="button"
            className="whatsnew-close"
            onClick={handleClose}
            aria-label="닫기"
            title="닫기 (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="whatsnew-body">
          {notes.length === 0 ? (
            <p className="whatsnew-empty">변경 사항 정보가 없습니다.</p>
          ) : (
            notes.map((note, idx) => (
              <article
                key={note.version}
                className={`whatsnew-entry ${idx === 0 ? 'whatsnew-entry-latest' : ''}`}
              >
                <header className="whatsnew-entry-header">
                  <h3>
                    v{note.version}
                    {idx === 0 && <span className="whatsnew-current-badge">현재 버전</span>}
                  </h3>
                  <time>{note.date}</time>
                </header>
                {note.highlight && (
                  <p className="whatsnew-highlight">{note.highlight}</p>
                )}
                {note.added && note.added.length > 0 && (
                  <section className="whatsnew-section">
                    <h4 className="whatsnew-tag whatsnew-tag-added">새 기능</h4>
                    <ul>
                      {note.added.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {note.fixed && note.fixed.length > 0 && (
                  <section className="whatsnew-section">
                    <h4 className="whatsnew-tag whatsnew-tag-fixed">버그 수정</h4>
                    <ul>
                      {note.fixed.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {note.changed && note.changed.length > 0 && (
                  <section className="whatsnew-section">
                    <h4 className="whatsnew-tag whatsnew-tag-changed">변경</h4>
                    <ul>
                      {note.changed.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </article>
            ))
          )}

          {!showAll && notes.length < RELEASE_NOTES.length && (
            <button
              type="button"
              className="whatsnew-show-more"
              onClick={() => {
                setNotes(RELEASE_NOTES);
                setShowAll(true);
              }}
            >
              📋 이전 버전 변경 이력 전부 보기
            </button>
          )}
        </div>

        <footer className="whatsnew-footer">
          <button type="button" className="btn btn-primary" onClick={handleClose}>
            확인
          </button>
        </footer>
      </div>
    </div>
  );
}
