// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "solady/tokens/ERC20.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {Twap, IUniswapV3PoolOracle} from "./lib/Twap.sol";
import {ICircuits} from "./interfaces/ITapeOut.sol";

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IPoolFee {
    function fee() external view returns (uint24);
}

/// @title Fund
/// @notice One Fundry stock fund. Holds USDG plus up to 4 tokenized stocks on X Layer.
///         Its rulebook is a TapeOut circuit that nobody can change. `rebalance()` is open to
///         anyone: it reads TWAP prices, turns them into input bits, asks the circuit for target
///         weights and trades toward them through Uniswap V3 with a TWAP-based slippage limit.
///         There is no owner and no admin path that can move fund assets.
contract Fund is ERC20, ReentrancyGuard {
    using SafeTransferLib for address;

    uint256 public constant MAX_ASSETS = 4;
    uint32 public constant TWAP_WINDOW = 1800; // 30 minutes
    uint256 public constant YEAR = 365 days;
    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_TRADE = 1e6; // 1 USDG: smaller trades are skipped
    uint256 public constant DUST_BPS = 100; // trades under 1% of NAV are skipped

    struct Config {
        string name;
        string symbol;
        address creator;
        address treasury;
        address usdg;
        address router;
        address circuits; // TapeOut processor (Circuits contract)
        uint256 circuitId;
        address[] assets;
        address[] pools; // asset/USDG Uniswap V3 pool for each asset
        uint16 dropBps;
        uint16 riseBps;
        uint16 stopBps;
        uint16 feeBps; // management fee per year
        uint16 maxSlippageBps;
        uint32 period; // seconds between rebalances
        uint256 tvlCap; // in USDG units
    }

    // ---- fixed at launch -------------------------------------------------------------------
    address public factory;
    string private _name;
    string private _symbol;
    address public creator;
    address public treasury;
    address public usdg;
    address public router;
    ICircuits public circuits;
    uint256 public circuitId;
    address[] internal _assets;
    address[] internal _pools;
    uint24[] internal _fees;
    uint16 public dropBps;
    uint16 public riseBps;
    uint16 public stopBps;
    uint16 public feeBps;
    uint16 public maxSlippageBps;
    uint32 public period;
    uint256 public tvlCap;
    uint256 public launchedAt;

    // ---- moving state ----------------------------------------------------------------------
    uint256 public lastRebalance;
    uint256 public rebalanceCount;
    uint256 public lastFeeAccrual;
    uint256[] internal _lastPrice; // USDG units per 1e18 of the asset, at the last rebalance
    uint256[] internal _peak;
    bytes public latchState;

    event Deposited(address indexed who, uint256 usdgIn, uint256 shares);
    event Withdrawn(address indexed who, uint256 shares, uint256 usdgOut, uint256[] assetsOut);
    event FeesAccrued(uint256 creatorShares, uint256 treasuryShares);
    event Rebalanced(
        uint256 indexed n,
        bytes inputs,
        bytes outputs,
        bytes newState,
        uint8[] levels,
        uint256[] prices,
        uint256 navBefore,
        uint256 navAfter
    );
    event Traded(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    error AlreadyInitialized();
    error BadConfig();
    error TooEarly();
    error CapReached();
    error Slippage();
    error ZeroAmount();
    error Empty();

    // ---- setup -----------------------------------------------------------------------------

    function initialize(Config calldata c) external {
        if (factory != address(0)) revert AlreadyInitialized();
        uint256 n = c.assets.length;
        if (n == 0 || n > MAX_ASSETS || c.pools.length != n) revert BadConfig();
        if (c.feeBps > 200 || c.maxSlippageBps == 0 || c.maxSlippageBps > 300) revert BadConfig();
        if (c.period < 1 hours) revert BadConfig();
        (uint32 nIn, uint32 nOut,,) = ICircuits(c.circuits).circuitInfo(c.circuitId);
        if (nIn != 3 * n || nOut != 2 * n) revert BadConfig();

        factory = msg.sender;
        _name = c.name;
        _symbol = c.symbol;
        creator = c.creator;
        treasury = c.treasury;
        usdg = c.usdg;
        router = c.router;
        circuits = ICircuits(c.circuits);
        circuitId = c.circuitId;
        dropBps = c.dropBps;
        riseBps = c.riseBps;
        stopBps = c.stopBps;
        feeBps = c.feeBps;
        maxSlippageBps = c.maxSlippageBps;
        period = c.period;
        tvlCap = c.tvlCap;
        launchedAt = block.timestamp;
        lastFeeAccrual = block.timestamp;

        for (uint256 i; i < n; i++) {
            address a = c.assets[i];
            address p = c.pools[i];
            address t0 = IUniswapV3PoolOracle(p).token0();
            address t1 = IUniswapV3PoolOracle(p).token1();
            if (!((t0 == a && t1 == c.usdg) || (t1 == a && t0 == c.usdg))) revert BadConfig();
            for (uint256 j; j < i; j++) if (c.assets[j] == a) revert BadConfig();
            _assets.push(a);
            _pools.push(p);
            _fees.push(IPoolFee(p).fee());
            _lastPrice.push(0);
            _peak.push(0);
            // reverts if the pool can't serve a 30-minute TWAP
            Twap.meanTick(p, TWAP_WINDOW);
        }
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    // ---- views -----------------------------------------------------------------------------

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function pools() external view returns (address[] memory) {
        return _pools;
    }

    function lastPrices() external view returns (uint256[] memory) {
        return _lastPrice;
    }

    function peaks() external view returns (uint256[] memory) {
        return _peak;
    }

    /// USDG value of 1e18 units of asset i at the 30-minute TWAP.
    function price(uint256 i) public view returns (uint256) {
        return Twap.value(_pools[i], TWAP_WINDOW, _assets[i], 1e18);
    }

    function _valueOf(uint256 i, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        return Twap.value(_pools[i], TWAP_WINDOW, _assets[i], uint128(amount));
    }

    /// Net asset value in USDG units: cash plus every holding at TWAP.
    function nav() public view returns (uint256 total) {
        total = SafeTransferLib.balanceOf(usdg, address(this));
        for (uint256 i; i < _assets.length; i++) {
            total += _valueOf(i, SafeTransferLib.balanceOf(_assets[i], address(this)));
        }
    }

    function nextRebalanceAt() public view returns (uint256) {
        return lastRebalance == 0 ? launchedAt : lastRebalance + period;
    }

    // ---- investors -------------------------------------------------------------------------

    /// Deposit USDG and receive shares at NAV. Cash waits for the next rebalance.
    function deposit(uint256 amount, uint256 minShares) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        _accrueFees();
        uint256 navNow = nav();
        if (navNow + amount > tvlCap) revert CapReached();
        uint256 supply = totalSupply();
        shares = supply == 0 || navNow == 0 ? amount * 1e12 : FixedPointMathLib.fullMulDiv(amount, supply, navNow);
        if (shares == 0 || shares < minShares) revert Slippage();
        usdg.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, shares);
        emit Deposited(msg.sender, amount, shares);
    }

    /// Burn shares and receive your exact slice of every holding (cash + each stock).
    /// No prices are used, so this can't be manipulated and always works.
    function withdraw(uint256 shares, address to) external nonReentrant {
        if (shares == 0) revert ZeroAmount();
        _accrueFees();
        uint256 supply = totalSupply();
        _burn(msg.sender, shares);
        uint256 cash = FixedPointMathLib.fullMulDiv(SafeTransferLib.balanceOf(usdg, address(this)), shares, supply);
        if (cash > 0) usdg.safeTransfer(to, cash);
        uint256[] memory outs = new uint256[](_assets.length);
        for (uint256 i; i < _assets.length; i++) {
            uint256 bal = SafeTransferLib.balanceOf(_assets[i], address(this));
            outs[i] = FixedPointMathLib.fullMulDiv(bal, shares, supply);
            if (outs[i] > 0) _assets[i].safeTransfer(to, outs[i]);
        }
        emit Withdrawn(msg.sender, shares, cash, outs);
    }

    // ---- fees ------------------------------------------------------------------------------

    function _accrueFees() internal {
        uint256 dt = block.timestamp - lastFeeAccrual;
        lastFeeAccrual = block.timestamp;
        uint256 supply = totalSupply();
        if (dt == 0 || supply == 0 || feeBps == 0) return;
        uint256 feeShares = FixedPointMathLib.fullMulDiv(supply, uint256(feeBps) * dt, BPS * YEAR);
        if (feeShares == 0) return;
        uint256 toCreator = feeShares / 2;
        _mint(creator, toCreator);
        _mint(treasury, feeShares - toCreator);
        emit FeesAccrued(toCreator, feeShares - toCreator);
    }

    function accrueFees() external nonReentrant {
        _accrueFees();
    }

    // ---- the rulebook ----------------------------------------------------------------------

    /// Input bits the circuit would see right now: [DROP, RISE, STOP] per asset, LSB first.
    function currentInputs() public view returns (bytes memory inputs, uint256[] memory prices) {
        uint256 n = _assets.length;
        prices = new uint256[](n);
        uint256 bits;
        for (uint256 i; i < n; i++) {
            uint256 p = price(i);
            prices[i] = p;
            uint256 last = _lastPrice[i];
            bool drop;
            bool rise;
            if (last != 0) {
                drop = p * BPS <= last * (BPS - dropBps);
                rise = p * BPS >= last * (BPS + riseBps);
            }
            uint256 pk = _peak[i] > p ? _peak[i] : p;
            bool stop = p * BPS <= pk * (BPS - stopBps);
            if (drop) bits |= 1 << (3 * i);
            if (rise) bits |= 1 << (3 * i + 1);
            if (stop) bits |= 1 << (3 * i + 2);
        }
        inputs = new bytes((3 * n + 7) / 8);
        for (uint256 b; b < inputs.length; b++) inputs[b] = bytes1(uint8(bits >> (8 * b)));
    }

    /// What the circuit decides right now (no trades). Useful for the app and for anyone checking.
    function preview()
        external
        view
        returns (bytes memory inputs, bytes memory outputs, bytes memory newState, uint8[] memory levels)
    {
        (inputs,) = currentInputs();
        (newState, outputs) = circuits.step(circuitId, latchState, inputs);
        levels = _levels(outputs);
    }

    function _levels(bytes memory outputs) internal view returns (uint8[] memory levels) {
        uint256 n = _assets.length;
        levels = new uint8[](n);
        for (uint256 i; i < n; i++) {
            uint256 b0 = 2 * i;
            uint256 b1 = 2 * i + 1;
            uint8 lo = (uint8(outputs[b0 >> 3]) >> (b0 & 7)) & 1;
            uint8 hi = (uint8(outputs[b1 >> 3]) >> (b1 & 7)) & 1;
            levels[i] = lo | (hi << 1);
        }
    }

    /// Anyone can call this once per period. The circuit decides; this contract only obeys.
    function rebalance() external nonReentrant {
        if (block.timestamp < nextRebalanceAt()) revert TooEarly();
        if (totalSupply() == 0) revert Empty();
        _accrueFees();

        (bytes memory inputs, uint256[] memory prices) = currentInputs();
        (bytes memory newState, bytes memory outputs) = circuits.step(circuitId, latchState, inputs);
        uint8[] memory levels = _levels(outputs);

        uint256 n = _assets.length;
        uint256 navBefore = nav();
        uint256 sumLevels;
        for (uint256 i; i < n; i++) sumLevels += levels[i];

        uint256[] memory target = new uint256[](n);
        uint256[] memory current = new uint256[](n);
        for (uint256 i; i < n; i++) {
            target[i] = sumLevels == 0 ? 0 : (navBefore * levels[i]) / sumLevels;
            current[i] = _valueOf(i, SafeTransferLib.balanceOf(_assets[i], address(this)));
        }
        uint256 dust = (navBefore * DUST_BPS) / BPS;
        if (dust < MIN_TRADE) dust = MIN_TRADE;

        // 1) sell what is over target, so cash is there for the buys
        for (uint256 i; i < n; i++) {
            if (current[i] > target[i] + dust || (target[i] == 0 && current[i] > 0)) {
                uint256 bal = SafeTransferLib.balanceOf(_assets[i], address(this));
                uint256 sellAmt =
                    target[i] == 0 ? bal : FixedPointMathLib.fullMulDiv(bal, current[i] - target[i], current[i]);
                _swap(_assets[i], usdg, _fees[i], sellAmt, _valueOf(i, sellAmt));
            }
        }
        // 2) buy what is under target, with the cash on hand
        for (uint256 i; i < n; i++) {
            if (target[i] > current[i] + dust) {
                uint256 cash = SafeTransferLib.balanceOf(usdg, address(this));
                uint256 buy = target[i] - current[i];
                if (buy > cash) buy = cash;
                if (buy < MIN_TRADE) continue;
                uint256 fair = Twap.value(_pools[i], TWAP_WINDOW, usdg, uint128(buy));
                _swap(usdg, _assets[i], _fees[i], buy, fair);
            }
        }

        // 3) remember prices, peaks (a fired stop resets the peak) and the circuit's memory
        for (uint256 i; i < n; i++) {
            bool stopped = (uint8(inputs[(3 * i + 2) >> 3]) >> ((3 * i + 2) & 7)) & 1 == 1;
            uint256 pk = _peak[i] > prices[i] ? _peak[i] : prices[i];
            _peak[i] = stopped ? prices[i] : pk;
            _lastPrice[i] = prices[i];
        }
        latchState = newState;
        lastRebalance = block.timestamp;
        rebalanceCount++;
        emit Rebalanced(rebalanceCount, inputs, outputs, newState, levels, prices, navBefore, nav());
    }

    function _swap(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 fairOut) internal {
        if (amountIn == 0) return;
        uint256 minOut = (fairOut * (BPS - maxSlippageBps)) / BPS;
        tokenIn.safeApprove(router, amountIn);
        uint256 out = ISwapRouter02(router).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        if (out < minOut) revert Slippage();
        emit Traded(tokenIn, tokenOut, amountIn, out);
    }
}
