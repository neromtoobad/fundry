// Sworn fund rules: a small rulebook a person picks from chips, compiled to a TapeOut circuit.
//
// Circuit interface (fixed for every Sworn fund, so the Fund contract can drive any rulebook):
//   inputs  : 3 bits per asset i, in order [DROP_i, RISE_i, STOP_i]
//             DROP_i = price fell at least dropBps since the last rebalance
//             RISE_i = price rose at least riseBps since the last rebalance
//             STOP_i = price is at least stopBps below its peak (the peak resets when a stop fires)
//   outputs : 2 bits per asset i, LSB first = weight level 0..3
//   state   : one LATCH per asset that has a "stay out" stop (the fund contract stores it)
// Target weight of asset i = level_i / sum(levels). If every level is 0 the fund sits in USDG.

import { Netlist, step, refKey } from "./netlist.js";

export const MAX_ASSETS = 4;
export const DROP_ACTIONS = ["none", "half", "zero"];
export const RISE_ACTIONS = ["none", "double"];

/**
 * @typedef {{symbol:string, base:number, onDrop:"none"|"half"|"zero", onRise:"none"|"double",
 *            stop:"none"|"once"|"stayOut"}} AssetRule
 * @typedef {{assets:AssetRule[], dropBps:number, riseBps:number, stopBps:number, allFallingToCash:boolean}} Rulebook
 */

export function validate(rb) {
  if (isFork(rb)) throw new Error("this is a fork: use validateFork");
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
  const { outputs, state: next } = step(compiled.netlist.records, compiled.nIn, compiled.nOut, inputBits(features), state, compiled.resolve || null);
  const levels = [];
  for (let i = 0; i < outputs.length; i += 2) levels.push(outputs[i] | (outputs[i + 1] << 1));
  return { levels, state: next };
}

const pct = (bps) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

/** The rulebook in plain English, one line per rule. */
export function describe(rb) {
  if (isFork(rb)) return describeFork(rb);
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

// ---- forks -------------------------------------------------------------------------------------
//
// A fork is a new fund whose chip contains its parent's chip, wired in with a TapeOut REF record.
// Each beat the parent chip runs first, unchanged, on the same price signals; the fork's own gates
// then adjust the parent's weight levels. Only the fork's own gates are burned at tape-out: the
// parent's are reused. The Sworn factory checks the REF on chain and pays the parent chip's
// owner a royalty out of the fork's creator fee.
//
// Fork rulebook:
//   { kind: "fork", parent: { fund, circuitId, name },
//     assets: [{ symbol, shift: -1|0|1, onDrop, onRise, stop }],   // same stocks, same order as the parent
//     dropBps, riseBps, stopBps, allFallingToCash }
// Level of asset i = the original rules applied with base = clamp(parentLevel_i + shift_i, 0, 3).

export const SHIFTS = [-1, 0, 1];

export function isFork(rb) {
  return rb?.kind === "fork";
}

export function validateFork(rb, parentAssetCount) {
  if (!isFork(rb)) throw new Error("not a fork rulebook");
  if (!rb.parent || rb.parent.circuitId == null) throw new Error("a fork needs its parent chip");
  if (!Array.isArray(rb.assets) || rb.assets.length < 1 || rb.assets.length > MAX_ASSETS) throw new Error(`a fund holds 1 to ${MAX_ASSETS} assets`);
  if (parentAssetCount != null && rb.assets.length !== parentAssetCount) throw new Error("a fork holds the same stocks as its parent");
  for (const a of rb.assets) {
    if (!SHIFTS.includes(a.shift)) throw new Error(`${a.symbol}: shift must be -1, 0 or 1`);
    if (!DROP_ACTIONS.includes(a.onDrop)) throw new Error(`${a.symbol}: bad onDrop`);
    if (!RISE_ACTIONS.includes(a.onRise)) throw new Error(`${a.symbol}: bad onRise`);
    if (!["none", "once", "stayOut"].includes(a.stop)) throw new Error(`${a.symbol}: bad stop`);
  }
  for (const k of ["dropBps", "riseBps", "stopBps"]) {
    if (!Number.isInteger(rb[k]) || rb[k] < 1 || rb[k] > 9000) throw new Error(`${k} must be 1..9000 bps`);
  }
  return rb;
}

/** A fork's level for one asset, given the parent chip's level. */
export function referenceForkLevel(a, parentLevel, env, allFallingToCash) {
  const base = Math.max(0, Math.min(3, parentLevel + a.shift));
  return referenceLevel({ ...a, base }, env, allFallingToCash);
}

/**
 * Compile a fork. `parent` is the parent chip as read from chain:
 *   { cpu, circuitId, nIn, nOut, nState, records, resolve? }
 * @returns compiled circuit, plus `resolve` for evaluating the REF and `ownGates` (transistors burned)
 */
export function compileFork(rb, parent) {
  const N = rb.assets.length;
  validateFork(rb, parent.nIn / 3);
  if (parent.nIn !== 3 * N || parent.nOut !== 2 * N) throw new Error("parent chip has a different shape");
  const n = new Netlist(3 * N);
  const memo = new Map();
  const DROP = (i) => n.input(3 * i);
  const RISE = (i) => n.input(3 * i + 1);
  const STOP = (i) => n.input(3 * i + 2);

  // the parent chip, first, on exactly this fund's input signals
  const pOut = n.ref(parent.cpu, parent.circuitId, Array.from({ length: 3 * N }, (_, i) => n.input(i)), parent);

  let allFalling = n.CONST0;
  if (rb.allFallingToCash) { allFalling = n.CONST1; for (let i = 0; i < N; i++) allFalling = n.and(allFalling, DROP(i)); }

  const latches = rb.assets.map((a) => (a.stop === "stayOut" ? n.latch() : null));
  const outputs = [];
  rb.assets.forEach((a, i) => {
    const stayed = latches[i] ? latches[i].q : n.CONST0;
    const vars = [
      { name: "p0", sig: pOut[2 * i] },
      { name: "p1", sig: pOut[2 * i + 1] },
      { name: "drop", sig: DROP(i) },
      { name: "rise", sig: RISE(i) },
      { name: "stop", sig: STOP(i) },
      { name: "stayed", sig: stayed },
      { name: "allFalling", sig: allFalling },
    ].filter((v) => v.sig !== n.CONST0 && v.sig !== n.CONST1);
    const envOf = (e) => ({
      drop: e.drop ?? 0, rise: e.rise ?? 0, stop: e.stop ?? 0, stayed: e.stayed ?? 0,
      allFalling: e.allFalling ?? (allFalling === n.CONST1 ? 1 : 0),
    });
    const lvl = (e) => referenceForkLevel(a, (e.p0 ?? 0) | ((e.p1 ?? 0) << 1), envOf(e), rb.allFallingToCash);
    outputs.push(synth(n, vars, (e) => lvl(e) & 1, memo), synth(n, vars, (e) => (lvl(e) >> 1) & 1, memo));
    if (latches[i]) latches[i].setD(synth(n, vars, (e) => referenceStayed(a, envOf(e)), memo));
  });
  n.finish(outputs);
  const pk = refKey(parent.cpu, parent.circuitId);
  const resolve = (cpu, id) => (refKey(cpu, id) === pk ? { records: parent.records, nIn: parent.nIn, nOut: parent.nOut, resolve: parent.resolve } : parent.resolve?.(cpu, id) ?? null);
  return {
    netlist: n, bytes: n.encode(), nIn: 3 * N, nOut: 2 * N, nState: n.nState,
    gateCount: n.gateCount, ownGates: n.gateCount, totalGates: n.gateCount + (parent.totalGates ?? 0), resolve,
  };
}

/**
 * The rules' meaning, without any circuit: one rebalance from input bits and state bits.
 * Works for forks too; `parentOf(rb.parent)` returns { rulebook, nState } of the parent chip.
 * This is what the chip must match on every input; the app checks it in the browser.
 */
export function referenceStep(rb, bits, state = [], parentOf = null) {
  const N = rb.assets.length;
  const f = (i) => ({ drop: bits[3 * i] ? 1 : 0, rise: bits[3 * i + 1] ? 1 : 0, stop: bits[3 * i + 2] ? 1 : 0 });
  const allFalling = rb.assets.every((_, i) => bits[3 * i]) ? 1 : 0;
  let parentLevels = null, parentState = [], k = 0;
  if (isFork(rb)) {
    if (!parentOf) throw new Error("referenceStep: a fork needs parentOf");
    const p = parentOf(rb.parent);
    const pr = referenceStep(p.rulebook, bits, state.slice(0, p.nState), parentOf);
    parentLevels = pr.levels; parentState = pr.state; k = p.nState;
  }
  const levels = [], next = [];
  rb.assets.forEach((a, i) => {
    const stayed = a.stop === "stayOut" ? (state[k] ? 1 : 0) : 0;
    const env = { ...f(i), stayed, allFalling };
    levels.push(parentLevels ? referenceForkLevel(a, parentLevels[i], env, rb.allFallingToCash) : referenceLevel(a, env, rb.allFallingToCash));
    if (a.stop === "stayOut") { next.push(referenceStayed(a, env)); k++; }
  });
  return { levels, state: [...parentState, ...next] };
}

/** A fork's rules in plain English. */
export function describeFork(rb) {
  const name = rb.parent?.name ? `“${rb.parent.name}”` : `chip #${rb.parent?.circuitId}`;
  const lines = [`Runs ${name}’s chip first, unchanged. Then:`];
  for (const a of rb.assets) {
    if (a.shift === 1) lines.push(`Holds more ${a.symbol}: one weight level above the parent.`);
    if (a.shift === -1) lines.push(`Holds less ${a.symbol}: one weight level below the parent.`);
    if (a.onDrop === "half") lines.push(`If ${a.symbol} falls ${pct(rb.dropBps)} or more since the last rebalance, cut it to half.`);
    if (a.onDrop === "zero") lines.push(`If ${a.symbol} falls ${pct(rb.dropBps)} or more since the last rebalance, sell all of it.`);
    if (a.onRise === "double") lines.push(`If ${a.symbol} rises ${pct(rb.riseBps)} or more, double its weight (up to the max).`);
    if (a.stop === "once") lines.push(`Stop-loss: if ${a.symbol} is ${pct(rb.stopBps)} below its peak, sell it for that rebalance.`);
    if (a.stop === "stayOut")
      lines.push(`Stop-loss: if ${a.symbol} is ${pct(rb.stopBps)} below its peak, sell it and stay out until it rises ${pct(rb.riseBps)} in one period.`);
  }
  if (rb.allFallingToCash) lines.push(`If everything falls ${pct(rb.dropBps)} or more at once, move the whole fund to cash (USDG).`);
  if (lines.length === 1) lines.push("No changes: the same rules, with this fund’s own triggers and fee.");
  lines.push(`Triggers: “falls” ${pct(rb.dropBps)}, “rises” ${pct(rb.riseBps)}, stop-loss ${pct(rb.stopBps)} from peak. The parent’s rules see these too.`);
  return lines;
}
