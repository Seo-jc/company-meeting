import { FormEvent, useEffect, useRef, useState } from 'react';
import { ChatMessage } from '../lib/webrtc';
import { useT, getLang } from '../i18n';

type Props = {
  messages: ChatMessage[];
  myId: string;
  onSend: (text: string) => void;
  onSendFile?: (file: File) => void;
};

const STR = {
  ko: {
    noMessages: '아직 메시지가 없습니다',
    me: '나',
    dropHint: '📎 여기에 놓으면 파일 전송',
    attachFile: '파일 첨부',
    messagePlaceholder: '메시지 입력',
    send: '전송',
    sendingPercent: (p: number) => `전송 중 ${p}%`,
    downloadingPercent: (p: number) => `다운로드 중 ${p}%`,
    sendDone: '전송 완료',
    receiveDone: '받기 완료',
    failed: '실패',
    save: '저장',
  },
  en: {
    noMessages: 'No messages yet',
    me: 'Me',
    dropHint: '📎 Drop here to send file',
    attachFile: 'Attach file',
    messagePlaceholder: 'Type a message',
    send: 'Send',
    sendingPercent: (p: number) => `Sending ${p}%`,
    downloadingPercent: (p: number) => `Downloading ${p}%`,
    sendDone: 'Sent',
    receiveDone: 'Received',
    failed: 'Failed',
    save: 'Save',
  },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(getLang() === 'en' ? 'en-US' : 'ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function ChatTab({ messages, myId, onSend, onSendFile }: Props) {
  const t = useT(STR);
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
          <div className="chat-empty">{t.noMessages}</div>
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
                  <span className="chat-name">{mine ? t.me : m.fromName}</span>
                  <span className="chat-time">{formatTime(m.ts)}</span>
                </div>
              )}
              {m.file ? (
                <FileMessage file={m.file} mine={mine} t={t} />
              ) : (
                <div className="chat-bubble">{m.text}</div>
              )}
            </div>
          );
        })}
      </div>
      {dragOver && (
        <div className="chat-drop-overlay">{t.dropHint}</div>
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
              title={t.attachFile}
              aria-label={t.attachFile}
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
          placeholder={t.messagePlaceholder}
          maxLength={500}
        />
        <button type="submit" disabled={!text.trim()}>
          {t.send}
        </button>
      </form>
    </div>
  );
}

function FileMessage({
  file,
  mine,
  t,
}: {
  file: NonNullable<ChatMessage['file']>;
  mine: boolean;
  t: ReturnType<typeof useT<typeof STR>>;
}) {
  const statusLabel = (() => {
    switch (file.status) {
      case 'sending':
        return mine ? t.sendingPercent(file.progress) : t.downloadingPercent(file.progress);
      case 'receiving':
        return t.downloadingPercent(file.progress);
      case 'done':
        return mine ? t.sendDone : t.receiveDone;
      case 'failed':
        return file.failedReason ?? t.failed;
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
          title={t.save}
        >
          {t.save}
        </a>
      )}
    </div>
  );
}
