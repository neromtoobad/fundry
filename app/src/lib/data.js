// Everything the app shows is read from chain: the factory's fund list, each fund's state, its
// circuit (netlist) on the Fundry TapeOut processor, and its events for the decision log.
import { createPublicClient, http, parseAbiItem } from "viem";
import { decode, refKey, hexToBytes, unpackBits, packBits, bytesToHex } from "@fundry/sdk";
import { chain, deployment, assetByAddress, RPC_URL } from "./config.js";
import { fundAbi, factoryAbi, circuitsAbi, erc20Abi } from "./abi.js";

export const client = createPublicClient({ chain, transport: http(RPC_URL), batch: { multicall: { wait: 16 } } });

const FUND_LAUNCHED = parseAbiItem(
  "event FundLaunched(address indexed fund, address indexed creator, uint256 indexed circuitId, address[] assets, uint256 gates, string name, string rulebook, address parent)"
);

// Public X Layer RPCs cap eth_getLogs at 100-1,000 blocks, so the app never scans the chain.
// Each fund keeps an on-chain list of the blocks it emitted events in (eventBlocks); we fetch logs
// for exactly those blocks.
const fundRead0 = (address, functionName, args) => client.readContract({ address, abi: fundAbi, functionName, args });

async function eventBlocksOf(fund) {
  const n = await fundRead0(fund, "eventBlockCount");
  return n === 0n ? [] : fundRead0(fund, "eventBlocks", [0n, n]);
}

/** Run async jobs with at most `n` in flight (public RPCs rate-limit bursts). */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const launchCache = {};
/** The FundLaunched event for one fund: creator, circuit id, gate count, rulebook JSON. */
export async function launchInfo(fund) {
  const key = fund.toLowerCase();
  if (launchCache[key]) return launchCache[key];
  const [block] = await fundRead0(fund, "eventBlocks", [0n, 1n]);
  const [l] = await client.getLogs({ address: deployment.factory, event: FUND_LAUNCHED, args: { fund }, fromBlock: block, toBlock: block });
  if (!l) return {};
  let rulebook = null;
  try { rulebook = JSON.parse(l.args.rulebook); } catch { /* a launch with an unreadable rulebook still shows */ }
  return (launchCache[key] = {
    creator: l.args.creator, circuitId: l.args.circuitId, gates: Number(l.args.gates),
    rulebook, launchBlock: l.blockNumber, launchTx: l.transactionHash,
    parent: l.args.parent && l.args.parent !== ZERO ? l.args.parent : null,
  });
}

const fundRead = fundRead0;
export const ZERO = "0x0000000000000000000000000000000000000000";

/** Summary used by the League table and the top of the Fund page. */
export async function fundSummary(address, launchInfo) {
  let [name, symbol, nav, supply, launchedAt, rebalanceCount, nextRebalanceAt, period, feeBps, tvlCap, assets, dropBps, riseBps, stopBps, latchState] =
    await Promise.all(
      ["name", "symbol", "nav", "totalSupply", "launchedAt", "rebalanceCount", "nextRebalanceAt", "period", "feeBps", "tvlCap", "assets", "dropBps", "riseBps", "stopBps", "latchState"].map(
        // nav and price revert while a pool can't serve a 30-minute TWAP yet; that must not hide the fund
        (fn) => fundRead(address, fn).catch((e) => (fn === "nav" ? null : Promise.reject(e)))
      )
    );
  const balances = await Promise.all(assets.map((a) => client.readContract({ address: a, abi: erc20Abi, functionName: "balanceOf", args: [address] })));
  const prices = await Promise.all(assets.map((_, i) => fundRead(address, "price", [BigInt(i)]).catch(() => null)));
  const holdings = assets.map((a, i) => {
    const meta = assetByAddress[a.toLowerCase()] || { symbol: "?", name: a, decimals: 18 };
    const value = prices[i] == null ? 0n : (prices[i] * balances[i]) / 10n ** 18n; // USDG units (price is per 1e18 base units)
    return { address: a, ...meta, balance: balances[i], price: prices[i], value };
  });
  const cash = await client.readContract({ address: deployment.usdg, abi: erc20Abi, functionName: "balanceOf", args: [address] });
  const priceWaiting = holdings.filter((h) => h.price == null).map((h) => h.symbol);
  // with no stock held, the NAV is just the cash, so it is exact even without prices
  const navUnavailable = nav == null && balances.some((b) => b > 0n);
  if (nav == null) nav = navUnavailable ? 0n : cash;
  // shares are minted at 1e12 per USDG unit at launch, so share price starts at exactly $1.00
  // $ per share = (nav / 1e6) / (supply / 1e18) = nav * 1e12 / supply
  const sharePrice = navUnavailable ? null : supply > 0n ? Number((nav * 10n ** 12n * 1_000_000n) / supply) / 1e6 : 1;
  const now = Number((await client.getBlock()).timestamp); // chain time (the local fork can run ahead of the wall clock)
  const [chipOwner, ownerFeeShares, royaltyFeeShares] = await Promise.all(
    ["chipOwner", "ownerFeeShares", "royaltyFeeShares"].map((fn) => fundRead(address, fn).catch(() => null))
  );
  return {
    address, name, symbol, nav, supply, sharePrice, ret: sharePrice == null ? null : sharePrice - 1,
    launchedAt: Number(launchedAt), rebalanceCount: Number(rebalanceCount), nextRebalanceAt: Number(nextRebalanceAt),
    period: Number(period), feeBps: Number(feeBps), tvlCap, dropBps: Number(dropBps), riseBps: Number(riseBps), stopBps: Number(stopBps),
    latchState, holdings, cash, now, priceWaiting, navUnavailable, chipOwner, ownerFeeShares, royaltyFeeShares, ...launchInfo,
  };
}

export async function allFunds() {
  if (!deployment) return [];
  const list = await client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "allFunds" });
  return pool(list, 4, async (f) => fundSummary(f, await launchInfo(f)));
}

/** The circuit as taped out on the Fundry processor. */
export async function circuit(circuitId) {
  const [netlist, info] = await Promise.all([
    client.readContract({ address: deployment.circuits, abi: circuitsAbi, functionName: "netlist", args: [circuitId] }),
    client.readContract({ address: deployment.circuits, abi: circuitsAbi, functionName: "circuitInfo", args: [circuitId] }),
  ]);
  return { netlist, nIn: Number(info[0]), nOut: Number(info[1]), nState: Number(info[2]), gateCount: Number(info[3]) };
}

/** What the chip would decide right now, straight from Circuits.step via fund.preview(). */
export async function preview(address) {
  const [inputs, outputs, newState, levels] = await fundRead(address, "preview");
  return { inputs, outputs, newState, levels: levels.map(Number) };
}

const ev = (name) => fundAbi.find((x) => x.type === "event" && x.name === name);

const EVENTS = ["Rebalanced", "Traded", "Deposited", "Withdrawn"].map(ev);

/** Every rebalance with the trades it made, newest first, plus money in and out. */
export async function decisionLog(address) {
  const blocks = await eventBlocksOf(address);
  const perBlock = await pool(blocks, 4, async (b) => {
    const [logs, block] = await Promise.all([
      client.getLogs({ address, events: EVENTS, fromBlock: b, toBlock: b }),
      client.getBlock({ blockNumber: b }),
    ]);
    return logs.map((l) => ({ ...l, time: Number(block.timestamp) }));
  });
  const logs = perBlock.flat();
  const byTx = {};
  for (const t of logs.filter((l) => l.eventName === "Traded")) (byTx[t.transactionHash] ??= []).push(t.args);
  const rebalances = logs.filter((l) => l.eventName === "Rebalanced").map((l) => ({
    ...l.args, n: Number(l.args.n), tx: l.transactionHash, block: l.blockNumber, time: l.time, trades: byTx[l.transactionHash] || [],
  }));
  const flows = logs.filter((l) => l.eventName === "Deposited" || l.eventName === "Withdrawn").map((l) => ({
    kind: l.eventName === "Deposited" ? "deposit" : "withdraw", ...l.args, tx: l.transactionHash, block: l.blockNumber, time: l.time,
  }));
  return { rebalances: rebalances.sort((a, b) => b.n - a.n), flows: flows.sort((a, b) => Number(b.block - a.block)) };
}

export async function tapeoutFee() {
  return client.readContract({ address: deployment.circuits, abi: circuitsAbi, functionName: "TAPEOUT_FEE" });
}

export async function listedAssets() {
  const n = await client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "listedCount" });
  const addrs = await Promise.all(Array.from({ length: Number(n) }, (_, i) => client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "listedAssets", args: [BigInt(i)] })));
  return addrs.map((a) => assetByAddress[a.toLowerCase()]).filter(Boolean);
}

export async function balanceOf(token, who) {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}

// ---- chips, forks and checks --------------------------------------------------------------------

const treeCache = new Map();
/**
 * A chip with every REF'd chip loaded, ready for the SDK evaluator:
 * { circuitId, netlist, records, nIn, nOut, nState, gateCount, resolve }.
 */
export async function chipTree(circuitId) {
  const key = String(circuitId);
  if (treeCache.has(key)) return treeCache.get(key);
  const p = (async () => {
    const c = await circuit(BigInt(circuitId));
    const records = decode(c.netlist);
    const subs = {};
    for (const r of records.filter((x) => x.op === "ref")) {
      if (r.cpu.toLowerCase() !== deployment.circuits.toLowerCase()) throw new Error("REF to another processor");
      subs[refKey(r.cpu, r.id)] = await chipTree(r.id);
    }
    return { circuitId: Number(circuitId), ...c, records, resolve: (cpu, id) => subs[refKey(cpu, id)] || null, subs };
  })();
  treeCache.set(key, p);
  p.catch(() => treeCache.delete(key));
  return p;
}

/** Ask the real TapeOut evaluator: one beat of `circuitId` for these bits. */
export async function stepOnChain(circuitId, stateBits, inputBits) {
  const [newState, outputs] = await client.readContract({
    address: deployment.circuits, abi: circuitsAbi, functionName: "step",
    args: [BigInt(circuitId), bytesToHex(packBits(stateBits)), bytesToHex(packBits(inputBits))],
  });
  return { state: unpackBits(hexToBytes(newState), stateBits.length), outputs: unpackBits(hexToBytes(outputs), 64) };
}

/** The fund that owns a chip, and its rulebook (for checking forks against their parent). */
export async function fundOfCircuit(circuitId) {
  const fund = await client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "fundOfCircuit", args: [BigInt(circuitId)] });
  if (!fund || fund === ZERO) return null;
  return { fund, ...(await launchInfo(fund)) };
}

/** Parent rulebooks for a fork, all the way up, keyed by circuit id: what referenceStep needs. */
export async function lineage(rb) {
  const out = {};
  let cur = rb;
  while (cur?.kind === "fork" && cur.parent) {
    const id = Number(cur.parent.circuitId);
    const [p, tree] = await Promise.all([fundOfCircuit(id), chipTree(id)]);
    if (!p?.rulebook) throw new Error(`parent chip #${id}: rulebook not found`);
    out[id] = { rulebook: p.rulebook, nState: tree.nState, fund: p.fund, name: p.rulebook?.parent?.name };
    cur = p.rulebook;
  }
  return out;
}

export async function childrenOf(fund) {
  return client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "childrenOf", args: [fund] });
}

export async function fundName(fund) {
  return fundRead(fund, "name");
}

/** The circuit NFT owner (who earns a fund's creator fee). */
export async function ownerOfChip(circuitId) {
  return client.readContract({ address: deployment.circuits, abi: circuitsAbi, functionName: "ownerOf", args: [BigInt(circuitId)] });
}
