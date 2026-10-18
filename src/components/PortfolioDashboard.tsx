import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { AlertCircle, ExternalLink, LoaderCircle, RefreshCw, Wallet, WalletCards } from "lucide-react";
import { ARC_EXPLORER_URL } from "../lib/arc";
import { formatNativeUsdc, getNativeUsdcBalance } from "../lib/probonClient";

type Token = { address: string; name: string; symbol: string; decimals: number | null; raw: string; formatted: string; usd: number | null; logo: string | null };
type Section = "Overview" | "Tokens" | "NFTs" | "Lending" | "Borrowing" | "Staking";
type AavePosition = { spoke: string; reserveId: number; asset: string; decimals: number; supplied: string; debt: string; collateralEnabled: boolean; healthFactor: string | null };
type MorphoPosition = { vault: string; name: string; symbol: string; assetSymbol: string; assetAddress: string; assets: string; shares: string; version: "V1" | "V2" };
type MorphoBorrowPosition = { marketId: string; loanSymbol: string; loanAddress: string; loanDecimals: number; collateralSymbol: string; collateralAddress: string; collateralDecimals: number; borrowAssets: string; borrowUsd: string | null; collateral: string; collateralUsd: string | null };
const short = (value: string) => value.length > 14 ? value.slice(0, 7) + "…" + value.slice(-5) : value;
const addressUrl = (address: string) => ARC_EXPLORER_URL + "/address/" + address;
const ARC_CHAIN = defineChain({ id: 5042, name: "Arc Mainnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 }, rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } }, blockExplorers: { default: { name: "Arc Explorer", url: ARC_EXPLORER_URL } } });
const AAVE_SPOKES = [{ name: "Main Spoke", address: "0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d" }, { name: "Forex Spoke", address: "0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB" }] as const;
const AAVE_SPOKE_ABI = [
  { type: "function", name: "getReserveCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getReserve", stateMutability: "view", inputs: [{ name: "reserveId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "underlying", type: "address" }, { name: "hub", type: "address" }, { name: "assetId", type: "uint16" }, { name: "decimals", type: "uint8" }, { name: "collateralRisk", type: "uint24" }, { name: "flags", type: "uint8" }, { name: "dynamicConfigKey", type: "uint32" }] }] },
  { type: "function", name: "getUserSuppliedAssets", stateMutability: "view", inputs: [{ name: "reserveId", type: "uint256" }, { name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getUserTotalDebt", stateMutability: "view", inputs: [{ name: "reserveId", type: "uint256" }, { name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getUserReserveStatus", stateMutability: "view", inputs: [{ name: "reserveId", type: "uint256" }, { name: "user", type: "address" }], outputs: [{ name: "usingAsCollateral", type: "bool" }, { name: "borrowing", type: "bool" }] },
  { type: "function", name: "getUserAccountData", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "tuple", components: [{ name: "riskPremium", type: "uint256" }, { name: "avgCollateralFactor", type: "uint256" }, { name: "healthFactor", type: "uint256" }, { name: "totalCollateralValue", type: "uint256" }, { name: "totalDebtValueRay", type: "uint256" }, { name: "activeCollateralCount", type: "uint256" }, { name: "borrowCount", type: "uint256" }] }] },
] as const;
const SUPPORTED_DEFI_ASSETS = new Set(["0x3600000000000000000000000000000000000000", "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1", "0x171a4217b86a807a64eb94757db6849fb4bdbaa0"]);
const assetAllowed = (address: string) => SUPPORTED_DEFI_ASSETS.has(address.toLowerCase());
const formatUnitsSafe = (raw: string, decimals: number) => { try { return (Number(raw) / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: 8 }); } catch { return raw; } };

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
  const [aavePositions, setAavePositions] = useState<AavePosition[]>([]);
  const [aaveError, setAaveError] = useState("");
  const [morphoPositions, setMorphoPositions] = useState<MorphoPosition[]>([]);
  const [morphoError, setMorphoError] = useState("");
  const [borrowPositions, setBorrowPositions] = useState<MorphoBorrowPosition[]>([]);
  const [borrowError, setBorrowError] = useState("");
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section>("Overview");
  const refresh = useCallback(async () => {
    if (!account) { setBalance(null); setTokens([]); setAavePositions([]); setMorphoPositions([]); setBorrowPositions([]); setError(""); setTokenError(""); setAaveError(""); setMorphoError(""); setBorrowError(""); return; }
    setLoading(true); setError(""); setTokenError(""); setAaveError(""); setMorphoError(""); setBorrowError("");
    const aaveRequest = (async (): Promise<AavePosition[]> => {
      const client = createPublicClient({ chain: ARC_CHAIN, transport: http("https://rpc.mainnet.arc.io") });
      const positions: AavePosition[] = [];
      const healthBySpoke = new Map<string, string | null>();
      for (const spoke of AAVE_SPOKES) {
        const spokeAddress = spoke.address as Address;
        const count = await client.readContract({ address: spokeAddress, abi: AAVE_SPOKE_ABI, functionName: "getReserveCount" });
        const reserveCount = Number(count);
        if (!Number.isSafeInteger(reserveCount) || reserveCount > 100) throw new Error("Unexpected Aave reserve count.");
        for (let reserveId = 0; reserveId < reserveCount; reserveId++) {
          const reserve = await client.readContract({ address: spokeAddress, abi: AAVE_SPOKE_ABI, functionName: "getReserve", args: [BigInt(reserveId)] });
          const asset = reserve.underlying.toLowerCase();
          if (!assetAllowed(asset)) continue;
          const [suppliedRaw, debtRaw, status] = await Promise.all([
            client.readContract({ address: spokeAddress, abi: AAVE_SPOKE_ABI, functionName: "getUserSuppliedAssets", args: [BigInt(reserveId), account] }),
            client.readContract({ address: spokeAddress, abi: AAVE_SPOKE_ABI, functionName: "getUserTotalDebt", args: [BigInt(reserveId), account] }),
            client.readContract({ address: spokeAddress, abi: AAVE_SPOKE_ABI, functionName: "getUserReserveStatus", args: [BigInt(reserveId), account] }),
          ]);
          if (suppliedRaw === 0n && debtRaw === 0n) continue;
          let healthFactor: string | null = healthBySpoke.get(spoke.name) ?? null;
          if (!healthBySpoke.has(spoke.name)) {
            try {
              const accountData = await client.readContract({ address: spokeAddress, abi: AAVE_SPOKE_ABI, functionName: "getUserAccountData", args: [account] });
              healthFactor = accountData.healthFactor.toString();
            } catch { healthFactor = null; }
            healthBySpoke.set(spoke.name, healthFactor);
          }
          positions.push({ spoke: spoke.name, reserveId, asset, decimals: reserve.decimals, supplied: suppliedRaw.toString(), debt: debtRaw.toString(), collateralEnabled: status[0], healthFactor });
        }
      }
      return positions;
    })();
    const tokenRequest = fetch("https://api.arc-scan.org/v1/address/" + account + "/tokens", { headers: { Accept: "application/json" } })
      .then(async response => { if (!response.ok) throw new Error("Arc token index is temporarily unavailable."); return parseTokens(await response.json()); });
    const morphoRequest = Promise.all((["v1", "v2"] as const).map(async version => {
      const url = `https://api.morpho.org/${version === "v1" ? "v1/vaults-v1" : "v1/vaults-v2"}/users/${account}/positions?chain_ids=5042&active_only=true&limit=100`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Morpho positions are temporarily unavailable.");
      const payload = await response.json() as { data?: unknown; items?: unknown[]; positions?: unknown[] };
      const data = payload.data;
      const rows = Array.isArray(data) ? data : Array.isArray(payload.items) ? payload.items : Array.isArray(payload.positions) ? payload.positions : data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).items) ? (data as { items: unknown[] }).items : [];
      return rows.map(value => {
        const row = value as Record<string, unknown>;
        const vaultInfo = (row.vault && typeof row.vault === "object" ? row.vault : {}) as Record<string, unknown>;
        const assetInfo = (vaultInfo.asset && typeof vaultInfo.asset === "object" ? vaultInfo.asset : row.asset && typeof row.asset === "object" ? row.asset : {}) as Record<string, unknown>;
        const vault = String(row.vault_address ?? row.vaultAddress ?? vaultInfo.address ?? "");
        const assetSymbol = String(assetInfo.symbol ?? row.asset_symbol ?? row.assetSymbol ?? "");
        const assetAddress = String(assetInfo.address ?? row.asset_address ?? row.assetAddress ?? "");
        const name = String(vaultInfo.name ?? row.name ?? row.vault_name ?? "Morpho vault");
        const symbol = String(vaultInfo.symbol ?? row.symbol ?? "Vault share");
        const shares = String(row.shares ?? (row.state as Record<string, unknown> | undefined)?.shares ?? "0");
        const assets = String(row.assets ?? (row.state as Record<string, unknown> | undefined)?.assets ?? "0");
        return { vault, name, symbol, assetSymbol, assetAddress, assets, shares, version: version === "v1" ? "V1" as const : "V2" as const };
      }).filter(row => /^0x[a-fA-F0-9]{40}$/.test(row.vault) && assetAllowed(row.assetAddress) && (Number(row.shares) > 0 || Number(row.assets) > 0));
    })).then(rows => rows.flat());
    const borrowRequest = fetch("https://api.morpho.org/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: `query GetArcMorphoPositions { userByAddress(address: "${account}", chainId: 5042) { marketPositions { market { marketId loanAsset { address symbol decimals } collateralAsset { address symbol decimals } } state { borrowAssets borrowAssetsUsd collateral collateralUsd } } } }` }),
    }).then(async response => {
      if (!response.ok) throw new Error("Morpho market positions are temporarily unavailable.");
      const payload = await response.json() as { errors?: unknown[]; data?: { userByAddress?: { marketPositions?: unknown[] } | null } };
      if (payload.errors?.length) throw new Error("Morpho market position query failed.");
      const positions = payload.data?.userByAddress?.marketPositions ?? [];
      return positions.map(value => {
        const row = value as Record<string, unknown>;
        const market = (row.market ?? {}) as Record<string, unknown>;
        const state = (row.state ?? {}) as Record<string, unknown>;
        const loan = (market.loanAsset ?? {}) as Record<string, unknown>;
        const collateralAsset = (market.collateralAsset ?? {}) as Record<string, unknown>;
        const borrowAssets = String(state.borrowAssets ?? "0");
        const collateral = String(state.collateral ?? "0");
        return {
          marketId: String(market.marketId ?? ""),
          loanSymbol: String(loan.symbol ?? "Loan asset"),
          loanAddress: String(loan.address ?? ""),
          loanDecimals: Number(loan.decimals ?? 18),
          collateralSymbol: String(collateralAsset.symbol ?? "Collateral"),
          collateralAddress: String(collateralAsset.address ?? ""),
          collateralDecimals: Number(collateralAsset.decimals ?? 18),
          borrowAssets,
          borrowUsd: state.borrowAssetsUsd == null ? null : String(state.borrowAssetsUsd),
          collateral,
          collateralUsd: state.collateralUsd == null ? null : String(state.collateralUsd),
        };
      }).filter(position => /^0x[a-fA-F0-9]{64}$/.test(position.marketId) && (assetAllowed(position.loanAddress) || assetAllowed(position.collateralAddress)) && (Number(position.borrowAssets) > 0 || Number(position.collateral) > 0));
    });
    try { setBalance(await getNativeUsdcBalance(account)); }
    catch { setBalance(null); setError("Native USDC balance could not be read from Arc Mainnet."); }
    try { setAavePositions(await aaveRequest); }\n    catch { setAavePositions([]); setAaveError("Aave V4 positions could not be loaded from Arc Mainnet. Refresh to retry; balances are not estimated."); }\n    try { setTokens(await tokenRequest); }
    catch { setTokens([]); setTokenError("Token holdings could not be loaded from Arcscan. Refresh to retry; balances are not estimated."); }
    try { setMorphoPositions(await morphoRequest); }
    catch { setMorphoPositions([]); setMorphoError("Morpho lending positions could not be loaded. Refresh to retry; balances are not estimated."); }
    try { setBorrowPositions(await borrowRequest); }
    catch { setBorrowPositions([]); setBorrowError("Morpho borrowing positions could not be loaded. Refresh to retry; balances are not estimated."); }
    finally { setLoading(false); }
  }, [account]);
  useEffect(() => { void refresh(); }, [refresh]);

  const frame = (children: ReactNode) => <section className="workspace-page"><div className="workspace-page-heading"><div><div className="eyebrow">PROBON · ARC MAINNET</div><h1>Portfolio<span className="heading-period">.</span></h1><p>Wallet assets and DeFi positions on Arc Mainnet (chain ID 5042).</p></div><button className="outline-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Refresh portfolio</button></div>{children}</section>;

  if (!account) return frame(<div className="workspace-empty"><Wallet size={25}/><strong>Connect a wallet to continue</strong><span>Connect an EVM wallet on Arc Mainnet to load your holdings.</span></div>);

  const tabs: Section[] = ["Overview", "Tokens", "NFTs", "Lending", "Borrowing", "Staking"];
  const notReady = (title: string, body: string) => <div className="workspace-empty"><AlertCircle size={25}/><strong>{title}</strong><span>{body}</span><span>Only verified on-chain positions will be shown; missing data will not be represented as zero.</span></div>;
  const tokenCards = <>{tokenError && <div className="workspace-error"><AlertCircle size={16}/>{tokenError}</div>}{loading && tokens.length === 0 ? <div className="workspace-empty"><LoaderCircle className="spin" size={22}/><span>Loading Arc Mainnet token holdings…</span></div> : tokens.length === 0 ? <div className="workspace-empty"><WalletCards size={25}/><strong>No indexed ERC-20 holdings returned</strong><span>Native USDC is shown separately. The token index returned no other token contracts.</span></div> : <div className="mandate-list">{tokens.map(token => <article className="mandate-card" key={token.address}><div className="mandate-card-top">{token.logo ? <img src={token.logo} alt="" width="36" height="36" style={{borderRadius:"50%",objectFit:"cover"}} onError={event => { event.currentTarget.style.display="none"; }}/> : <div className="mandate-icon"><WalletCards size={18}/></div>}<div className="mandate-title"><strong>{token.name}</strong><span>{token.symbol}</span></div><span className="mandate-badge badge-active">{token.usd === null ? "PRICE N/A" : "$" + token.usd.toLocaleString(undefined,{maximumFractionDigits:2})}</span></div><div className="mandate-stats"><div><span>Balance</span><strong>{token.formatted || (token.raw && token.decimals !== null ? (Number(token.raw)/Math.pow(10,token.decimals)).toLocaleString(undefined,{maximumFractionDigits:8}) : "—")} {token.symbol}</strong></div><div><span>Contract</span><strong>{short(token.address)}</strong></div><div><span>USD value</span><strong>{token.usd === null ? "Not indexed" : "$"+token.usd.toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div><div><span>Network</span><strong>Arc Mainnet</strong></div></div><div className="mandate-actions"><a className="subtle-button" href={addressUrl(token.address)} target="_blank" rel="noreferrer">View token <ExternalLink size={13}/></a></div></article>)}</div>}</>;

  const aaveCards = (kind: "supply" | "debt") => {
    const rows = aavePositions.filter(position => kind === "supply" ? BigInt(position.supplied) > 0n : BigInt(position.debt) > 0n);
    const assetSymbol = (address: string) => address.toLowerCase() === "0x3600000000000000000000000000000000000000" ? "USDC" : address.toLowerCase() === "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1" ? "EURC" : "cirBTC";
    return <>{aaveError && <div className="workspace-error"><AlertCircle size={16}/>{aaveError}</div>}{rows.length > 0 && <><div className="workspace-toolbar"><span>Aave V4 · Arc Mainnet · {kind === "supply" ? "Supplied assets" : "Borrowed assets"}</span><a className="subtle-button" href="https://pro.aave.com/" target="_blank" rel="noreferrer">Open Aave Pro <ExternalLink size={13}/></a></div><div className="mandate-list">{rows.map(position => <article className="mandate-card" key={position.spoke + position.reserveId + kind}><div className="mandate-card-top"><div className="mandate-icon"><WalletCards size={18}/></div><div className="mandate-title"><strong>{assetSymbol(position.asset)} · Aave V4</strong><span>{position.spoke} · {kind === "supply" ? (position.collateralEnabled ? "Enabled as collateral" : "Supply") : "Debt"}</span></div><span className="mandate-badge badge-active">ON-CHAIN</span></div><div className="mandate-stats"><div><span>{kind === "supply" ? "Supplied" : "Borrowed"}</span><strong>{formatUnitsSafe(kind === "supply" ? position.supplied : position.debt, position.decimals)} {assetSymbol(position.asset)}</strong></div><div><span>Health factor</span><strong>{position.healthFactor && BigInt(position.debt) > 0n ? (Number(position.healthFactor) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}</strong></div><div><span>Reserve</span><strong>{position.reserveId}</strong></div><div><span>Network</span><strong>Arc Mainnet</strong></div></div><div className="mandate-actions"><a className="subtle-button" href={addressUrl(position.spoke === "Main Spoke" ? AAVE_SPOKES[0].address : AAVE_SPOKES[1].address)} target="_blank" rel="noreferrer">View Aave contract <ExternalLink size={13}/></a></div></article>)}</div></>}</>;
  };
  return frame(<>{error && <div className="workspace-error"><AlertCircle size={16}/>{error}</div>}<div className="portfolio-note"><WalletCards size={17}/><span>Wallet <a href={addressUrl(account)} target="_blank" rel="noreferrer">{short(account)} <ExternalLink size={12}/></a> · Arc Mainnet only. Token pricing appears only when returned by the index.</span></div><div className="portfolio-stats"><article className="stat-card"><div className="stat-top"><span>Native USDC</span><span className="stat-icon purple"><Wallet size={17}/></span></div><div className="stat-value">{balance === null ? "—" : formatNativeUsdc(balance)} <span className="stat-unit">USDC</span></div><div className="stat-foot">Spendable wallet balance</div></article><article className="stat-card"><div className="stat-top"><span>Indexed tokens</span><span className="stat-icon cyan"><WalletCards size={17}/></span></div><div className="stat-value">{loading && tokens.length===0 ? "…" : tokens.length}</div><div className="stat-foot">Other token contracts returned by Arcscan</div></article><article className="stat-card"><div className="stat-top"><span>Connected network</span><span className="stat-icon green"><Wallet size={17}/></span></div><div className="stat-value">Arc <span className="stat-unit">Mainnet</span></div><div className="stat-foot">Chain ID 5042</div></article></div><div className="workspace-toolbar portfolio-tabs" role="tablist" aria-label="Portfolio sections">{tabs.map(tab => <button key={tab} role="tab" aria-selected={section===tab} className={section===tab ? "primary-button" : "subtle-button"} onClick={() => setSection(tab)}>{tab}</button>)}</div>{section==="Overview" && <><div className="workspace-toolbar"><span>Wallet token holdings</span><button className="subtle-button" onClick={() => setSection("Tokens")}>View all tokens <ExternalLink size={13}/></button></div>{tokenCards}<div className="workspace-toolbar"><span>DeFi overview</span></div>{notReady("Protocol positions are not indexed yet","NFT, lending, borrowing and staking positions require separate Arc-compatible NFT and protocol integrations. The portfolio currently reads native USDC and indexed ERC-20 token holdings.")}</>}{section==="Tokens" && tokenCards}{section==="NFTs" && notReady("NFT indexer not connected","Arcscan's token-balance endpoint does not provide a complete ERC-721/ERC-1155 inventory. An Arc-compatible NFT ownership indexer is required.")}{section==="Lending" && <>{aaveCards("supply")}{morphoError && <div className="workspace-error"><AlertCircle size={16}/>{morphoError}</div>}{morphoPositions.length === 0 ? <>{aavePositions.filter(position => BigInt(position.supplied) > 0n).length === 0 && !aaveError && notReady("No active lending positions returned","No supplied USDC, EURC or cirBTC positions were found on Aave V4 or Morpho on Arc Mainnet.")}</> : <><div className="workspace-toolbar"><span>Morpho lending positions · Arc Mainnet</span><a className="subtle-button" href="https://app.morpho.org/" target="_blank" rel="noreferrer">Open Morpho <ExternalLink size={13}/></a></div><div className="mandate-list">{morphoPositions.map(position => <article className="mandate-card" key={position.version + position.vault}><div className="mandate-card-top"><div className="mandate-icon"><WalletCards size={18}/></div><div className="mandate-title"><strong>{position.name}</strong><span>{position.symbol} · underlying {position.assetSymbol || "asset"} · Morpho {position.version}</span></div><span className="mandate-badge badge-active">ACTIVE</span></div><div className="mandate-stats"><div><span>Underlying assets</span><strong>{formatUnitsSafe(position.assets, position.assetSymbol.toUpperCase() === "CIRBTC" ? 8 : 6)} {position.assetSymbol}</strong></div><div><span>Vault shares</span><strong>{position.shares}</strong></div><div><span>Vault contract</span><strong>{short(position.vault)}</strong></div><div><span>Network</span><strong>Arc Mainnet</strong></div></div><div className="mandate-actions"><a className="subtle-button" href={addressUrl(position.vault)} target="_blank" rel="noreferrer">View contract <ExternalLink size={13}/></a></div></article>)}</div></>}</>}{section==="Borrowing" && <>{aaveCards("debt")}{borrowError && <div className="workspace-error"><AlertCircle size={16}/>{borrowError}</div>}{borrowPositions.length === 0 ? <>{aavePositions.filter(position => BigInt(position.debt) > 0n).length === 0 && !aaveError && notReady("No active borrowing positions returned","No debt involving USDC, EURC or cirBTC was found on Aave V4 or Morpho on Arc Mainnet.")}</> : <><div className="workspace-toolbar"><span>Morpho Blue market positions · Arc Mainnet</span><a className="subtle-button" href="https://app.morpho.org/" target="_blank" rel="noreferrer">Open Morpho <ExternalLink size={13}/></a></div><div className="mandate-list">{borrowPositions.map(position => <article className="mandate-card" key={position.marketId}><div className="mandate-card-top"><div className="mandate-icon"><WalletCards size={18}/></div><div className="mandate-title"><strong>{position.loanSymbol} market</strong><span>Borrowing · {position.collateralSymbol} collateral</span></div><span className="mandate-badge badge-active">ON-CHAIN INDEX</span></div><div className="mandate-stats"><div><span>Debt</span><strong>{formatUnitsSafe(position.borrowAssets, position.loanDecimals)} {position.loanSymbol}</strong></div><div><span>Debt USD value</span><strong>{position.borrowUsd === null ? "Not indexed" : "$" + Number(position.borrowUsd).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div><div><span>Collateral</span><strong>{formatUnitsSafe(position.collateral, position.collateralDecimals)} {position.collateralSymbol}</strong></div><div><span>Collateral USD value</span><strong>{position.collateralUsd === null ? "Not indexed" : "$" + Number(position.collateralUsd).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div></div><div className="mandate-actions"><a className="subtle-button" href={"https://app.morpho.org/"} target="_blank" rel="noreferrer">View market in Morpho <ExternalLink size={13}/></a></div></article>)}</div></>}</>}{section==="Staking" && notReady("Staking integration not connected","Staked assets and claimable rewards require verified Arc Mainnet staking or vault contract integrations.")}</>);
}
