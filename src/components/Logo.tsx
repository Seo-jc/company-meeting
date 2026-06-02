type Props = {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
};

export default function Logo({ size = 'md', showWordmark = false }: Props) {
  const iconSize = size === 'sm' ? 32 : size === 'lg' ? 160 : 64;
  const fontSize = size === 'sm' ? 14 : size === 'lg' ? 36 : 22;
  const gradId = `logoSilver-${size}`;
  const bgId = `logoBg-${size}`;

  return (
    <div
      className="logo"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'lg' ? '0.85rem' : '0.55rem',
      }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="서정천 SJC"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="30%" stopColor="#cbd5e1" />
            <stop offset="55%" stopColor="#f1f5f9" />
            <stop offset="80%" stopColor="#94a3b8" />
            <stop offset="100%" stopColor="#475569" />
          </linearGradient>
          <linearGradient id={bgId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1a1d23" />
            <stop offset="100%" stopColor="#0d1117" />
          </linearGradient>
        </defs>

        <rect
          x="6"
          y="6"
          width="188"
          height="188"
          rx="34"
          fill={`url(#${bgId})`}
          stroke="#475569"
          strokeWidth="1.2"
        />

        {/* SJC — Stacked Layers monogram */}
        <g
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="15"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* S — top */}
          <path d="M 135 35 C 75 30 70 65 110 75 C 150 85 130 115 70 110" />
          {/* J — vertical through middle */}
          <path d="M 105 75 L 105 130 Q 105 150 85 148" />
          {/* C — wraps around bottom */}
          <path d="M 160 110 Q 100 105 95 145 Q 95 175 165 175" />
        </g>
      </svg>
      {showWordmark && (
        <span
          className="logo-wordmark"
          style={{
            fontSize: `${fontSize}px`,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #e5e7eb 0%, #94a3b8 50%, #475569 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
          }}
        >
          서정천
        </span>
      )}
    </div>
  );
}
