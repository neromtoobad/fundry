// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Minimal TapeOut protocol interfaces on X Layer (chain 196).
/// Since Nov 8 2026, new processors take BEM for the deploy fee, mint price and per-mint protocol fee.
interface ITapeOutFactory {
    function createCPU(string calldata name, string calldata symbol, string calldata story, uint256 transistorSupply, uint256 mintPrice)
        external
        payable
        returns (address transistors, address circuits);
    function deployFee() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function bem() external view returns (address);
    function isCPU(address) external view returns (bool);
}

interface ITransistors {
    function mint(uint256 id, uint256 amount) external payable;
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function supplyCap() external view returns (uint256);
    function minted() external view returns (uint256);
    function creator() external view returns (address);
    function owed(address) external view returns (uint256);
    function withdraw() external;
    function balanceOf(address, uint256) external view returns (uint256);
}

interface ICircuits {
    function tapeout(bytes calldata nl, uint32 nIn, uint32 nOut) external payable returns (uint256);
    function TAPEOUT_FEE() external view returns (uint256);
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    function step(uint256 id, bytes calldata state, bytes calldata inputs)
        external
        view
        returns (bytes memory newState, bytes memory outputs);
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function netlist(uint256 id) external view returns (bytes memory);
    function ownerOf(uint256 id) external view returns (address);
    function transistors() external view returns (address);
    function transferFrom(address from, address to, uint256 id) external;
}
