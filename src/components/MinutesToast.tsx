// 회의록 저장 알림 — 앱의 업데이트 알림(update-banner)과 같은 모양. 패널을 닫아도 보이고, 회의록 패널이 열려 있으면 그 왼쪽 가운데에 뜬다.
//   저장 성공: 파일 이름·저장 위치 + [파일 열기][폴더 열기][위치 변경]
//   저장 실패: 사유 + [다른 위치에 저장][닫기]   (회의록 내용은 그대로 남아 있다)
// 겹침 확인: UpdateNotification.tsx 와 다름 — 그건 앱 자동 업데이트 알림이고, 이 파일은 회의록 저장 결과 알림이다(모양만 같게 맞춤).

import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { MinutesSession } from '../lib/minutes/session';
import { useMinutesState } from '../lib/minutes/useMinutes';

const STR = {
  ko: {
    savedTitle: '엑셀로 저장했습니다',
    saveDir: (dir: string) => `저장 위치 · ${dir}`,
    renamed: '같은 이름이 있어 (2) 같은 번호를 붙여 새 파일로 저장했습니다. 먼저 저장한 파일은 그대로입니다.',
    offlineWarn: '연결이 끊긴 상태입니다. 다른 사람이 방금 쓴 글은 빠졌을 수 있으니, 다시 연결된 뒤 한 번 더 저장하세요.',
    openFile: '파일 열기',
    openFolder: '폴더 열기',
    changeDir: '위치 변경',
    nextDir: (dir: string) => `다음 저장부터 ‘${dir}’ 에 저장합니다.`,
    failTitle: '엑셀로 저장하지 못했습니다',
    failKeep: '회의록 내용은 그대로 남아 있습니다. 다른 위치를 골라 다시 저장해 주세요.',
    saveElsewhere: '다른 위치에 저장',
    close: '닫기',
    emptyTitle: '저장할 내용이 없습니다',
    emptyBody: '안건이나 회의 내용을 먼저 적어 주세요.',
    noElectronTitle: '저장은 데스크톱 앱에서만 됩니다',
    noElectronBody: '이 화면에서는 엑셀 파일을 만들 수 없습니다. PikMeeting 앱에서 저장해 주세요.',
    restoredTitle: '이전 회의록을 복구했습니다',
    restoredBody: '이 PC에 임시 보관돼 있던 내용입니다. 엑셀로 저장해 두세요.',
    truncatedWarn: '내용이 너무 길어 일부는 엑셀에 담지 못했습니다 (안건 50개 · 안건당 5만 글자 · 전체 20만 글자 · 참석자 200명까지). 회의록 화면에는 그대로 있습니다.',
    undoWord: '되돌리기',
    undoTail: ' (10초 안에 되돌릴 수 있음)',
    removedAtt: (name: string, extra: number) => `참석자 ‘${name || '이름 없는 줄'}’${extra > 0 ? ` 외 ${extra}명` : ''} 뺌`,
    removedAg: (title: string, hasBody: boolean) => `안건 ‘${title || '제목 없음'}’${hasBody ? ' 와 그 아래 내용' : ''} 지움`,
  },
  en: {
    savedTitle: 'Saved as Excel',
    saveDir: (dir: string) => `Saved in · ${dir}`,
    renamed: 'A file with that name exists, so a number like (2) was added and saved as a new file. The earlier file is untouched.',
    offlineWarn: 'You are disconnected. Text others just wrote may be missing — save once more after reconnecting.',
    openFile: 'Open file',
    openFolder: 'Open folder',
    changeDir: 'Change folder',
    nextDir: (dir: string) => `From the next save on, files go to “${dir}”.`,
    failTitle: 'Could not save as Excel',
    failKeep: 'Your minutes are still here. Pick another folder and save again.',
    saveElsewhere: 'Save elsewhere',
    close: 'Close',
    emptyTitle: 'Nothing to save',
    emptyBody: 'Write an agenda item or some notes first.',
    noElectronTitle: 'Saving works in the desktop app only',
    noElectronBody: 'An Excel file cannot be created here. Please save from the PikMeeting app.',
    restoredTitle: 'Previous minutes restored',
    restoredBody: 'This is what was kept on this PC. Save it as Excel.',
    truncatedWarn: 'Some of the text was too long to fit in the Excel file (up to 50 agenda items, 50,000 characters per item, 200,000 in total, 200 attendees). It is all still in the minutes panel.',
    undoWord: 'Undo',
    undoTail: ' (you can undo within 10 seconds)',
    removedAtt: (name: string, extra: number) => `Removed attendee “${name || 'unnamed row'}”${extra > 0 ? ` and ${extra} more` : ''}`,
    removedAg: (title: string, hasBody: boolean) => `Deleted item “${title || 'untitled'}”${hasBody ? ' and its notes' : ''}`,
  },
};

/**
 * «10초 안에 되돌리기» 목록. 세션이 들고 있으므로 패널을 닫아도 남는다:
 * 패널이 열려 있으면 패널 아래쪽(저장 줄 위)에, 닫혀 있으면 화면 아래 가운데에 띄운다(MinutesToast 가 floating 으로 그린다).
 */
export function MinutesUndoStack({ session, floating = false }: { session: MinutesSession; floating?: boolean }) {
  const t = useT(STR);
  const items = useMinutesState(session).undo;
  if (items.length === 0) return null;
  return (
    <div className={`mm-undo-stack ${floating ? 'floating' : ''}`}>
      {items.map((u) => (
        <div key={u.id} className="mm-undo-bar" role="status">
          <span className="ut">
            {u.kind === 'agenda' ? t.removedAg(u.title, u.hasBody) : t.removedAtt(u.name, u.extra)}
            {t.undoTail}
          </span>
          <button type="button" className="mm-mini-btn" onClick={() => session.undoRemoval(u.id)}>
            {t.undoWord}
          </button>
        </div>
      ))}
    </div>
  );
}

type Props = {
  session: MinutesSession;
  /** 회의록 패널이 열려 있나(열려 있으면 패널을 피해 가운데에 뜬다) */
  panelOpen: boolean;
};

export default function MinutesToast({ session, panelOpen }: Props) {
  const t = useT(STR);
  const n = useMinutesState(session).notice;
  const [nextDir, setNextDir] = useState<string | null>(null);

  useEffect(() => {
    setNextDir(null);
    if (!n) return;
    const ms = n.kind === 'saved' ? 12_000 : n.kind === 'save-failed' ? 9_000 : 5_000;
    const id = setTimeout(() => session.setNotice(null), ms);
    return () => clearTimeout(id);
  }, [n, session]);

  // 패널이 닫혀 있을 때만 여기서 되돌리기를 띄운다(열려 있으면 패널 안에 있다)
  const undoFloating = panelOpen ? null : <MinutesUndoStack session={session} floating />;
  if (!n) return undoFloating;
  const isError = n.kind === 'save-failed' || n.kind === 'empty' || n.kind === 'no-electron';
  const close = () => session.setNotice(null);

  return (
    <>
    {undoFloating}
    <div
      className={`mm-toast ${isError ? 'mm-toast-error' : 'mm-toast-success'} ${panelOpen ? 'panel-open' : ''}`}
      role={isError ? 'alert' : 'status'}
    >
      <div className="mm-toast-icon">{isError ? '⚠️' : '💾'}</div>
      <div className="mm-toast-body">
        {n.kind === 'saved' && (
          <>
            <strong>{t.savedTitle}</strong>
            <small className="fn">{n.fileName}</small>
            <small>{t.saveDir(n.dir)}</small>
            {n.renamedHint && <small>{t.renamed}</small>}
            {n.offline && <small className="warn">{t.offlineWarn}</small>}
            {n.truncated && <small className="warn">{t.truncatedWarn}</small>}
            {nextDir && <small>{t.nextDir(nextDir)}</small>}
            <div className="mm-toast-actions">
              <button type="button" className="mm-toast-btn" onClick={() => void session.openSavedFile(n.filePath)}>
                {t.openFile}
              </button>
              <button type="button" className="mm-toast-btn" onClick={() => void session.openSavedFolder(n.filePath)}>
                {t.openFolder}
              </button>
              <button
                type="button"
                className="mm-toast-btn"
                onClick={() => {
                  void session.chooseSaveDir().then((d) => d && setNextDir(d));
                }}
              >
                {t.changeDir}
              </button>
            </div>
          </>
        )}
        {n.kind === 'save-failed' && (
          <>
            <strong>{t.failTitle}</strong>
            <small>{n.message}</small>
            <small>{t.failKeep}</small>
            <div className="mm-toast-actions">
              <button
                type="button"
                className="mm-toast-btn"
                onClick={() => {
                  void session.chooseSaveDir().then((d) => {
                    if (d) void session.save();
                  });
                }}
              >
                {t.saveElsewhere}
              </button>
              <button type="button" className="mm-toast-btn" onClick={close}>
                {t.close}
              </button>
            </div>
          </>
        )}
        {n.kind === 'empty' && (
          <>
            <strong>{t.emptyTitle}</strong>
            <small>{t.emptyBody}</small>
          </>
        )}
        {n.kind === 'no-electron' && (
          <>
            <strong>{t.noElectronTitle}</strong>
            <small>{t.noElectronBody}</small>
          </>
        )}
        {n.kind === 'restored' && (
          <>
            <strong>{t.restoredTitle}</strong>
            <small>{t.restoredBody}</small>
          </>
        )}
      </div>
      <button type="button" className="mm-toast-close" onClick={close} aria-label={t.close}>
        ✕
      </button>
    </div>
    </>
  );
}
