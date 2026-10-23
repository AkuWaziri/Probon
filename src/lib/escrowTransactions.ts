import {
  createPublicClient, createWalletClient, custom, decodeEventLog, http,
  parseUnits, type Address, type Hash
} from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_RPC_URL, BASE_SEPOLIA_USDC, PROBON_ESCROW_ADDRESS } from "./baseSepoliaEscrow";
import { erc20Abi, probonEscrowAbi } from "./baseSepoliaEscrowAbi";

/** Converts wallet/viem failures into concise UI-safe messages. Never expose raw RPC request data. */
export function getTransactionErrorMessage(error: unknown, action: string): string {
  const candidate = error as { code?: number | string; shortMessage?: string; message?: string; cause?: { code?: number | string; message?: string; cause?: { code?: number | string; message?: string } } } | null;
  const text = [candidate?.message, candidate?.shortMessage, candidate?.cause?.message, candidate?.cause?.cause?.message].filter(Boolean).join(" ").toLowerCase();
  const code = candidate?.code ?? candidate?.cause?.code ?? candidate?.cause?.cause?.code;
  if (code === 4001 || code === "4001" || code === "ACTION_REJECTED" || /user rejected|user denied|request rejected|action_rejected|transaction was rejected/.test(text)) {
    return "Transaction cancelled in your wallet. Nothing was submitted or marked as funded, and no submission status was changed.";
  }
  if (/insufficient funds|insufficient balance/.test(text)) return "Your wallet does not have enough Base Sepolia ETH for the network fee. No campaign or submission status was changed.";
  if (/chain.?id|wrong network|unsupported chain/.test(text)) return "Switch your wallet to Base Sepolia and try again. No campaign or submission status was changed.";
  return action + " could not be completed. Check your wallet and Base Sepolia connection, then try again. No campaign or submission status was changed.";
}

type InjectedProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC_URL) });

async function walletClient() {
  const provider = window.ethereum as InjectedProvider | undefined;
  if (!provider) throw new Error("Install a browser wallet to use Probon on Base Sepolia.");
  const chainId = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (chainId !== "0x14a34") {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] });
    } catch (switchError) {
      const code = (switchError as { code?: number }).code;
      if (code !== 4902) throw new Error("Switch your wallet to Base Sepolia to continue.");
      await provider.request({ method: "wallet_addEthereumChain", params: [{
        chainId: "0x14a34",
        chainName: "Base Sepolia",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [BASE_SEPOLIA_RPC_URL],
        blockExplorerUrls: ["https://sepolia.basescan.org"]
      }] });
    }
  }
  return createWalletClient({ chain: baseSepolia, transport: custom(provider as never) });
}

export async function createEscrowCampaign(args: {
  budgetUsdc: number; rewardUsdc: number; slots: number; deadline: string;
}): Promise<{ campaignId: string; txHash: Hash }> {
  const client = await walletClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect your wallet before creating a campaign.");
  const budget = parseUnits(args.budgetUsdc.toFixed(6), 6);
  const reward = parseUnits(args.rewardUsdc.toFixed(6), 6);
  const total = budget + budget * 500n / 10000n;
  const allowance = await publicClient.readContract({
    address: BASE_SEPOLIA_USDC as Address, abi: erc20Abi, functionName: "allowance",
    args: [account, PROBON_ESCROW_ADDRESS as Address]
  });
  if (allowance < total) {
    const approveHash = await client.writeContract({
      account, chain: baseSepolia, address: BASE_SEPOLIA_USDC as Address, abi: erc20Abi,
      functionName: "approve", args: [PROBON_ESCROW_ADDRESS as Address, total]
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }
  const deadlineSeconds = BigInt(Math.floor(new Date(args.deadline + "T23:59:59").getTime() / 1000));
  const hash = await client.writeContract({
    account, chain: baseSepolia, address: PROBON_ESCROW_ADDRESS as Address, abi: probonEscrowAbi,
    functionName: "createCampaign", args: [budget, reward, BigInt(args.slots), deadlineSeconds]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Campaign funding transaction failed on Base Sepolia.");
  let campaignId: bigint | undefined;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: probonEscrowAbi, eventName: "CampaignCreated", data: log.data, topics: log.topics });
      campaignId = decoded.args.campaignId;
      break;
    } catch { /* unrelated contract event */ }
  }
  if (campaignId === undefined) throw new Error("Campaign transaction succeeded, but its on-chain campaign ID could not be read.");
  return { campaignId: campaignId.toString(), txHash: hash };
}

export async function joinEscrowCampaign(campaignId: string): Promise<Hash> {
  const client = await walletClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect your wallet before joining.");
  const hash = await client.writeContract({ account, chain: baseSepolia, address: PROBON_ESCROW_ADDRESS as Address, abi: probonEscrowAbi, functionName: "joinCampaign", args: [BigInt(campaignId)] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Join transaction failed on Base Sepolia.");
  return hash;
}

export async function submitEscrowWork(campaignId: string, url: string): Promise<Hash> {
  const client = await walletClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect your wallet before submitting work.");
  const hash = await client.writeContract({ account, chain: baseSepolia, address: PROBON_ESCROW_ADDRESS as Address, abi: probonEscrowAbi, functionName: "submitWork", args: [BigInt(campaignId), url] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Submission transaction failed on Base Sepolia.");
  return hash;
}

export async function reviewEscrowSubmission(campaignId: string, participant: string, approved: boolean): Promise<Hash> {
  const client = await walletClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect the campaign creator wallet before reviewing work.");
  const hash = await client.writeContract({
    account, chain: baseSepolia, address: PROBON_ESCROW_ADDRESS as Address, abi: probonEscrowAbi,
    functionName: approved ? "approveSubmission" : "rejectSubmission",
    args: [BigInt(campaignId), participant as Address]
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Review transaction failed on Base Sepolia.");
  return hash;
}

export async function refundEscrowCampaign(campaignId: string): Promise<Hash> {
  const client = await walletClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect the campaign creator wallet before requesting a refund.");
  const hash = await client.writeContract({
    account, chain: baseSepolia, address: PROBON_ESCROW_ADDRESS as Address,
    abi: probonEscrowAbi, functionName: "refundRemainingBudget", args: [BigInt(campaignId)]
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Refund transaction failed on Base Sepolia.");
  return hash;
}
