// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {FundryFactory} from "../src/FundryFactory.sol";
import {Fund} from "../src/Fund.sol";
import {ITapeOutFactory, ICircuits} from "../src/interfaces/ITapeOut.sol";
import {XLayer} from "./XLayer.sol";

interface IERC20F {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IERC721T {
    function transferFrom(address, address, uint256) external;
}

/// Forks and chip ownership on a fork of X Layer mainnet, using the real Fundry processor
/// (0x80bf…CC0B) that mainnet funds already live on:
/// - a fork's chip REFs its parent's chip; Circuits.step on chain matches the JS evaluator on all 256 cases
/// - the factory rejects REFs that don't point at the parent, or that are wired to other signals
/// - the creator fee goes to whoever holds the chip; a fork pays 20% of it to whoever holds the parent chip
contract ForksTest is Test {
    ITapeOutFactory constant TAPEOUT = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    address constant FUNDRY_PROCESSOR = 0x80bf3Aa74171b3711b5946D9F39b84F464B4CC0B;

    struct Case {
        bytes inputs;
        bytes newState;
        bytes outputs;
        bytes state;
    }

    FundryFactory factory;
    ICircuits cpu;
    address treasury = makeAddr("treasury");
    address maker = makeAddr("maker"); // launches the parent
    address forker = makeAddr("forker"); // launches the fork
    address buyer = makeAddr("buyer"); // later buys the parent chip
    address alice = makeAddr("alice");
    string json;

    function setUp() public {
        vm.createSelectFork("xlayer");
        factory = new FundryFactory(address(TAPEOUT), XLayer.USDG, XLayer.SWAP_ROUTER_02, treasury, address(this));
        factory.useProcessor(FUNDRY_PROCESSOR);
        cpu = factory.circuits();
        address bem = TAPEOUT.bem();
        deal(bem, address(this), 1e8);
        IERC20F(bem).approve(address(factory), type(uint256).max);
        factory.restock(300, 10);
        factory.listAsset(XLayer.wNVDAx, XLayer.POOL_NVDA_USDG);
        factory.listAsset(XLayer.wSPYx, XLayer.POOL_SPY_USDG);
        json = vm.readFile("test/fixtures/fork.json");
        vm.deal(maker, 1 ether);
        vm.deal(forker, 1 ether);
    }

    function _assets() internal pure returns (address[] memory a) {
        a = new address[](2);
        a[0] = XLayer.wNVDAx;
        a[1] = XLayer.wSPYx;
    }

    function _launch(address who, bytes memory nl, string memory rb, address parent) internal returns (Fund, uint256) {
        uint256 fee = cpu.TAPEOUT_FEE();
        vm.prank(who);
        (address f, uint256 id) = factory.launch{value: fee}(
            FundryFactory.Launch({
                name: parent == address(0) ? "AI + Market" : "AI + Market, safer",
                symbol: parent == address(0) ? "fAIM" : "fAIMS",
                assets: _assets(),
                netlist: nl,
                dropBps: 500,
                riseBps: 500,
                stopBps: 1500,
                feeBps: 200,
                period: 1 days,
                tvlCap: 25_000e6,
                rulebook: rb,
                parent: parent
            })
        );
        return (Fund(f), id);
    }

    /// The fork netlist from the fixture, with its placeholder REF pointed at (cpu, id).
    function _forkNetlist(address target, uint256 id) internal view returns (bytes memory nl) {
        nl = vm.parseJsonBytes(json, ".forkNetlist");
        assertEq(uint8(nl[0]), 2, "fixture: REF first");
        bytes20 a = bytes20(target);
        for (uint256 i; i < 20; i++) nl[1 + i] = a[i];
        for (uint256 i; i < 8; i++) nl[21 + i] = bytes1(uint8(id >> (8 * (7 - i))));
    }

    function _parent() internal returns (Fund parent, uint256 pid) {
        return _launch(maker, vm.parseJsonBytes(json, ".parentNetlist"), vm.parseJsonString(json, ".parentRulebook"), address(0));
    }

    function test_forkReusesParentChipAndMatchesJs() public {
        (Fund parent, uint256 pid) = _parent();
        uint256 nandBefore = factory.transistors().balanceOf(address(factory), 0);
        (Fund fork, uint256 fid) = _launch(forker, _forkNetlist(address(cpu), pid), vm.parseJsonString(json, ".forkRulebook"), address(parent));
        uint256 burned = nandBefore - factory.transistors().balanceOf(address(factory), 0);

        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = cpu.circuitInfo(fid);
        (,,, uint32 parentGates) = cpu.circuitInfo(pid);
        assertEq(nIn, 6);
        assertEq(nOut, 4);
        assertEq(nState, 2, "parent latch + fork latch");
        assertEq(gates, parentGates + vm.parseJsonUint(json, ".forkOwnGates"), "gate count includes the REF'd parent");
        assertEq(burned + vm.parseJsonUint(json, ".forkLatches"), vm.parseJsonUint(json, ".forkOwnGates"), "only the fork's own gates are burned");
        console2.log("fork total gates", gates);
        console2.log("NAND burned for the fork", burned);

        // family tree on chain
        assertEq(factory.parentOf(address(fork)), address(parent));
        assertEq(factory.childrenOf(address(parent)).length, 1);
        assertEq(factory.childrenOf(address(parent))[0], address(fork));
        assertEq(factory.fundOfCircuit(fid), address(fork));
        assertEq(fork.parent(), address(parent));
        assertEq(fork.parentCircuitId(), pid);
        assertEq(cpu.ownerOf(fid), forker);

        // the real TapeOut evaluator agrees with the JS evaluator on every input and state
        Case[] memory cases = abi.decode(vm.parseJson(json, ".cases"), (Case[]));
        for (uint256 k; k < cases.length; k++) {
            (bytes memory ns, bytes memory out) = cpu.step(fid, cases[k].state, cases[k].inputs);
            assertEq(uint8(out[0]), uint8(cases[k].outputs[0]), "outputs");
            assertEq(uint8(ns[0]), uint8(cases[k].newState[0]), "state");
        }
        console2.log("fork cases checked on chain", cases.length);
    }

    function test_badForksAreRejected() public {
        (Fund parent, uint256 pid) = _parent();
        string memory rb = vm.parseJsonString(json, ".forkRulebook");
        uint256 fee = cpu.TAPEOUT_FEE();

        // REF to a different chip than the parent's
        bytes memory wrongId = _forkNetlist(address(cpu), pid - 1);
        vm.expectRevert(FundryFactory.BadFork.selector);
        this.launchAs(forker, wrongId, rb, address(parent), fee);

        // a netlist with a REF but no parent declared (an unpaid copy)
        bytes memory nl = _forkNetlist(address(cpu), pid);
        vm.expectRevert(FundryFactory.BadFork.selector);
        this.launchAs(forker, nl, rb, address(0), fee);

        // REF fed with other signals than the fund's own inputs
        bytes memory rewired = _forkNetlist(address(cpu), pid);
        rewired[31 + 2] = bytes1(uint8(3)); // REF input 0 <- signal 3 instead of 2
        vm.expectRevert(FundryFactory.BadFork.selector);
        this.launchAs(forker, rewired, rb, address(parent), fee);

        // a parent that isn't a Fundry fund
        vm.expectRevert(FundryFactory.BadFork.selector);
        this.launchAs(forker, nl, rb, alice, fee);
    }

    function launchAs(address who, bytes memory nl, string memory rb, address parent, uint256 fee) external {
        vm.prank(who);
        factory.launch{value: fee}(
            FundryFactory.Launch("x", "x", _assets(), nl, 500, 500, 1500, 200, 1 days, 25_000e6, rb, parent)
        );
    }

    function test_chipOwnerEarnsAndForkPaysRoyalty() public {
        (Fund parent, uint256 pid) = _parent();
        (Fund fork, uint256 fid) = _launch(forker, _forkNetlist(address(cpu), pid), vm.parseJsonString(json, ".forkRulebook"), address(parent));
        assertEq(fork.chipOwner(), forker);
        assertEq(fork.parentOwner(), maker);
        assertEq(parent.parentOwner(), address(0));

        deal(XLayer.USDG, alice, 10_000e6);
        vm.startPrank(alice);
        IERC20F(XLayer.USDG).approve(address(fork), 10_000e6);
        fork.deposit(10_000e6, 0);
        vm.stopPrank();

        // a year at 2%: 2% of supply in fee shares; half to treasury, half split 80/20 fork/parent
        vm.warp(block.timestamp + 365 days);
        fork.accrueFees();
        uint256 supply0 = 10_000e6 * 1e12;
        uint256 fees = (supply0 * 200) / 10_000;
        assertApproxEqRel(fork.balanceOf(treasury), fees / 2, 1e12);
        assertApproxEqRel(fork.balanceOf(forker), (fees / 2) * 8 / 10, 1e12);
        assertApproxEqRel(fork.balanceOf(maker), (fees / 2) * 2 / 10, 1e12);
        assertEq(fork.royaltyFeeShares(), fork.balanceOf(maker));

        // the parent chip is sold: its royalties now go to the buyer
        vm.prank(maker);
        IERC721T(address(cpu)).transferFrom(maker, buyer, pid);
        assertEq(fork.parentOwner(), buyer);
        // the fork chip is sold too: the fork's own fee follows it
        vm.prank(forker);
        IERC721T(address(cpu)).transferFrom(forker, alice, fid);
        assertEq(fork.chipOwner(), alice);
        uint256 makerBefore = fork.balanceOf(maker);
        uint256 aliceBefore = fork.balanceOf(alice);
        vm.warp(block.timestamp + 30 days);
        fork.accrueFees();
        assertEq(fork.balanceOf(maker), makerBefore, "old parent owner earns nothing new");
        assertGt(fork.balanceOf(buyer), 0, "new parent owner earns the royalty");
        assertGt(fork.balanceOf(alice), aliceBefore, "new chip owner earns the fee");
    }

    function test_forkRebalancesThroughTheParentChip() public {
        (Fund parent, uint256 pid) = _parent();
        (Fund fork,) = _launch(forker, _forkNetlist(address(cpu), pid), vm.parseJsonString(json, ".forkRulebook"), address(parent));
        deal(XLayer.USDG, alice, 1_000e6);
        vm.startPrank(alice);
        IERC20F(XLayer.USDG).approve(address(fork), 1_000e6);
        fork.deposit(1_000e6, 0);
        vm.stopPrank();
        // parent says 2:2 at rest; the fork shifts NVDA down one (1) and SPY up one (3)
        (,,, uint8[] memory lv) = fork.preview();
        assertEq(lv[0], 1);
        assertEq(lv[1], 3);
        uint256 g = gasleft();
        fork.rebalance();
        console2.log("fork rebalance gas", g - gasleft());
        assertEq(fork.rebalanceCount(), 1);
        assertGt(IERC20F(XLayer.wSPYx).balanceOf(address(fork)), 0);
    }
}
