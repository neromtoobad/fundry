// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibClone} from "solady/utils/LibClone.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {Fund} from "./Fund.sol";
import {ITapeOutFactory, ITransistors, ICircuits} from "./interfaces/ITapeOut.sol";

/// @title FundryFactory
/// @notice Launches Fundry funds. It is the creator of the Fundry TapeOut processor: every
///         fund's rulebook is taped out on that processor (burning Fundry transistors), and the
///         circuit NFT goes to the fund's creator. A launch is one transaction.
/// @dev Trust model: the `curator` can only add stocks to the list that new funds may hold
///      (each with its USDG pool) and hand the role on. It cannot touch any fund, any fund's
///      assets, any rulebook or any fee. Funds have no owner.
contract FundryFactory is ReentrancyGuard {
    using SafeTransferLib for address;

    uint256 public constant NAND = 0;
    uint256 public constant LATCH = 1;
    uint16 public constant MAX_FEE_BPS = 200;

    ITapeOutFactory public immutable tapeout;
    address public immutable usdg;
    address public immutable router;
    address public immutable treasury;
    address public immutable fundImpl;

    address public curator;
    ITransistors public transistors;
    ICircuits public circuits;

    mapping(address asset => address pool) public poolOf;
    address[] public listedAssets;

    address[] public funds;
    mapping(address fund => bool) public isFund;

    struct Launch {
        string name;
        string symbol;
        address[] assets;
        bytes netlist;
        uint16 dropBps;
        uint16 riseBps;
        uint16 stopBps;
        uint16 feeBps;
        uint32 period;
        uint256 tvlCap;
        string rulebook; // the rulebook JSON the circuit was compiled from (for the app to show and re-check)
    }

    event ProcessorCreated(address transistors, address circuits);
    event AssetListed(address indexed asset, address indexed pool);
    event CuratorChanged(address curator);
    event Restocked(uint256 nand, uint256 latch);
    event FundLaunched(
        address indexed fund,
        address indexed creator,
        uint256 indexed circuitId,
        address[] assets,
        uint256 gates,
        string name,
        string rulebook
    );

    error NotCurator();
    error AlreadySetUp();
    error NotSetUp();
    error NotListed(address asset);
    error BadNetlist();
    error BadParams();

    constructor(address tapeout_, address usdg_, address router_, address treasury_, address curator_) {
        tapeout = ITapeOutFactory(tapeout_);
        usdg = usdg_;
        router = router_;
        treasury = treasury_;
        curator = curator_;
        fundImpl = address(new Fund());
    }

    // ---- one-time processor setup (anyone can pay for it) ----------------------------------

    /// Create the Fundry processor. The caller pays the BEM deploy fee; this contract becomes
    /// the processor's creator, so transistor sales accrue to it and are swept to the treasury.
    function setUpProcessor(uint256 supply, uint256 mintPrice, string calldata story) external nonReentrant {
        if (address(circuits) != address(0)) revert AlreadySetUp();
        address bem = tapeout.bem();
        uint256 fee = tapeout.deployFee();
        bem.safeTransferFrom(msg.sender, address(this), fee);
        bem.safeApprove(address(tapeout), fee);
        (address tr, address cpu) = tapeout.createCPU("Fundry", "FNDRY", story, supply, mintPrice);
        transistors = ITransistors(tr);
        circuits = ICircuits(cpu);
        emit ProcessorCreated(tr, cpu);
    }

    /// Buy Fundry transistors for future launches. The caller pays in BEM
    /// (price x amount, of which this contract is paid back as creator, plus the protocol fee).
    function restock(uint256 nand, uint256 latch) external nonReentrant {
        if (address(transistors) == address(0)) revert NotSetUp();
        address bem = tapeout.bem();
        uint256 perTx = transistors.protocolFee();
        uint256 cost = transistors.mintPrice() * (nand + latch) + perTx * ((nand > 0 ? 1 : 0) + (latch > 0 ? 1 : 0));
        bem.safeTransferFrom(msg.sender, address(this), cost);
        bem.safeApprove(address(transistors), cost);
        if (nand > 0) transistors.mint(NAND, nand);
        if (latch > 0) transistors.mint(LATCH, latch);
        emit Restocked(nand, latch);
    }

    /// Send processor income (BEM owed to this contract as creator) to the treasury.
    function sweep() external nonReentrant {
        if (address(transistors) == address(0)) revert NotSetUp();
        if (transistors.owed(address(this)) > 0) transistors.withdraw();
        address bem = tapeout.bem();
        uint256 bal = SafeTransferLib.balanceOf(bem, address(this));
        if (bal > 0) bem.safeTransfer(treasury, bal);
    }

    // ---- curation (adds stocks only) -------------------------------------------------------

    function listAsset(address asset, address pool) external {
        if (msg.sender != curator) revert NotCurator();
        if (poolOf[asset] == address(0)) listedAssets.push(asset);
        poolOf[asset] = pool;
        emit AssetListed(asset, pool);
    }

    function setCurator(address next) external {
        if (msg.sender != curator) revert NotCurator();
        curator = next;
        emit CuratorChanged(next);
    }

    function listedCount() external view returns (uint256) {
        return listedAssets.length;
    }

    function fundCount() external view returns (uint256) {
        return funds.length;
    }

    function allFunds() external view returns (address[] memory) {
        return funds;
    }

    // ---- launch ----------------------------------------------------------------------------

    /// Count top-level NAND and LATCH records. REF is not accepted yet (rule parts come later).
    function countGates(bytes calldata nl) public pure returns (uint256 nands, uint256 latches) {
        uint256 p;
        while (p < nl.length) {
            uint8 op = uint8(nl[p]);
            if (op == 0) {
                nands++;
                p += 7;
            } else if (op == 1) {
                latches++;
                p += 4;
            } else {
                revert BadNetlist();
            }
        }
        if (p != nl.length) revert BadNetlist();
    }

    /// Tape out the rulebook and open the fund, in one transaction.
    /// msg.value must equal the TapeOut tape-out fee (paid in OKB).
    function launch(Launch calldata l) external payable nonReentrant returns (address fund, uint256 circuitId) {
        if (address(circuits) == address(0)) revert NotSetUp();
        uint256 n = l.assets.length;
        if (n == 0 || n > 4 || l.feeBps > MAX_FEE_BPS || bytes(l.name).length == 0) revert BadParams();
        address[] memory pools = new address[](n);
        for (uint256 i; i < n; i++) {
            pools[i] = poolOf[l.assets[i]];
            if (pools[i] == address(0)) revert NotListed(l.assets[i]);
        }

        (uint256 nands, uint256 latches) = countGates(l.netlist);
        // transistors come from this contract's stock; tapeout burns them
        if (transistors.balanceOf(address(this), NAND) < nands || transistors.balanceOf(address(this), LATCH) < latches)
        {
            revert BadParams();
        }
        circuitId = circuits.tapeout{value: msg.value}(l.netlist, uint32(3 * n), uint32(2 * n));
        // the creator owns their fund's chip
        circuits.transferFrom(address(this), msg.sender, circuitId);

        fund = LibClone.clone(fundImpl);
        Fund(fund).initialize(
            Fund.Config({
                name: l.name,
                symbol: l.symbol,
                creator: msg.sender,
                treasury: treasury,
                usdg: usdg,
                router: router,
                circuits: address(circuits),
                circuitId: circuitId,
                assets: l.assets,
                pools: pools,
                dropBps: l.dropBps,
                riseBps: l.riseBps,
                stopBps: l.stopBps,
                feeBps: l.feeBps,
                maxSlippageBps: 100,
                period: l.period,
                tvlCap: l.tvlCap
            })
        );
        funds.push(fund);
        isFund[fund] = true;
        emit FundLaunched(fund, msg.sender, circuitId, l.assets, nands + latches, l.name, l.rulebook);
    }

    // ERC1155 / ERC721 receivers: transistors arrive by safe transfer; circuit NFTs pass through.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
