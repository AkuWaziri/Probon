import { defineChain } from "viem";

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc Mainnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
  testnet: false,
});

export const ARC_CHAIN_ID = 5042;
export const ARC_RPC_URL = "https://rpc.mainnet.arc.io";
export const ARC_EXPLORER_URL = "https://explorer.arc.io";
export const NATIVE_USDC_DECIMALS = 18;
export const PROBON_CONTRACT_ADDRESS = (import.meta.env.VITE_PROBON_CONTRACT_ADDRESS || "") as `0x${string}` | "";

export const PROBON_DEPLOYMENT_BLOCK = import.meta.env.VITE_PROBON_DEPLOYMENT_BLOCK ? BigInt(import.meta.env.VITE_PROBON_DEPLOYMENT_BLOCK) : 0n;
