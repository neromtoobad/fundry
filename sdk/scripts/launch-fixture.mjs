// Writes contracts/test/fixtures/launch-nvda-spy.json: a 2-stock rulebook compiled for the
// lifecycle fork test (launch -> deposit -> rebalance -> crash -> rebalance -> withdraw).
import { writeFileSync } from "node:fs";
import { compile, describe, bytesToHex } from "../src/index.js";

const rulebook = {
  assets: [
    { symbol: "NVDA", base: 2, onDrop: "half", onRise: "double", stop: "stayOut" },
    { symbol: "SPY", base: 2, onDrop: "none", onRise: "none", stop: "none" },
  ],
  dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: true,
};
const c = compile(rulebook);
writeFileSync(new URL("../../contracts/test/fixtures/launch-nvda-spy.json", import.meta.url), JSON.stringify({
  netlist: bytesToHex(c.bytes), nIn: c.nIn, nOut: c.nOut, nState: c.nState, gateCount: c.gateCount,
  rulebook: JSON.stringify(rulebook), english: describe(rulebook).join(" "),
}, null, 1));
console.log("launch fixture:", c.gateCount, "gates,", c.nState, "latch");
