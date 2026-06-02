type Props = {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
};

export default function Logo({ size = 'md', showWordmark = false }: Props) {
  const iconSize = size === 'sm' ? 32 : size === 'lg' ? 160 : 64;
  const fontSize = size === 'sm' ? 14 : size === 'lg' ? 36 : 22;

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
        viewBox="0 0 140 140"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="서정천"
      >
        <defs>
          <linearGradient id="logoCircuitBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06141a" />
            <stop offset="100%" stopColor="#0a2230" />
          </linearGradient>
          <filter id="logoCircuitGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer rounded square — circuit board substrate */}
        <rect
          x="14"
          y="14"
          width="112"
          height="112"
          rx="16"
          fill="url(#logoCircuitBg)"
          stroke="#1abc9c"
          strokeWidth="1.5"
        />

        {/* Background circuit traces */}
        <g stroke="#1abc9c" strokeWidth="0.8" fill="none" opacity="0.35">
          <path d="M14 35 L40 35 L40 50" />
          <path d="M126 35 L100 35 L100 50" />
          <path d="M14 105 L40 105 L40 90" />
          <path d="M126 105 L100 105 L100 90" />
        </g>
        <g fill="#1abc9c" opacity="0.6">
          <circle cx="14" cy="35" r="2" />
          <circle cx="126" cy="35" r="2" />
          <circle cx="14" cy="105" r="2" />
          <circle cx="126" cy="105" r="2" />
        </g>

        {/* Korean character strokes as circuit traces (서정천) */}
        <g
          filter="url(#logoCircuitGlow)"
          stroke="#1abc9c"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* ㅅ (서) */}
          <path d="M44 54 L70 36 L96 54" strokeWidth="3.5" />
          {/* ㅡ (정) */}
          <path d="M40 66 L100 66" strokeWidth="3.5" />
          {/* ㅊ top tick */}
          <path d="M58 76 L82 76" strokeWidth="2.5" />
          {/* ㅊ bottom curve */}
          <path d="M42 88 Q70 98 98 88" strokeWidth="3.5" />
        </g>

        {/* Solder nodes — IC pin/junction dots */}
        <circle cx="44" cy="54" r="2.5" fill="#1abc9c" />
        <circle cx="96" cy="54" r="2.5" fill="#1abc9c" />
        <circle cx="70" cy="36" r="2.5" fill="#ffffff" />
        <circle cx="40" cy="66" r="2.5" fill="#1abc9c" />
        <circle cx="100" cy="66" r="2.5" fill="#1abc9c" />
        <circle cx="42" cy="88" r="2" fill="#1abc9c" opacity="0.85" />
        <circle cx="98" cy="88" r="2" fill="#1abc9c" opacity="0.85" />
      </svg>
      {showWordmark && (
        <span
          className="logo-wordmark"
          style={{
            fontSize: `${fontSize}px`,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: '#1abc9c',
            textShadow: '0 0 12px rgba(26,188,156,0.4)',
          }}
        >
          서정천
        </span>
      )}
    </div>
  );
}
