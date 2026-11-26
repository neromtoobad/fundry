// The die drawing of a fund's real circuit. One tile per gate, laid out by logic depth (left to
// right, the order signals flow), NAND tiles in ink, LATCH tiles (the fund's memory) in copper.
// A REF (a fork reusing its parent's chip) is one large outlined block marked with the parent's
// chip number. Input pads on the left (DROP / RISE / STOP per stock), output pads on the right
// (2 weight bits per stock). With `inputs`, tiles carrying a 1 light up: that is the chip evaluating,
// with the same evaluator the checks use (REFs included).
import { useMemo } from "react";
import { decode, firstSignals, step } from "@sworn/sdk";

function layout(records, nIn) {
  const first = firstSignals(records, nIn);
  const depthOf = new Map(); // signal -> depth
  const nodeDepth = records.map((r, i) => {
    let d = 0;
    if (r.op === "nand") d = 1 + Math.max(depthOf.get(r.a) ?? 0, depthOf.get(r.b) ?? 0);
    else if (r.op === "ref") d = 1 + Math.max(0, ...r.ins.map((x) => depthOf.get(x) ?? 0));
    const n = r.op === "ref" ? r.nOuts : 1;
    for (let k = 0; k < n; k++) depthOf.set(first[i] + k, d);
    return d;
  });
  const cols = [];
  records.forEach((r, i) => (cols[nodeDepth[i]] ??= []).push(i));
  return { cols: cols.filter(Boolean), first };
}

const REF_H = 3; // a REF block is as tall as 3 tiles

export default function Chip({ netlist, records: recs, nIn, nOut, size = 280, inputs = null, state = [], resolve = null, label = true, totalGates }) {
  const records = useMemo(() => {
    if (recs) return recs;
    try { return netlist ? decode(netlist) : []; } catch { return []; }
  }, [netlist, recs]);
  const { cols, first } = useMemo(() => layout(records, nIn), [records, nIn]);
  const sig = useMemo(() => {
    if (!inputs) return null;
    try { return step(records, nIn, nOut, inputs, state, resolve).signals; } catch { return null; }
  }, [records, nIn, nOut, inputs, state, resolve]);

  const pad = size * 0.11; // pad ring
  const core = size - 2 * pad;
  const inner = core * 0.86;
  const ox = pad + (core - inner) / 2;
  const rowsOf = (col) => col.reduce((s, ri) => s + (records[ri].op === "ref" ? REF_H : 1), 0);
  const maxRows = Math.max(1, ...cols.map(rowsOf));
  const cell = Math.min(inner / Math.max(1, cols.length), inner / maxRows);
  const tile = cell * 0.78;
  const gridW = cell * cols.length;
  const gx = ox + (inner - gridW) / 2;
  const nSig = 2 + nIn + records.reduce((s, r) => s + (r.op === "ref" ? r.nOuts : 1), 0);
  const own = records.filter((r) => r.op !== "ref").length;

  const pads = (n, side) =>
    Array.from({ length: n }, (_, i) => {
      const stepY = core / (n + 1);
      const y = pad + stepY * (i + 1);
      const w = pad * 0.5;
      const h = Math.min(stepY * 0.55, size * 0.035);
      const x = side === "l" ? pad - w - size * 0.012 : size - pad + size * 0.012;
      const on = sig && (side === "l" ? sig[2 + i] : sig[nSig - nOut + i]);
      return <rect key={side + i} x={x} y={y - h / 2} width={w} height={h} rx={1} className={on ? "pad on" : "pad"} />;
    });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" className={sig ? "live" : ""} style={{ maxWidth: size, display: "block" }} role="img"
      aria-label={`Circuit die: ${own} gates, ${records.filter((r) => r.op === "latch").length} latch${records.some((r) => r.op === "ref") ? ", plus the parent chip" : ""}`}>
      <rect x={pad} y={pad} width={core} height={core} rx={size * 0.03} className="die" />
      <rect x={pad + 4} y={pad + 4} width={core - 8} height={core - 8} rx={size * 0.022} className="die-inner" />
      {pads(nIn, "l")}
      {pads(nOut, "r")}
      {cols.map((col, ci) => {
        const colH = rowsOf(col) * cell;
        let y = ox + (inner - colH) / 2;
        return col.map((ri) => {
          const r = records[ri];
          const x = gx + ci * cell + (cell - tile) / 2;
          if (r.op === "ref") {
            const h = REF_H * cell - (cell - tile);
            const lit = sig && Array.from({ length: r.nOuts }, (_, k) => sig[first[ri] + k]).some(Boolean);
            const node = (
              <g key={ri}>
                <rect x={x - cell * 0.4} y={y + (cell - tile) / 2} width={tile + cell * 0.8} height={h} rx={3} className={`gate ref${lit ? " lit" : ""}`}>
                  <title>{`Parent chip #${r.id}, reused through a REF: its ${r.nOuts} outputs feed this chip`}</title>
                </rect>
                <text x={x + tile / 2} y={y + (cell - tile) / 2 + h / 2} className="ref-mark" textAnchor="middle" dominantBaseline="middle">#{r.id}</text>
              </g>
            );
            y += REF_H * cell;
            return node;
          }
          const lit = sig && sig[first[ri]];
          const node = (
            <rect key={ri} x={x} y={y + (cell - tile) / 2} width={tile} height={tile} rx={Math.min(2, tile / 4)} className={`gate ${r.op}${lit ? " lit" : ""}`}>
              <title>{`${r.op === "nand" ? "NAND" : "LATCH (memory)"} · signal ${first[ri]}${sig ? ` = ${sig[first[ri]]}` : ""}`}</title>
            </rect>
          );
          y += cell;
          return node;
        });
      })}
      {label && (
        <text x={pad + 10} y={size - pad - 10} className="die-mark">
          FNDRY · {totalGates && totalGates !== own ? `${own} + ${totalGates - own} REUSED` : `${own}`} GATES
        </text>
      )}
    </svg>
  );
}
