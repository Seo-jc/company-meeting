import { useState } from 'react';
import Lobby from './components/Lobby';
import MeetingRoom from './components/MeetingRoom';
import UpdateNotification from './components/UpdateNotification';
import WhatsNew from './components/WhatsNew';

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
        title="클릭하면 변경 이력을 볼 수 있습니다"
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
