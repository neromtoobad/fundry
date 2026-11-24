// Writes contracts/test/fixtures/fork.json: a parent rulebook and a fork of it whose netlist REFs
// the parent chip. The REF target is a placeholder (cpu 0x..aa, id 0) that the Solidity test
// patches once it knows the real processor and circuit id. `cases` holds the expected step()
// result for every input and state, computed by the JS evaluator, to compare against the chain.
import { writeFileSync } from "node:fs";
import { compile, compileFork, decode, step, packBits, unpackBits, bytesToHex, describe } from "../src/index.js";

const parentRb = {
  assets: [
    { symbol: "NVDA", base: 2, onDrop: "half", onRise: "double", stop: "stayOut" },
    { symbol: "SPY", base: 2, onDrop: "none", onRise: "none", stop: "none" },
  ],
  dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: true,
};
const forkRb = {
  kind: "fork", parent: { fund: "0x0", circuitId: 0, name: "AI + Market" },
  assets: [
    { symbol: "NVDA", shift: -1, onDrop: "none", onRise: "none", stop: "none" },
    { symbol: "SPY", shift: 1, onDrop: "none", onRise: "none", stop: "stayOut" },
  ],
  dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: false,
};
const PLACEHOLDER = "0x00000000000000000000000000000000000000aa";
const p = compile(parentRb);
const parent = { cpu: PLACEHOLDER, circuitId: 0, nIn: p.nIn, nOut: p.nOut, nState: p.nState, records: decode(p.bytes), totalGates: p.gateCount };
const f = compileFork(forkRb, parent);
const recs = decode(f.bytes);
const cases = [];
for (let inp = 0; inp < 1 << f.nIn; inp++) {
  for (let st = 0; st < 1 << f.nState; st++) {
    const inBits = unpackBits(Uint8Array.of(inp), f.nIn);
    const stBits = unpackBits(Uint8Array.of(st), f.nState);
    const r = step(recs, f.nIn, f.nOut, inBits, stBits, f.resolve);
    cases.push({ inputs: bytesToHex(packBits(inBits)), state: bytesToHex(packBits(stBits)), outputs: bytesToHex(packBits(r.outputs)), newState: bytesToHex(packBits(r.state)) });
  }
}
writeFileSync(new URL("../../contracts/test/fixtures/fork.json", import.meta.url), JSON.stringify({
  parentNetlist: bytesToHex(p.bytes), parentGates: p.gateCount, parentRulebook: JSON.stringify(parentRb),
  forkNetlist: bytesToHex(f.bytes), forkOwnGates: f.ownGates, forkNState: f.nState, forkLatches: f.netlist.nLatch,
  forkRulebook: JSON.stringify(forkRb), english: describe(forkRb).join(" "), cases,
}, null, 1));
console.log("fork fixture: parent", p.gateCount, "gates; fork", f.ownGates, "own gates,", f.nState, "state bits,", cases.length, "cases");
