// Writes contracts/test/fixtures/rule-example.json: a compiled rulebook plus the expected
// step() result for every input and latch state, for the on-chain fork test.
import { writeFileSync } from "node:fs";
import { compile, step, packBits, bytesToHex, unpackBits } from "../src/index.js";

const rb = {
  assets: [
    { symbol: "NVDA", base: 2, onDrop: "half", onRise: "double", stop: "stayOut" },
    { symbol: "SPY", base: 2, onDrop: "none", onRise: "none", stop: "once" },
    { symbol: "GOLD", base: 1, onDrop: "none", onRise: "none", stop: "none" },
  ],
  dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: true,
};
const c = compile(rb);
const cases = [];
for (let inp = 0; inp < 1 << c.nIn; inp++) {
  for (let st = 0; st < 1 << c.nState; st++) {
    const inBits = unpackBits(Uint8Array.of(inp & 255, inp >> 8), c.nIn);
    const stBits = unpackBits(Uint8Array.of(st), c.nState);
    const r = step(c.netlist.records, c.nIn, c.nOut, inBits, stBits);
    cases.push({ inputs: bytesToHex(packBits(inBits)), state: bytesToHex(packBits(stBits)), outputs: bytesToHex(packBits(r.outputs)), newState: bytesToHex(packBits(r.state)) });
  }
}
writeFileSync(new URL("../../contracts/test/fixtures/rule-example.json", import.meta.url),
  JSON.stringify({ netlist: bytesToHex(c.bytes), nIn: c.nIn, nOut: c.nOut, nState: c.nState, gateCount: c.gateCount, cases }, null, 1));
console.log("fixture:", c.gateCount, "gates,", cases.length, "cases");
