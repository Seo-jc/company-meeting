import { useCallback, useState } from 'react';
import Lobby from './components/Lobby';
import MeetingRoom from './components/MeetingRoom';
import MinutesLeftNotice from './components/MinutesLeftNotice';
import type { MinutesLeftInfo } from './lib/minutes/types';
import UpdateNotification from './components/UpdateNotification';
import WhatsNew from './components/WhatsNew';
import { useT } from './i18n';

const STR = {
  ko: { changelogTip: '클릭하면 변경 이력을 볼 수 있습니다' },
  en: { changelogTip: 'Click to view the changelog' },
};

type Screen =
  | { name: 'lobby' }
  | {
      name: 'meeting';
      roomCode: string;
      displayName: string;
      meetingTitle?: string;
    };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'lobby' });
  const [manualChangelog, setManualChangelog] = useState(false);
  // 방금 나온 회의에서 회의록을 엑셀로 저장했다면 그 안내(로비 첫 화면에 잠깐 띄움)
  const [leftMinutes, setLeftMinutes] = useState<MinutesLeftInfo | null>(null);
  const closeLeftMinutes = useCallback(() => setLeftMinutes(null), []);
  const t = useT(STR);

  return (
    <div className="app-root">
      <UpdateNotification />
      {manualChangelog ? (
        <WhatsNew forceShow onClose={() => setManualChangelog(false)} />
      ) : (
        <WhatsNew />
      )}
      <button
        type="button"
        className="version-bar"
        onClick={() => setManualChangelog(true)}
        title={t.changelogTip}
      >
        v{__APP_VERSION__} <span className="version-sep">·</span> Seo Jeong-Cheon
      </button>
      {screen.name === 'lobby' ? (
        <>
          <Lobby
            onJoin={(roomCode, displayName, meetingTitle) => {
              setLeftMinutes(null);
              setScreen({ name: 'meeting', roomCode, displayName, meetingTitle });
            }}
          />
          {leftMinutes && <MinutesLeftNotice info={leftMinutes} onClose={closeLeftMinutes} />}
        </>
      ) : (
        <MeetingRoom
          roomCode={screen.roomCode}
          displayName={screen.displayName}
          meetingTitle={screen.meetingTitle}
          onLeave={(saved) => {
            setLeftMinutes(saved ?? null);
            setScreen({ name: 'lobby' });
          }}
        />
      )}
    </div>
  );
}
