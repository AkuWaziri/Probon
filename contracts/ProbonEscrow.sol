// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ProbonEscrow
/// @notice ERC-20 USDC escrow for Probon creator campaigns on Base.
/// @dev The creator must approve this contract for budget + the 5% platform fee before creation.
contract ProbonEscrow {
    uint256 public constant PLATFORM_FEE_BPS = 500;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IERC20Minimal public immutable usdc;
    address public immutable feeRecipient;
    uint256 public nextCampaignId = 1;
    uint256 private unlocked = 1;

    enum ParticipationStatus { None, Joined, Submitted, Paid, Rejected }

    struct Campaign {
        address creator;
        uint256 budget;
        uint256 remainingBudget;
        uint256 rewardPerParticipant;
        uint256 slots;
        uint256 joinedCount;
        uint256 finalizedCount;
        uint64 deadline;
        bool refundClaimed;
    }

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => ParticipationStatus)) public participationStatus;
    mapping(uint256 => mapping(address => string)) public submissionUrl;

    event CampaignCreated(uint256 indexed campaignId, address indexed creator, uint256 budget, uint256 platformFee, uint256 rewardPerParticipant, uint256 slots, uint64 deadline);
    event ParticipantJoined(uint256 indexed campaignId, address indexed participant);
    event SubmissionRecorded(uint256 indexed campaignId, address indexed participant, string url);
    event ParticipantPaid(uint256 indexed campaignId, address indexed participant, uint256 amount);
    event SubmissionRejected(uint256 indexed campaignId, address indexed participant);
    event CampaignRefunded(uint256 indexed campaignId, address indexed creator, uint256 amount);

    error ZeroAddress();
    error InvalidCampaign();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidSlots();
    error IncorrectFunding(uint256 expected, uint256 received);
    error NotCampaignCreator();
    error CampaignClosed();
    error CampaignFull();
    error CreatorCannotJoin();
    error AlreadyParticipated();
    error InvalidParticipationState();
    error EmptySubmission();
    error DeadlineNotPassed();
    error ParticipantsNotFinalized();
    error RefundAlreadyClaimed();
    error TransferFailed();
    error ReentrantCall();

    constructor(address usdc_, address feeRecipient_) {
        if (usdc_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        usdc = IERC20Minimal(usdc_);
        feeRecipient = feeRecipient_;
    }

    modifier nonReentrant() {
        if (unlocked != 1) revert ReentrantCall();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    function createCampaign(uint256 budget, uint256 rewardPerParticipant, uint256 slots, uint64 deadline)
        external returns (uint256 campaignId)
    {
        if (budget == 0 || rewardPerParticipant == 0) revert InvalidAmount();
        if (slots == 0) revert InvalidSlots();
        if (rewardPerParticipant > budget / slots) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        uint256 fee = budget * PLATFORM_FEE_BPS / BPS_DENOMINATOR;
        uint256 expected = budget + fee;
        uint256 beforeBalance = usdc.balanceOf(address(this));
        if (!usdc.transferFrom(msg.sender, address(this), expected)) revert TransferFailed();
        uint256 received = usdc.balanceOf(address(this)) - beforeBalance;
        if (received != expected) revert IncorrectFunding(expected, received);

        campaignId = nextCampaignId++;
        campaigns[campaignId] = Campaign({
            creator: msg.sender,
            budget: budget,
            remainingBudget: budget,
            rewardPerParticipant: rewardPerParticipant,
            slots: slots,
            joinedCount: 0,
            finalizedCount: 0,
            deadline: deadline,
            refundClaimed: false
        });

        if (!usdc.transfer(feeRecipient, fee)) revert TransferFailed();
        emit CampaignCreated(campaignId, msg.sender, budget, fee, rewardPerParticipant, slots, deadline);
    }

    function joinCampaign(uint256 campaignId) external {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert InvalidCampaign();
        if (block.timestamp >= c.deadline || c.refundClaimed) revert CampaignClosed();
        if (msg.sender == c.creator) revert CreatorCannotJoin();
        if (c.joinedCount >= c.slots) revert CampaignFull();
        if (participationStatus[campaignId][msg.sender] != ParticipationStatus.None) revert AlreadyParticipated();
        participationStatus[campaignId][msg.sender] = ParticipationStatus.Joined;
        c.joinedCount += 1;
        emit ParticipantJoined(campaignId, msg.sender);
    }

    function submitWork(uint256 campaignId, string calldata url) external {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert InvalidCampaign();
        if (block.timestamp >= c.deadline || c.refundClaimed) revert CampaignClosed();
        if (bytes(url).length == 0) revert EmptySubmission();
        if (participationStatus[campaignId][msg.sender] != ParticipationStatus.Joined) revert InvalidParticipationState();
        participationStatus[campaignId][msg.sender] = ParticipationStatus.Submitted;
        submissionUrl[campaignId][msg.sender] = url;
        emit SubmissionRecorded(campaignId, msg.sender, url);
    }

    function approveSubmission(uint256 campaignId, address participant) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert InvalidCampaign();
        if (msg.sender != c.creator) revert NotCampaignCreator();
        if (participationStatus[campaignId][participant] != ParticipationStatus.Submitted) revert InvalidParticipationState();
        _finalizeAndPay(campaignId, participant, c);
    }

    function rejectSubmission(uint256 campaignId, address participant) external {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert InvalidCampaign();
        if (msg.sender != c.creator) revert NotCampaignCreator();
        ParticipationStatus status = participationStatus[campaignId][participant];
        if (status == ParticipationStatus.Submitted) {
            // Submitted work may be rejected after review, before or after the deadline.
        } else if (status == ParticipationStatus.Joined) {
            if (block.timestamp < c.deadline) revert DeadlineNotPassed();
        } else {
            revert InvalidParticipationState();
        }
        participationStatus[campaignId][participant] = ParticipationStatus.Rejected;
        c.finalizedCount += 1;
        emit SubmissionRejected(campaignId, participant);
    }

    function refundRemainingBudget(uint256 campaignId) external nonReentrant {
        Campaign storage c = campaigns[campaignId];
        if (c.creator == address(0)) revert InvalidCampaign();
        if (msg.sender != c.creator) revert NotCampaignCreator();
        if (block.timestamp < c.deadline) revert DeadlineNotPassed();
        if (c.refundClaimed) revert RefundAlreadyClaimed();
        if (c.finalizedCount != c.joinedCount) revert ParticipantsNotFinalized();

        c.refundClaimed = true;
        uint256 amount = c.remainingBudget;
        c.remainingBudget = 0;
        emit CampaignRefunded(campaignId, c.creator, amount);
        if (amount > 0 && !usdc.transfer(c.creator, amount)) revert TransferFailed();
    }

    function _finalizeAndPay(uint256 campaignId, address participant, Campaign storage c) private {
        participationStatus[campaignId][participant] = ParticipationStatus.Paid;
        c.finalizedCount += 1;
        uint256 amount = c.rewardPerParticipant;
        if (c.remainingBudget < amount) revert InvalidAmount();
        c.remainingBudget -= amount;
        emit ParticipantPaid(campaignId, participant, amount);
        if (!usdc.transfer(participant, amount)) revert TransferFailed();
    }
}

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
