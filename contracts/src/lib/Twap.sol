// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

interface IUniswapV3PoolOracle {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @title Twap
/// @notice Time-weighted prices from Uniswap V3 pools on X Layer, used for fund NAV,
///         rule inputs and swap slippage limits. Nothing off-chain, no keys.
library Twap {
    error TickOutOfRange();

    int24 internal constant MAX_TICK = 887272;

    /// Arithmetic-mean tick over the last `window` seconds.
    function meanTick(address pool, uint32 window) internal view returns (int24 tick) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        ago[1] = 0;
        (int56[] memory cum,) = IUniswapV3PoolOracle(pool).observe(ago);
        int56 delta = cum[1] - cum[0];
        int56 w = int56(uint56(window));
        tick = int24(delta / w);
        // round towards negative infinity, as Uniswap's OracleLibrary does
        if (delta < 0 && (delta % w != 0)) tick--;
    }

    /// How many `quoteToken` you get for `baseAmount` of `baseToken` at `tick`
    /// (port of Uniswap OracleLibrary.getQuoteAtTick, MIT re-implementation).
    function quoteAtTick(int24 tick, uint128 baseAmount, address baseToken, address quoteToken)
        internal
        pure
        returns (uint256 quoteAmount)
    {
        uint160 sqrtRatioX96 = sqrtRatioAtTick(tick);
        if (sqrtRatioX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtRatioX96) * sqrtRatioX96;
            quoteAmount = baseToken < quoteToken
                ? FixedPointMathLib.fullMulDiv(ratioX192, baseAmount, 1 << 192)
                : FixedPointMathLib.fullMulDiv(1 << 192, baseAmount, ratioX192);
        } else {
            uint256 ratioX128 = FixedPointMathLib.fullMulDiv(sqrtRatioX96, sqrtRatioX96, 1 << 64);
            quoteAmount = baseToken < quoteToken
                ? FixedPointMathLib.fullMulDiv(ratioX128, baseAmount, 1 << 128)
                : FixedPointMathLib.fullMulDiv(1 << 128, baseAmount, ratioX128);
        }
    }

    /// Value of `amount` of `token` in the pool's other token, at the `window`-second TWAP.
    function value(address pool, uint32 window, address token, uint128 amount) internal view returns (uint256) {
        address t0 = IUniswapV3PoolOracle(pool).token0();
        address other = token == t0 ? IUniswapV3PoolOracle(pool).token1() : t0;
        return quoteAtTick(meanTick(pool, window), amount, token, other);
    }

    /// sqrt(1.0001^tick) * 2^96. Same constants as Uniswap v3-core TickMath.
    function sqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        if (absTick > uint256(int256(MAX_TICK))) revert TickOutOfRange();

        uint256 ratio = absTick & 0x1 != 0 ? 0xfffcb933bd6fad37aa2d162d1a594001 : 0x100000000000000000000000000000000;
        if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

        if (tick > 0) ratio = type(uint256).max / ratio;
        sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
    }
}
