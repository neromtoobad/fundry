# Fundry: submission text

Copy-paste source for the Build X Series form (https://forms.gle/EoDNbxQ65dev1wFd9). Every claim
here is checkable in the repo or on chain; addresses are in the README's "Live on X Layer" table.

## Project name
Fundry

## Elevator pitch (one line)
Launch your own tokenized-stock fund on X Layer in a minute; its rules are compiled into a TapeOut chip, so nobody can change them after launch, not even you.

## Product
Fundry lets anyone launch a fund that holds up to four tokenized stocks on X Layer (NVDA, SPY, SpaceX, MSFT, META, gold, BTC, ETH as wrapped xStocks / tokens with Uniswap V3 pools against USDG).

The creator writes the rules in words or with buttons, for example: "Hold 60% NVDA and 40% SPY. If NVDA falls 5%, cut it to half. Stop-loss 15%, and stay out until it recovers. If everything falls, go to cash."

Fundry compiles the rulebook into a NAND/LATCH netlist and tapes it out on the Fundry TapeOut processor. The circuit NFT goes to the creator. From then on:
- anyone can invest USDG and get shares at NAV (30-minute Uniswap TWAP prices)
- anyone can press Rebalance once per period: the fund turns prices into input bits, calls `Circuits.step` on the fund's circuit and trades toward the weights the chip returns
- anyone can withdraw their exact slice of every holding at any time

Every decision is logged on chain with the prices, the bits the chip saw, its output and the trades it made.

## Which TapeOut features it uses
- **Circuits as the product:** every fund is one TapeOut circuit (processor address + circuit id on each fund page). The fund contract calls `Circuits.step` on every rebalance. LATCH bits are the fund's memory ("stay out after a stop-loss").
- **Own processor:** `FundryFactory` creates the Fundry processor through the TapeOut factory (BEM deploy fee) and burns Fundry transistors on every launch.
- **DeWEB:** the app is mirrored on X Layer DeWEB (see README for the tape:// / gateway link).
- **X Layer:** xStocks / USDG Uniswap V3 pools for prices (TWAP) and trades.

## Target users and how we reach them
- **Fund creators:** traders and finance creators on X who already post their stock picks and rules ("I sell NVDA if it drops 5%"). Fundry turns their public rules into a fund their followers can join, with a track record nobody can edit. Reach: X posts with a fund link and the League leaderboard; the fund page is the shareable proof.
- **Investors:** people who want stock exposure on chain with rules they can read before they invest, and without trusting a manager who can change course. Reach: the creators above, the X Layer and OKX Wallet audience, and the League.

## Revenue model
- Each fund charges a yearly management fee chosen at launch (0–2%), paid as new shares. Half goes to the creator, half to the Fundry treasury.
- Fundry earns the transistor mint revenue of its own processor (launches burn Fundry transistors).

## Why users pay and keep using it
- Creators earn half the fee on everything their fund holds, and their record is on chain and can't be faked or edited.
- Investors get rules that cannot change after they invest, exits that always work (in-kind withdrawal, no price needed), and a full decision log.
- Funds rebalance every period, so the product is used continuously, not once.

## Team background
(fill in)

## Links
- GitHub: https://github.com/neromtoobad/fundry
- Website: https://fundry.nerom.site
- Demo video: (after recording)
