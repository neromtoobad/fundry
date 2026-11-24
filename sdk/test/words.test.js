import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWords, compile, validate } from "../src/index.js";

test("the example from the home page", () => {
  const r = parseWords("Hold 60% NVDA and 40% SPY. If NVDA falls 5%, cut it to half. If it rises 8%, double it. Stop-loss 15% on NVDA, stay out until it recovers. If everything falls, go to cash.");
  assert.equal(r.error, null);
  assert.deepEqual(r.skipped, []);
  const [nvda, spy] = r.rulebook.assets;
  assert.deepEqual(nvda, { symbol: "NVDA", base: 3, onDrop: "half", onRise: "double", stop: "stayOut" });
  assert.deepEqual(spy, { symbol: "SPY", base: 2, onDrop: "none", onRise: "none", stop: "none" });
  assert.equal(r.rulebook.dropBps, 500);
  assert.equal(r.rulebook.riseBps, 800);
  assert.equal(r.rulebook.stopBps, 1500);
  assert.equal(r.rulebook.allFallingToCash, true);
  validate(r.rulebook);
  assert.ok(compile(r.rulebook).gateCount > 0);
});

test("names, aliases and 'each'", () => {
  const r = parseWords("Own Microsoft, Meta and Nvidia equally.\nIf any of them drops 4%, sell it.\nStop-loss 10% on each.");
  assert.deepEqual(r.rulebook.assets.map((a) => [a.symbol, a.base, a.onDrop, a.stop]), [
    ["MSFT", 2, "zero", "once"], ["META", 2, "zero", "once"], ["NVDA", 2, "zero", "once"],
  ]);
  assert.equal(r.rulebook.dropBps, 400);
  assert.equal(r.rulebook.stopBps, 1000);
});

test("mostly / a little", () => {
  const r = parseWords("Mostly gold, a little bitcoin and a little ether. Never go to cash.");
  assert.deepEqual(r.rulebook.assets.map((a) => [a.symbol, a.base]), [["GOLD", 3], ["BTC", 1], ["ETH", 1]]);
  assert.equal(r.rulebook.allFallingToCash, false);
});

test("reports what it did not understand instead of guessing", () => {
  const r = parseWords("Hold SPY. Buy the dip on Tuesdays. Make me rich.");
  assert.deepEqual(r.understood, ["Hold SPY"]);
  assert.deepEqual(r.skipped, ["Buy the dip on Tuesdays", "Make me rich"]);
});

test("limits: no stocks, too many, unlisted", () => {
  assert.ok(parseWords("make money").error);
  assert.ok(parseWords("Hold NVDA, SPY, MSFT, META and gold").error);
  const r = parseWords("Hold NVDA and bitcoin", ["NVDA", "SPY"]);
  assert.deepEqual(r.rulebook.assets.map((a) => a.symbol), ["NVDA"]);
});
