// Which chain the app talks to. Local dev defaults to the anvil fork of X Layer (chain 31337);
// production builds set VITE_CHAIN_ID=196 and use the mainnet deployment.
import { defineChain } from "viem";
import assetsJson from "../../../deployments/assets.json";

const deployments = import.meta.glob("../../../deployments/[0-9]*.json", { eager: true, import: "default" });

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 31337);
export const IS_FORK = CHAIN_ID === 31337;
export const RPC_URL = import.meta.env.VITE_RPC_URL || (IS_FORK ? "http://127.0.0.1:8545" : "https://rpc.xlayer.tech");
export const EXPLORER = "https://www.oklink.com/x-layer";

export const deployment = Object.values(deployments).find((d) => d.chainId === CHAIN_ID) || null;

export const chain = defineChain({
  id: CHAIN_ID,
  name: IS_FORK ? "X Layer (local fork)" : "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "OKLink", url: EXPLORER } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

/** Stocks Fundry can hold, keyed by lowercase token address. */
export const ASSETS = assetsJson.assets;
export const assetByAddress = Object.fromEntries(ASSETS.map((a) => [a.address.toLowerCase(), a]));
export const assetBySymbol = Object.fromEntries(ASSETS.map((a) => [a.symbol, a]));
export const USDG = assetsJson.usdg;

/** Explorer links only make sense on mainnet; the fork has no explorer. */
export const txUrl = (h) => (IS_FORK ? null : `${EXPLORER}/tx/${h}`);
export const addrUrl = (a) => (IS_FORK ? null : `${EXPLORER}/address/${a}`);
