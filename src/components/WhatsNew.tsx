import { useEffect, useState } from 'react';
import { ReleaseNote, RELEASE_NOTES, getNotesAfter } from '../releaseNotes';
import { localizeNote } from '../releaseNotes';
import { useT, useLang } from '../i18n';

const SEEN_KEY = 'lastSeenVersion';

const STR = {
  ko: {
    updateComplete: '🎉 업데이트 완료',
    versionChanges: (version: string) => `버전 ${version} 변경 사항`,
    close: '닫기',
    closeEsc: '닫기 (Esc)',
    noChanges: '변경 사항 정보가 없습니다.',
    currentVersion: '현재 버전',
    tagAdded: '새 기능',
    tagFixed: '버그 수정',
    tagChanged: '변경',
    showAllHistory: '📋 이전 버전 변경 이력 전부 보기',
    confirm: '확인',
  },
  en: {
    updateComplete: '🎉 Update complete',
    versionChanges: (version: string) => `Version ${version} changes`,
    close: 'Close',
    closeEsc: 'Close (Esc)',
    noChanges: 'No changelog information available.',
    currentVersion: 'Current version',
    tagAdded: 'New',
    tagFixed: 'Bug fixes',
    tagChanged: 'Changed',
    showAllHistory: '📋 View all previous version history',
    confirm: 'OK',
  },
};

type Props = {
  /** If provided, modal opens for that version on mount. Otherwise auto-detects. */
  forceShow?: boolean;
  onClose?: () => void;
};

export default function WhatsNew({ forceShow, onClose }: Props) {
  const t = useT(STR);
  const { lang } = useLang();
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

    if (!seen) {
      // No prior version recorded. Could be:
      //  (a) brand-new install → don't show anything
      //  (b) returning user from before this feature existed → show current version's notes
      // We distinguish by looking for any sign of prior usage in localStorage.
      const hasPriorUsage =
        localStorage.getItem('lastDisplayName') !== null ||
        localStorage.getItem('savedMeetings:v1') !== null ||
        localStorage.getItem('selectedMicId') !== null ||
        localStorage.getItem('selectedSpeakerId') !== null;

      if (hasPriorUsage) {
        // Returning user: show notes for the current version so they see what's new.
        setNotes(RELEASE_NOTES.slice(0, 1));
        setOpen(true);
        return;
      }

      // True first install: silently record and skip.
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
            <div className="whatsnew-eyebrow">{t.updateComplete}</div>
            <h2>{t.versionChanges(currentVersion)}</h2>
          </div>
          <button
            type="button"
            className="whatsnew-close"
            onClick={handleClose}
            aria-label={t.close}
            title={t.closeEsc}
          >
            ✕
          </button>
        </header>

        <div className="whatsnew-body">
          {notes.length === 0 ? (
            <p className="whatsnew-empty">{t.noChanges}</p>
          ) : (
            notes.map((rawNote, idx) => {
              const note = localizeNote(rawNote, lang);
              return (
              <article
                key={note.version}
                className={`whatsnew-entry ${idx === 0 ? 'whatsnew-entry-latest' : ''}`}
              >
                <header className="whatsnew-entry-header">
                  <h3>
                    v{note.version}
                    {idx === 0 && <span className="whatsnew-current-badge">{t.currentVersion}</span>}
                  </h3>
                  <time>{note.date}</time>
                </header>
                {note.highlight && (
                  <p className="whatsnew-highlight">{note.highlight}</p>
                )}
                {note.added && note.added.length > 0 && (
                  <section className="whatsnew-section">
                    <h4 className="whatsnew-tag whatsnew-tag-added">{t.tagAdded}</h4>
                    <ul>
                      {note.added.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {note.fixed && note.fixed.length > 0 && (
                  <section className="whatsnew-section">
                    <h4 className="whatsnew-tag whatsnew-tag-fixed">{t.tagFixed}</h4>
                    <ul>
                      {note.fixed.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {note.changed && note.changed.length > 0 && (
                  <section className="whatsnew-section">
                    <h4 className="whatsnew-tag whatsnew-tag-changed">{t.tagChanged}</h4>
                    <ul>
                      {note.changed.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </article>
              );
            })
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
              {t.showAllHistory}
            </button>
          )}
        </div>

        <footer className="whatsnew-footer">
          <button type="button" className="btn btn-primary" onClick={handleClose}>
            {t.confirm}
          </button>
        </footer>
      </div>
    </div>
  );
}
