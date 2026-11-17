// Fundry fund rules: a small rulebook a person picks from chips, compiled to a TapeOut circuit.
//
// Circuit interface (fixed for every Fundry fund, so the Fund contract can drive any rulebook):
//   inputs  : 3 bits per asset i, in order [DROP_i, RISE_i, STOP_i]
//             DROP_i = price fell at least dropBps since the last rebalance
//             RISE_i = price rose at least riseBps since the last rebalance
//             STOP_i = price is at least stopBps below its peak (the peak resets when a stop fires)
//   outputs : 2 bits per asset i, LSB first = weight level 0..3
//   state   : one LATCH per asset that has a "stay out" stop (the fund contract stores it)
// Target weight of asset i = level_i / sum(levels). If every level is 0 the fund sits in USDG.

import { Netlist, step } from "./netlist.js";

export const MAX_ASSETS = 4;
export const DROP_ACTIONS = ["none", "half", "zero"];
export const RISE_ACTIONS = ["none", "double"];

/**
 * @typedef {{symbol:string, base:number, onDrop:"none"|"half"|"zero", onRise:"none"|"double",
 *            stop:"none"|"once"|"stayOut"}} AssetRule
 * @typedef {{assets:AssetRule[], dropBps:number, riseBps:number, stopBps:number, allFallingToCash:boolean}} Rulebook
 */

export function validate(rb) {
  if (!rb || !Array.isArray(rb.assets) || rb.assets.length < 1 || rb.assets.length > MAX_ASSETS)
    throw new Error(`a fund holds 1 to ${MAX_ASSETS} assets`);
  for (const a of rb.assets) {
    if (!Number.isInteger(a.base) || a.base < 0 || a.base > 3) throw new Error(`${a.symbol}: base weight must be 0..3`);
    if (!DROP_ACTIONS.includes(a.onDrop)) throw new Error(`${a.symbol}: bad onDrop`);
    if (!RISE_ACTIONS.includes(a.onRise)) throw new Error(`${a.symbol}: bad onRise`);
    if (!["none", "once", "stayOut"].includes(a.stop)) throw new Error(`${a.symbol}: bad stop`);
  }
  for (const k of ["dropBps", "riseBps", "stopBps"]) {
    if (!Number.isInteger(rb[k]) || rb[k] < 1 || rb[k] > 9000) throw new Error(`${k} must be 1..9000 bps`);
  }
  if (rb.assets.every((a) => a.base === 0)) throw new Error("at least one asset needs a base weight above 0");
  return rb;
}

/** Reference semantics in plain JS. The circuit must match this on every input. */
export function referenceLevel(a, { drop, rise, stop, stayed, allFalling }, allFallingToCash) {
  let lvl = a.base;
  if (a.onRise === "double" && rise) lvl = Math.min(3, Math.max(1, a.base * 2));
  if (a.onDrop === "half" && drop) lvl = a.base >> 1;
  if (a.onDrop === "zero" && drop) lvl = 0;
  if (a.stop !== "none" && stop) lvl = 0;
  if (a.stop === "stayOut" && stayed) lvl = 0;
  if (allFallingToCash && allFalling) lvl = 0;
  return lvl;
}

/** Next value of the "stayed out" latch: set by a stop, cleared by a rise. */
export function referenceStayed(a, { rise, stop, stayed }) {
  if (a.stop !== "stayOut") return 0;
  return (stayed || stop) && !rise ? 1 : 0;
}

// Build a boolean function of up to 6 named signals from a truth table, by Shannon expansion.
function synth(n, vars, fn, memo) {
  // vars: [{name, sig}] ; fn(env) -> 0|1. Names that share a signal share one truth-table column.
  const cols = [];
  for (const v of vars) {
    const c = cols.find((c) => c.sig === v.sig);
    if (c) c.names.push(v.name);
    else cols.push({ sig: v.sig, names: [v.name] });
  }
  const rows = 1 << cols.length;
  let tt = "";
  for (let r = 0; r < rows; r++) {
    const env = {};
    cols.forEach((c, i) => { for (const nm of c.names) env[nm] = (r >> i) & 1; });
    tt += fn(env) ? "1" : "0";
  }
  return build(n, cols, tt, memo);
}

function build(n, vars, tt, memo) {
  if (!tt.includes("1")) return n.CONST0;
  if (!tt.includes("0")) return n.CONST1;
  const key = vars.map((v) => v.sig).join(",") + ":" + tt;
  if (memo.has(key)) return memo.get(key);
  // split on the highest variable
  const top = vars[vars.length - 1];
  const half = tt.length / 2;
  const f0 = tt.slice(0, half); // top = 0
  const f1 = tt.slice(half); // top = 1
  const rest = vars.slice(0, -1);
  let sig;
  if (f0 === f1) sig = build(n, rest, f0, memo);
  else sig = n.mux(top.sig, build(n, rest, f1, memo), build(n, rest, f0, memo));
  memo.set(key, sig);
  return sig;
}

/**
 * Compile a rulebook to a TapeOut netlist.
 * @returns {{netlist:Netlist, bytes:Uint8Array, nIn:number, nOut:number, nState:number, gateCount:number}}
 */
export function compile(rb) {
  validate(rb);
  const N = rb.assets.length;
  const nIn = 3 * N;
  const n = new Netlist(nIn);
  const memo = new Map();
  const DROP = (i) => n.input(3 * i);
  const RISE = (i) => n.input(3 * i + 1);
  const STOP = (i) => n.input(3 * i + 2);

  let allFalling = n.CONST1;
  if (rb.allFallingToCash) for (let i = 0; i < N; i++) allFalling = n.and(allFalling, DROP(i));
  else allFalling = n.CONST0;

  const latches = rb.assets.map((a) => (a.stop === "stayOut" ? n.latch() : null));
  const outputs = [];
  rb.assets.forEach((a, i) => {
    const stayed = latches[i] ? latches[i].q : n.CONST0;
    const vars = [
      { name: "drop", sig: DROP(i) },
      { name: "rise", sig: RISE(i) },
      { name: "stop", sig: STOP(i) },
      { name: "stayed", sig: stayed },
      { name: "allFalling", sig: allFalling },
    ].filter((v) => v.sig !== n.CONST0 && v.sig !== n.CONST1);
    const envOf = (env) => ({
      drop: env.drop ?? 0, rise: env.rise ?? 0, stop: env.stop ?? 0,
      stayed: env.stayed ?? 0, allFalling: env.allFalling ?? (allFalling === n.CONST1 ? 1 : 0),
    });
    const bit0 = synth(n, vars, (e) => referenceLevel(a, envOf(e), rb.allFallingToCash) & 1, memo);
    const bit1 = synth(n, vars, (e) => (referenceLevel(a, envOf(e), rb.allFallingToCash) >> 1) & 1, memo);
    outputs.push(bit0, bit1);
    if (latches[i]) {
      const next = synth(n, vars, (e) => referenceStayed(a, envOf(e)), memo);
      latches[i].setD(next);
    }
  });
  n.finish(outputs);
  return { netlist: n, bytes: n.encode(), nIn, nOut: 2 * N, nState: n.nLatch, gateCount: n.gateCount };
}

/** Feature bits for one rebalance, in circuit input order. */
export function inputBits(features) {
  return features.flatMap((f) => [f.drop ? 1 : 0, f.rise ? 1 : 0, f.stop ? 1 : 0]);
}

/** Run a compiled rulebook for one rebalance: features -> levels + next latch state. */
export function run(compiled, features, state = []) {
  const { outputs, state: next } = step(compiled.netlist.records, compiled.nIn, compiled.nOut, inputBits(features), state);
  const levels = [];
  for (let i = 0; i < outputs.length; i += 2) levels.push(outputs[i] | (outputs[i + 1] << 1));
  return { levels, state: next };
}

const pct = (bps) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

/** The rulebook in plain English, one line per rule. */
export function describe(rb) {
  validate(rb);
  const total = rb.assets.reduce((s, a) => s + a.base, 0);
  const lines = [];
  lines.push(
    "Normally holds " +
      rb.assets.filter((a) => a.base > 0).map((a) => `${a.symbol} ${Math.round((100 * a.base) / total)}%`).join(", ") +
      "."
  );
  for (const a of rb.assets) {
    if (a.onDrop === "half") lines.push(`If ${a.symbol} falls ${pct(rb.dropBps)} or more since the last rebalance, cut it to half.`);
    if (a.onDrop === "zero") lines.push(`If ${a.symbol} falls ${pct(rb.dropBps)} or more since the last rebalance, sell all of it.`);
    if (a.onRise === "double") lines.push(`If ${a.symbol} rises ${pct(rb.riseBps)} or more, double its weight (up to the max).`);
    if (a.stop === "once") lines.push(`Stop-loss: if ${a.symbol} is ${pct(rb.stopBps)} below its peak, sell it for that rebalance.`);
    if (a.stop === "stayOut")
      lines.push(`Stop-loss: if ${a.symbol} is ${pct(rb.stopBps)} below its peak, sell it and stay out until it rises ${pct(rb.riseBps)} in one period.`);
  }
  if (rb.allFallingToCash) lines.push(`If everything falls ${pct(rb.dropBps)} or more at once, move the whole fund to cash (USDG).`);
  lines.push("Weights are rebalanced to these targets; leftover goes to cash.");
  return lines;
}
