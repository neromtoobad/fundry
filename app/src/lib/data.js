// Everything the app shows is read from chain: the factory's fund list, each fund's state, its
// circuit (netlist) on the Fundry TapeOut processor, and its events for the decision log.
import { createPublicClient, http, parseAbiItem } from "viem";
import { chain, deployment, assetByAddress, RPC_URL } from "./config.js";
import { fundAbi, factoryAbi, circuitsAbi, erc20Abi } from "./abi.js";

export const client = createPublicClient({ chain, transport: http(RPC_URL), batch: { multicall: { wait: 16 } } });

const FUND_LAUNCHED = parseAbiItem(
  "event FundLaunched(address indexed fund, address indexed creator, uint256 indexed circuitId, address[] assets, uint256 gates, string name, string rulebook)"
);

/** getLogs in chunks (public RPCs cap the block range). */
async function getLogsChunked(params, from, to, step = 50_000n) {
  const out = [];
  for (let a = from; a <= to; a += step) {
    const b = a + step - 1n > to ? to : a + step - 1n;
    out.push(...(await client.getLogs({ ...params, fromBlock: a, toBlock: b })));
  }
  return out;
}

let launchCache = null;
/** FundLaunched events: creator, circuit id, rulebook JSON per fund. */
export async function launches() {
  if (launchCache) return launchCache;
  const latest = await client.getBlockNumber();
  const logs = await getLogsChunked({ address: deployment.factory, event: FUND_LAUNCHED }, BigInt(deployment.startBlock), latest);
  const map = {};
  for (const l of logs) {
    let rulebook = null;
    try { rulebook = JSON.parse(l.args.rulebook); } catch { /* a launch with an unreadable rulebook still shows */ }
    map[l.args.fund.toLowerCase()] = {
      creator: l.args.creator, circuitId: l.args.circuitId, gates: Number(l.args.gates),
      rulebook, launchBlock: l.blockNumber, launchTx: l.transactionHash,
    };
  }
  launchCache = map;
  setTimeout(() => (launchCache = null), 15_000);
  return map;
}

const fundRead = (address, functionName, args) => client.readContract({ address, abi: fundAbi, functionName, args });

/** Summary used by the League table and the top of the Fund page. */
export async function fundSummary(address, launchInfo) {
  const [name, symbol, nav, supply, launchedAt, rebalanceCount, nextRebalanceAt, period, feeBps, tvlCap, assets, dropBps, riseBps, stopBps, latchState] =
    await Promise.all(
      ["name", "symbol", "nav", "totalSupply", "launchedAt", "rebalanceCount", "nextRebalanceAt", "period", "feeBps", "tvlCap", "assets", "dropBps", "riseBps", "stopBps", "latchState"].map(
        (fn) => fundRead(address, fn)
      )
    );
  const balances = await Promise.all(assets.map((a) => client.readContract({ address: a, abi: erc20Abi, functionName: "balanceOf", args: [address] })));
  const prices = await Promise.all(assets.map((_, i) => fundRead(address, "price", [BigInt(i)])));
  const holdings = assets.map((a, i) => {
    const meta = assetByAddress[a.toLowerCase()] || { symbol: "?", name: a, decimals: 18 };
    const value = (prices[i] * balances[i]) / 10n ** 18n; // USDG units (price is per 1e18 base units)
    return { address: a, ...meta, balance: balances[i], price: prices[i], value };
  });
  const cash = await client.readContract({ address: deployment.usdg, abi: erc20Abi, functionName: "balanceOf", args: [address] });
  // shares are minted at 1e12 per USDG unit at launch, so share price starts at exactly $1.00
  // $ per share = (nav / 1e6) / (supply / 1e18) = nav * 1e12 / supply
  const sharePrice = supply > 0n ? Number((nav * 10n ** 12n * 1_000_000n) / supply) / 1e6 : 1;
  const now = Number((await client.getBlock()).timestamp); // chain time (the local fork can run ahead of the wall clock)
  return {
    address, name, symbol, nav, supply, sharePrice, ret: sharePrice - 1,
    launchedAt: Number(launchedAt), rebalanceCount: Number(rebalanceCount), nextRebalanceAt: Number(nextRebalanceAt),
    period: Number(period), feeBps: Number(feeBps), tvlCap, dropBps: Number(dropBps), riseBps: Number(riseBps), stopBps: Number(stopBps),
    latchState, holdings, cash, now, ...launchInfo,
  };
}

export async function allFunds() {
  if (!deployment) return [];
  const [list, info] = await Promise.all([
    client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "allFunds" }),
    launches(),
  ]);
  return Promise.all(list.map((f) => fundSummary(f, info[f.toLowerCase()] || {})));
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

/** Every rebalance with the trades it made, newest first. */
export async function decisionLog(address, fromBlock) {
  const latest = await client.getBlockNumber();
  const from = BigInt(fromBlock ?? deployment.startBlock);
  const [reb, trades, deps, wds] = await Promise.all(
    ["Rebalanced", "Traded", "Deposited", "Withdrawn"].map((n) => getLogsChunked({ address, event: ev(n) }, from, latest))
  );
  const blocks = {};
  const ts = async (bn) => (blocks[bn] ??= (await client.getBlock({ blockNumber: bn })).timestamp);
  const byTx = {};
  for (const t of trades) (byTx[t.transactionHash] ??= []).push(t.args);
  const rebalances = await Promise.all(
    reb.map(async (l) => ({ ...l.args, n: Number(l.args.n), tx: l.transactionHash, block: l.blockNumber, time: Number(await ts(l.blockNumber)), trades: byTx[l.transactionHash] || [] }))
  );
  const flows = await Promise.all(
    [...deps.map((l) => ({ kind: "deposit", ...l.args, tx: l.transactionHash, block: l.blockNumber })),
     ...wds.map((l) => ({ kind: "withdraw", ...l.args, tx: l.transactionHash, block: l.blockNumber }))].map(async (f) => ({ ...f, time: Number(await ts(f.block)) }))
  );
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
