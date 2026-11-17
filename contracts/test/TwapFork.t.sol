// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Twap} from "../src/lib/Twap.sol";
import {XLayer} from "./XLayer.sol";

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

/// Reads real stock-token prices from live X Layer pools (fork) and checks the TWAP
/// against what the pool would actually pay for a 1,000 USDG buy.
contract TwapForkTest is Test {
    function setUp() public {
        vm.createSelectFork("xlayer");
    }

    function _twapPrice(address pool, address stock) internal view returns (uint256 usdPer1) {
        // value of 1 whole stock token (18 decimals) in USDG (6 decimals)
        usdPer1 = Twap.value(pool, 1800, stock, 1e18);
    }

    function test_twapPricesArePlausible() public view {
        uint256 nvda = _twapPrice(XLayer.POOL_NVDA_USDG, XLayer.wNVDAx);
        uint256 spy = _twapPrice(XLayer.POOL_SPY_USDG, XLayer.wSPYx);
        console2.log("NVDA (USDG, 6dp)", nvda);
        console2.log("SPY  (USDG, 6dp)", spy);
        assertGt(nvda, 50e6);
        assertLt(nvda, 1000e6);
        assertGt(spy, 300e6);
        assertLt(spy, 1500e6);
    }

    function test_twapMatchesQuoterWithinTwoPercent() public {
        uint256 usdIn = 1_000e6;
        (uint256 got,,,) = IQuoterV2(XLayer.QUOTER_V2).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: XLayer.USDG,
                tokenOut: XLayer.wNVDAx,
                amountIn: usdIn,
                fee: 500,
                sqrtPriceLimitX96: 0
            })
        );
        uint256 expected = Twap.value(XLayer.POOL_NVDA_USDG, 1800, XLayer.USDG, uint128(usdIn));
        console2.log("quoter wNVDAx out", got);
        console2.log("twap   wNVDAx out", expected);
        assertApproxEqRel(got, expected, 0.02e18);
    }
}
