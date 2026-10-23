// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/ProbonEscrow.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockUSDC {
    string public constant name = "Mock USDC";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ProbonEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant FEE = address(0xFEE);
    address private constant CREATOR = address(0xA11CE);
    address private constant ALICE = address(0xA1);
    address private constant BOB = address(0xB0B);
    MockUSDC private token;
    ProbonEscrow private escrow;
    uint256 private constant USDC = 1e6;

    function setUp() public {
        token = new MockUSDC();
        escrow = new ProbonEscrow(address(token), FEE);
        token.mint(CREATOR, 100_000 * USDC);
        token.mint(ALICE, 10_000 * USDC);
        token.mint(BOB, 10_000 * USDC);
        vm.prank(CREATOR);
        token.approve(address(escrow), type(uint256).max);
    }

    function _create(uint256 budget, uint256 reward, uint256 slots) private returns (uint256) {
        vm.prank(CREATOR);
        return escrow.createCampaign(budget, reward, slots, uint64(block.timestamp + 1 days));
    }

    function testCreateCampaignCollectsUSDCFeeAndEscrowsBudget() public {
        uint256 budget = 1_000 * USDC;
        uint256 fee = budget / 20;
        uint256 id = _create(budget, 100 * USDC, 10);
        require(id == 1, "wrong id");
        require(token.balanceOf(FEE) == fee, "fee not sent");
        require(token.balanceOf(address(escrow)) == budget, "budget not escrowed");
        (address creator, uint256 storedBudget, uint256 remaining,,,,,,) = escrow.campaigns(id);
        require(creator == CREATOR && storedBudget == budget && remaining == budget, "campaign mismatch");
    }

    function testCreationRequiresAllowance() public {
        vm.prank(ALICE);
        vm.expectRevert();
        escrow.createCampaign(100 * USDC, 10 * USDC, 10, uint64(block.timestamp + 1 days));
    }

    function testJoinSubmitApproveAndPayoutUSDC() public {
        uint256 budget = 1_000 * USDC;
        uint256 id = _create(budget, 100 * USDC, 10);
        vm.prank(ALICE);
        escrow.joinCampaign(id);
        vm.prank(ALICE);
        escrow.submitWork(id, "https://example.com/work");
        vm.prank(CREATOR);
        escrow.approveSubmission(id, ALICE);
        require(token.balanceOf(ALICE) == 10_100 * USDC, "payout incorrect");
        require(token.balanceOf(address(escrow)) == 900 * USDC, "remaining budget incorrect");
    }

    function testRejectAndRefundRemainingUSDCAfterDeadline() public {
        uint256 budget = 1_000 * USDC;
        uint256 id = _create(budget, 100 * USDC, 10);
        vm.prank(ALICE);
        escrow.joinCampaign(id);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(CREATOR);
        escrow.rejectSubmission(id, ALICE);
        vm.prank(CREATOR);
        escrow.refundRemainingBudget(id);
        require(token.balanceOf(CREATOR) == 99_000 * USDC, "refund amount incorrect");
        require(token.balanceOf(address(escrow)) == 0, "escrow should be empty");
    }

    function testCannotJoinTwiceOrBeyondSlots() public {
        uint256 id = _create(2 * USDC, 1 * USDC, 2);
        vm.prank(ALICE);
        escrow.joinCampaign(id);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(ProbonEscrow.AlreadyParticipated.selector));
        escrow.joinCampaign(id);
        vm.prank(BOB);
        escrow.joinCampaign(id);
        address carol = address(0xCA);
        vm.prank(CREATOR);
        token.mint(carol, 1 * USDC);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ProbonEscrow.CampaignFull.selector));
        escrow.joinCampaign(id);
    }

    function testWrongAmountAndInvalidDeadlineRevert() public {
        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(ProbonEscrow.InvalidAmount.selector));
        escrow.createCampaign(10 * USDC, 2 * USDC, 10, uint64(block.timestamp + 1 days));
        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(ProbonEscrow.InvalidDeadline.selector));
        escrow.createCampaign(10 * USDC, 1 * USDC, 10, uint64(block.timestamp));
    }
}
