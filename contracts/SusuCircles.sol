// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SusuCircles — rotating savings groups with the rotation enforced onchain.
/// @notice A circle is a group that contributes a fixed amount each round. The payout
///         order is locked when the circle starts, and the contract pays whoever is next
///         in that order. Nobody can jump the queue, including the circle's owner.
///
///         Members authorise contributions by SIGNING, never by sending a transaction, so
///         a member needs no ETH and never handles a wallet. Anyone may relay a signed
///         note and pay the gas.
///
///         Test money on a test network. Not audited.
contract SusuCircles {
    string public constant name = "Susu Demo Cedi";
    string public constant symbol = "GHSx";
    uint8 public constant decimals = 2; // pesewas, so 2000 == GHS 20.00

    address public immutable operator;
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 private constant CONTRIBUTE_TYPEHASH =
        keccak256("Contribute(uint256 circleId,address member,uint256 amount,uint256 round,uint256 nonce)");

    struct Circle {
        string label;
        address owner;
        uint64 contributionAmount;
        uint64 roundLength; // seconds a round stays open
        uint32 size; // how many members the owner expects
        uint32 currentRound;
        uint64 roundStartedAt;
        uint128 pot; // this round's pot, plus anything rolled over
        bool started;
        bool finished;
    }

    Circle[] private _circles;

    // circleId => ordered members. Locked once the circle starts.
    mapping(uint256 => address[]) private _order;
    mapping(uint256 => mapping(address => bool)) public isMemberOf;
    // How many rounds this member has paid. Eligible when it equals currentRound + 1.
    mapping(uint256 => mapping(address => uint32)) public paidCount;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public paidInRound;
    mapping(uint256 => mapping(address => bool)) public hasReceived;
    mapping(uint256 => mapping(address => uint32)) public missedTurns;
    // Where to resume the search for the next recipient.
    mapping(uint256 => uint32) public payoutCursor;
    // keccak256(join code) => circleId + 1. Storing the hash keeps codes off the public record.
    mapping(bytes32 => uint256) private _circleByCode;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public nonces;
    mapping(address => string) public handleOf;

    event CircleCreated(uint256 indexed circleId, string label, address indexed owner, uint64 amount, uint32 size);
    event Joined(uint256 indexed circleId, address indexed member, string handle, uint32 position);
    event Started(uint256 indexed circleId, uint256 memberCount, uint64 startedAt);
    event Contributed(uint256 indexed circleId, address indexed member, string handle, uint256 amount, uint32 round);
    event RoundSettled(uint256 indexed circleId, uint32 round, address indexed paidTo, string handle, uint256 amount);
    event TurnMissed(uint256 indexed circleId, uint32 round, address indexed member, string handle);
    event RoundStalled(uint256 indexed circleId, uint32 round, uint256 potRolledOver);
    event CircleFinished(uint256 indexed circleId);
    event Credited(address indexed member, uint256 amount, string providerRef);

    error NotOperator();
    error NotOwner();
    error BadSignature();
    error InsufficientBalance();
    error UnknownCircle();
    error CodeTaken();
    error AlreadyMember();
    error NotAMember();
    error CircleFull();
    error AlreadyStarted();
    error NotStarted();
    error AlreadyFinished();
    error WrongAmount();
    error AlreadyPaidThisRound();
    error RoundStillOpen();
    error TooFewMembers();
    error UnknownRound();

    constructor() {
        operator = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("SusuCircles")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier exists(uint256 circleId) {
        if (circleId >= _circles.length) revert UnknownCircle();
        _;
    }

    // ------------------------------------------------------------------ setup

    /// @notice Opens a circle. The join code is stored only as a hash, so codes cannot be
    ///         harvested by reading the chain.
    function createCircle(
        string calldata label,
        bytes32 codeHash,
        address owner,
        uint64 contributionAmount,
        uint64 roundLength,
        uint32 size
    ) external onlyOperator returns (uint256 circleId) {
        if (_circleByCode[codeHash] != 0) revert CodeTaken();
        if (size < 2) revert TooFewMembers();

        _circles.push(
            Circle({
                label: label,
                owner: owner,
                contributionAmount: contributionAmount,
                roundLength: roundLength,
                size: size,
                currentRound: 0,
                roundStartedAt: 0,
                pot: 0,
                started: false,
                finished: false
            })
        );

        circleId = _circles.length - 1;
        _circleByCode[codeHash] = circleId + 1;
        emit CircleCreated(circleId, label, owner, contributionAmount, size);
    }

    /// @notice Adds a member using the join code. Position in the queue is join order.
    function joinCircle(bytes32 codeHash, address member, string calldata handle)
        external
        onlyOperator
        returns (uint256 circleId)
    {
        uint256 slot = _circleByCode[codeHash];
        if (slot == 0) revert UnknownCircle();
        circleId = slot - 1;

        Circle storage c = _circles[circleId];
        if (c.started) revert AlreadyStarted();
        if (isMemberOf[circleId][member]) revert AlreadyMember();
        if (_order[circleId].length >= c.size) revert CircleFull();

        isMemberOf[circleId][member] = true;
        _order[circleId].push(member);
        handleOf[member] = handle;

        emit Joined(circleId, member, handle, uint32(_order[circleId].length - 1));
    }

    /// @notice Locks the order and opens round 0. After this nobody can be added or reordered.
    function startCircle(uint256 circleId) external exists(circleId) {
        Circle storage c = _circles[circleId];
        if (msg.sender != operator && msg.sender != c.owner) revert NotOwner();
        if (c.started) revert AlreadyStarted();
        if (_order[circleId].length < 2) revert TooFewMembers();

        c.started = true;
        c.roundStartedAt = uint64(block.timestamp);
        emit Started(circleId, _order[circleId].length, c.roundStartedAt);
    }

    // ------------------------------------------------------- money in the door

    /// @notice Credits a member's balance. Stands in for a confirmed mobile money deposit.
    /// @dev providerRef is the payment provider's transaction id, kept for reconciliation.
    function credit(address member, uint256 amount, string calldata providerRef) external onlyOperator {
        balanceOf[member] += amount;
        emit Credited(member, amount, providerRef);
    }

    // --------------------------------------------------------- contributing

    /// @notice Records a contribution from a member's signature alone.
    /// @dev Callable by anyone. The signature is the authorisation; the sender only pays gas.
    ///      `round` may be the current round or any earlier one the member still owes, so
    ///      somebody who fell behind can pay their arrears and become eligible again.
    function contributeWithSig(
        uint256 circleId,
        address member,
        uint256 amount,
        uint256 round,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external exists(circleId) {
        Circle storage c = _circles[circleId];
        if (!c.started) revert NotStarted();
        if (c.finished) revert AlreadyFinished();
        if (!isMemberOf[circleId][member]) revert NotAMember();
        if (amount != c.contributionAmount) revert WrongAmount();
        if (round > c.currentRound) revert UnknownRound();
        if (paidInRound[circleId][round][member]) revert AlreadyPaidThisRound();

        _requireSignature(circleId, member, amount, round, v, r, s);
        if (balanceOf[member] < amount) revert InsufficientBalance();

        unchecked {
            nonces[member]++;
            paidCount[circleId][member]++;
        }
        paidInRound[circleId][round][member] = true;
        balanceOf[member] -= amount;
        c.pot += uint128(amount);

        emit Contributed(circleId, member, handleOf[member], amount, uint32(round));
    }

    /// @dev Split out so `contributeWithSig` keeps few enough locals alive to compile.
    function _requireSignature(
        uint256 circleId,
        address member,
        uint256 amount,
        uint256 round,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private view {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(CONTRIBUTE_TYPEHASH, circleId, member, amount, round, nonces[member]))
            )
        );
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != member) revert BadSignature();
    }

    /// @notice How many past rounds this member still owes.
    function arrearsOf(uint256 circleId, address member) external view exists(circleId) returns (uint32) {
        Circle storage c = _circles[circleId];
        uint32 due = c.currentRound + 1;
        uint32 paid = paidCount[circleId][member];
        return paid >= due ? 0 : due - paid;
    }

    // -------------------------------------------------------------- rotation

    /// @notice Pays this round's pot to whoever is next in the locked order and eligible.
    /// @dev Callable by anyone once every member has paid, or once the round deadline passes.
    ///      A member who has not kept up forfeits this turn and is passed over; the next
    ///      eligible member in the order takes it. This is the rule that penalises default.
    function settleRound(uint256 circleId) external exists(circleId) {
        Circle storage c = _circles[circleId];
        if (!c.started) revert NotStarted();
        if (c.finished) revert AlreadyFinished();

        address[] storage order = _order[circleId];
        uint256 n = order.length;

        if (!_everyonePaid(circleId, c.currentRound, order)) {
            if (block.timestamp < c.roundStartedAt + c.roundLength) revert RoundStillOpen();
        }

        uint32 round = c.currentRound;
        uint32 required = round + 1;
        address recipient = address(0);
        uint32 foundAt;

        for (uint256 i = 0; i < n; i++) {
            uint32 idx = uint32((payoutCursor[circleId] + i) % n);
            address candidate = order[idx];
            if (hasReceived[circleId][candidate]) continue;

            if (paidCount[circleId][candidate] < required) {
                missedTurns[circleId][candidate] += 1;
                emit TurnMissed(circleId, round, candidate, handleOf[candidate]);
                continue;
            }
            recipient = candidate;
            foundAt = idx;
            break;
        }

        if (recipient == address(0)) {
            // Nobody is eligible. The pot rolls into the next round rather than being stuck.
            emit RoundStalled(circleId, round, c.pot);
        } else {
            uint256 amount = c.pot;
            c.pot = 0;
            hasReceived[circleId][recipient] = true;
            payoutCursor[circleId] = uint32((foundAt + 1) % n);
            balanceOf[recipient] += amount;
            emit RoundSettled(circleId, round, recipient, handleOf[recipient], amount);
        }

        c.currentRound = round + 1;
        c.roundStartedAt = uint64(block.timestamp);

        if (c.currentRound >= n) {
            c.finished = true;
            emit CircleFinished(circleId);
        }
    }

    function _everyonePaid(uint256 circleId, uint32 round, address[] storage order) private view returns (bool) {
        for (uint256 i = 0; i < order.length; i++) {
            if (!paidInRound[circleId][round][order[i]]) return false;
        }
        return true;
    }

    // ------------------------------------------------------------------ views

    function circleCount() external view returns (uint256) {
        return _circles.length;
    }

    function circleByCode(bytes32 codeHash) external view returns (bool found, uint256 circleId) {
        uint256 slot = _circleByCode[codeHash];
        return (slot != 0, slot == 0 ? 0 : slot - 1);
    }

    function orderOf(uint256 circleId) external view exists(circleId) returns (address[] memory) {
        return _order[circleId];
    }

    /// @notice Whose turn it is right now, and whether they are currently eligible to take it.
    function nextInLine(uint256 circleId) external view exists(circleId) returns (address who, bool eligible) {
        Circle storage c = _circles[circleId];
        address[] storage order = _order[circleId];
        uint256 n = order.length;
        if (n == 0 || c.finished) return (address(0), false);

        for (uint256 i = 0; i < n; i++) {
            address candidate = order[(payoutCursor[circleId] + i) % n];
            if (hasReceived[circleId][candidate]) continue;
            return (candidate, paidCount[circleId][candidate] >= c.currentRound + 1);
        }
        return (address(0), false);
    }

    function circleInfo(uint256 circleId)
        external
        view
        exists(circleId)
        returns (Circle memory circle, uint256 joined, uint64 roundEndsAt)
    {
        Circle storage c = _circles[circleId];
        return (c, _order[circleId].length, c.roundStartedAt + c.roundLength);
    }

    /// @notice Everything the front end needs about one circle's members, in one call.
    function membersOf(uint256 circleId)
        external
        view
        exists(circleId)
        returns (
            address[] memory addrs,
            string[] memory handles,
            uint256[] memory balances,
            uint32[] memory paid,
            bool[] memory received,
            bool[] memory paidThisRound
        )
    {
        address[] storage order = _order[circleId];
        uint256 n = order.length;
        uint32 round = _circles[circleId].currentRound;

        addrs = new address[](n);
        handles = new string[](n);
        balances = new uint256[](n);
        paid = new uint32[](n);
        received = new bool[](n);
        paidThisRound = new bool[](n);

        for (uint256 i = 0; i < n; i++) {
            address m = order[i];
            addrs[i] = m;
            handles[i] = handleOf[m];
            balances[i] = balanceOf[m];
            paid[i] = paidCount[circleId][m];
            received[i] = hasReceived[circleId][m];
            paidThisRound[i] = paidInRound[circleId][round][m];
        }
    }
}
