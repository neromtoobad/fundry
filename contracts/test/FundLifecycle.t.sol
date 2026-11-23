// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {FundryFactory} from "../src/FundryFactory.sol";
import {Fund, ISwapRouter02} from "../src/Fund.sol";
import {ITapeOutFactory, ICircuits} from "../src/interfaces/ITapeOut.sol";
import {XLayer} from "./XLayer.sol";

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Full lifecycle on a fork of X Layer mainnet, with the real TapeOut factory, the real
/// wNVDAx/wSPYx pools and the real Uniswap router:
/// set up processor -> launch (tape out) -> deposit -> rebalance -> NVDA crash -> rebalance -> withdraw.
contract FundLifecycleTest is Test {
    ITapeOutFactory constant TAPEOUT = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);

    FundryFactory factory;
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address whale = makeAddr("whale");
    address bem;

    function setUp() public {
        vm.createSelectFork("xlayer");
        bem = TAPEOUT.bem();
        factory = new FundryFactory(address(TAPEOUT), XLayer.USDG, XLayer.SWAP_ROUTER_02, treasury, address(this));

        deal(bem, address(this), 10e8);
        IERC20(bem).approve(address(factory), type(uint256).max);
        factory.setUpProcessor(1_000_000, 1e3, "Fundry: fund rulebooks as chips");
        factory.restock(2_000, 50);

        factory.listAsset(XLayer.wNVDAx, XLayer.POOL_NVDA_USDG);
        factory.listAsset(XLayer.wSPYx, XLayer.POOL_SPY_USDG);
    }

    function _launch() internal returns (Fund fund, uint256 circuitId) {
        string memory json = vm.readFile("test/fixtures/launch-nvda-spy.json");
        address[] memory assets = new address[](2);
        assets[0] = XLayer.wNVDAx;
        assets[1] = XLayer.wSPYx;
        uint256 fee = ICircuits(address(factory.circuits())).TAPEOUT_FEE();
        vm.deal(creator, 1 ether);
        vm.prank(creator);
        (address f, uint256 id) = factory.launch{value: fee}(
            FundryFactory.Launch({
                name: "AI + Market",
                symbol: "fAIM",
                assets: assets,
                netlist: vm.parseJsonBytes(json, ".netlist"),
                dropBps: 500,
                riseBps: 500,
                stopBps: 1500,
                feeBps: 100,
                period: 1 days,
                tvlCap: 25_000e6,
                rulebook: vm.parseJsonString(json, ".rulebook")
            })
        );
        return (Fund(f), id);
    }

    function _deposit(Fund fund, address who, uint256 amount) internal {
        deal(XLayer.USDG, who, amount);
        vm.startPrank(who);
        IERC20(XLayer.USDG).approve(address(fund), amount);
        fund.deposit(amount, 0);
        vm.stopPrank();
    }

    function test_launchTapesOutAndGivesCreatorTheChip() public {
        (Fund fund, uint256 id) = _launch();
        ICircuits cpu = factory.circuits();
        assertEq(cpu.ownerOf(id), creator, "creator owns the chip");
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = cpu.circuitInfo(id);
        assertEq(nIn, 6);
        assertEq(nOut, 4);
        assertEq(nState, 1);
        console2.log("rulebook gates", gates);
        assertEq(fund.circuitId(), id);
        assertTrue(factory.isFund(address(fund)));
        assertEq(fund.creator(), creator);
    }

    function test_fullLifecycle() public {
        (Fund fund,) = _launch();
        _deposit(fund, alice, 1_000e6);
        assertEq(fund.nav(), 1_000e6, "all cash before the first rebalance");

        // first rebalance: base weights 2:2 -> about 50% NVDA, 50% SPY
        (,,, uint8[] memory lv) = fund.preview();
        assertEq(lv[0], 2);
        assertEq(lv[1], 2);
        fund.rebalance();
        uint256 navAfter = fund.nav();
        console2.log("NAV after first rebalance", navAfter);
        assertApproxEqRel(navAfter, 1_000e6, 0.01e18, "lost < 1% to fees + slippage");
        uint256 nvdaVal = _val(fund, 0);
        uint256 spyVal = _val(fund, 1);
        console2.log("NVDA value", nvdaVal);
        console2.log("SPY value", spyVal);
        assertApproxEqRel(nvdaVal, spyVal, 0.05e18, "about 50/50");

        // too early to rebalance again
        vm.expectRevert(Fund.TooEarly.selector);
        fund.rebalance();

        // NVDA crashes: a whale dumps wNVDAx into the pool, then a day passes so the TWAP catches up
        _crashNvda();
        vm.warp(block.timestamp + 1 days + 1);
        (bytes memory inputs,,, uint8[] memory lv2) = fund.preview();
        console2.log("inputs after crash");
        console2.logBytes(inputs);
        uint256 p0 = fund.lastPrices()[0];
        console2.log("NVDA price drop (bps)", (p0 - fund.price(0)) * 10_000 / p0);
        assertEq(uint8(inputs[0]) & 1, 1, "DROP bit for NVDA");
        assertEq((uint8(inputs[0]) >> 2) & 1, 0, "no stop-loss: the drop is between 5% and 15%");
        assertEq(lv2[0], 1, "NVDA cut to half");
        assertEq(lv2[1], 2, "SPY unchanged");
        uint256 nvdaBefore = IERC20(XLayer.wNVDAx).balanceOf(address(fund));
        fund.rebalance();
        uint256 nvdaAfter = IERC20(XLayer.wNVDAx).balanceOf(address(fund));
        assertLt(nvdaAfter, nvdaBefore, "the circuit made the fund sell NVDA");
        assertEq(fund.rebalanceCount(), 2);

        // alice leaves with her exact slice of everything
        uint256 shares = fund.balanceOf(alice);
        vm.prank(alice);
        fund.withdraw(shares, alice);
        assertGt(IERC20(XLayer.wNVDAx).balanceOf(alice), 0);
        assertGt(IERC20(XLayer.wSPYx).balanceOf(alice), 0);
        assertEq(fund.balanceOf(alice), 0);
        // fees went to creator and treasury as shares
        assertGt(fund.balanceOf(creator), 0);
        assertGt(fund.balanceOf(treasury), 0);
    }

    function test_bigCrashFiresStopAndStaysOut() public {
        (Fund fund,) = _launch();
        _deposit(fund, alice, 1_000e6);
        fund.rebalance();
        // a deep crash: DROP and STOP both fire, the stay-out latch sets, NVDA goes to zero
        deal(XLayer.wNVDAx, whale, 2_500e18);
        _sellNvda(2_500e18);
        vm.warp(block.timestamp + 1 days + 1);
        (bytes memory inputs,, bytes memory newState, uint8[] memory lv) = fund.preview();
        assertEq(uint8(inputs[0]) & 5, 5, "DROP and STOP for NVDA");
        assertEq(lv[0], 0, "NVDA sold out");
        assertEq(uint8(newState[0]) & 1, 1, "stay-out latch set");
        fund.rebalance();
        assertEq(IERC20(XLayer.wNVDAx).balanceOf(address(fund)), 0, "no NVDA left");
        // next period, no rise yet: the latch keeps NVDA at zero even though nothing new fell
        vm.warp(block.timestamp + 1 days + 1);
        (bytes memory in2,,, uint8[] memory lv2) = fund.preview();
        assertEq(uint8(in2[0]) & 7, 0, "no new signal for NVDA");
        assertEq(lv2[0], 0, "still out: the chip remembers");
    }

    function test_capAndInitGuards() public {
        (Fund fund,) = _launch();
        deal(XLayer.USDG, alice, 30_000e6);
        vm.startPrank(alice);
        IERC20(XLayer.USDG).approve(address(fund), type(uint256).max);
        vm.expectRevert(Fund.CapReached.selector);
        fund.deposit(30_000e6, 0);
        vm.stopPrank();

        Fund.Config memory c;
        vm.expectRevert(Fund.AlreadyInitialized.selector);
        fund.initialize(c);
    }

    function test_onlyCuratorLists() public {
        vm.prank(alice);
        vm.expectRevert(FundryFactory.NotCurator.selector);
        factory.listAsset(XLayer.wNVDAx, XLayer.POOL_NVDA_USDG);
    }

    function test_unlistedAssetRejected() public {
        address[] memory assets = new address[](1);
        assets[0] = XLayer.USDC;
        vm.expectRevert(abi.encodeWithSelector(FundryFactory.NotListed.selector, XLayer.USDC));
        factory.launch(
            FundryFactory.Launch("x", "x", assets, hex"", 500, 500, 1500, 100, 1 days, 1e9, "")
        );
    }

    function _val(Fund fund, uint256 i) internal view returns (uint256) {
        address a = fund.assets()[i];
        uint256 bal = IERC20(a).balanceOf(address(fund));
        return bal == 0 ? 0 : (fund.price(i) * bal) / 1e18;
    }

    function _crashNvda() internal {
        // sell enough wNVDAx to push the pool price down 5-15%
        uint256 amount = 1_400e18;
        deal(XLayer.wNVDAx, whale, amount);
        _sellNvda(amount);
    }

    function _sellNvda(uint256 amount) internal {
        vm.startPrank(whale);
        IERC20(XLayer.wNVDAx).approve(XLayer.SWAP_ROUTER_02, amount);
        ISwapRouter02(XLayer.SWAP_ROUTER_02).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: XLayer.wNVDAx,
                tokenOut: XLayer.USDG,
                fee: 500,
                recipient: whale,
                amountIn: amount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();
    }
}
