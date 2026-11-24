// Launches the demo funds through FundryFactory. On the local fork it also deposits test USDG and
// runs their first rebalance.
//   Local fork:  node scripts/seed.mjs [--days=N]   (anvil's test accounts, chain 31337)
//   Mainnet:     node --env-file=.env scripts/seed.mjs   (launches only: putting real money in and
//                the first swap are done by a person from the app, never by this script)
// On the fork, --days=N moves time forward a day at a time and rebalances again, so the decision
// log has more than one entry. It never fakes prices: the chips see whatever the real pools say.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createPublicClient, createWalletClient, http, parseUnits, defineChain, decodeEventLog } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { compile, compileFork, decode, bytesToHex } from "@fundry/sdk";
import { fundAbi, factoryAbi, circuitsAbi, erc20Abi } from "../app/src/lib/abi.js";
import { demoFunds, demoForks } from "./funds.mjs";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const days = Number((process.argv.find((a) => a.startsWith("--days=")) || "--days=0").split("=")[1]);
const chainId = await createPublicClient({ transport: http(RPC) }).getChainId();
const fork = chainId === 31337;
const chain = defineChain({
  id: chainId, name: fork ? "X Layer fork" : "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
const dep = JSON.parse(readFileSync(new URL(`../deployments/${chainId}.json`, import.meta.url)));
const { assets } = JSON.parse(readFileSync(new URL("../deployments/assets.json", import.meta.url)));
const bySymbol = Object.fromEntries(assets.map((a) => [a.symbol, a]));

const MNEMONIC = "test test test test test test test test test test test junk"; // anvil's public test mnemonic
const accounts = fork
  ? [1, 2, 3, 4].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }))
  : [privateKeyToAccount(process.env.PRIVATE_KEY)];
const send = async (account, req) => {
  const hash = await createWalletClient({ account, chain, transport: http(RPC) }).writeContract({ ...req, account, chain });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${req.functionName} reverted: ${hash}`);
  return rc;
};
const read = (address, functionName, args = []) => pub.readContract({ address, abi: fundAbi, functionName, args });

if (fork) for (const a of accounts) execFileSync("python3", ["scripts/fork-fund.py", a.address, RPC], { stdio: "ignore" });

const fee = await pub.readContract({ address: dep.circuits, abi: circuitsAbi, functionName: "TAPEOUT_FEE" });
const existing = await pub.readContract({ address: dep.factory, abi: factoryAbi, functionName: "allFunds" });
const names = await Promise.all(existing.map((f) => read(f, "name")));
const launched = [];

/** A chip as the SDK needs it to compile a fork: read from the processor (REFs resolved). */
async function chipOf(circuitId) {
  const [nl, info] = await Promise.all([
    pub.readContract({ address: dep.circuits, abi: circuitsAbi, functionName: "netlist", args: [circuitId] }),
    pub.readContract({ address: dep.circuits, abi: circuitsAbi, functionName: "circuitInfo", args: [circuitId] }),
  ]);
  const records = decode(nl);
  const subs = {};
  for (const r of records.filter((x) => x.op === "ref")) subs[`${r.cpu}:${r.id}`] = await chipOf(BigInt(r.id));
  return {
    cpu: dep.circuits.toLowerCase(), circuitId: Number(circuitId), nIn: Number(info[0]), nOut: Number(info[1]), nState: Number(info[2]),
    totalGates: Number(info[3]), records, resolve: (cpu, id) => subs[`${cpu.toLowerCase()}:${Number(id)}`] || null,
  };
}

for (const [i, f] of [...demoFunds, ...demoForks].entries()) {
  const creator = accounts[i % accounts.length];
  let fund = existing[names.indexOf(f.name)] || launched.find((x) => x.name === f.name)?.fund;
  if (!fund) {
    let parent = "0x0000000000000000000000000000000000000000";
    let c;
    if (f.forkOf) {
      const p = launched.find((x) => x.name === f.forkOf);
      parent = p.fund;
      const pid = await read(parent, "circuitId");
      f.rulebook = { ...f.rulebook, parent: { fund: parent, circuitId: Number(pid), name: f.forkOf } };
      c = compileFork(f.rulebook, await chipOf(pid));
    } else c = compile(f.rulebook);
    const rc = await send(creator, {
      address: dep.factory, abi: factoryAbi, functionName: "launch", value: fee, gas: 6_000_000n,
      args: [{
        name: f.name, symbol: f.symbol,
        assets: f.rulebook.assets.map((a) => bySymbol[a.symbol].address),
        netlist: bytesToHex(c.bytes),
        dropBps: f.rulebook.dropBps, riseBps: f.rulebook.riseBps, stopBps: f.rulebook.stopBps,
        feeBps: 100, period: 86_400, tvlCap: parseUnits("25000", 6),
        rulebook: JSON.stringify(f.rulebook), parent,
      }],
    });
    const ev = rc.logs
      .map((l) => { try { return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics }); } catch { return null; } })
      .find((e) => e?.eventName === "FundLaunched");
    fund = ev.args.fund;
    console.log(`launched ${f.name} at ${fund}: circuit #${ev.args.circuitId}, ${c.gateCount} own gates${f.forkOf ? `, fork of ${f.forkOf}` : ""}`);
  } else console.log(`${f.name} already at ${fund}`);
  launched.push({ ...f, fund, creator });
}

if (!fork) process.exit(0);

// fork only: the creator deposits test USDG and a second account joins
for (const [i, f] of launched.entries()) {
  if ((await read(f.fund, "totalSupply")) > 0n) continue;
  const investors = [f.creator, accounts[(i + 1) % accounts.length]];
  for (const [k, who] of investors.entries()) {
    const amount = parseUnits(String(k === 0 ? f.deposit : Math.round(f.deposit / 2)), 6);
    await send(who, { address: dep.usdg, abi: erc20Abi, functionName: "approve", args: [f.fund, amount] });
    await send(who, { address: f.fund, abi: fundAbi, functionName: "deposit", args: [amount, 0n], gas: 400_000n });
  }
  console.log(`${f.name}: deposits in`);
}

async function rebalanceDue(keeper) {
  const now = (await pub.getBlock()).timestamp;
  for (const f of launched) {
    if (now < (await read(f.fund, "nextRebalanceAt"))) continue;
    await send(keeper, { address: f.fund, abi: fundAbi, functionName: "rebalance", gas: 3_000_000n });
    console.log(`${f.name}: rebalanced, NAV $${(Number(await read(f.fund, "nav")) / 1e6).toFixed(2)}`);
  }
}
await rebalanceDue(accounts[0]);
for (let d = 0; d < days; d++) {
  await pub.request({ method: "evm_increaseTime", params: [86_401] });
  await pub.request({ method: "evm_mine", params: [] });
  await rebalanceDue(accounts[d % accounts.length]);
}
