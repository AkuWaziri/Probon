import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { AlertCircle, ExternalLink, LoaderCircle, RefreshCw, Wallet, WalletCards } from "lucide-react";
import { ARC_EXPLORER_URL } from "../lib/arc";
import { formatNativeUsdc, getNativeUsdcBalance } from "../lib/probonClient";

type Token = { address: string; name: string; symbol: string; decimals: number | null; raw: string; formatted: string; usd: number | null; logo: string | null };
type Section = "Overview" | "Tokens" | "NFTs" | "Lending" | "Borrowing" | "Staking";
const short = (value: string) => value.length > 14 ? value.slice(0, 7) + "…" + value.slice(-5) : value;
const addressUrl = (address: string) => ARC_EXPLORER_URL + "/address/" + address;

function parseTokens(payload: unknown): Token[] {
  const root = payload as Record<string, unknown>;
  const rows = Array.isArray(payload) ? payload : Array.isArray(root?.tokens) ? root.tokens : Array.isArray(root?.items) ? root.items : Array.isArray(root?.result) ? root.result : [];
  return rows.map((value) => {
    const row = value as Record<string, unknown>;
    const money = (row.balance && typeof row.balance === "object" ? row.balance : {}) as Record<string, unknown>;
    const address = String(row.address ?? row.token_address ?? row.contract_address ?? row.contractAddress ?? "");
    const decimalsRaw = row.decimals ?? money.decimals;
    const decimals = decimalsRaw !== undefined && Number.isFinite(Number(decimalsRaw)) ? Number(decimalsRaw) : null;
    const raw = String(row.raw_balance ?? row.balance_raw ?? money.raw ?? row.value ?? "");
    const formattedRaw = row.formatted_balance ?? row.balance_formatted ?? money.formatted;
    const usdRaw = row.usd_value ?? row.value_usd ?? money.usd;
    const usd = usdRaw === undefined || usdRaw === null || usdRaw === "" ? null : Number(usdRaw);
    return {
      address, name: String(row.name ?? row.token_name ?? row.symbol ?? "Unknown token"),
      symbol: String(row.symbol ?? row.token_symbol ?? money.symbol ?? "TOKEN"), decimals, raw,
      formatted: typeof formattedRaw === "string" || typeof formattedRaw === "number" ? String(formattedRaw) : "",
      usd: Number.isFinite(usd) ? usd : null,
      logo: typeof (row.logo ?? row.logo_url ?? row.image) === "string" ? String(row.logo ?? row.logo_url ?? row.image) : null,
    };
  }).filter((token) => /^0x[a-fA-F0-9]{40}$/.test(token.address));
}

export function PortfolioDashboard({ account }: { account: Address | null }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section>("Overview");
  const refresh = useCallback(async () => {
    if (!account) { setBalance(null); setTokens([]); setError(""); setTokenError(""); return; }
    setLoading(true); setError(""); setTokenError("");
    const tokenRequest = fetch("https://api.arc-scan.org/v1/address/" + account + "/tokens", { headers: { Accept: "application/json" } })
      .then(async response => { if (!response.ok) throw new Error("Arc token index is temporarily unavailable."); return parseTokens(await response.json()); });
    try { setBalance(await getNativeUsdcBalance(account)); }
    catch { setBalance(null); setError("Native USDC balance could not be read from Arc Mainnet."); }
    try { setTokens(await tokenRequest); }
    catch { setTokens([]); setTokenError("Token holdings could not be loaded from Arcscan. Refresh to retry; balances are not estimated."); }
    finally { setLoading(false); }
  }, [account]);
  useEffect(() => { void refresh(); }, [refresh]);

  const frame = (children: React.ReactNode) => <section className="workspace-page"><div className="workspace-page-heading"><div><div className="eyebrow">PROBON · ARC MAINNET</div><h1>Portfolio<span className="heading-period">.</span></h1><p>Wallet assets and DeFi positions on Arc Mainnet (chain ID 5042).</p></div><button className="outline-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Refresh portfolio</button></div>{children}</section>;

  if (!account) return frame(<div className="workspace-empty"><Wallet size={25}/><strong>Connect a wallet to continue</strong><span>Connect an EVM wallet on Arc Mainnet to load your holdings.</span></div>);

  const tabs: Section[] = ["Overview", "Tokens", "NFTs", "Lending", "Borrowing", "Staking"];
  const notReady = (title: string, body: string) => <div className="workspace-empty"><AlertCircle size={25}/><strong>{title}</strong><span>{body}</span><span>Only verified on-chain positions will be shown; missing data will not be represented as zero.</span></div>;
  const tokenCards = <>{tokenError && <div className="workspace-error"><AlertCircle size={16}/>{tokenError}</div>}{loading && tokens.length === 0 ? <div className="workspace-empty"><LoaderCircle className="spin" size={22}/><span>Loading Arc Mainnet token holdings…</span></div> : tokens.length === 0 ? <div className="workspace-empty"><WalletCards size={25}/><strong>No indexed ERC-20 holdings returned</strong><span>Native USDC is shown separately. The token index returned no other token contracts.</span></div> : <div className="mandate-list">{tokens.map(token => <article className="mandate-card" key={token.address}><div className="mandate-card-top">{token.logo ? <img src={token.logo} alt="" width="36" height="36" style={{borderRadius:"50%",objectFit:"cover"}} onError={event => { event.currentTarget.style.display="none"; }}/> : <div className="mandate-icon"><WalletCards size={18}/></div>}<div className="mandate-title"><strong>{token.name}</strong><span>{token.symbol}</span></div><span className="mandate-badge badge-active">{token.usd === null ? "PRICE N/A" : "$" + token.usd.toLocaleString(undefined,{maximumFractionDigits:2})}</span></div><div className="mandate-stats"><div><span>Balance</span><strong>{token.formatted || (token.raw && token.decimals !== null ? (Number(token.raw)/Math.pow(10,token.decimals)).toLocaleString(undefined,{maximumFractionDigits:8}) : "—")} {token.symbol}</strong></div><div><span>Contract</span><strong>{short(token.address)}</strong></div><div><span>USD value</span><strong>{token.usd === null ? "Not indexed" : "$"+token.usd.toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div><div><span>Network</span><strong>Arc Mainnet</strong></div></div><div className="mandate-actions"><a className="subtle-button" href={addressUrl(token.address)} target="_blank" rel="noreferrer">View token <ExternalLink size={13}/></a></div></article>)}</div>}</>;

  return frame(<>{error && <div className="workspace-error"><AlertCircle size={16}/>{error}</div>}<div className="portfolio-note"><WalletCards size={17}/><span>Wallet <a href={addressUrl(account)} target="_blank" rel="noreferrer">{short(account)} <ExternalLink size={12}/></a> · Arc Mainnet only. Token pricing appears only when returned by the index.</span></div><div className="portfolio-stats"><article className="stat-card"><div className="stat-top"><span>Native USDC</span><span className="stat-icon purple"><Wallet size={17}/></span></div><div className="stat-value">{balance === null ? "—" : formatNativeUsdc(balance)} <span className="stat-unit">USDC</span></div><div className="stat-foot">Spendable wallet balance</div></article><article className="stat-card"><div className="stat-top"><span>Indexed tokens</span><span className="stat-icon cyan"><WalletCards size={17}/></span></div><div className="stat-value">{loading && tokens.length===0 ? "…" : tokens.length}</div><div className="stat-foot">Other token contracts returned by Arcscan</div></article><article className="stat-card"><div className="stat-top"><span>Connected network</span><span className="stat-icon green"><Wallet size={17}/></span></div><div className="stat-value">Arc <span className="stat-unit">Mainnet</span></div><div className="stat-foot">Chain ID 5042</div></article></div><div className="workspace-toolbar portfolio-tabs" role="tablist" aria-label="Portfolio sections">{tabs.map(tab => <button key={tab} role="tab" aria-selected={section===tab} className={section===tab ? "primary-button" : "subtle-button"} onClick={() => setSection(tab)}>{tab}</button>)}</div>{section==="Overview" && <><div className="workspace-toolbar"><span>Wallet token holdings</span><button className="subtle-button" onClick={() => setSection("Tokens")}>View all tokens <ExternalLink size={13}/></button></div>{tokenCards}<div className="workspace-toolbar"><span>DeFi overview</span></div>{notReady("Protocol positions are not indexed yet","NFT, lending, borrowing and staking positions require separate Arc-compatible NFT and protocol integrations. The portfolio currently reads native USDC and indexed ERC-20 token holdings.")}</>}{section==="Tokens" && tokenCards}{section==="NFTs" && notReady("NFT indexer not connected","Arcscan's token-balance endpoint does not provide a complete ERC-721/ERC-1155 inventory. An Arc-compatible NFT ownership indexer is required.")}{section==="Lending" && notReady("Lending positions need verified protocol reads","Supplied assets and accrued interest must be read from deployed Arc Mainnet lending contracts or a verified position API.")}{section==="Borrowing" && notReady("Borrowing positions need verified protocol reads","Debt, collateral, interest rates and health factors must come from deployed Arc Mainnet lending contracts; they cannot be inferred from wallet tokens.")}{section==="Staking" && notReady("Staking integration not connected","Staked assets and claimable rewards require verified Arc Mainnet staking or vault contract integrations.")}</>);
}
