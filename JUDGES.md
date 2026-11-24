# For judges

Fundry in one line: launch a tokenized-stock fund on X Layer whose rules are a TapeOut circuit, so nobody can change them after launch, not even the creator.

- **App:** https://fundry.nerom.site (reads X Layer mainnet)
- **Contracts and demo funds:** README → "Live on X Layer mainnet"
- **Every mainnet transaction we sent, with hashes:** [evidence/mainnet-v2-2026-11-24.json](evidence/mainnet-v2-2026-11-24.json) (v2, live) and [evidence/mainnet-2026-11-24.json](evidence/mainnet-2026-11-24.json) (v1, retired)

## The fastest check: let the app prove itself

Open any fund on https://fundry.nerom.site, scroll to **Check it yourself** and press **Run the checks**. Using chain data only, your browser reads the chip, confirms a fork really contains its parent chip, runs the written rules against the chip on every possible input, asks `Circuits.step` on X Layer 12 random questions and compares the answers, and replays every rebalance from the prices it logged. From a terminal:

```bash
git clone https://github.com/neromtoobad/fundry && cd fundry && npm install
node scripts/verify.mjs --all     # read-only, mainnet; every fund, every check
```

Try **Chip Lab** on the same page too: move a stock's price with a slider and watch the chip decide, with TapeOut's evaluator on chain giving the same answer.

## Check it in 5 minutes

| What to check | Where |
|---|---|
| Each fund is a TapeOut circuit | Open any fund on the app: the header shows `CIRCUIT #n` on processor `0x80bf…CC0B`. On chain: `Fund.circuitId()` and `Circuits.circuitInfo(id)` |
| The Fundry processor was created through the real TapeOut factory (BEM fee) | `setUpProcessor` tx in the evidence file; code in `contracts/src/FundryFactory.sol` |
| The fund obeys the chip | `Fund.rebalance` calls `Circuits.step` and trades toward the levels it returns: `contracts/src/Fund.sol` (rebalance ~line 325, `step` ~331) |
| The rules can't change after launch | TapeOut circuits are immutable once taped out; `Fund` has no setter for rules, circuit or thresholds |
| Rules compile to NAND/LATCH correctly | `npm test` (200 random rulebooks match the reference on every input) and `contracts/test/TapeOutFork.t.sol` (real factory, all 1,024 inputs) |
| Full lifecycle with real swaps | `contracts/test/FundLifecycle.t.sol` on a mainnet fork: launch → deposit → rebalance → a 6.8% NVDA drop halves it → a crash fires the stop and the LATCH keeps it out → withdraw |
| Forks reuse the parent chip through REF | "AI + Market, Safer" (`0xa0E9…5000`, chip #9) on mainnet: `Circuits.netlist(9)` starts with a REF record to chip #5; `circuitInfo(9)` counts 78 gates, but only 45 were burned. `FundryFactory.parentOf(fund)` and `childrenOf(parent)` hold the family tree. Tests: `contracts/test/Forks.t.sol` |
| The fee follows the chip NFT | `Fund.chipOwner()` = `Circuits.ownerOf(circuitId)`; `Fund.parentOwner()` for the 20% royalty. `Forks.t.sol` sells both chips and checks the fee moves with them |
| Source matches what's deployed | Sourcify exact match for `FundryFactory` and the `Fund` implementation (links in the README) |

## Judging criteria → where Fundry answers them

| Criterion | Answer |
|---|---|
| User value and commercial potential | Creators turn the rules they already post on X into a fund their followers can join, and earn half of a 0–2%/yr fee. Investors get rules that can't change and exits that always work. Revenue: the other half of the fee goes to the Fundry treasury, plus Fundry transistor sales on every launch. See `docs/SUBMISSION.md`. |
| Innovation | The circuit is the fund's rulebook and LATCH bits are its memory ("stay out after a stop-loss"). The chip decides the weights; the contract only obeys. Forks compose strategies chip-inside-chip with TapeOut REF (the first REF circuits on X Layer), and pay their parent a royalty, so good strategies earn from everything built on them. |
| Ecosystem integration | Own TapeOut processor (BEM fee, transistors burned per launch), `Circuits.step` on every rebalance, REF for forks, the circuit NFT as the fee right (ownerOf), X Layer xStocks and USDG pools, DeWEB publisher in `scripts/deweb-publish.mjs`. |
| Product readiness and UX | Live app on mainnet data; rules can be written in plain words; Chip Lab lets anyone test a fund's real chip with what-if prices; every claim can be re-checked in the browser; every decision is logged on chain and shown on the fund page. |
| Demo video | Linked in the README once recorded (≤ 3 min). |

## Honest limits

- The six demo funds are empty: investing and rebalancing trade real tokens, so we leave that to real investors. Rebalance replay is shown working on the local fork of mainnet (3 rebalances per fund, all replayed); on mainnet it reports "no rebalances yet" until someone invests.
- v1 (factory `0x9b4F…1e6E`) was retired on Nov 24 for v2; its funds never took deposits.
- The BTC and ETH pools had too little price history for a 30-minute TWAP; we raised it on chain (evidence file → `oracleFix`). Until a pool has 30 minutes of history, its funds show "price not ready" and can't take deposits or rebalance. Withdrawals never need a price.
- The DeWEB copy of the app is ready to publish but not yet published (it costs 0.085 OKB).
