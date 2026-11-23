// The die drawing of a fund's real circuit. One tile per gate, laid out by logic depth (left to
// right, the order signals flow), NAND tiles in ink, LATCH tiles (the fund's memory) in copper.
// Input pads on the left (DROP / RISE / STOP per stock), output pads on the right (2 weight bits
// per stock). With `inputs`, tiles carrying a 1 light up: that is the chip evaluating.
import { useMemo } from "react";
import { decode } from "@fundry/sdk";

function layout(records, nIn) {
  const base = 2 + nIn;
  const depth = new Array(base + records.length).fill(0);
  records.forEach((r, i) => {
    depth[base + i] = r.op === "nand" ? 1 + Math.max(depth[r.a] ?? 0, depth[r.b] ?? 0) : 0;
  });
  const cols = [];
  records.forEach((r, i) => {
    const d = depth[base + i];
    (cols[d] ??= []).push(i);
  });
  return cols.filter(Boolean);
}

function evaluate(records, nIn, inputs, state) {
  const s = new Uint8Array(2 + nIn + records.length);
  s[1] = 1;
  for (let i = 0; i < nIn; i++) s[2 + i] = inputs[i] ? 1 : 0;
  let k = 0;
  records.forEach((r, i) => {
    s[2 + nIn + i] = r.op === "nand" ? (s[r.a] & s[r.b] ? 0 : 1) : state[k++] ? 1 : 0;
  });
  return s;
}

export default function Chip({ netlist, nIn, nOut, size = 280, inputs = null, state = [], label = true }) {
  const records = useMemo(() => {
    try { return netlist ? decode(netlist) : []; } catch { return []; }
  }, [netlist]);
  const cols = useMemo(() => layout(records, nIn), [records, nIn]);
  const sig = useMemo(() => (inputs ? evaluate(records, nIn, inputs, state) : null), [records, nIn, inputs, state]);

  const pad = size * 0.11; // pad ring
  const core = size - 2 * pad;
  const inner = core * 0.86;
  const ox = pad + (core - inner) / 2;
  const maxRows = Math.max(1, ...cols.map((c) => c.length));
  const cell = Math.min(inner / Math.max(1, cols.length), inner / maxRows);
  const tile = cell * 0.78;
  const gridW = cell * cols.length;
  const gx = ox + (inner - gridW) / 2;
  const base = 2 + nIn;

  const pads = (n, side) =>
    Array.from({ length: n }, (_, i) => {
      const step = core / (n + 1);
      const y = pad + step * (i + 1);
      const w = pad * 0.5;
      const h = Math.min(step * 0.55, size * 0.035);
      const x = side === "l" ? pad - w - size * 0.012 : size - pad + size * 0.012;
      const on = sig && (side === "l" ? sig[2 + i] : sig[base + records.length - nOut + i]);
      return <rect key={side + i} x={x} y={y - h / 2} width={w} height={h} rx={1} className={on ? "pad on" : "pad"} />;
    });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" className={sig ? "live" : ""} style={{ maxWidth: size, display: "block" }} role="img"
      aria-label={`Circuit die: ${records.length} gates, ${records.filter((r) => r.op === "latch").length} latch`}>
      <rect x={pad} y={pad} width={core} height={core} rx={size * 0.03} className="die" />
      <rect x={pad + 4} y={pad + 4} width={core - 8} height={core - 8} rx={size * 0.022} className="die-inner" />
      {pads(nIn, "l")}
      {pads(nOut, "r")}
      {cols.map((col, ci) => {
        const colH = col.length * cell;
        const y0 = ox + (inner - colH) / 2;
        return col.map((ri, k) => {
          const r = records[ri];
          const lit = sig && sig[base + ri];
          return (
            <rect key={ri} x={gx + ci * cell + (cell - tile) / 2} y={y0 + k * cell + (cell - tile) / 2} width={tile} height={tile} rx={Math.min(2, tile / 4)}
              className={`gate ${r.op}${lit ? " lit" : ""}`} />
          );
        });
      })}
      {label && (
        <text x={pad + 10} y={size - pad - 10} className="die-mark">
          FNDRY · {records.length} GATES
        </text>
      )}
    </svg>
  );
}
