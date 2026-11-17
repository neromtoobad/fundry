# Fundry: build plan

**One sentence:** launch your own stock fund in 60 seconds; its rules are etched in a chip on X Layer, so nobody (not even you) can change them, and anyone can invest.

Event: X Layer TapeOut Accelerate. Started 2026-10-16; this repo starts 2026-11-17. Deadline **2026-12-07 23:59 UTC** (target: submit Dec 5).
Facts are in [HACK.md](HACK.md); the stock trade path is in [STOCKS.md](STOCKS.md).

## The product (what a judge sees)

1. **Launch** (`/launch`): pick 2–4 assets (NVDA, SPY, QQQ, TSLA, SpaceX, MSFT, META, gold, BTC, ETH), give them base weights, add plain rules from chips:
   - "If X falls more than N% in a week → cut it to half / zero"
   - "If X rises more than N% → let it run (double)"
   - "If everything is falling → go to cash"
   - "Stay out for K rebalances after a stop" (LATCH memory)

   Optional: type it in words and AI fills in the chips. The page shows the rule in plain English and as a chip diagram (gate count). One transaction tapes the rulebook out as a TapeOut circuit on the **Fundry processor** and deploys the fund.
2. **Fund page** (`/f/<id>`):
   - holdings, NAV per share, performance since launch
   - the rulebook (English + chip + circuit ID + "locked since block N")
   - the **decision log**: every rebalance, with the input bits the chain saw, the output the circuit gave, and the trades made, each linking to the tx
3. **Invest / withdraw:** deposit USDG and get shares at NAV. Withdraw in kind (your slice of every stock) or as USDG.
4. **Fund League** (`/`): every fund ranked by return since launch, with its age, size and the "locked since" date. The home page opens with it.
5. **Rule parts** (phase 3): shared blocks (stop-loss, momentum, all-falling→cash) taped out once. Fund circuits REF them, and part authors earn a cut of fees.
6. **Mine-to-Own** (phase 3): approve FAB/BEM/OKB once, and a daily keeper swaps a set amount into your chosen fund.

## How it works on chain

```
            ┌──────────── Fundry processor (TapeOut Circuits, X Layer) ───────────┐
 launch ──▶ │  tapeout(netlist)  → circuit #k  = the fund's rulebook (frozen)     │
            └────────────────────────────────────────────────────────────────────┘
                                   ▲ eval/step(k, inputBits, state)
 rebalance() (anyone, once per window)
   1. read 30-min TWAP for each asset from its Uniswap V3 pool (observe)
   2. build input bits: per asset [weekRet < -T1, weekRet > T2, drawdown > T3] + "all falling"
   3. call Circuits.step(k, bits, latchState) → output bits → weight level per asset (2 bits)
   4. target weights = level_i / Σ levels (Σ=0 → all USDG)
   5. swap toward targets through Uniswap V3 SwapRouter02 with TWAP-based minOut
   6. store new latch state; emit Decision(inputBits, outputBits, trades)
```

- **Trust model:** no owner can move fund assets. `rebalance` is permissionless, rate-limited (one per window) and slippage-capped against the TWAP. The rulebook circuit is immutable (TapeOut logic frozen Oct 22). The only parameters are fixed at launch: assets, pools, thresholds, fee, creator.
- **Fees:** management fee (default 1%/yr, max 2%) accrues as newly minted shares, split creator 50 / Fundry treasury 40 / rule-part authors 10. Launch fee in BEM (half burned), when BEM is wired up (phase 3).
- **Processor:** "Fundry" processor from the TapeOut factory. Its `creator` is the FundryTreasury contract, so transistor mint income (every launch burns 1 transistor per gate) goes to the treasury by rule.
- **Prices:** Uniswap V3 TWAP only. These pools are live, have $0.3–3.6M depth, and keep 720–1801 price snapshots. No keys, no off-chain oracle. Chainlink Data Streams is "not built".
- **Caps:** per-fund TVL cap (default $25K) because of pool depth. Geo-gate in the app (no US/EU), matching xStocks' own limits; labelled.

## Repo layout

```
contracts/   Foundry: FundryFactory, Fund (shares, NAV, rebalance), RuleBits (feature encoding),
             Twap (Uniswap V3 observe), FundryTreasury (processor creator, fee split), ITapeOut
             test/: unit + fork tests against real X Layer pools
sdk/         rule → netlist compiler (chips → NAND/LATCH), JS VM bit-identical to TapeOut eval,
             rule → plain English
app/         Vite + React: League, Launch, Fund page, Invest; viem; light theme
keeper/      rebalance + mine-to-own runner (permissionless; anyone can run it)
docs/        HACK, PLAN, STOCKS, JUDGES (verify in 2 minutes), DEMO-SCRIPT, SUBMISSION
```

## Built before the event (disclose in README)
Ideas and parts of the NAND/LATCH netlist builder and JS VM come from our earlier TapeOut entry [NAND Arena](https://github.com/neromtoobad/nand-arena) (Oct 5–9 2026, before this event). They will be rewritten/adapted here in fresh commits and named in the README under "Built before the event".

## Phases

| Phase | Dates | Done when |
|---|---|---|
| 0. Skeleton | Nov 17–18 | repo + Foundry + fork test reads real wNVDAx/SPY TWAPs and quotes a swap |
| 1. Core contracts + compiler | Nov 18–22 | fork test: launch fund (tapeout on a fork), deposit, rebalance driven by the circuit, withdraw. JS VM matches `eval` on chain bit for bit |
| 2. App + mainnet | Nov 22–26 | Fundry processor + factory live and verified; 2–3 seed funds with small real money; League, Launch, Fund page live at fundry.nerom.site + DeWEB mirror |
| 3. Parts + Mine-to-Own + AI | Nov 26–30 | parts REF'd with fee split live; auto-invest from FAB/OKB; "describe your fund" AI fill |
| 4. Ship | Dec 1–5 | self-audit ≥7 everywhere, README/JUDGES.md, ≤3-min demo video, X posts from the project account, form submitted |

## Needs from the user
- **Project X account** (form requires one) + a 256×256 logo (we'll make it).
- **Register early** on the form (allowed, update later) to get livestream feedback.
- **Fund a new deployer wallet:** ~0.1 OKB (gas, tape-outs, DeWEB container 0.08) + ~0.2 BEM (processor fee) + ~$50–100 USDG for seed funds.
- Claude API key, only for the "describe it" AI fill (phase 3). Everything else works without it.

## Not built yet (keep this list honest)
Everything. This section shrinks as phases land.
