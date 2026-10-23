export const probonEscrowAbi = [
  { type: "function", name: "usdc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "feeRecipient", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "nextCampaignId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "PLATFORM_FEE_BPS", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "createCampaign", stateMutability: "nonpayable", inputs: [{ name: "budget", type: "uint256" }, { name: "rewardPerParticipant", type: "uint256" }, { name: "slots", type: "uint256" }, { name: "deadline", type: "uint64" }], outputs: [{ name: "campaignId", type: "uint256" }] },
  { type: "function", name: "joinCampaign", stateMutability: "nonpayable", inputs: [{ name: "campaignId", type: "uint256" }], outputs: [] },
  { type: "function", name: "submitWork", stateMutability: "nonpayable", inputs: [{ name: "campaignId", type: "uint256" }, { name: "url", type: "string" }], outputs: [] },
  { type: "function", name: "approveSubmission", stateMutability: "nonpayable", inputs: [{ name: "campaignId", type: "uint256" }, { name: "participant", type: "address" }], outputs: [] },
  { type: "function", name: "rejectSubmission", stateMutability: "nonpayable", inputs: [{ name: "campaignId", type: "uint256" }, { name: "participant", type: "address" }], outputs: [] },
  { type: "function", name: "refundRemainingBudget", stateMutability: "nonpayable", inputs: [{ name: "campaignId", type: "uint256" }], outputs: [] },
  { type: "function", name: "campaigns", stateMutability: "view", inputs: [{ name: "campaignId", type: "uint256" }], outputs: [{ name: "creator", type: "address" }, { name: "budget", type: "uint256" }, { name: "remainingBudget", type: "uint256" }, { name: "rewardPerParticipant", type: "uint256" }, { name: "slots", type: "uint256" }, { name: "joinedCount", type: "uint256" }, { name: "finalizedCount", type: "uint256" }, { name: "deadline", type: "uint64" }, { name: "refundClaimed", type: "bool" }] },
  { type: "function", name: "participationStatus", stateMutability: "view", inputs: [{ name: "campaignId", type: "uint256" }, { name: "participant", type: "address" }], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "submissionUrl", stateMutability: "view", inputs: [{ name: "campaignId", type: "uint256" }, { name: "participant", type: "address" }], outputs: [{ name: "", type: "string" }] },
  { type: "event", name: "CampaignCreated", anonymous: false, inputs: [{ indexed: true, name: "campaignId", type: "uint256" }, { indexed: true, name: "creator", type: "address" }, { indexed: false, name: "budget", type: "uint256" }, { indexed: false, name: "platformFee", type: "uint256" }, { indexed: false, name: "rewardPerParticipant", type: "uint256" }, { indexed: false, name: "slots", type: "uint256" }, { indexed: false, name: "deadline", type: "uint64" }] }
] as const;

export const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }
] as const;
