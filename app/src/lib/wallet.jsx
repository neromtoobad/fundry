// Wallet: any injected EVM wallet (OKX Wallet, MetaMask, Rabby…) on X Layer.
// On the local fork only, a "test account" option signs with one of anvil's public test keys,
// so every flow can be clicked through without a browser extension.
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { createWalletClient, custom, http, encodeAbiParameters, keccak256, BaseError, ContractFunctionRevertedError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, IS_FORK, RPC_URL, USDG } from "./config.js";
import { client } from "./data.js";

// anvil's well-known test key #5. Only ever used against the local fork (chain 31337).
const FORK_TEST_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";

const Ctx = createContext(null);

export function WalletProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [kind, setKind] = useState(null); // "injected" | "fork-test"
  const [error, setError] = useState(null);

  const walletClient = useMemo(() => {
    if (!account) return null;
    if (kind === "fork-test") return createWalletClient({ account: privateKeyToAccount(FORK_TEST_KEY), chain, transport: http(RPC_URL) });
    return createWalletClient({ account, chain, transport: custom(window.ethereum) });
  }, [account, kind]);

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const onAcc = (a) => kind === "injected" && setAccount(a[0] || null);
    window.ethereum.on("accountsChanged", onAcc);
    return () => window.ethereum.removeListener?.("accountsChanged", onAcc);
  }, [kind]);

  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError(IS_FORK ? "No browser wallet found. Use the local test account instead." : "No browser wallet found. Install OKX Wallet or MetaMask.");
      return;
    }
    const [a] = await window.ethereum.request({ method: "eth_requestAccounts" });
    const hex = `0x${chain.id.toString(16)}`;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [RPC_URL], blockExplorerUrls: IS_FORK ? undefined : ["https://www.oklink.com/x-layer"] }],
      });
    }
    setKind("injected");
    setAccount(a);
  }, []);

  const useTestAccount = useCallback(async () => {
    const acc = privateKeyToAccount(FORK_TEST_KEY);
    setKind("fork-test");
    setAccount(acc.address);
  }, []);

  /** Local fork only: top up OKB for gas and USDG to invest (writes anvil storage, nothing real). */
  const forkFaucet = useCallback(async () => {
    if (!IS_FORK || !account) return;
    await client.request({ method: "anvil_setBalance", params: [account, "0x56BC75E2D63100000"] });
    const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [account, 1n])); // USDG balances live in slot 1
    await client.request({ method: "anvil_setStorageAt", params: [USDG, slot, `0x${(10_000n * 10n ** 6n).toString(16).padStart(64, "0")}`] });
  }, [account]);

  /** Send a contract write and wait for it. Throws a short, readable message. */
  const write = useCallback(
    async (req) => {
      if (!walletClient) throw new Error("Connect a wallet first.");
      try {
        const hash = await walletClient.writeContract({ ...req, chain, account: walletClient.account });
        const rc = await client.waitForTransactionReceipt({ hash });
        if (rc.status !== "success") throw new Error(`Transaction reverted (${hash.slice(0, 10)}…)`);
        return rc;
      } catch (e) {
        throw new Error(readable(e));
      }
    },
    [walletClient]
  );

  const value = { account, kind, connect, useTestAccount, forkFaucet, write, error, disconnect: () => { setAccount(null); setKind(null); } };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useWallet = () => useContext(Ctx);

export function readable(e) {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert?.data?.errorName) return explain(revert.data.errorName);
    if (e.shortMessage) return e.shortMessage.replace(/^The contract function .* reverted\.?/, "The contract refused this.");
  }
  return e?.message || String(e);
}

const explain = (name) =>
  ({
    TooEarly: "Not due yet. Each fund rebalances once per period.",
    CapReached: "This fund is at its size cap.",
    Slippage: "The price moved too much. Try again.",
    ZeroAmount: "Enter an amount.",
    Empty: "Nobody has invested yet, so there is nothing to rebalance.",
    NotListed: "One of these stocks isn't listed on Sworn.",
    BadNetlist: "The compiled circuit was rejected.",
    BadParams: "Some launch settings are out of range.",
  })[name] || name;
