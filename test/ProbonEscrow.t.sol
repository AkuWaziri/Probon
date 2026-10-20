// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/ProbonEscrow.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata revertData) external;
}

contract ProbonEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant FEE = address(0xFEE);
    address private constant CREATOR = address(0xA11CE);
    address private constant ALICE = address(0xA1);
    address private constant BOB = address(0xB0B);
    ProbonEscrow private escrow;

    function setUp() public {
        escrow = new ProbonEscrow(FEE);
        vm.deal(CREATOR, 100 ether);
        vm.deal(ALICE, 10 ether);
        vm.deal(BOB, 10 ether);
    }

    function testCreateCampaignRoutesFivePercentFeeAndHoldsBudget() public {
        uint256 budget = 10 ether;
        uint256 fee = budget * 500 / 10_000;
        vm.prank(CREATOR);
        uint256 id = escrow.createCampaign{value: budget + fee}(budget, 1 ether, 5, uint64(block.timestamp + 1 days));
        require(id == 1, "wrong id");
        require(FEE.balance == fee, "fee not sent");
        require(address(escrow).balance == budget, "budget not escrowed");
        (address creator, uint256 storedBudget, uint256 remaining,,,,,,) = escrow.campaigns(id);
        require(creator == CREATOR && storedBudget == budget && remaining == budget, "campaign mismatch");
    }

    function testIncorrectFundingReverts() public {
        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(ProbonEscrow.IncorrectFunding.selector, 10.5 ether, 10 ether));
        escrow.createCampaign{value: 10 ether}(10 ether, 1 ether, 5, uint64(block.timestamp + 1 days));
    }

    function testJoinSubmitApproveAndRefundRemainder() public {
        uint256 budget = 10 ether;
        uint256 fee = budget / 20;
        vm.prank(CREATOR);
        uint256 id = escrow.createCampaign{value: budget + fee}(budget, 1 ether, 5, uint64(block.timestamp + 1 days));

        vm.prank(ALICE);
        escrow.joinCampaign(id);
        vm.prank(ALICE);
        escrow.submitWork(id, "https://example.com/work");
        uint256 before = ALICE.balance;
        vm.prank(CREATOR);
        escrow.approveSubmission(id, ALICE);
        require(ALICE.balance == before + 1 ether, "payout incorrect");

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(CREATOR);
        vm.expectRevert(ProbonEscrow.InvalidParticipationState.selector);
        escrow.rejectSubmission(id, ALICE); // Paid work cannot be finalized a second time.
    }


    function testRefundRequiresDeadlineAndFinalizedParticipants() public {
        uint256 budget = 10 ether;
        uint256 fee = budget / 20;
        vm.prank(CREATOR);
        uint256 id = escrow.createCampaign{value: budget + fee}(budget, 1 ether, 5, uint64(block.timestamp + 1 days));

        vm.prank(ALICE);
        escrow.joinCampaign(id);

        vm.prank(CREATOR);
        vm.expectRevert(ProbonEscrow.DeadlineNotPassed.selector);
        escrow.refundRemainingBudget(id);

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(CREATOR);
        vm.expectRevert(ProbonEscrow.ParticipantsNotFinalized.selector);
        escrow.refundRemainingBudget(id);

        vm.prank(CREATOR);
        escrow.rejectSubmission(id, ALICE);

        uint256 before = CREATOR.balance;
        vm.prank(CREATOR);
        escrow.refundRemainingBudget(id);
        require(CREATOR.balance == before + budget, "refund amount incorrect");
        require(address(escrow).balance == 0, "escrow should be empty");
    }

    function testCannotJoinTwiceOrBeyondSlots() public {
        vm.prank(CREATOR);
        uint256 id = escrow.createCampaign{value: 2.1 ether}(2 ether, 1 ether, 2, uint64(block.timestamp + 1 days));
        vm.prank(ALICE);
        escrow.joinCampaign(id);
        vm.prank(ALICE);
        vm.expectRevert(ProbonEscrow.AlreadyParticipated.selector);
        escrow.joinCampaign(id);
        vm.prank(BOB);
        escrow.joinCampaign(id);
        address carol = address(0xCA);
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        vm.expectRevert(ProbonEscrow.CampaignFull.selector);
        escrow.joinCampaign(id);
    }
}
