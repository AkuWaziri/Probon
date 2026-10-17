// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Probon
/// @notice Owner-funded payment mandates for AI agents on Arc Mainnet.
/// @dev Arc native USDC is the native currency and uses 18 decimals. This contract uses native-value transfers.
contract Probon {
    uint256 public constant MAX_RECIPIENTS = 50;
    uint256 public constant MIN_EXPIRY = 1 hours;
    uint256 public constant MAX_EXPIRY = 365 days;

    address public owner;
    bool public paused;
    uint256 public nextMandateId = 1;
    uint256 private _entered = 1;

    struct Mandate {
        address owner;
        address agent;
        uint128 maxPerTx;
        uint128 dailyLimit;
        uint64 expiresAt;
        uint128 balance;
        uint128 totalSpent;
        bool active;
    }

    mapping(uint256 => Mandate) private _mandates;
    mapping(uint256 => mapping(address => bool)) public recipientAllowed;
    mapping(uint256 => mapping(uint256 => uint256)) public dailySpent;

    event MandateCreated(uint256 indexed mandateId, address indexed owner, address indexed agent, uint256 maxPerTx, uint256 dailyLimit, uint64 expiresAt, uint256 initialFunding);
    event MandateFunded(uint256 indexed mandateId, address indexed funder, uint256 amount);
    event PaymentExecuted(uint256 indexed mandateId, address indexed agent, address indexed recipient, uint256 amount, uint256 day);
    event MandateRevoked(uint256 indexed mandateId, uint256 refunded);
    event PauseChanged(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error Unauthorized();
    error InvalidAddress();
    error InvalidMandate();
    error InvalidPolicy();
    error InvalidRecipients();
    error RecipientNotAllowed();
    error MandateInactive();
    error MandateExpired();
    error SpendingLimitExceeded();
    error InsufficientMandateBalance();
    error TransferFailed();
    error ContractPaused();
    error ReentrantCall();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered != 1) revert ReentrantCall();
        _entered = 2;
        _;
        _entered = 1;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function createMandate(
        address agent,
        address[] calldata recipients,
        uint128 maxPerTx,
        uint128 dailyLimit,
        uint64 expiresAt
    ) external payable onlyOwner returns (uint256 mandateId) {
        if (agent == address(0) || agent == msg.sender) revert InvalidAddress();
        if (recipients.length == 0 || recipients.length > MAX_RECIPIENTS) revert InvalidRecipients();
        if (maxPerTx == 0 || dailyLimit < maxPerTx || expiresAt < block.timestamp + MIN_EXPIRY || expiresAt > block.timestamp + MAX_EXPIRY) revert InvalidPolicy();
        if (msg.value > type(uint128).max) revert InvalidPolicy();

        mandateId = nextMandateId++;
        _mandates[mandateId] = Mandate({
            owner: msg.sender,
            agent: agent,
            maxPerTx: maxPerTx,
            dailyLimit: dailyLimit,
            expiresAt: expiresAt,
            balance: uint128(msg.value),
            totalSpent: 0,
            active: true
        });

        for (uint256 i; i < recipients.length; ++i) {
            address recipient = recipients[i];
            if (recipient == address(0) || recipient == msg.sender || recipient == agent || recipientAllowed[mandateId][recipient]) revert InvalidRecipients();
            recipientAllowed[mandateId][recipient] = true;
        }

        emit MandateCreated(mandateId, msg.sender, agent, maxPerTx, dailyLimit, expiresAt, msg.value);
        if (msg.value > 0) emit MandateFunded(mandateId, msg.sender, msg.value);
    }

    function fundMandate(uint256 mandateId) external payable onlyOwner {
        Mandate storage m = _getMandate(mandateId);
        if (!m.active || block.timestamp >= m.expiresAt) revert MandateInactive();
        if (msg.value == 0 || uint256(m.balance) + msg.value > type(uint128).max) revert InvalidPolicy();
        m.balance += uint128(msg.value);
        emit MandateFunded(mandateId, msg.sender, msg.value);
    }

    function executePayment(uint256 mandateId, address payable recipient, uint128 amount) external nonReentrant {
        if (paused) revert ContractPaused();
        Mandate storage m = _getMandate(mandateId);
        if (!m.active) revert MandateInactive();
        if (block.timestamp >= m.expiresAt) revert MandateExpired();
        if (msg.sender != m.agent) revert Unauthorized();
        if (recipient == address(0) || !recipientAllowed[mandateId][recipient]) revert RecipientNotAllowed();
        if (amount == 0 || amount > m.maxPerTx) revert SpendingLimitExceeded();

        uint256 day = block.timestamp / 1 days;
        uint256 newDailySpend = dailySpent[mandateId][day] + amount;
        if (newDailySpend > m.dailyLimit) revert SpendingLimitExceeded();
        if (amount > m.balance) revert InsufficientMandateBalance();

        dailySpent[mandateId][day] = newDailySpend;
        m.balance -= amount;
        m.totalSpent += amount;

        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit PaymentExecuted(mandateId, msg.sender, recipient, amount, day);
    }

    function revokeMandate(uint256 mandateId) external nonReentrant {
        Mandate storage m = _getMandate(mandateId);
        if (msg.sender != m.owner) revert Unauthorized();
        if (!m.active) revert MandateInactive();
        m.active = false;
        uint256 refund = m.balance;
        m.balance = 0;
        if (refund > 0) {
            (bool success,) = payable(m.owner).call{value: refund}("");
            if (!success) revert TransferFailed();
        }
        emit MandateRevoked(mandateId, refund);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PauseChanged(value);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function getMandate(uint256 mandateId) external view returns (Mandate memory) {
        return _getMandate(mandateId);
    }

    function getMandatePolicy(uint256 mandateId) external view returns (
        address mandateOwner,
        address agent,
        uint128 maxPerTx,
        uint128 dailyLimit,
        uint64 expiresAt,
        uint128 balance,
        uint128 totalSpent,
        bool active
    ) {
        Mandate storage m = _getMandate(mandateId);
        return (m.owner, m.agent, m.maxPerTx, m.dailyLimit, m.expiresAt, m.balance, m.totalSpent, m.active);
    }

    function _getMandate(uint256 mandateId) private view returns (Mandate storage m) {
        m = _mandates[mandateId];
        if (m.owner == address(0)) revert InvalidMandate();
    }

    receive() external payable {
        revert InvalidPolicy();
    }
}
