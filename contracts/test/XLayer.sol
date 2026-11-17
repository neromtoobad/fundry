// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Real X Layer mainnet (chain 196) addresses used by tests and deploy scripts.
/// Sources: docs/STOCKS.md (pools read on chain, Nov 17 2026) and the Uniswap X Layer deployments page.
library XLayer {
    // Uniswap V3
    address internal constant UNIV3_FACTORY = 0x4B2ab38DBF28D31D467aA8993f6c2585981D6804;
    address internal constant SWAP_ROUTER_02 = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    address internal constant QUOTER_V2 = 0xD1b797D92d87B688193A2B976eFc8D577D204343;

    // Stablecoins (6 decimals)
    address internal constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address internal constant USDC = 0xB6CEceAB302E2E4948951eE7843FC24E92933061;

    // Wrapped xStocks (18 decimals)
    address internal constant wNVDAx = 0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5;
    address internal constant wSPYx = 0xE7E553Cd128F0011777323A0b44a7b96EA1CB540;

    // Pools (0.05%)
    address internal constant POOL_NVDA_USDG = 0x2a2B11730C2b6d99a58034A869dd810D7300a7b2;
    address internal constant POOL_SPY_USDG = 0x07c40850D14064D20eB0AfDEf9574675392f2c11;
}
