// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {ITapeOutFactory, ITransistors, ICircuits} from "../src/interfaces/ITapeOut.sol";

interface IERC20Min {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// Creates a processor on the real (forked) TapeOut factory, tapes out a rulebook compiled by
/// sdk/scripts/fixture.mjs, and checks Circuits.step against the JS evaluator on all 1,024 cases.
contract TapeOutForkTest is Test {
    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);

    struct Case {
        bytes inputs;
        bytes newState;
        bytes outputs;
        bytes state;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function setUp() public {
        vm.createSelectFork("xlayer");
    }

    function test_compiledRulebookRunsOnRealTapeOut() public {
        address bem = FACTORY.bem();
        uint256 fee = FACTORY.deployFee();
        console2.log("BEM", bem);
        console2.log("deployFee (BEM units)", fee);
        deal(bem, address(this), 100e8);
        vm.deal(address(this), 1 ether);
        IERC20Min(bem).approve(address(FACTORY), type(uint256).max);

        (address tr, address cpu) = FACTORY.createCPU("Fundry", "FNDRY", "test", 1_000_000, 1e4);
        console2.log("transistors", tr);
        console2.log("circuits", cpu);
        IERC20Min(bem).approve(tr, type(uint256).max);

        string memory json = vm.readFile("test/fixtures/rule-example.json");
        bytes memory nl = vm.parseJsonBytes(json, ".netlist");
        uint256 nIn = vm.parseJsonUint(json, ".nIn");
        uint256 nOut = vm.parseJsonUint(json, ".nOut");
        uint256 gates = vm.parseJsonUint(json, ".gateCount");

        // the fixture rulebook uses 1 LATCH; the rest are NANDs
        ITransistors(tr).mint(0, gates - 1);
        ITransistors(tr).mint(1, 1);
        uint256 tapeFee = ICircuits(cpu).TAPEOUT_FEE();
        uint256 id = ICircuits(cpu).tapeout{value: tapeFee}(nl, uint32(nIn), uint32(nOut));
        (uint32 i_, uint32 o_, uint32 s_, uint32 g_) = ICircuits(cpu).circuitInfo(id);
        assertEq(i_, nIn);
        assertEq(o_, nOut);
        assertEq(s_, 1);
        assertEq(g_, gates);

        Case[] memory cases = abi.decode(vm.parseJson(json, ".cases"), (Case[]));
        for (uint256 k = 0; k < cases.length; k++) {
            (bytes memory ns, bytes memory out) = ICircuits(cpu).step(id, cases[k].state, cases[k].inputs);
            assertEq(uint8(out[0]), uint8(cases[k].outputs[0]), "outputs");
            assertEq(uint8(ns[0]), uint8(cases[k].newState[0]), "state");
        }
        console2.log("cases checked on chain", cases.length);
    }
}
