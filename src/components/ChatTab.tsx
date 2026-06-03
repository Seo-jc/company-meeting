import { FormEvent, useEffect, useRef, useState } from 'react';
import { ChatMessage } from '../lib/webrtc';

type Props = {
  messages: ChatMessage[];
  myId: string;
  onSend: (text: string) => void;
  onSendFile?: (file: File) => void;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function ChatTab({ messages, myId, onSend, onSendFile }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

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

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onSendFile) {
      onSendFile(file);
    }
    // Reset so selecting the same file twice still fires onChange
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!onSendFile) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onSendFile(file);
  };

  return (
    <div
      className={`tab-content chat-tab ${dragOver ? 'chat-tab-drag' : ''}`}
      onDragOver={(e) => {
        if (onSendFile && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        // Only clear if leaving the container, not entering a child
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={handleDrop}
    >
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
              {m.file ? (
                <FileMessage file={m.file} mine={mine} />
              ) : (
                <div className="chat-bubble">{m.text}</div>
              )}
            </div>
          );
        })}
      </div>
      {dragOver && (
        <div className="chat-drop-overlay">📎 여기에 놓으면 파일 전송</div>
      )}
      <form className="chat-form" onSubmit={handleSubmit}>
        {onSendFile && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="chat-attach"
              onClick={handlePickFile}
              title="파일 첨부"
              aria-label="파일 첨부"
            >
              📎
            </button>
          </>
        )}
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

function FileMessage({
  file,
  mine,
}: {
  file: NonNullable<ChatMessage['file']>;
  mine: boolean;
}) {
  const statusLabel = (() => {
    switch (file.status) {
      case 'sending':
        return mine ? `전송 중 ${file.progress}%` : `다운로드 중 ${file.progress}%`;
      case 'receiving':
        return `다운로드 중 ${file.progress}%`;
      case 'done':
        return mine ? '전송 완료' : '받기 완료';
      case 'failed':
        return file.failedReason ?? '실패';
    }
  })();

  const inProgress = file.status === 'sending' || file.status === 'receiving';
  const canDownload = file.status === 'done' && file.blobUrl;

  return (
    <div className={`chat-file ${file.status === 'failed' ? 'chat-file-failed' : ''}`}>
      <div className="chat-file-icon">📎</div>
      <div className="chat-file-info">
        <div className="chat-file-name" title={file.name}>
          {file.name}
        </div>
        <div className="chat-file-meta">
          {formatBytes(file.size)} · {statusLabel}
        </div>
        {inProgress && (
          <div className="chat-file-progress">
            <div
              className="chat-file-progress-fill"
              style={{ width: `${file.progress}%` }}
            />
          </div>
        )}
      </div>
      {canDownload && (
        <a
          className="chat-file-save"
          href={file.blobUrl}
          download={file.name}
          title="저장"
        >
          저장
        </a>
      )}
    </div>
  );
}
