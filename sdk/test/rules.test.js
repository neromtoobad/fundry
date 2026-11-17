import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, run, referenceLevel, referenceStayed, describe, validate, decode, step, bytesToHex } from "../src/index.js";

const DROPS = ["none", "half", "zero"], RISES = ["none", "double"], STOPS = ["none", "once", "stayOut"];

function rng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function randomRulebook(r) {
  const N = 1 + Math.floor(r() * 4);
  const assets = Array.from({ length: N }, (_, i) => ({
    symbol: ["NVDA", "SPY", "SPCX", "GOLD"][i],
    base: Math.floor(r() * 4),
    onDrop: DROPS[Math.floor(r() * 3)],
    onRise: RISES[Math.floor(r() * 2)],
    stop: STOPS[Math.floor(r() * 3)],
  }));
  if (assets.every((a) => a.base === 0)) assets[0].base = 1;
  return { assets, dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: r() < 0.5 };
}

// Exhaustive check: every input combination and every latch state gives the reference result.
function checkExhaustive(rb) {
  const c = compile(rb);
  const N = rb.assets.length;
  const latchAssets = rb.assets.map((a, i) => (a.stop === "stayOut" ? i : -1)).filter((i) => i >= 0);
  for (let inp = 0; inp < 1 << (3 * N); inp++) {
    for (let st = 0; st < 1 << latchAssets.length; st++) {
      const features = rb.assets.map((_, i) => ({ drop: (inp >> (3 * i)) & 1, rise: (inp >> (3 * i + 1)) & 1, stop: (inp >> (3 * i + 2)) & 1 }));
      const stayedOf = (i) => { const k = latchAssets.indexOf(i); return k < 0 ? 0 : (st >> k) & 1; };
      const state = latchAssets.map((_, k) => (st >> k) & 1);
      const got = run(c, features, state);
      const allFalling = features.every((f) => f.drop) ? 1 : 0;
      rb.assets.forEach((a, i) => {
        const env = { ...features[i], stayed: stayedOf(i), allFalling };
        assert.equal(got.levels[i], referenceLevel(a, env, rb.allFallingToCash), `level ${a.symbol} inp=${inp} st=${st}`);
      });
      latchAssets.forEach((i, k) => {
        const env = { ...features[i], stayed: stayedOf(i) };
        assert.equal(got.state[k], referenceStayed(rb.assets[i], env), `latch ${i}`);
      });
    }
  }
  return c;
}

test("example fund compiles and matches the reference on every input", () => {
  const rb = {
    assets: [
      { symbol: "NVDA", base: 2, onDrop: "half", onRise: "double", stop: "stayOut" },
      { symbol: "SPY", base: 2, onDrop: "none", onRise: "none", stop: "once" },
      { symbol: "GOLD", base: 1, onDrop: "none", onRise: "none", stop: "none" },
    ],
    dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: true,
  };
  const c = checkExhaustive(rb);
  assert.equal(c.nIn, 9);
  assert.equal(c.nOut, 6);
  assert.equal(c.nState, 1);
  assert.ok(c.gateCount < 80, `gate count ${c.gateCount}`);
  // encoding round-trips
  const back = decode(c.bytes);
  assert.deepEqual(back, c.netlist.records.map((r) => (r.op === "nand" ? { op: "nand", a: r.a, b: r.b } : { op: "latch", d: r.d })));
  console.log("example gates", c.gateCount, "bytes", c.bytes.length);
  console.log(describe(rb).join("\n"));
});

test("200 random rulebooks match the reference exhaustively", () => {
  const r = rng(42);
  let maxGates = 0;
  for (let k = 0; k < 200; k++) {
    const c = checkExhaustive(randomRulebook(r));
    maxGates = Math.max(maxGates, c.gateCount);
  }
  console.log("max gates over 200 random funds:", maxGates);
});

test("validate rejects bad rulebooks", () => {
  assert.throws(() => validate({ assets: [], dropBps: 1, riseBps: 1, stopBps: 1 }));
  assert.throws(() => validate({ assets: [{ symbol: "X", base: 0, onDrop: "none", onRise: "none", stop: "none" }], dropBps: 500, riseBps: 500, stopBps: 500 }));
  assert.throws(() => validate({ assets: [{ symbol: "X", base: 4, onDrop: "none", onRise: "none", stop: "none" }], dropBps: 500, riseBps: 500, stopBps: 500 }));
});
