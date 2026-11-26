# Sworn: submission text

Copy-paste source for the Build X Series form (https://forms.gle/EoDNbxQ65dev1wFd9). Every claim
here is checkable in the repo or on chain; addresses are in the README's "Live on X Layer" table.

## Project name
Sworn

## Elevator pitch (one line)
Stock funds that keep their word. Launch your own tokenized-stock fund on X Layer in a minute: its rules are compiled into a TapeOut chip, so nobody can change them after launch, not even you.

## Product
_Built under the working name Fundry; the deployed contracts keep that name (`FundryFactory`, processor "Fundry" / `FNDRY`)._

Sworn lets anyone launch a fund that holds up to four tokenized stocks on X Layer (NVDA, SPY, SpaceX, MSFT, META, gold, BTC, ETH as wrapped xStocks / tokens with Uniswap V3 pools against USDG).

The creator writes the rules in words or with buttons, for example: "Hold 60% NVDA and 40% SPY. If NVDA falls 5%, cut it to half. Stop-loss 15%, and stay out until it recovers. If everything falls, go to cash."

Sworn compiles the rulebook into a NAND/LATCH netlist and tapes it out on the Sworn TapeOut processor. The circuit NFT goes to the creator. From then on:
- anyone can invest USDG and get shares at NAV (30-minute Uniswap TWAP prices)
- anyone can press Rebalance once per period: the fund turns prices into input bits, calls `Circuits.step` on the fund's circuit and trades toward the weights the chip returns
- anyone can withdraw their exact slice of every holding at any time

Every decision is logged on chain with the prices, the bits the chip saw, its output and the trades it made.

Three things set it apart:
- **Fork a fund.** A fork's chip runs the parent's chip inside it, unchanged, through a TapeOut REF, then applies its own rules. The fork etches only its own gates, and 20% of its creator fee goes to whoever holds the parent chip, forever. Live on mainnet: "AI + Market, Safer" runs "AI + Market" inside it.
- **The chip owns the fund.** The creator fee goes to whoever holds the circuit NFT. The rules can't change, so the NFT is the strategy plus its track record, and it can be sold.
- **Check it yourself.** Each fund page has a Chip Lab (move prices, watch the real chip decide, see `Circuits.step` on chain agree) and a one-click panel that re-checks every claim from chain data: rules vs chip on every input, chain vs page, fork wiring, and a replay of every rebalance from its logged prices. `node scripts/verify.mjs --all` does the same from a terminal.

## Which TapeOut features it uses
- **Circuits as the product:** every fund is one TapeOut circuit (processor address + circuit id on each fund page). The fund contract calls `Circuits.step` on every rebalance. LATCH bits are the fund's memory ("stay out after a stop-loss").
- **REF:** forks are built by REF'ing the parent's chip; the factory checks the REF points at the parent and is fed the fund's own inputs. The first REF circuits on X Layer.
- **Circuit NFTs:** the fee right is `ownerOf(circuitId)`, so the NFT is a sellable strategy.
- **Own processor:** `FundryFactory` creates the Sworn processor through the TapeOut factory (BEM deploy fee) and burns Sworn transistors on every launch.
- **DeWEB:** a publisher that mirrors the app into fund #1's circuit container is ready (`scripts/deweb-publish.mjs`, dry-run tested); the app itself is at sworn.nerom.site.
- **X Layer:** xStocks / USDG Uniswap V3 pools for prices (TWAP) and trades.

## Target users and how we reach them
- **Fund creators:** traders and finance creators on X who already post their stock picks and rules ("I sell NVDA if it drops 5%"). Sworn turns their public rules into a fund their followers can join, with a track record nobody can edit. Reach: X posts with a fund link and the League leaderboard; the fund page is the shareable proof.
- **Investors:** people who want stock exposure on chain with rules they can read before they invest, and without trusting a manager who can change course. Reach: the creators above, the X Layer and OKX Wallet audience, and the League.

## Revenue model
- Each fund charges a yearly management fee chosen at launch (0–2%), paid as new shares. Half goes to whoever holds the fund's chip NFT, half to the Sworn treasury. A fork passes 20% of its holder's half to the parent chip's holder.
- Sworn earns the transistor mint revenue of its own processor (launches burn Sworn transistors).

## Why users pay and keep using it
- Creators earn half the fee on everything their fund holds, plus royalties from every fork of their fund, and their record is on chain and can't be faked or edited. A chip with a good record can be sold.
- Investors get rules that cannot change after they invest, exits that always work (in-kind withdrawal, no price needed), and a full decision log.
- Funds rebalance every period, so the product is used continuously, not once.

## Team background
(fill in)

## Links
- GitHub: https://github.com/neromtoobad/sworn
- Website: https://sworn.nerom.site
- Demo video: (after recording)
