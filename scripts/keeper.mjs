// Sworn keeper: presses "Rebalance" for every fund that is due. rebalance() is open to anyone and
// the chip decides the weights, so the keeper has no say over what a fund buys; it only pays gas.
// It simulates each call first and only sends the ones that would succeed.
//
//   Local fork:  node scripts/keeper.mjs --once
//   Mainnet:     KEEPER_KEY=0x.. RPC_URL=https://rpc.xlayer.tech node scripts/keeper.mjs
//
// Options: --once (one pass, then exit), --every=<minutes> (default 10).
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { fundAbi, factoryAbi } from "../app/src/lib/abi.js";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const once = process.argv.includes("--once");
const every = Number((process.argv.find((a) => a.startsWith("--every=")) || "--every=10").split("=")[1]);

const chainId = await createPublicClient({ transport: http(RPC) }).getChainId();
const fork = chainId === 31337;
const chain = defineChain({
  id: chainId, name: fork ? "X Layer fork" : "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
const dep = JSON.parse(readFileSync(new URL(`../deployments/${chainId}.json`, import.meta.url)));
const key = process.env.KEEPER_KEY;
if (!key && !fork) throw new Error("set KEEPER_KEY (a wallet with a little OKB for gas)");
// anvil's public test mnemonic, account 6, on the fork only
const account = key ? privateKeyToAccount(key) : mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 6 });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const read = (address, functionName) => pub.readContract({ address, abi: fundAbi, functionName });
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function pass() {
  const now = (await pub.getBlock()).timestamp;
  const funds = await pub.readContract({ address: dep.factory, abi: factoryAbi, functionName: "allFunds" });
  let sent = 0;
  for (const fund of funds) {
    const [name, supply, next] = await Promise.all([read(fund, "name"), read(fund, "totalSupply"), read(fund, "nextRebalanceAt")]);
    if (supply === 0n || now < next) continue;
    try {
      // dry run first: a revert here (empty fund, price moved past the slippage cap) costs nothing
      const { request } = await pub.simulateContract({ address: fund, abi: fundAbi, functionName: "rebalance", account, gas: 3_000_000n });
      const hash = await wallet.writeContract(request);
      const rc = await pub.waitForTransactionReceipt({ hash });
      log(`${name}: rebalance ${rc.status} in ${hash}, NAV $${(Number(await read(fund, "nav")) / 1e6).toFixed(2)}`);
      sent++;
    } catch (e) {
      log(`${name}: skipped, ${e.shortMessage || e.message}`);
    }
  }
  log(`checked ${funds.length} funds, sent ${sent} rebalance(s), keeper ${account.address}`);
}

await pass();
if (!once) setInterval(() => pass().catch((e) => log("pass failed:", e.shortMessage || e.message)), every * 60_000);
