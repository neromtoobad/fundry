// Checks anyone can run on a Fundry fund, in the browser or in Node, from chain data alone.
//
//   checkRules   : the chip (netlist read from chain) gives the result the plain-words rulebook
//                  says, on every input and every memory state (or a large random sample).
//   inputsFromPrices / replay : every logged rebalance is recomputed from its prices alone:
//                  price signals -> chip -> weights and memory, and compared with what the fund logged.

import { step, stateSize } from "./netlist.js";
import { referenceStep } from "./rules.js";

const BPS = 10_000n;

function rng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/**
 * @param chip  { records, nIn, nOut, resolve? }
 * @param rb    the rulebook JSON from the launch event
 * @param parentOf  for forks: (parent) => { rulebook, nState }
 * @returns {{ cases:number, mismatches:Array, exhaustive:boolean, nState:number }}
 */
export function checkRules(chip, rb, parentOf = null, { maxCases = 1 << 18, seed = 7 } = {}) {
  const nState = stateSize(chip.records, chip.resolve);
  const nIn = chip.nIn;
  const total = 2 ** (nIn + nState);
  const exhaustive = total <= maxCases;
  const r = rng(seed);
  const count = exhaustive ? total : maxCases;
  const mismatches = [];
  for (let c = 0; c < count; c++) {
    const bitsOf = (n, off) => Array.from({ length: n }, (_, i) => (exhaustive ? Math.floor(c / 2 ** (off + i)) % 2 : r() < 0.5 ? 1 : 0));
    const inputs = bitsOf(nIn, 0);
    const state = bitsOf(nState, nIn);
    const got = step(chip.records, nIn, chip.nOut, inputs, state, chip.resolve);
    const want = referenceStep(rb, inputs, state, parentOf);
    const levels = [];
    for (let i = 0; i < got.outputs.length; i += 2) levels.push(got.outputs[i] | (got.outputs[i + 1] << 1));
    if (levels.join() !== want.levels.join() || got.state.join() !== want.state.join()) {
      if (mismatches.length < 5) mismatches.push({ inputs, state, got: { levels, state: got.state }, want });
    }
  }
  return { cases: count, mismatches, exhaustive, nState };
}

/** The input bits a fund computes from prices (Fund.currentInputs), tracking last price and peak. */
export function inputsFromPrices(prices, mem, { dropBps, riseBps, stopBps }) {
  const bits = [];
  const next = { last: [...mem.last], peak: [...mem.peak] };
  prices.forEach((pRaw, i) => {
    const p = BigInt(pRaw), last = BigInt(mem.last[i] ?? 0), peak = BigInt(mem.peak[i] ?? 0);
    let drop = false, rise = false;
    if (last !== 0n) {
      drop = p * BPS <= last * (BPS - BigInt(dropBps));
      rise = p * BPS >= last * (BPS + BigInt(riseBps));
    }
    const pk = peak > p ? peak : p;
    const stop = p * BPS <= pk * (BPS - BigInt(stopBps));
    bits.push(drop ? 1 : 0, rise ? 1 : 0, stop ? 1 : 0);
    next.peak[i] = stop ? p : pk;
    next.last[i] = p;
  });
  return { bits, mem: next };
}

/**
 * Replay a fund's rebalances, oldest first. Each item needs { n, prices, inputBits, outputBits, newStateBits }.
 * Returns one row per rebalance with what was recomputed and whether it matches.
 */
export function replay(chip, fund, rebalances) {
  const nState = stateSize(chip.records, chip.resolve);
  let mem = { last: fund.assets.map(() => 0n), peak: fund.assets.map(() => 0n) };
  let state = new Array(nState).fill(0);
  return rebalances.map((r) => {
    const derived = inputsFromPrices(r.prices, mem, fund);
    const got = step(chip.records, chip.nIn, chip.nOut, derived.bits, state, chip.resolve);
    const inputsOk = derived.bits.join() === r.inputBits.slice(0, derived.bits.length).join();
    const outputsOk = got.outputs.join() === r.outputBits.slice(0, got.outputs.length).join();
    const stateOk = got.state.join() === r.newStateBits.slice(0, got.state.length).join();
    mem = derived.mem;
    state = r.newStateBits.slice(0, nState); // continue from what the fund stored
    return { n: r.n, inputs: derived.bits, outputs: got.outputs, state: got.state, inputsOk, outputsOk, stateOk, ok: inputsOk && outputsOk && stateOk };
  });
}
