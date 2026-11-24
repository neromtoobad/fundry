# Fundry

**Launch your own stock fund in 60 seconds. Its rules are etched in a chip on X Layer, so nobody can change them, not even you.**

Built for **X Layer TapeOut Accelerate** (Oct 16 – Dec 7 2026). This repo started on Nov 17 2026.

**App:** https://fundry.nerom.site · **For judges:** [JUDGES.md](JUDGES.md) (5-minute checks and the judging criteria answered) · **Mainnet proof:** [evidence/](evidence/mainnet-2026-11-24.json) · **Demo video:** recorded before submission (≤ 3 min), link goes here

## How it works

1. **Launch.** Pick up to 4 tokenized stocks (NVDA, SPY, SpaceX, MSFT, META, gold…) and set the fund's rules from plain choices: "if NVDA falls 5%, cut it to half", "stop-loss at −15% and stay out until it recovers", "if everything falls, go to cash". Fundry compiles the rulebook into a NAND/LATCH circuit and tapes it out on the **Fundry TapeOut processor**. TapeOut circuits can't be changed once taped out, so the rules are locked from launch.
2. **Invest.** Deposit USDG for fund shares, priced at NAV. The fund holds real wrapped xStocks on X Layer, priced from 30-minute Uniswap V3 TWAPs.
3. **Rebalance.** Anyone can call `rebalance()` once per period. The contract turns prices into input bits, asks the circuit (`Circuits.step`) for target weights and trades toward them. The circuit decides; the contract only obeys.
4. **Withdraw.** Burn shares and get your exact slice of every holding. No prices are involved, so a withdrawal always works.

## Live on X Layer mainnet

**App: https://fundry.nerom.site** (reads X Layer mainnet; connect OKX Wallet to launch or invest)

| | Address |
|---|---|
| FundryFactory | [`0x9b4FD9f81Aa64e83446F83F03616Ac3c5Ab71e6E`](https://www.oklink.com/xlayer/address/0x9b4FD9f81Aa64e83446F83F03616Ac3c5Ab71e6E) · [source verified on Sourcify](https://repo.sourcify.dev/196/0x9b4FD9f81Aa64e83446F83F03616Ac3c5Ab71e6E) |
| Fund implementation | [`0x6d04f13221635bd2392e5215585Db8B587e153d1`](https://www.oklink.com/xlayer/address/0x6d04f13221635bd2392e5215585Db8B587e153d1) · [Sourcify](https://repo.sourcify.dev/196/0x6d04f13221635bd2392e5215585Db8B587e153d1) |
| Fundry processor (Circuits) | [`0x80bf3Aa74171b3711b5946D9F39b84F464B4CC0B`](https://www.oklink.com/xlayer/address/0x80bf3Aa74171b3711b5946D9F39b84F464B4CC0B) (created through the TapeOut factory, BEM fee paid) |
| Fundry transistors | [`0xd1Aac2c96094fd9B9EE4C8e717620B132Fc2098c`](https://www.oklink.com/xlayer/address/0xd1Aac2c96094fd9B9EE4C8e717620B132Fc2098c) |
| Deploy transaction | [`0x4f6465…5f77`](https://www.oklink.com/xlayer/tx/0x4f64655aca76cc6576e07f830eb0b72b1a13d0fb4147183e345f346c8da25f77) (block 76,755,109) |

Demo funds launched on mainnet (each one is a TapeOut circuit on the Fundry processor):

| Fund | Holds | Circuit | Address |
|---|---|---|---|
| AI + Market | NVDA, SPY | #1, 33 gates | [`0x1c31CB32e816e904fFa3bB12045BA30bcC96D5ea`](https://www.oklink.com/xlayer/address/0x1c31CB32e816e904fFa3bB12045BA30bcC96D5ea) |
| Big Tech Guard | MSFT, META, NVDA | #2, 34 gates | [`0x4567d0C8c2b53c5B22D15f07e2bc99943715cBF1`](https://www.oklink.com/xlayer/address/0x4567d0C8c2b53c5B22D15f07e2bc99943715cBF1) |
| Hard Assets | GOLD, BTC, ETH | #3, 56 gates | [`0xdB8C314bE3E045Cdf3af9200bE98D28924C87A9b`](https://www.oklink.com/xlayer/address/0xdB8C314bE3E045Cdf3af9200bE98D28924C87A9b) |
| SpaceX Moonshot | SPCX, SPY | #4, 24 gates | [`0x28d8dB38Da3Ee5E3c2d065908c5eBc7F7c09818C`](https://www.oklink.com/xlayer/address/0x28d8dB38Da3Ee5E3c2d065908c5eBc7F7c09818C) |

The demo funds start empty: putting money in and rebalancing trade real tokens, so we leave that to real investors. Everything else above was done on mainnet.

**Oracle note.** The BTC and ETH pools kept only 100 price observations, less than the 30-minute TWAP window on such busy pools, so `price()` reverted with `OLD`. We raised both pools to 1,801 observations with Uniswap's permissionless `increaseObservationCardinalityNext` (BTC pool `0x520F…5b76`, ETH pool `0x6E18…F6D5`); the app shows "price not ready" for a pool until it has 30 minutes of history, and withdrawals never need a price.

## What works today

| | Status |
|---|---|
| Rule compiler (`sdk/`): rulebook → TapeOut netlist, plain-English text, bit-exact evaluator | ✅ matches the reference rules on every input for 200 random funds (`sdk/test`) |
| Same circuit on the **real** TapeOut contracts | ✅ fork test creates a processor on the live factory (BEM fee), tapes out, matches `step()` on all 1,024 cases (`contracts/test/TapeOutFork.t.sol`) |
| Real stock prices | ✅ TWAP reader matches the live Uniswap quoter within 0.1% (`contracts/test/TwapFork.t.sol`) |
| `Fund` + `FundryFactory` | ✅ fork lifecycle: launch → deposit → rebalance → a 6.8% NVDA drop halves it → a >15% crash fires the stop and the latch keeps it out → withdraw (`contracts/test/FundLifecycle.t.sol`) |
| Web app (`app/`) | ✅ League, Launch (live chip + “try your chip”), Fund page (live chip, invest/withdraw, rebalance, decision log). Clicked through on a local fork of X Layer mainnet: launch → invest → rebalance with real Uniswap swaps |
| Deploy + seed (`contracts/script/Deploy.s.sol`, `scripts/seed.mjs`) | ✅ run on the local fork: processor created with BEM, 8 stocks listed, 4 demo funds launched and rebalanced |
| Rules in words (`sdk/src/words.js`) | ✅ a fixed parser (no AI model) turns sentences like “If NVDA falls 5%, cut it to half” into a rulebook and lists every sentence it didn't understand (`sdk/test/words.test.js`) |
| Keeper (`scripts/keeper.mjs`) | ✅ presses Rebalance for every fund that is due, simulating each call first; rebalanced all 5 funds on the local fork |
| No chain scanning | ✅ public X Layer RPCs cap `eth_getLogs` at 100–1,000 blocks, so each fund stores the blocks it has events in (`Fund.eventBlocks`) and the app fetches exactly those |
| DeWEB publisher (`scripts/deweb-publish.mjs`) | ✅ dry-run tested: opens the circuit's container, uploads the build in 24 KB chunks, activates the `.tape` name, checks every file's SHA-256 back |

## Not built yet

- DeWEB copy of the app (the publisher is ready and dry-run against circuit #1; publishing costs 0.085 OKB)
- Rule parts with REF royalties, Mine-to-Own

## Built with TapeOut and X Layer (sponsor integration)

- **TapeOut circuits are the rulebook.** Every fund is a circuit on the Fundry processor, and the fund contract calls `Circuits.step` on every rebalance. LATCH bits are the fund's memory ("stay out after a stop").
- **The Fundry processor** is created by `FundryFactory` through the TapeOut factory, paying the BEM deploy fee. Every launch burns Fundry transistors, and the fund creator receives the circuit NFT.
- **X Layer xStocks** (wrapped, traded on Uniswap V3 against USDG) are the fund holdings. Pool list: [docs/STOCKS.md](docs/STOCKS.md).

## Claims and where to check them

| Claim | Code |
|---|---|
| The rulebook is compiled to a TapeOut netlist | `sdk/src/rules.js:99` (`compile`) |
| Each launch tapes out a new circuit and gives the chip to the creator | `contracts/src/FundryFactory.sol:188`, `:190` |
| The circuit decides every rebalance | `contracts/src/Fund.sol:331` (`circuits.step`) |
| Prices are Uniswap V3 30-minute TWAPs | `contracts/src/lib/Twap.sol:28` |
| Anyone can rebalance; nobody can rebalance early or an empty fund | `contracts/src/Fund.sol:325` |
| Withdrawals pay your exact slice of every holding, no prices used | `contracts/src/Fund.sol:237` |
| Every decision is in the on-chain log the app shows | `contracts/src/Fund.sol` `Rebalanced`/`Traded` events, `app/src/lib/data.js:105` |
| Rules in words, no AI | `sdk/src/words.js:43` |

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

## Built during the hackathon

Everything in this repo was written during Accelerate, from Nov 17 2026 (see the commit history). One idea came from before:


The netlist-building approach (TAP-02 encoding, output buffers, the JS stepper) is adapted from our earlier TapeOut entry [NAND Arena](https://github.com/neromtoobad/nand-arena) (Oct 5–9 2026, before this event). The code here was written fresh for Fundry.

## AI disclosure

Fundry was built by directing Claude Code (an AI coding agent), which wrote the code, contracts, tests and copy. Every claim in this README was checked against the code or the chain. The product itself uses no AI model: the "rules in words" box is a fixed parser (`sdk/src/words.js`) that lists any sentence it didn't understand.

## License

MIT
