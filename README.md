# Fundry

**Launch your own stock fund in 60 seconds. Its rules are etched in a chip on X Layer, so nobody can change them, not even you.**

Built for **X Layer TapeOut Accelerate** (Oct 16 – Dec 7 2026). This repo started on Nov 17 2026.

## What it does

1. **Launch.** Pick up to 4 tokenized stocks (NVDA, SPY, SpaceX, MSFT, META, gold…) and set the fund's rules from plain choices: "if NVDA falls 5%, cut it to half", "stop-loss at −15% and stay out until it recovers", "if everything falls, go to cash". Fundry compiles the rulebook into a NAND/LATCH circuit and tapes it out on the **Fundry TapeOut processor**. TapeOut circuits can't be changed once taped out, so the rules are locked from launch.
2. **Invest.** Deposit USDG for fund shares, priced at NAV. The fund holds real wrapped xStocks on X Layer, priced from 30-minute Uniswap V3 TWAPs.
3. **Rebalance.** Anyone can call `rebalance()` once per period. The contract turns prices into input bits, asks the circuit (`Circuits.step`) for target weights and trades toward them. The circuit decides; the contract only obeys.
4. **Withdraw.** Burn shares and get your exact slice of every holding. No prices are involved, so a withdrawal always works.

## What works today

| | Status |
|---|---|
| Rule compiler (`sdk/`): rulebook → TapeOut netlist, plain-English text, bit-exact evaluator | ✅ matches the reference rules on every input for 200 random funds (`sdk/test`) |
| Same circuit on the **real** TapeOut contracts | ✅ fork test creates a processor on the live factory (BEM fee), tapes out, matches `step()` on all 1,024 cases (`contracts/test/TapeOutFork.t.sol`) |
| Real stock prices | ✅ TWAP reader matches the live Uniswap quoter within 0.1% (`contracts/test/TwapFork.t.sol`) |
| `Fund` + `FundryFactory` | ✅ fork lifecycle: launch → deposit → rebalance → a 6.8% NVDA drop halves it → a >15% crash fires the stop and the latch keeps it out → withdraw (`contracts/test/FundLifecycle.t.sol`) |
| Web app (`app/`) | ✅ League, Launch (live chip + “try your chip”), Fund page (live chip, invest/withdraw, rebalance, decision log). Clicked through on a local fork of X Layer mainnet: launch → invest → rebalance with real Uniswap swaps |
| Deploy + seed (`contracts/script/Deploy.s.sol`, `scripts/seed.mjs`) | ✅ run on the local fork: processor created with BEM, 8 stocks listed, 4 demo funds launched and rebalanced |

## Not built yet

- Mainnet deployment (no contract addresses yet, so the app runs against a local fork for now)
- Rule parts with REF royalties, Mine-to-Own, AI "describe your fund"
- DeWEB hosting

## How it uses TapeOut and X Layer

- **TapeOut circuits are the rulebook.** Every fund is a circuit on the Fundry processor, and the fund contract calls `Circuits.step` on every rebalance. LATCH bits are the fund's memory ("stay out after a stop").
- **The Fundry processor** is created by `FundryFactory` through the TapeOut factory, paying the BEM deploy fee. Every launch burns Fundry transistors, and the fund creator receives the circuit NFT.
- **X Layer xStocks** (wrapped, traded on Uniswap V3 against USDG) are the fund holdings. Pool list: [docs/STOCKS.md](docs/STOCKS.md).

## Trust model

- Funds have **no owner**. No function can move fund assets except `rebalance` (circuit-decided trades, at most 1% slippage against the TWAP) and `withdraw` (your own slice).
- Assets, pools, thresholds, fee (max 2%/yr) and the circuit are fixed at launch.
- `FundryFactory.curator` can only add stocks that **new** funds may hold. It can't touch existing funds.
- Prices are on-chain 30-minute TWAPs, so they can't be pushed around within a single block. Funds have a size cap because of pool depth.

## Run it

```bash
git clone --recurse-submodules https://github.com/neromtoobad/fundry && cd fundry && npm install
npm test                                # compiler tests, about 1 s
cd contracts && forge test && cd ..     # fork tests against X Layer mainnet (slow public RPC: ~7 min)
```

The app on a local fork of X Layer mainnet (real pools and TapeOut contracts, test money):

```bash
anvil --fork-url https://rpc.xlayer.tech --chain-id 31337                     # terminal 1
python3 scripts/fork-fund.py 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266       # test BEM/USDG for anvil account 0
(cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)  # anvil's public test key
node scripts/seed.mjs --days=2                                                # 4 demo funds, 3 rebalances each
npm run dev                                                                   # http://localhost:5173
```

In the app, “Connect → Local test account” signs with an anvil test key and “Get test USDG” tops it up. Both only exist on the fork.

## Built before the event

The netlist-building approach (TAP-02 encoding, output buffers, the JS stepper) is adapted from our earlier TapeOut entry [NAND Arena](https://github.com/neromtoobad/nand-arena) (Oct 5–9 2026, before this event). The code here was written fresh for Fundry.

## License

MIT
