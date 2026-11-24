// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {FundryFactory} from "../src/FundryFactory.sol";
import {ITapeOutFactory} from "../src/interfaces/ITapeOut.sol";

interface IERC20Min {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Deploys FundryFactory, sets up its TapeOut processor, buys transistor stock and lists every
/// stock in deployments/assets.json.
///
///   forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast --private-key <key>
///
/// With PROCESSOR=<circuits address> the factory attaches to an existing processor (v2 reuses the
/// Fundry processor that v1 created, so every chip, old and new, lives on one processor and forks
/// can REF any of them). Without it, a new processor is created (0.1 BEM deploy fee).
/// Transistors cost mintPrice each plus 0.01 BEM per mint transaction.
/// Writes deployments/<chainId>.json for the app and seed script.
contract Deploy is Script {
    address constant TAPEOUT = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address constant SWAP_ROUTER_02 = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;

    struct Asset {
        address addr;
        uint256 decimals;
        string name;
        address pool;
        string symbol;
        string token;
    }

    function _processor(FundryFactory factory) internal {
        address existing = vm.envOr("PROCESSOR", address(0));
        if (existing != address(0)) {
            factory.useProcessor(existing);
        } else {
            factory.setUpProcessor(
                vm.envOr("TRANSISTOR_SUPPLY", uint256(1_000_000)),
                vm.envOr("MINT_PRICE", uint256(1e3)),
                "Fundry: every fund's rulebook is a chip. Launch a stock fund on X Layer whose rules nobody can change."
            );
        }
    }

    function run() external {
        string memory cfg = vm.readFile("../deployments/assets.json");
        address usdg = vm.parseJsonAddress(cfg, ".usdg");
        uint256 n = vm.parseJsonUint(cfg, ".count");

        vm.startBroadcast();
        address me = msg.sender;
        address treasury = vm.envOr("TREASURY", me);
        address curator = vm.envOr("CURATOR", me);
        uint256 startBlock = block.number;

        FundryFactory factory = new FundryFactory(TAPEOUT, usdg, SWAP_ROUTER_02, treasury, curator);
        address bem = ITapeOutFactory(TAPEOUT).bem();
        IERC20Min(bem).approve(address(factory), type(uint256).max);
        _processor(factory);
        factory.restock(vm.envOr("RESTOCK_NAND", uint256(2_000)), vm.envOr("RESTOCK_LATCH", uint256(50)));
        IERC20Min(bem).approve(address(factory), 0);

        if (curator == me) {
            for (uint256 i; i < n; i++) {
                string memory k = string.concat(".assets[", vm.toString(i), "]");
                factory.listAsset(vm.parseJsonAddress(cfg, string.concat(k, ".address")), vm.parseJsonAddress(cfg, string.concat(k, ".pool")));
            }
        }
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "startBlock", startBlock);
        vm.serializeAddress(o, "usdg", usdg);
        vm.serializeAddress(o, "router", SWAP_ROUTER_02);
        vm.serializeAddress(o, "tapeout", TAPEOUT);
        vm.serializeAddress(o, "treasury", treasury);
        vm.serializeAddress(o, "transistors", address(factory.transistors()));
        vm.serializeAddress(o, "circuits", address(factory.circuits()));
        string memory out = vm.serializeAddress(o, "factory", address(factory));
        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console2.log("FundryFactory", address(factory));
        console2.log("Circuits", address(factory.circuits()));
        console2.log("listed", factory.listedCount());
    }
}
