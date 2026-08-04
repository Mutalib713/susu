// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Susu — a group contribution pot where members never touch crypto.
/// @notice Members hold a demo cedi balance and authorise contributions by SIGNING a
///         message, never by sending a transaction. A relayer submits the signed note
///         and pays the gas, so a member needs zero ETH and never sees a wallet.
///         Test money on a test network. Not audited.
contract Susu {
    string public constant name = "Susu Demo Cedi";
    string public constant symbol = "GHSx";
    uint8 public constant decimals = 2; // pesewas, so 5000 == GHS 50.00

    address public immutable operator;
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 private constant CONTRIBUTE_TYPEHASH =
        keccak256("Contribute(address member,uint256 amount,uint256 nonce)");

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public nonces;
    mapping(address => uint256) public contributed;
    mapping(address => string) public handleOf;
    mapping(address => bool) public isMember;

    address[] private _members;
    uint256 public pot;
    uint256 public roundsPaid;

    event Joined(address indexed member, string handle);
    event Contributed(address indexed member, string handle, uint256 amount, uint256 pot);
    event PaidOut(address indexed to, string handle, uint256 amount, uint256 round);

    error NotOperator();
    error BadSignature();
    error InsufficientBalance();
    error EmptyPot();

    constructor() {
        operator = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Susu")),
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

    /// @notice Opens an account for a new member and credits their starting demo balance.
    /// @dev Called by the relayer right after someone signs in with their email.
    function join(address member, string calldata handle, uint256 startingBalance) external onlyOperator {
        if (!isMember[member]) {
            isMember[member] = true;
            _members.push(member);
        }
        handleOf[member] = handle;
        balanceOf[member] += startingBalance;
        emit Joined(member, handle);
    }

    /// @notice Moves a member's contribution into the pot using only their signature.
    /// @dev Deliberately callable by anyone: the signature is the authorisation, so whoever
    ///      submits it is just paying postage. This is the gas abstraction.
    function contributeWithSig(address member, uint256 amount, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(CONTRIBUTE_TYPEHASH, member, amount, nonces[member]))
            )
        );
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != member) revert BadSignature();
        if (balanceOf[member] < amount) revert InsufficientBalance();

        unchecked {
            nonces[member]++;
        }
        balanceOf[member] -= amount;
        contributed[member] += amount;
        pot += amount;

        emit Contributed(member, handleOf[member], amount, pot);
    }

    /// @notice Hands the whole pot to whoever's turn it is this round.
    function payout(address to) external onlyOperator {
        uint256 amount = pot;
        if (amount == 0) revert EmptyPot();
        pot = 0;
        balanceOf[to] += amount;
        roundsPaid += 1;
        emit PaidOut(to, handleOf[to], amount, roundsPaid);
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function members() external view returns (address[] memory) {
        return _members;
    }

    /// @notice Everything the front end needs for the public ledger, in one call.
    function snapshot()
        external
        view
        returns (address[] memory addrs, string[] memory handles, uint256[] memory balances, uint256[] memory gave)
    {
        uint256 n = _members.length;
        addrs = new address[](n);
        handles = new string[](n);
        balances = new uint256[](n);
        gave = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            address m = _members[i];
            addrs[i] = m;
            handles[i] = handleOf[m];
            balances[i] = balanceOf[m];
            gave[i] = contributed[m];
        }
    }
}
