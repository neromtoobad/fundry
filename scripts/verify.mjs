// Check a Sworn fund from chain data alone, the same checks as "Check it yourself" on the fund page:
//   1. read its chip (and, for a fork, the parent chip it REFs) from the TapeOut processor
//   2. a fork's REF really points at the parent chip the factory recorded, on the fund's own inputs
//   3. the rules written at launch (the rulebook in FundLaunched) match the chip on every input
//   4. TapeOut's Circuits.step on chain agrees with the JS evaluator on random cases
//   5. every rebalance replays from the prices it logged: prices -> signals -> chip -> weights, memory
// Read-only: no key, no transactions.
//   node scripts/verify.mjs <fund address>            (mainnet, rpc.xlayer.tech)
//   RPC_URL=http://127.0.0.1:8545 node scripts/verify.mjs <fund>   (local fork)
//   node scripts/verify.mjs --all                      (every fund the factory knows)
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbiItem, keccak256 } from "viem";
import { decode, refKey, checkRules, replay, step, stateSize, packBits, unpackBits, bytesToHex, hexToBytes, isFork } from "@sworn/sdk";
import { fundAbi, factoryAbi, circuitsAbi } from "../app/src/lib/abi.js";

const RPC = process.env.RPC_URL || "https://rpc.xlayer.tech";
const pub = createPublicClient({ transport: http(RPC), batch: { multicall: false } });
const chainId = await pub.getChainId();
const dep = JSON.parse(readFileSync(new URL(`../deployments/${chainId}.json`, import.meta.url)));
const FUND_LAUNCHED = parseAbiItem(
  "event FundLaunched(address indexed fund, address indexed creator, uint256 indexed circuitId, address[] assets, uint256 gates, string name, string rulebook, address parent)"
);
const read = (address, abi, functionName, args) => pub.readContract({ address, abi, functionName, args });
const bits = (hex, n) => unpackBits(hexToBytes(hex || "0x"), n);

const chips = new Map();
async function chip(id) {
  const k = String(id);
  if (chips.has(k)) return chips.get(k);
  const [netlist, info] = await Promise.all([read(dep.circuits, circuitsAbi, "netlist", [BigInt(id)]), read(dep.circuits, circuitsAbi, "circuitInfo", [BigInt(id)])]);
  const records = decode(netlist);
  const subs = {};
  for (const r of records.filter((x) => x.op === "ref")) {
    if (r.cpu !== dep.circuits.toLowerCase()) throw new Error(`chip #${id} REFs another processor ${r.cpu}`);
    subs[refKey(r.cpu, r.id)] = await chip(r.id);
  }
  const c = { id: Number(id), netlist, records, nIn: Number(info[0]), nOut: Number(info[1]), nState: Number(info[2]), gateCount: Number(info[3]), resolve: (cpu, i) => subs[refKey(cpu, i)] || null };
  chips.set(k, c);
  return c;
}

async function eventsOf(fund, opts) {
  const n = await read(fund, fundAbi, "eventBlockCount");
  const blocks = n === 0n ? [] : await read(fund, fundAbi, "eventBlocks", [0n, n]);
  const out = [];
  for (const b of blocks) out.push(...(await pub.getLogs({ ...opts, fromBlock: b, toBlock: b })));
  return { blocks, logs: out };
}

async function launchOf(fund) {
  const [b] = await read(fund, fundAbi, "eventBlocks", [0n, 1n]);
  const [l] = await pub.getLogs({ address: dep.factory, event: FUND_LAUNCHED, args: { fund }, fromBlock: b, toBlock: b });
  if (!l) throw new Error("FundLaunched event not found");
  return { ...l.args, rulebook: JSON.parse(l.args.rulebook) };
}

async function lineage(rb) {
  const out = {};
  for (let cur = rb; isFork(cur); ) {
    const id = Number(cur.parent.circuitId);
    const pf = await read(dep.factory, factoryAbi, "fundOfCircuit", [BigInt(id)]);
    const pl = await launchOf(pf);
    out[id] = { rulebook: pl.rulebook, nState: (await chip(id)).nState };
    cur = pl.rulebook;
  }
  return out;
}

let failed = 0;
const say = (ok, msg) => { if (!ok) failed++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };

async function verify(fund) {
  const L = await launchOf(fund);
  const rb = L.rulebook;
  console.log(`\n${L.name}  ${fund}`);
  const c = await chip(L.circuitId);
  const own = c.records.filter((r) => r.op !== "ref").length;
  const refs = c.records.filter((r) => r.op === "ref");
  say(true, `chip #${c.id}: ${hexToBytes(c.netlist).length} bytes, ${own} own gates, ${c.gateCount} total, ${c.nState} memory bits, keccak ${keccak256(c.netlist).slice(0, 18)}…`);

  let parents = {};
  if (isFork(rb) || refs.length) {
    const pid = Number(rb.parent?.circuitId);
    const recorded = await read(dep.factory, factoryAbi, "parentOf", [fund]);
    const pf = await read(dep.factory, factoryAbi, "fundOfCircuit", [BigInt(pid)]);
    const ok = refs.length === 1 && refs[0].id === pid && refs[0].ins.every((s, k) => s === 2 + k) && recorded.toLowerCase() === pf.toLowerCase() && L.parent.toLowerCase() === pf.toLowerCase();
    say(ok, `fork: REF → chip #${refs[0]?.id} on inputs 2..${1 + c.nIn}; factory.parentOf = ${recorded}`);
    parents = await lineage(rb);
  }

  const r = checkRules(c, rb, (p) => parents[Number(p.circuitId)]);
  say(r.mismatches.length === 0, `rules vs chip: ${r.cases - r.mismatches.length}/${r.cases} cases${r.exhaustive ? " (every input and memory combination)" : " (random sample)"}`);

  const nState = stateSize(c.records, c.resolve);
  let agree = 0;
  const K = 16;
  for (let k = 0; k < K; k++) {
    const ins = Array.from({ length: c.nIn }, () => (Math.random() < 0.4 ? 1 : 0));
    const st = Array.from({ length: nState }, () => (Math.random() < 0.5 ? 1 : 0));
    const [ns, out] = await read(dep.circuits, circuitsAbi, "step", [BigInt(c.id), bytesToHex(packBits(st)), bytesToHex(packBits(ins))]);
    const mine = step(c.records, c.nIn, c.nOut, ins, st, c.resolve);
    const o = bits(out, c.nOut), s = bits(ns, nState);
    if (mine.outputs.every((b, i) => b === o[i]) && mine.state.every((b, i) => b === s[i])) agree++;
  }
  say(agree === K, `Circuits.step on chain vs JS evaluator: ${agree}/${K} random cases`);

  const [assets, dropBps, riseBps, stopBps] = await Promise.all(["assets", "dropBps", "riseBps", "stopBps"].map((fn) => read(fund, fundAbi, fn)));
  const ev = fundAbi.find((x) => x.type === "event" && x.name === "Rebalanced");
  const { logs } = await eventsOf(fund, { address: fund, event: ev });
  const n = assets.length;
  const rebs = logs.map((l) => l.args).sort((a, b) => Number(a.n - b.n)).map((x) => ({
    n: Number(x.n), prices: x.prices, inputBits: bits(x.inputs, 3 * n), outputBits: bits(x.outputs, 2 * n), newStateBits: bits(x.newState, nState),
  }));
  const rep = replay(c, { assets, dropBps: Number(dropBps), riseBps: Number(riseBps), stopBps: Number(stopBps) }, rebs);
  const bad = rep.filter((x) => !x.ok).map((x) => `#${x.n}`);
  say(bad.length === 0, rebs.length ? `replayed ${rebs.length - bad.length}/${rebs.length} rebalances from their logged prices${bad.length ? `; mismatched ${bad.join(", ")}` : ""}` : "no rebalances yet");
}

const arg = process.argv[2];
if (!arg) { console.error("usage: node scripts/verify.mjs <fund address> | --all"); process.exit(2); }
console.log(`chain ${chainId} · factory ${dep.factory} · processor ${dep.circuits}`);
const list = arg === "--all" ? await read(dep.factory, factoryAbi, "allFunds") : [arg];
for (const f of list) await verify(f);
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
