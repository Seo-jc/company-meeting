import { useState } from 'react';
import Lobby from './components/Lobby';
import MeetingRoom from './components/MeetingRoom';
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
        <Lobby
          onJoin={(roomCode, displayName, meetingTitle) =>
            setScreen({ name: 'meeting', roomCode, displayName, meetingTitle })
          }
        />
      ) : (
        <MeetingRoom
          roomCode={screen.roomCode}
          displayName={screen.displayName}
          meetingTitle={screen.meetingTitle}
          onLeave={() => setScreen({ name: 'lobby' })}
        />
      )}
    </div>
  );
}
