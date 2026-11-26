# Sworn design direction (Nov 23)

## References (principles only, nothing cloned)
- [Composer](https://www.composer.trade): the category leader for no-code trading strategies. It uses a very large grotesk headline, black on a light canvas, and blocky flat colour rectangles. The first line says what it does.
- [Plainrate (Framer fintech template)](https://plainrate.framer.website/): cool light canvas `#f2f3f5`, Host Grotesk at 500–700 with strong negative tracking (−0.035em), DM Mono 11.5px labels for reference numbers ("Ref PR-26-0418"), white pill buttons with one saturated blue pill.

Shared principles: a light, cool canvas; one heavy headline voice with tight tracking; small mono "reference" labels that make numbers feel official; pill controls; a single accent; white cards with generous radii; no gradients and no glow.

## Sworn's own identity: the chip is the fund
- **Every fund shows its real die.** A square chip drawing generated from the fund's actual netlist: one tile per gate (NAND dark, LATCH copper), I/O pads around the edge matching its real input/output pins. Two funds with different rules look different. This is art tied to real data, not decoration.
- **Wafer markings** in mono under every chip and number: `CIRCUIT #12 · 33 GATES · 1 LATCH · LOCKED SINCE BLOCK 76,625,102`.
- **Accent: molten copper** `#E2591B` (foundry), used for one action per screen and for LATCH tiles. Everything else is ink on cool paper.
- Gains in green `#0F8A4B`, losses in red `#C8362B`, shown only on numbers.

## Tokens
- Canvas `#F1F2F4` · Card `#FFFFFF` · Ink `#0D0F12` · Muted `#5B616B` · Line `#E3E5E9` · Copper `#E2591B` · Copper-soft `#FBE6DA`
- Type: **Schibsted Grotesk** 800 for headlines (tracking −0.045em), 400–600 for body. Picked by setting seven grotesks (Host, Inter Tight, Schibsted, Bricolage, Familjen, Geist, Hanken) on the real headline: Schibsted was the most compact and confident at 88px. Mono: JetBrains Mono for wafer markings.
- Radius: cards 20px, pills 999px, chip tiles 2px.
- Copy is plain (see the user's plain-language rule): "Launch a fund", "Invest", "Withdraw", "Rebalance now". The first line on the home page says what it does.

## Pages
1. **League (home):** headline + one-line explainer, the "launch a fund" CTA, and a ranked table of funds (chip thumbnail, name, holdings chips, return since launch, NAV, age, "locked since").
2. **Launch:** left side picks stocks and rules from plain choices; right side shows the live chip being built (gate count, English rules, cost). One button: "Etch and launch".
3. **Fund:** NAV + performance, holdings, the rulebook in English beside its chip, invest/withdraw, "Rebalance now" when due, and the **decision log** (every rebalance: what the chip saw, what it decided, the trades, tx links).
