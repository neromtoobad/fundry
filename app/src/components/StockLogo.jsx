// Round logo badges for the stocks Fundry can hold. Brand marks come from Simple Icons (CC0),
// bundled into the app (nothing loads from other sites); Microsoft's four squares, the S&P 500
// badge and the gold bar are drawn here. Used only to identify each asset.
import { siNvidia, siMeta, siSpacex, siBitcoin, siEthereum } from "simple-icons";

// a Simple Icons glyph (24x24 path), centred on a brand-colour disc
const mark = (icon, bg, scale) => (
  <>
    <circle cx="12" cy="12" r="12" fill={bg} />
    <g transform={`translate(${12 - 12 * scale} ${12 - 12 * scale}) scale(${scale})`}>
      <path d={icon.path} fill="#fff" />
    </g>
  </>
);

const LOGOS = {
  NVDA: mark(siNvidia, "#76B900", 0.62),
  META: mark(siMeta, "#0467DF", 0.6),
  SPCX: mark(siSpacex, "#0b0d12", 0.8),
  // the Simple Icons Bitcoin path is the whole coin with the ₿ cut out: the classic logo as is
  BTC: (
    <>
      <circle cx="12" cy="12" r="10" fill="#fff" />
      <path d={siBitcoin.path} fill="#F7931A" />
    </>
  ),
  ETH: mark(siEthereum, "#627EEA", 0.58),
  MSFT: (
    <>
      <circle cx="12" cy="12" r="11.5" fill="#fff" stroke="#e2ded5" />
      <g transform="translate(6.6 6.6)">
        <rect width="5.1" height="5.1" fill="#F25022" />
        <rect x="5.7" width="5.1" height="5.1" fill="#7FBA00" />
        <rect y="5.7" width="5.1" height="5.1" fill="#00A4EF" />
        <rect x="5.7" y="5.7" width="5.1" height="5.1" fill="#FFB900" />
      </g>
    </>
  ),
  SPY: (
    <>
      <circle cx="12" cy="12" r="12" fill="#13294B" />
      <text x="12" y="12.6" textAnchor="middle" dominantBaseline="middle" fontFamily="Inter Tight, system-ui, sans-serif" fontWeight="800" fontSize="7.2" letterSpacing="-0.3" fill="#fff">S&amp;P</text>
    </>
  ),
  GOLD: (
    <>
      <defs>
        <linearGradient id="stock-logo-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F3D27A" />
          <stop offset="1" stopColor="#C08E14" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill="url(#stock-logo-gold)" />
      <path d="M6.8 16.2 8.7 9h6.6l1.9 7.2z" fill="#fff" />
      <path d="M9.6 10.4h4.8" stroke="#D9AB3A" strokeWidth="0.8" />
    </>
  ),
};

/** A round logo for a stock symbol (falls back to its first letters). */
export default function StockLogo({ symbol, size = 20 }) {
  return (
    <svg className="stock-logo" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`${symbol} logo`}>
      {LOGOS[symbol] ?? (
        <>
          <circle cx="12" cy="12" r="12" fill="#e7e4dd" />
          <text x="12" y="12.6" textAnchor="middle" dominantBaseline="middle" fontSize="7.5" fontWeight="700" fill="#64625c">{symbol.slice(0, 3)}</text>
        </>
      )}
    </svg>
  );
}

/** Logo + ticker, inline. */
export function Ticker({ symbol, size = 20, style }) {
  return (
    <span className="ticker" style={style}>
      <StockLogo symbol={symbol} size={size} />
      <b>{symbol}</b>
    </span>
  );
}
