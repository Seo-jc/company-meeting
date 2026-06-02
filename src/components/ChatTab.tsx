import { FormEvent, useEffect, useRef, useState } from 'react';
import { ChatMessage } from '../lib/webrtc';

type Props = {
  messages: ChatMessage[];
  myId: string;
  onSend: (text: string) => void;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatTab({ messages, myId, onSend }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <div className="tab-content chat-tab">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">아직 메시지가 없습니다</div>
        )}
        {messages.map((m, i) => {
          const mine = m.from === myId;
          const prev = messages[i - 1];
          const showHeader = !prev || prev.from !== m.from;
          return (
            <div
              key={i}
              className={`chat-msg ${mine ? 'chat-msg-mine' : ''}`}
            >
              {showHeader && (
                <div className="chat-meta">
                  <span className="chat-name">{mine ? '나' : m.fromName}</span>
                  <span className="chat-time">{formatTime(m.ts)}</span>
                </div>
              )}
              <div className="chat-bubble">{m.text}</div>
            </div>
          );
        })}
      </div>
      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="메시지 입력"
          maxLength={500}
        />
        <button type="submit" disabled={!text.trim()}>
          전송
        </button>
      </form>
    </div>
  );
}
