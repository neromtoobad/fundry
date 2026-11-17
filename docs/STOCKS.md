# xStocks on X Layer: trade path + prices (checked Nov 17 2026, read-only)

Wrapped xStocks (w…x) trade on **Uniswap V3** on X Layer against USDG / USDC. All are 0.05% fee pools. TWAP = Uniswap V3 `observe()`, and "slots" is the number of price snapshots the pool keeps.

| Stock | Token | Pool | Quote | Liquidity | 24h vol | TWAP slots |
|---|---|---|---|---|---|---|
| NVDA | wNVDAx `0xa8ddb5cd96b5222afe198316e9a57caa642850d5` | `0x2a2b11730c2b6d99a58034a869dd810d7300a7b2` | USDG | $1.87M | $3.44M | 1801 |
| QQQ | wQQQx `0x4c1ae29c159838fc1b224636e28e086eb69101f7` | `0x2bd90724ffc80ba22ec7af8cfd2b4b51ff395b04` | USDC | $3.25M | $2.48M | 1801 |
| SPY | wSPYx `0xe7e553cd128f0011777323a0b44a7b96ea1cb540` | `0x07c40850d14064d20eb0afdef9574675392f2c11` | USDG | $3.63M | $1.30M | 1801 |
| SpaceX | wSPCXx `0x8e2eed8b8b5e13ea7bf38e50d7821d2c57309072` | `0x535aabfaf9a6fbc1a04317b98885706dc6bf1650` | USDG | $1.41M | $1.04M | 720 |
| TSLA | wTSLAx `0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171` | `0x6a58944eed3d2074e137eb4e94b302fe4af247a6` | USDC | $1.46M | $0.91M | 720 |
| MSFT | wMSFTx `0x166fbe68274b6a47e025f4ba17388c539f1fa1d0` | `0x66187278490a70a8ac26a6e159eb045f82dbfb57` | USDG | $0.36M | $0.33M | 1801 |
| META | wMETAx `0xe840946ffebcd66b7c4e95095effafadfa0d0e56` | `0xfad9e3c7550768fd4f34bc9cefd365cc193c0fb0` | USDG | $0.33M | $0.26M | 1801 |
| Gold | PAXGy `0x6c6494fd9962eb98b94ffa48f6679058f820700e` | `0x568e1aae314fc7e5e624dc47a505fc857d411528` | USDG | $0.97M | $0.07M | 310 |
| BTC | xBTC `0xb7c00000bcdeef966b20b3d884b98e64d2b06b4f` | `0x520f8c07a529ffb5230e76bcb8ea553d664e5b76` | USDG | $2.11M | $0.80M | 100 |
| ETH | xETH `0xe7b000003a45145decf8a28fc755ad5ec5ea025a` | `0x6e18cebfb9c5bbcf127b97a6dab026e941fff6d5` | USDG | $2.20M | $1.79M | 100 |
| AAPL | wAAPLx `0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f` | `0xfdd9f2a36645ab7a65e04b32cc23a4184728b47c` | USDC | $0.20M | $0.05M | **1, so no TWAP** |

Stablecoins:
- USDG `0x4ae46a509f6b1d9056937ba4500cb143933d2dc8`
- USDC `0xb6ceceab302e2e4948951ee7843fc24e92933061`
- USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`
- USDG/USD₮0 pool `0x0cbe0dbe1400e57f371a38bd3b9bc80f7c3676da` ($3.1M liquidity)

WOKB is `0xe538905cf8410324e03a5a23c1c177a474d59b2b`.

The plain NVDAx (`0xc845…849d`, ~310,859 supply) is the base xStock. The wrapped versions are what trades on DEXes.

Implications:
- **Fund base currency = USDG.** Most stock pools quote in USDG; USDC pools need one USDG↔USDC hop.
- **Prices = 30-min Uniswap V3 TWAP from these pools.** It's on chain, needs no keys, and resists manipulation for small funds. Chainlink Data Streams is optional later.
- **Rebalance trades go through the Uniswap V3 SwapRouter on X Layer.** Address still to confirm.
- **Size:** about $1–3M of depth per stock means funds up to roughly $10–50K rebalance with under 0.5% slippage. Cap funds at that size for the hackathon.
- **Market hours:** these trade 24/7 on chain, but prices drift off-hours. Rebalance during US market hours.
