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
        aria-label="PikMeeting"
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

        {/* Screen Mic — monitor (screen share) with a microphone inside (voice) */}
        <g
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="34" y="50" width="132" height="94" rx="14" />
          <line x1="78" y1="166" x2="122" y2="166" />
          <line x1="100" y1="144" x2="100" y2="166" />
        </g>
        <g fill="none" stroke={`url(#${gradId})`} strokeLinecap="round">
          <rect x="88" y="70" width="24" height="36" rx="12" strokeWidth="10" />
          <path d="M 76 96 A 24 24 0 0 0 124 96" strokeWidth="10" />
          <line x1="100" y1="116" x2="100" y2="126" strokeWidth="10" />
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
          PikMeeting
        </span>
      )}
    </div>
  );
}
