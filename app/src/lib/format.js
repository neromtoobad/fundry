export const usd = (units6, digits = 2) =>
  "$" + (Number(units6) / 1e6).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const pct = (x, digits = 2) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

export const bps = (b) => `${(b / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const num = (n) => Number(n).toLocaleString("en-US");

export function ago(ts, now = Date.now() / 1000) {
  const s = Math.max(0, Math.floor(now - Number(ts)));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function until(ts, now = Date.now() / 1000) {
  const s = Math.floor(Number(ts) - now);
  if (s <= 0) return "now";
  if (s < 5400) return `in ${Math.ceil(s / 60)}m`;
  if (s < 129600) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}

export const date = (ts) =>
  new Date(Number(ts) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
