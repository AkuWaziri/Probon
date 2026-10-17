import {
  createPublicClient, createWalletClient, custom, decodeEventLog, formatUnits,
  getAddress, http, isAddress, parseAbiItem, parseUnits, type Address,
} from "viem";
import { arcMainnet, ARC_CHAIN_ID, ARC_RPC_URL, ARC_EXPLORER_URL, NATIVE_USDC_DECIMALS, PROBON_CONTRACT_ADDRESS, PROBON_DEPLOYMENT_BLOCK } from "./arc";
import { probonAbi } from "./probonAbi";

const mandateCreatedEvent = parseAbiItem("event MandateCreated(uint256 indexed mandateId, address indexed owner, address indexed agent, uint256 maxPerTx, uint256 dailyLimit, uint64 expiresAt, uint256 initialFunding)");
const recipientConfiguredEvent = parseAbiItem("event RecipientConfigured(uint256 indexed mandateId, address indexed recipient)");
const paymentExecutedEvent = parseAbiItem("event PaymentExecuted(uint256 indexed mandateId, address indexed agent, address indexed recipient, uint256 amount, uint256 day)");

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (eventName: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (eventName: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}

export type ProbonMandate = {
  id: bigint;
  owner: Address;
  agent: Address;
  maxPerTx: bigint;
  dailyLimit: bigint;
  expiresAt: bigint;
  balance: bigint;
  totalSpent: bigint;
  active: boolean;
  recipients: Address[];
};

export type ProbonPayment = {
  mandateId: bigint;
  agent: Address;
  recipient: Address;
  amount: bigint;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
};

export const publicClient = createPublicClient({
  chain: arcMainnet,
  transport: http(ARC_RPC_URL, { timeout: 20_000, retryCount: 2 }),
});

function requireContract(): Address {
  if (!PROBON_CONTRACT_ADDRESS || !isAddress(PROBON_CONTRACT_ADDRESS)) {
    throw new Error("Probon contract is not configured yet. Deploy the contract to Arc Mainnet, then set VITE_PROBON_CONTRACT_ADDRESS in Vercel.");
  }
  return getAddress(PROBON_CONTRACT_ADDRESS);
}

async function switchToArcMainnet() {
  if (!window.ethereum) throw new Error("No injected wallet found. Install or unlock MetaMask, Rabby, or another EVM wallet.");
  const current = String(await window.ethereum.request({ method: "eth_chainId" }));
  if (Number.parseInt(current, 16) === ARC_CHAIN_ID) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x13b2" }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x13b2",
        chainName: "Arc Mainnet",
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: [ARC_RPC_URL],
        blockExplorerUrls: [ARC_EXPLORER_URL],
      }],
    });
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x13b2" }] });
  }
  const verifiedChain = String(await window.ethereum.request({ method: "eth_chainId" }));
  if (Number.parseInt(verifiedChain, 16) !== ARC_CHAIN_ID) {
    throw new Error("Switch your wallet to Arc Mainnet (chain ID 5042) before continuing.");
  }
}

export async function connectWallet(): Promise<Address> {
  if (!window.ethereum) throw new Error("No injected wallet found. Install or unlock MetaMask, Rabby, or another EVM wallet.");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
  if (!accounts?.[0] || !isAddress(accounts[0])) throw new Error("The wallet did not return a valid address.");
  await switchToArcMainnet();
  return getAddress(accounts[0]);
}

export async function getNativeUsdcBalance(address: Address): Promise<bigint> {
  return publicClient.getBalance({ address });
}

function walletClientFor(address: Address) {
  if (!window.ethereum) throw new Error("Connect an EVM wallet first.");
  return createWalletClient({
    account: address,
    chain: arcMainnet,
    transport: custom(window.ethereum as never),
  });
}

export async function loadMandates(owner: Address): Promise<ProbonMandate[]> {
  const contractAddress = requireContract();
  const created = await publicClient.getLogs({
    address: contractAddress,
    event: mandateCreatedEvent,
    fromBlock: PROBON_DEPLOYMENT_BLOCK,
    toBlock: "latest",
  });
  const ids = [...new Set(created.flatMap((log) => {
    const decoded = decodeEventLog({ abi: probonAbi, data: log.data, topics: log.topics });
    return decoded.eventName === "MandateCreated" && decoded.args.owner.toLowerCase() === owner.toLowerCase()
      ? [decoded.args.mandateId] : [];
  }))];

  const recipientLogs = await publicClient.getLogs({
    address: contractAddress,
    event: recipientConfiguredEvent,
    fromBlock: PROBON_DEPLOYMENT_BLOCK,
    toBlock: "latest",
  });
  const recipientsByMandate = new Map<bigint, Address[]>();
  for (const log of recipientLogs) {
    const decoded = decodeEventLog({ abi: probonAbi, data: log.data, topics: log.topics });
    if (decoded.eventName !== "RecipientConfigured") continue;
    const list = recipientsByMandate.get(decoded.args.mandateId) ?? [];
    list.push(decoded.args.recipient);
    recipientsByMandate.set(decoded.args.mandateId, list);
  }

  const mandates = await Promise.all(ids.map(async (id) => {
    const raw = await publicClient.readContract({
      address: contractAddress,
      abi: probonAbi,
      functionName: "getMandatePolicy",
      args: [id],
    }) as readonly [Address, Address, bigint, bigint, bigint, bigint, bigint, boolean];
    return { id, owner: raw[0], agent: raw[1], maxPerTx: raw[2], dailyLimit: raw[3], expiresAt: raw[4], balance: raw[5], totalSpent: raw[6], active: raw[7], recipients: recipientsByMandate.get(id) ?? [] };
  }));
  return mandates.sort((a, b) => Number(b.id - a.id));
}

export async function loadPayments(): Promise<ProbonPayment[]> {
  const contractAddress = requireContract();
  const logs = await publicClient.getLogs({
    address: contractAddress,
    event: paymentExecutedEvent,
    fromBlock: PROBON_DEPLOYMENT_BLOCK,
    toBlock: "latest",
  });
  return logs.slice(-50).reverse().map((log) => {
    const decoded = decodeEventLog({ abi: probonAbi, data: log.data, topics: log.topics });
    if (decoded.eventName !== "PaymentExecuted") throw new Error("Unexpected Probon event.");
    return {
      mandateId: decoded.args.mandateId,
      agent: decoded.args.agent,
      recipient: decoded.args.recipient,
      amount: decoded.args.amount,
      transactionHash: log.transactionHash!,
      blockNumber: log.blockNumber!,
    };
  });
}

export async function createMandateOnChain(input: {
  account: Address;
  agent: string;
  recipients: string[];
  maxPerTx: string;
  dailyLimit: string;
  expiryDays: number;
  initialFunding: string;
}): Promise<`0x${string}`> {
  const contractAddress = requireContract();
  if (!isAddress(input.agent)) throw new Error("Enter a valid agent wallet address.");
  const agent = getAddress(input.agent);
  const recipients = [...new Set(input.recipients.map((value) => value.trim()).filter(Boolean))];
  if (!recipients.length || recipients.some((value) => !isAddress(value))) throw new Error("Enter one or more valid recipient addresses, separated by commas.");
  if (recipients.some((value) => getAddress(value) === input.account || getAddress(value) === agent)) throw new Error("Recipient addresses must be different from the owner and agent wallet.");
  const maxPerTx = parseUnits(input.maxPerTx, NATIVE_USDC_DECIMALS);
  const dailyLimit = parseUnits(input.dailyLimit, NATIVE_USDC_DECIMALS);
  const initialFunding = parseUnits(input.initialFunding || "0", NATIVE_USDC_DECIMALS);
  if (maxPerTx <= 0n || dailyLimit < maxPerTx) throw new Error("The daily limit must be at least as large as the per-payment limit.");
  if (input.expiryDays < 1 || input.expiryDays > 365) throw new Error("Expiry must be between 1 and 365 days.");
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + input.expiryDays * 86400 - 60);
  const wallet = walletClientFor(input.account);
  return wallet.writeContract({
    address: contractAddress,
    abi: probonAbi,
    functionName: "createMandate",
    args: [agent, recipients.map(value => getAddress(value)), maxPerTx, dailyLimit, expiresAt],
    value: initialFunding,
    account: input.account,
    chain: arcMainnet,
  });
}

export async function fundMandateOnChain(account: Address, id: bigint, amount: string) {
  const contractAddress = requireContract();
  const value = parseUnits(amount, NATIVE_USDC_DECIMALS);
  if (value <= 0n) throw new Error("Funding amount must be greater than zero.");
  return walletClientFor(account).writeContract({
    address: contractAddress, abi: probonAbi, functionName: "fundMandate",
    args: [id], value, account, chain: arcMainnet,
  });
}

export async function revokeMandateOnChain(account: Address, id: bigint) {
  return walletClientFor(account).writeContract({
    address: requireContract(), abi: probonAbi, functionName: "revokeMandate",
    args: [id], account, chain: arcMainnet,
  });
}

export async function executePaymentOnChain(account: Address, id: bigint, recipient: string, amount: string) {
  if (!isAddress(recipient)) throw new Error("Enter a valid recipient address.");
  return walletClientFor(account).writeContract({
    address: requireContract(), abi: probonAbi, functionName: "executePayment",
    args: [id, getAddress(recipient), parseUnits(amount, NATIVE_USDC_DECIMALS)],
    account, chain: arcMainnet,
  });
}

export async function setEmergencyPause(account: Address, paused: boolean) {
  return walletClientFor(account).writeContract({
    address: requireContract(), abi: probonAbi, functionName: "setPaused",
    args: [paused], account, chain: arcMainnet,
  });
}

export async function getContractOwner(): Promise<Address> {
  return publicClient.readContract({ address: requireContract(), abi: probonAbi, functionName: "owner" });
}

export async function getContractPauseState(): Promise<boolean> {
  return publicClient.readContract({ address: requireContract(), abi: probonAbi, functionName: "paused" });
}

export function formatNativeUsdc(value: bigint, fractionDigits = 4): string {
  const [whole, fraction = ""] = formatUnits(value, NATIVE_USDC_DECIMALS).split(".");
  const rounded = fraction.slice(0, fractionDigits).replace(/0+$/, "");
  return rounded ? `${whole}.${rounded}` : whole;
}

export function getContractAddress() {
  return PROBON_CONTRACT_ADDRESS;
}
