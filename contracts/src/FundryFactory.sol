// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibClone} from "solady/utils/LibClone.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {Fund} from "./Fund.sol";
import {ITapeOutFactory, ITransistors, ICircuits} from "./interfaces/ITapeOut.sol";

/// @title FundryFactory
/// @notice Launches Fundry funds. Every fund's rulebook is taped out on the Fundry TapeOut
///         processor (burning Fundry transistors), and the circuit NFT goes to the fund's creator.
///         A launch is one transaction.
///
///         Forks: a fund can be launched as a fork of another Fundry fund. Its netlist must hold
///         exactly one REF record, to the parent fund's chip, wired to this fund's own price
///         signals. The parent's gates are reused (not burned again), and the fork pays the parent
///         chip's holder a royalty out of its fee. The factory checks the REF and records the
///         family tree on chain.
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
    mapping(uint256 circuitId => address fund) public fundOfCircuit;
    mapping(address fund => address parent) public parentOf;
    mapping(address fund => address[]) internal _children;

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
        address parent; // a Fundry fund to fork (its chip must be REF'd by `netlist`), or 0
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
        string rulebook,
        address parent
    );

    error NotCurator();
    error AlreadySetUp();
    error NotSetUp();
    error NotListed(address asset);
    error BadNetlist();
    error BadParams();
    error BadFork();

    constructor(address tapeout_, address usdg_, address router_, address treasury_, address curator_) {
        tapeout = ITapeOutFactory(tapeout_);
        usdg = usdg_;
        router = router_;
        treasury = treasury_;
        curator = curator_;
        fundImpl = address(new Fund());
    }

    // ---- one-time processor setup ---------------------------------------------------------

    /// Use an existing processor (the curator picks it once). Transistors are bought on it with
    /// `restock`, which anyone can call; transistor sales go to that processor's creator.
    function useProcessor(address circuits_) external {
        if (msg.sender != curator) revert NotCurator();
        if (address(circuits) != address(0)) revert AlreadySetUp();
        if (!tapeout.isCPU(circuits_)) revert BadParams();
        circuits = ICircuits(circuits_);
        transistors = ITransistors(circuits.transistors());
        emit ProcessorCreated(address(transistors), circuits_);
    }

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

    /// Funds launched as forks of `fund`, oldest first.
    function childrenOf(address fund) external view returns (address[] memory) {
        return _children[fund];
    }

    // ---- launch ----------------------------------------------------------------------------

    struct Ref {
        address cpu;
        uint256 id;
        uint256 nIns;
        uint256 nOuts;
        bool identityWired; // input k of the REF is this circuit's input k, for every k
    }

    /// Count top-level NAND and LATCH records (the transistors a tape-out burns) and read REFs.
    function scan(bytes calldata nl) public pure returns (uint256 nands, uint256 latches, Ref[] memory refs) {
        uint256 p;
        uint256 nRefs;
        // first pass: count REFs so the array can be sized
        while (p < nl.length) {
            uint8 op = uint8(nl[p]);
            if (op == 0) p += 7;
            else if (op == 1) p += 4;
            else if (op == 2) {
                if (p + 31 > nl.length) revert BadNetlist();
                nRefs++;
                p += 31 + 3 * uint8(nl[p + 29]);
            } else revert BadNetlist();
        }
        if (p != nl.length) revert BadNetlist();
        refs = new Ref[](nRefs);
        p = 0;
        uint256 r;
        while (p < nl.length) {
            uint8 op = uint8(nl[p]);
            if (op == 0) {
                nands++;
                p += 7;
            } else if (op == 1) {
                latches++;
                p += 4;
            } else {
                Ref memory x;
                x.cpu = address(bytes20(nl[p + 1:p + 21]));
                x.id = uint64(bytes8(nl[p + 21:p + 29]));
                x.nIns = uint8(nl[p + 29]);
                x.nOuts = uint8(nl[p + 30]);
                x.identityWired = true;
                for (uint256 k; k < x.nIns; k++) {
                    uint256 q = p + 31 + 3 * k;
                    uint256 sig = (uint256(uint8(nl[q])) << 16) | (uint256(uint8(nl[q + 1])) << 8) | uint8(nl[q + 2]);
                    if (sig != 2 + k) x.identityWired = false;
                }
                refs[r++] = x;
                p += 31 + 3 * x.nIns;
            }
        }
    }

    /// A fork must hold the same stocks in the same order as its parent, and exactly one REF, to
    /// the parent's chip, fed with this fund's own price signals. A non-fork may hold no REF.
    function _checkFork(Launch calldata l, Ref[] memory refs) internal view returns (uint256 parentCircuitId) {
        if (l.parent == address(0)) {
            if (refs.length != 0) revert BadFork();
            return 0;
        }
        uint256 n = l.assets.length;
        if (!isFund[l.parent]) revert BadFork();
        address[] memory pa = Fund(l.parent).assets();
        if (pa.length != n) revert BadFork();
        for (uint256 i; i < n; i++) if (pa[i] != l.assets[i]) revert BadFork();
        parentCircuitId = Fund(l.parent).circuitId();
        if (
            refs.length != 1 || refs[0].cpu != address(circuits) || refs[0].id != parentCircuitId
                || refs[0].nIns != 3 * n || refs[0].nOuts != 2 * n || !refs[0].identityWired
        ) revert BadFork();
    }

    function _record(Launch calldata l, address fund, uint256 circuitId, uint256 gates) internal {
        address parent = l.parent;
        funds.push(fund);
        isFund[fund] = true;
        fundOfCircuit[circuitId] = fund;
        if (parent != address(0)) {
            parentOf[fund] = parent;
            _children[parent].push(fund);
        }
        emit FundLaunched(fund, msg.sender, circuitId, l.assets, gates, l.name, l.rulebook, parent);
    }

    /// Tape out the rulebook and open the fund, in one transaction.
    /// msg.value must equal the TapeOut tape-out fee (paid in OKB).
    function launch(Launch calldata l) external payable nonReentrant returns (address fund, uint256 circuitId) {
        if (address(circuits) == address(0)) revert NotSetUp();
        uint256 n = l.assets.length;
        if (n == 0 || n > 4 || l.feeBps > MAX_FEE_BPS || bytes(l.name).length == 0) revert BadParams();

        address[] memory pools = _poolsOf(l.assets);
        uint256 gates;
        uint256 parentCircuitId;
        {
            (uint256 nands, uint256 latches, Ref[] memory refs) = scan(l.netlist);
            parentCircuitId = _checkFork(l, refs);
            // transistors come from this contract's stock; tapeout burns them (REF'd gates are not burned again)
            if (transistors.balanceOf(address(this), NAND) < nands || transistors.balanceOf(address(this), LATCH) < latches)
            {
                revert BadParams();
            }
            gates = nands + latches;
        }
        circuitId = circuits.tapeout{value: msg.value}(l.netlist, uint32(3 * n), uint32(2 * n));
        // the creator owns their fund's chip
        circuits.transferFrom(address(this), msg.sender, circuitId);

        fund = _open(l, circuitId, parentCircuitId, pools);
        _record(l, fund, circuitId, gates);
    }

    function _poolsOf(address[] calldata assets_) internal view returns (address[] memory pools) {
        pools = new address[](assets_.length);
        for (uint256 i; i < assets_.length; i++) {
            pools[i] = poolOf[assets_[i]];
            if (pools[i] == address(0)) revert NotListed(assets_[i]);
        }
    }

    function _open(Launch calldata l, uint256 circuitId, uint256 parentCircuitId, address[] memory pools)
        internal
        returns (address fund)
    {
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
                tvlCap: l.tvlCap,
                parent: l.parent,
                parentCircuits: l.parent == address(0) ? address(0) : address(circuits),
                parentCircuitId: parentCircuitId
            })
        );
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
