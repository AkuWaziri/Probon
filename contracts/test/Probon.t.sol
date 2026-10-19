// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/Probon.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata) external;
}

contract ProbonTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    Probon private probon;
    address private owner = address(0xA11CE);
    address private agent = address(0xB0B);
    address payable private recipient = payable(address(0xCAFE));
    address payable private stranger = payable(address(0xBAD));

    function setUp() public {
        vm.deal(owner, 100 ether);
        vm.deal(agent, 10 ether);
        vm.deal(address(this), 100 ether);
        probon = new Probon();
        probon.transferOwnership(owner);
    }

    function _create() private returns (uint256 id) {
        address[] memory recipients = new address[](1);
        recipients[0] = recipient;
        vm.prank(owner);
        id = probon.createMandate{value: 10 ether}(agent, recipients, 2 ether, 5 ether, uint64(block.timestamp + 7 days));
    }

    function testCreateAndFundedBalance() public {
        uint256 id = _create();
        (address mandateOwner, address mandateAgent, uint128 maxPerTx, uint128 dailyLimit,, uint128 balance,, bool active) = probon.getMandatePolicy(id);
        require(mandateOwner == owner, "owner");
        require(mandateAgent == agent, "agent");
        require(maxPerTx == 2 ether, "max");
        require(dailyLimit == 5 ether, "daily");
        require(balance == 9.9 ether, "funding after 1% fee");
        require(active, "active");
    }

    function testCreationFeeIsOnePercentAndSentToFeeRecipient() public {
        uint256 beforeFeeBalance = probon.FEE_RECIPIENT().balance;
        _create();
        require(probon.FEE_RECIPIENT().balance == beforeFeeBalance + 0.1 ether, "1% fee recipient payment");
    }

    function testOwnerCanWithdrawMandateFundsToAnotherWallet() public {
        uint256 id = _create();
        uint256 beforeRecipientBalance = stranger.balance;
        vm.prank(owner);
        probon.withdrawMandateFunds(id, stranger, 2 ether);
        require(stranger.balance == beforeRecipientBalance + 2 ether, "withdrawal recipient paid");
        (, , , , , uint128 balance,, bool active) = probon.getMandatePolicy(id);
        require(balance == 7.9 ether && active, "remaining balance and active mandate");
    }

    function testNonOwnerCannotWithdrawMandateFunds() public {
        uint256 id = _create();
        vm.expectRevert(abi.encodeWithSelector(Probon.Unauthorized.selector));
        vm.prank(agent);
        probon.withdrawMandateFunds(id, stranger, 1 ether);
    }

    function testAgentCanPayAllowedRecipientWithinLimits() public {
        uint256 id = _create();
        uint256 beforeBalance = recipient.balance;
        vm.prank(agent);
        probon.executePayment(id, recipient, 1 ether);
        require(recipient.balance == beforeBalance + 1 ether, "recipient paid");
        (, , , , , uint128 balance, uint128 spent,) = probon.getMandatePolicy(id);
        require(balance == 8.9 ether && spent == 1 ether, "accounting");
    }

    function testDisallowedRecipientReverts() public {
        uint256 id = _create();
        vm.expectRevert(abi.encodeWithSelector(Probon.RecipientNotAllowed.selector));
        vm.prank(agent);
        probon.executePayment(id, stranger, 1 ether);
    }

    function testPerTransactionLimitReverts() public {
        uint256 id = _create();
        vm.expectRevert(abi.encodeWithSelector(Probon.SpendingLimitExceeded.selector));
        vm.prank(agent);
        probon.executePayment(id, recipient, 3 ether);
    }

    function testDailyLimitRevertsAcrossPayments() public {
        uint256 id = _create();
        vm.prank(agent);
        probon.executePayment(id, recipient, 2 ether);
        vm.prank(agent);
        probon.executePayment(id, recipient, 2 ether);
        vm.expectRevert(abi.encodeWithSelector(Probon.SpendingLimitExceeded.selector));
        vm.prank(agent);
        probon.executePayment(id, recipient, 2 ether);
    }

    function testRevocationRefundsRemainingBalance() public {
        uint256 id = _create();
        uint256 beforeBalance = owner.balance;
        vm.prank(owner);
        probon.revokeMandate(id);
        require(owner.balance == beforeBalance + 9.9 ether, "refund");
        (, , , , , uint128 balance,, bool active) = probon.getMandatePolicy(id);
        require(balance == 0 && !active, "revoked");
    }

    function testGlobalPauseBlocksPayments() public {
        uint256 id = _create();
        vm.prank(owner);
        probon.setPaused(true);
        vm.expectRevert(abi.encodeWithSelector(Probon.ContractPaused.selector));
        vm.prank(agent);
        probon.executePayment(id, recipient, 1 ether);
    }

    function testExpiredMandateCannotPay() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(abi.encodeWithSelector(Probon.MandateExpired.selector));
        vm.prank(agent);
        probon.executePayment(id, recipient, 1 ether);
    }
}
