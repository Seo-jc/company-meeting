import { useEffect, useState } from 'react';

export type ScreenSource = {
  id: string;
  name: string;
  thumbnail: string;
};

type Props = {
  onPick: (sourceId: string) => void;
  onCancel: () => void;
};

export default function SourcePicker({ onPick, onCancel }: Props) {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = window.electronAPI;
        if (!api) throw new Error('Electron API 사용 불가');
        const result = await api.getScreenSources();
        if (cancelled) return;
        setSources(result);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '소스 목록을 불러오지 못했습니다');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const screens = sources.filter((s) => s.id.startsWith('screen:'));
  const windows = sources.filter((s) => s.id.startsWith('window:'));

  return (
    <div className="picker-overlay" onClick={onCancel}>
      <div className="picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <h2>공유할 항목 선택</h2>
          <button className="picker-close" onClick={onCancel}>✕</button>
        </div>

        {loading && <p className="picker-status">불러오는 중...</p>}
        {error && <p className="picker-status picker-error">{error}</p>}

        {!loading && !error && (
          <div className="picker-body">
            {screens.length > 0 && (
              <section className="picker-section">
                <h3>전체 화면</h3>
                <div className="picker-grid">
                  {screens.map((s) => (
                    <SourceCard key={s.id} source={s} onPick={onPick} />
                  ))}
                </div>
              </section>
            )}
            {windows.length > 0 && (
              <section className="picker-section">
                <h3>창</h3>
                <div className="picker-grid">
                  {windows.map((s) => (
                    <SourceCard key={s.id} source={s} onPick={onPick} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  onPick,
}: {
  source: ScreenSource;
  onPick: (id: string) => void;
}) {
  return (
    <button className="source-card" onClick={() => onPick(source.id)}>
      <img src={source.thumbnail} alt={source.name} />
      <span className="source-name">{source.name}</span>
    </button>
  );
}
