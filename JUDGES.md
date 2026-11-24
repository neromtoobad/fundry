# For judges

Fundry in one line: launch a tokenized-stock fund on X Layer whose rules are a TapeOut circuit, so nobody can change them after launch, not even the creator.

- **App:** https://fundry.nerom.site (reads X Layer mainnet)
- **Contracts and demo funds:** README → "Live on X Layer mainnet"
- **Every mainnet transaction we sent, with hashes:** [evidence/mainnet-2026-11-24.json](evidence/mainnet-2026-11-24.json)

## Check it in 5 minutes

| What to check | Where |
|---|---|
| Each fund is a TapeOut circuit | Open any fund on the app: the header shows `CIRCUIT #n` on processor `0x80bf…CC0B`. On chain: `Fund.circuitId()` and `Circuits.circuitInfo(id)` |
| The Fundry processor was created through the real TapeOut factory (BEM fee) | `setUpProcessor` tx in the evidence file; code in `contracts/src/FundryFactory.sol` |
| The fund obeys the chip | `Fund.rebalance` calls `Circuits.step` and trades toward the levels it returns: `contracts/src/Fund.sol` (rebalance ~line 325, `step` ~331) |
| The rules can't change after launch | TapeOut circuits are immutable once taped out; `Fund` has no setter for rules, circuit or thresholds |
| Rules compile to NAND/LATCH correctly | `npm test` (200 random rulebooks match the reference on every input) and `contracts/test/TapeOutFork.t.sol` (real factory, all 1,024 inputs) |
| Full lifecycle with real swaps | `contracts/test/FundLifecycle.t.sol` on a mainnet fork: launch → deposit → rebalance → a 6.8% NVDA drop halves it → a crash fires the stop and the LATCH keeps it out → withdraw |
| Source matches what's deployed | Sourcify exact match for `FundryFactory` and the `Fund` implementation (links in the README) |

## Judging criteria → where Fundry answers them

| Criterion | Answer |
|---|---|
| User value and commercial potential | Creators turn the rules they already post on X into a fund their followers can join, and earn half of a 0–2%/yr fee. Investors get rules that can't change and exits that always work. Revenue: the other half of the fee goes to the Fundry treasury, plus Fundry transistor sales on every launch. See `docs/SUBMISSION.md`. |
| Innovation | The circuit is the fund's rulebook and LATCH bits are its memory ("stay out after a stop-loss"). The chip decides the weights; the contract only obeys. |
| Ecosystem integration | Own TapeOut processor (BEM fee, transistors burned per launch), `Circuits.step` on every rebalance, X Layer xStocks and USDG pools, DeWEB publisher in `scripts/deweb-publish.mjs`. |
| Product readiness and UX | Live app on mainnet data; rules can be written in plain words; every decision is logged on chain and shown on the fund page. |
| Demo video | Linked in the README once recorded (≤ 3 min). |

## Honest limits

- The four demo funds are empty: investing and rebalancing trade real tokens, so we leave that to real investors.
- The BTC and ETH pools had too little price history for a 30-minute TWAP; we raised it on chain (evidence file → `oracleFix`). Until a pool has 30 minutes of history, its funds show "price not ready" and can't take deposits or rebalance. Withdrawals never need a price.
- The DeWEB copy of the app is ready to publish but not yet published (it costs 0.085 OKB).
