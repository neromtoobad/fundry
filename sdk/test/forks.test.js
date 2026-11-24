import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, compileFork, decode, encode, checkRules, replay, inputsFromPrices, step, packBits, unpackBits, describe, stateSize } from "../src/index.js";

const CPU = "0x80bf3aa74171b3711b5946d9f39b84f464b4cc0b";
const DROPS = ["none", "half", "zero"], RISES = ["none", "double"], STOPS = ["none", "once", "stayOut"];
function rng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const pick = (r, a) => a[Math.floor(r() * a.length)];

function randomBase(r, N) {
  const assets = Array.from({ length: N }, (_, i) => ({ symbol: ["NVDA", "SPY", "SPCX", "GOLD"][i], base: Math.floor(r() * 4), onDrop: pick(r, DROPS), onRise: pick(r, RISES), stop: pick(r, STOPS) }));
  if (assets.every((a) => a.base === 0)) assets[0].base = 1;
  return { assets, dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: r() < 0.5 };
}
function randomFork(r, parent, id) {
  return {
    kind: "fork", parent: { fund: "0x0", circuitId: id, name: "Parent" },
    assets: parent.assets.map((a) => ({ symbol: a.symbol, shift: pick(r, [-1, 0, 1]), onDrop: pick(r, DROPS), onRise: pick(r, RISES), stop: pick(r, STOPS) })),
    dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: r() < 0.5,
  };
}
// what the app gets back after reading a chip from chain
const asChip = (c, id) => ({ cpu: CPU, circuitId: id, nIn: c.nIn, nOut: c.nOut, nState: c.nState, records: decode(c.bytes), resolve: c.resolve, totalGates: c.totalGates ?? c.gateCount });

test("REF records encode and decode", () => {
  const p = compile(randomBase(rng(1), 2));
  const f = compileFork(randomFork(rng(2), randomBase(rng(1), 2), 3), asChip(p, 3));
  const recs = decode(f.bytes);
  assert.equal(recs[0].op, "ref");
  assert.equal(recs[0].cpu, CPU);
  assert.equal(recs[0].id, 3);
  assert.deepEqual(recs[0].ins, [2, 3, 4, 5, 6, 7]);
  assert.equal(recs[0].nOuts, 4);
  assert.deepEqual(encode(recs), f.bytes);
});

test("80 random forks match their rules on every input and memory state", () => {
  const r = rng(99);
  let maxOwn = 0;
  for (let k = 0; k < 80; k++) {
    const N = 1 + Math.floor(r() * 4);
    const prb = randomBase(r, N);
    const p = compile(prb);
    const frb = randomFork(r, prb, 10 + k);
    const f = compileFork(frb, asChip(p, 10 + k));
    const parentOf = () => ({ rulebook: prb, nState: p.nState });
    const res = checkRules({ records: decode(f.bytes), nIn: f.nIn, nOut: f.nOut, resolve: f.resolve }, frb, parentOf);
    assert.equal(res.mismatches.length, 0, JSON.stringify(res.mismatches[0]));
    assert.ok(res.exhaustive);
    // the parent alone also matches its own rules
    assert.equal(checkRules({ records: decode(p.bytes), nIn: p.nIn, nOut: p.nOut }, prb).mismatches.length, 0);
    maxOwn = Math.max(maxOwn, f.ownGates);
  }
  console.log("max own gates over 80 forks:", maxOwn);
});

test("a fork of a fork (three generations) checks out", () => {
  const r = rng(5);
  const g0 = randomBase(r, 3); const c0 = compile(g0);
  const g1 = randomFork(r, g0, 1); const c1 = compileFork(g1, asChip(c0, 1));
  const g2 = randomFork(r, g0, 2); g2.parent.circuitId = 2; const c2 = compileFork(g2, asChip(c1, 2));
  const parentOf = (p) => (p.circuitId === 1 ? { rulebook: g0, nState: c0.nState } : { rulebook: g1, nState: c1.nState });
  const res = checkRules({ records: decode(c2.bytes), nIn: c2.nIn, nOut: c2.nOut, resolve: c2.resolve }, g2, parentOf);
  assert.equal(res.mismatches.length, 0);
  assert.equal(stateSize(decode(c2.bytes), c2.resolve), c0.nState + (c1.nState - c0.nState) + (c2.nState - c1.nState));
  console.log(describe(g2).join("\n"));
});

test("a changed chip is caught", () => {
  const prb = randomBase(rng(3), 2);
  const p = compile(prb);
  const recs = decode(p.bytes);
  const i = recs.findIndex((x) => x.op === "nand" && x.a !== x.b);
  recs[i] = { ...recs[i], b: recs[i].a }; // rewire one gate
  const res = checkRules({ records: recs, nIn: p.nIn, nOut: p.nOut }, prb);
  assert.ok(res.mismatches.length > 0);
});

test("replay recomputes every decision from prices", () => {
  const rb = { assets: [{ symbol: "NVDA", base: 2, onDrop: "half", onRise: "double", stop: "stayOut" }, { symbol: "SPY", base: 2, onDrop: "none", onRise: "none", stop: "none" }], dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: true };
  const c = compile(rb);
  const fund = { assets: ["a", "b"], dropBps: 500, riseBps: 500, stopBps: 1500 };
  const path = [[100n, 50n], [94n, 51n], [80n, 49n], [85n, 50n], [95n, 52n]];
  let mem = { last: [0n, 0n], peak: [0n, 0n] }, state = new Array(c.nState).fill(0);
  const logged = path.map((prices, k) => {
    const d = inputsFromPrices(prices, mem, fund); mem = d.mem;
    const s = step(decode(c.bytes), c.nIn, c.nOut, d.bits, state); state = s.state;
    return { n: k + 1, prices, inputBits: unpackBits(packBits(d.bits), d.bits.length), outputBits: s.outputs, newStateBits: s.state };
  });
  const rows = replay({ records: decode(c.bytes), nIn: c.nIn, nOut: c.nOut }, fund, logged);
  assert.ok(rows.every((x) => x.ok));
  assert.deepEqual(rows[2].inputs.slice(0, 3), [1, 0, 1]); // NVDA fell >5% and is >15% below its peak
  logged[3].outputBits = logged[3].outputBits.map((b, i) => (i === 0 ? 1 - b : b)); // tamper with one logged decision
  assert.equal(replay({ records: decode(c.bytes), nIn: c.nIn, nOut: c.nOut }, fund, logged)[3].ok, false);
});
