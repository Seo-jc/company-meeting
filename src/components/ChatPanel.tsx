import { ReactNode } from 'react';
import { useT } from '../i18n';

const STR = {
  ko: {
    title: '채팅',
    closeAria: '채팅 닫기',
  },
  en: {
    title: 'Chat',
    closeAria: 'Close chat',
  },
};

type Props = {
  onClose: () => void;
  children: ReactNode;
};

export default function ChatPanel({ onClose, children }: Props) {
  const t = useT(STR);
  return (
    <aside className="right-panel">
      <header className="right-panel-header">
        <h3 className="right-panel-title">{t.title}</h3>
        <button
          className="panel-close"
          onClick={onClose}
          aria-label={t.closeAria}
        >
          ✕
        </button>
      </header>
      <div className="right-panel-body">{children}</div>
    </aside>
  );
}
