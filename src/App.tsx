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

  return (
    <div className="app-root">
      <UpdateNotification />
      <WhatsNew />
      <div className="version-bar">
        v{__APP_VERSION__} <span className="version-sep">·</span> 개발자 서정천
      </div>
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
