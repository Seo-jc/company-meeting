import { ReactNode } from 'react';

type Props = {
  onClose: () => void;
  children: ReactNode;
};

export default function ChatPanel({ onClose, children }: Props) {
  return (
    <aside className="right-panel">
      <header className="right-panel-header">
        <h3 className="right-panel-title">채팅</h3>
        <button
          className="panel-close"
          onClick={onClose}
          aria-label="채팅 닫기"
        >
          ✕
        </button>
      </header>
      <div className="right-panel-body">{children}</div>
    </aside>
  );
}
