import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, Bot, BrainCircuit, CircleAlert, Download, ExternalLink, Fingerprint, LoaderCircle, Plus, RefreshCw, ShieldCheck, TrendingUp, Wallet, WalletCards, X } from "lucide-react";
import type { Address } from "viem";
import { ARC_EXPLORER_URL, PROBON_CONTRACT_ADDRESS } from "../lib/arc";
import {
  createMandateOnChain, executePaymentOnChain, formatNativeUsdc, getContractAddress, getNativeUsdcBalance,
  loadMandates, loadPayments, publicClient, revokeMandateOnChain,
  fundMandateOnChain, getContractOwner, getContractPauseState, setEmergencyPause, type ProbonMandate, type ProbonPayment,
} from "../lib/probonClient";

type SharedProps = { account: Address | null; onNotice: (message: string) => void };
const short = (value: string) => value.length > 14 ? value.slice(0, 7) + "…" + value.slice(-5) : value;
const explorerTx = (hash: string) => ARC_EXPLORER_URL + "/tx/" + hash;
const explorerAddress = (address: string) => ARC_EXPLORER_URL + "/address/" + address;

function mandateCreationError(error: unknown): string {
  const e = error as {
    name?: string; shortMessage?: string; message?: string; details?: string;
    cause?: { name?: string; shortMessage?: string; message?: string; details?: string };
  };
  const name = [e?.name, e?.cause?.name].filter(Boolean).join(" ").toLowerCase();
  const message = [e?.shortMessage, e?.message, e?.details, e?.cause?.shortMessage, e?.cause?.message, e?.cause?.details]
    .filter(Boolean).join(" ").toLowerCase();

  if (/userrejected|user rejected|rejected the request|denied transaction|request rejected|action_rejected/.test(name + " " + message)) {
    return "Transaction cancelled in your wallet. No mandate was created.";
  }
  if (/chain.?id|wrong network|switch.*network|chain mismatch/.test(message)) {
    return "Your wallet is not on Arc Mainnet. Switch to Arc Mainnet (chain ID 5042) and try again.";
  }
  if (/insufficient funds|exceeds the balance|not enough funds|gas required exceeds|funds for gas/.test(message)) {
    return "Your wallet needs enough native USDC to cover the network fee and any initial funding. A USDC token balance on another network will not cover Arc Mainnet fees.";
  }
  if (/daily limit must be at least|expiry must be between|enter a valid agent|enter one or more valid recipient|recipient addresses must be different|funding amount must be greater/.test(message)) {
    return e.message || e.shortMessage || "Check the mandate settings and try again.";
  }
  if (/revert|execution reverted|contractfunctionexecutionerror|call exception/.test(name + " " + message)) {
    return "Arc Mainnet rejected the mandate settings. Verify the addresses, daily limit, expiry, and contract status before retrying.";
  }
  if (/failed to fetch|network request failed|timeout|timed out|http request failed|could not connect|network error/.test(message)) {
    return "Could not reach the Arc Mainnet RPC to submit the transaction. Try again shortly; no transaction may have been submitted.";
  }
  if (/fee data|gas price|estimate gas|transaction underpriced/.test(message)) {
    return "The wallet could not estimate the Arc Mainnet transaction fee. Check that the wallet is on Arc Mainnet and has native USDC available for fees.";
  }
  return "The wallet or Arc Mainnet RPC did not accept the transaction. Check the wallet network and native USDC balance, then retry. If it repeats, check the wallet's activity for a pending or failed transaction before submitting again.";
}

function WalletRequired() {
  return <div className="workspace-empty"><Wallet size={25}/><strong>Connect a wallet to continue</strong><span>Connect an EVM wallet on Arc Mainnet to read and manage on-chain data.</span></div>;
}

function ContractMissing() {
  return <div className="workspace-warning"><CircleAlert size={18}/><div><strong>Contract not configured</strong><p>Probon's contract is not deployed yet. Once the contract is deployed to Arc Mainnet, add <code>VITE_PROBON_CONTRACT_ADDRESS</code> to the Vercel project environment variables and push a redeployment. No transaction will be sent until this is configured.</p></div></div>;
}

export function MandatesWorkspace({ account, onNotice }: SharedProps) {
  const [mandates, setMandates] = useState<ProbonMandate[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [agent, setAgent] = useState("");
  const [recipients, setRecipients] = useState("");
  const [maxPerTx, setMaxPerTx] = useState("2");
  const [dailyLimit, setDailyLimit] = useState("10");
  const [expiryDays, setExpiryDays] = useState("30");
  const [initialFunding, setInitialFunding] = useState("0");
  const [showForm, setShowForm] = useState(false);
  const [pendingHash, setPendingHash] = useState<`0x${string}` | "">("");

  const refresh = useCallback(async () => {
    if (!account || !getContractAddress()) { setMandates([]); return; }
    setLoading(true); setError("");
    try { setMandates(await loadMandates(account)); }
    catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError("Mandates could not be loaded. " + detail.slice(0, 220));
    }
    finally { setLoading(false); }
  }, [account]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function finishConfirmedMandate(hash: `0x${string}`) {
    onNotice("Mandate transaction confirmed on Arc Mainnet: " + hash);
    setPendingHash("");
    setShowForm(false); setAgent(""); setRecipients(""); setInitialFunding("0");
    await refresh();
  }

  async function checkMandateConfirmation(hash: `0x${string}`) {
    setSubmitting(true);
    setError("");
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setPendingHash("");
        setError("The mandate transaction failed on-chain. Review the transaction before creating another mandate: " + explorerTx(hash));
        return;
      }
      await finishConfirmedMandate(hash);
    } catch {
      setPendingHash(hash);
      setError("The wallet submitted this transaction, but Arc RPC has not returned its receipt yet. Do not submit another mandate. Check the transaction: " + explorerTx(hash));
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!account || pendingHash) return;
    setSubmitting(true); setError("");
    let hash: `0x${string}`;
    try {
      hash = await createMandateOnChain({
        account, agent, recipients: recipients.split(/[\n,;]/), maxPerTx, dailyLimit,
        expiryDays: Number(expiryDays), initialFunding,
      });
    } catch (error) {
      setError(mandateCreationError(error));
      setSubmitting(false);
      return;
    }

    // From this point on, the wallet has returned a transaction hash. Never describe
    // a later receipt/RPC error as a failed submission or invite a duplicate transaction.
    setPendingHash(hash);
    onNotice("Mandate submitted. Checking Arc Mainnet confirmation: " + explorerTx(hash));
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setPendingHash("");
        setError("The mandate transaction failed on-chain. Review the transaction before trying again: " + explorerTx(hash));
        return;
      }
      await finishConfirmedMandate(hash);
    } catch {
      setError("Transaction submitted successfully from your wallet, but confirmation could not be checked through Arc RPC. Do not submit again. Check the transaction: " + explorerTx(hash));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(mandate: ProbonMandate) {
    if (!account || !window.confirm("Revoke mandate #" + mandate.id + "? The remaining mandate balance will be returned to its owner.")) return;
    setError(""); setSubmitting(true);
    try {
      const hash = await revokeMandateOnChain(account, mandate.id);
      onNotice("Revocation submitted. Waiting for confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      onNotice("Mandate revoked. Refund and state changes are on-chain. " + hash);
      await refresh();
    } catch { setError("Mandate revocation could not be completed. Check your wallet and try again."); }
    finally { setSubmitting(false); }
  }

  async function fund(mandate: ProbonMandate) {
    if (!account) return;
    const amount = window.prompt("Amount of native USDC to add to mandate #" + mandate.id + " (Arc native USDC uses 18 decimals internally):");
    if (amount === null) return;
    setError(""); setSubmitting(true);
    try {
      const hash = await fundMandateOnChain(account, mandate.id, amount);
      onNotice("Funding submitted. Waiting for confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      onNotice("Mandate funded on Arc Mainnet. " + hash);
      await refresh();
    } catch { setError("Mandate funding could not be completed. Check your wallet and try again."); }
    finally { setSubmitting(false); }
  }

  if (!account) return <WorkspaceFrame title="Mandates" subtitle="Create programmable spending permissions enforced by the Probon contract."><WalletRequired/></WorkspaceFrame>;
  return <WorkspaceFrame title="Mandates" subtitle="Each mandate sets the agent, allowed recipients, payment cap, daily cap, expiry, and funded balance." action={<button className="primary-button" onClick={() => setShowForm(!showForm)}><Plus size={16}/>{showForm ? "Close form" : "Create mandate"}</button>}>
    {!PROBON_CONTRACT_ADDRESS && <ContractMissing/>}
    {error && <div className="workspace-error"><CircleAlert size={16}/>{error}</div>}
    {showForm && <form className="mandate-form" onSubmit={submit}>
      <div className="form-heading"><div><h3>New spending mandate</h3><p>This submits a real transaction on Arc Mainnet after wallet approval.</p></div><button type="button" className="icon-button" aria-label="Close form" onClick={() => setShowForm(false)}><X size={17}/></button></div>
      <label>Agent wallet address<input required value={agent} onChange={e=>setAgent(e.target.value)} placeholder="0x…" autoComplete="off"/></label>
      <label>Allowed recipient addresses <span className="field-hint">Separate addresses with commas or new lines (max 50).</span><textarea required rows={3} value={recipients} onChange={e=>setRecipients(e.target.value)} placeholder="0x…"/></label>
      <div className="form-grid">
        <label>Max per payment (USDC)<input required type="number" min="0.000000000000000001" step="any" value={maxPerTx} onChange={e=>setMaxPerTx(e.target.value)}/></label>
        <label>Daily limit (USDC)<input required type="number" min="0.000000000000000001" step="any" value={dailyLimit} onChange={e=>setDailyLimit(e.target.value)}/></label>
        <label>Expires in (days)<input required type="number" min="1" max="365" step="1" value={expiryDays} onChange={e=>setExpiryDays(e.target.value)}/></label>
        <label>Initial funding (USDC)<input required type="number" min="0" step="any" value={initialFunding} onChange={e=>setInitialFunding(e.target.value)}/></label>
      </div>
      <div className="form-note"><ShieldCheck size={16}/><span>Only the selected agent can execute payments. Contract rules block unapproved recipients, expired mandates, payments above the per-payment cap, and daily-limit overruns. Funding is real mainnet USDC.</span></div>
      <button className="primary-button" type="submit" disabled={submitting || !PROBON_CONTRACT_ADDRESS}>{submitting ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} {pendingHash ? "Transaction submitted — checking status" : submitting ? "Confirming on Arc Mainnet…" : "Review & create mandate"}</button>
      {pendingHash && <div className="form-note"><CircleAlert size={16}/><span>Do not submit another mandate while this transaction is unresolved. <a href={explorerTx(pendingHash)} target="_blank" rel="noreferrer">View transaction</a> or <button type="button" className="subtle-button" disabled={submitting} onClick={() => void checkMandateConfirmation(pendingHash)}>Check confirmation</button></span></div>}
    </form>}
    <div className="workspace-toolbar"><span>{mandates.length} mandate{mandates.length === 1 ? "" : "s"} found for this wallet</span><button className="subtle-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Refresh</button></div>
    {loading ? <div className="workspace-empty"><LoaderCircle className="spin" size={22}/><span>Reading Arc Mainnet…</span></div> : mandates.length === 0 ? <div className="workspace-empty"><Fingerprint size={26}/><strong>No mandates yet</strong><span>Create your first on-chain spending policy. Nothing is stored until a wallet transaction confirms.</span>{PROBON_CONTRACT_ADDRESS && <button className="primary-button" onClick={() => setShowForm(true)}><Plus size={16}/> Create mandate</button>}</div> :
      <div className="mandate-list">{mandates.map(m => <article className="mandate-card" key={m.id}>
        <div className="mandate-card-top"><div className="mandate-icon"><Fingerprint size={18}/></div><div className="mandate-title"><strong>Mandate #{m.id.toString()}</strong><span>{m.active ? (BigInt(Math.floor(Date.now()/1000)) >= m.expiresAt ? "Expired" : "Active") : "Revoked"}</span></div><span className={"mandate-badge " + (m.active && BigInt(Math.floor(Date.now()/1000)) < m.expiresAt ? "badge-active" : "badge-off")}>{m.active && BigInt(Math.floor(Date.now()/1000)) < m.expiresAt ? "ENFORCED" : "INACTIVE"}</span></div>
        <div className="mandate-stats"><div><span>Available balance</span><strong>{formatNativeUsdc(m.balance)} USDC</strong></div><div><span>Max per payment</span><strong>{formatNativeUsdc(m.maxPerTx)} USDC</strong></div><div><span>Daily limit</span><strong>{formatNativeUsdc(m.dailyLimit)} USDC</strong></div><div><span>Total spent</span><strong>{formatNativeUsdc(m.totalSpent)} USDC</strong></div></div><div className="spend-progress"><div className="spend-progress-label"><span>Mandate funding used</span><strong>{m.totalSpent + m.balance > 0n ? Math.min(100, Number((m.totalSpent * 10000n) / (m.totalSpent + m.balance)) / 100).toFixed(1) : "0.0"}%</strong></div><div className="spend-progress-track" role="progressbar" aria-label={"Mandate " + m.id.toString() + " funding used"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.totalSpent + m.balance > 0n ? Math.min(100, Number((m.totalSpent * 10000n) / (m.totalSpent + m.balance)) / 100) : 0}><span style={{width: (m.totalSpent + m.balance > 0n ? Math.min(100, Number((m.totalSpent * 10000n) / (m.totalSpent + m.balance)) / 100) : 0) + "%"}} /></div><small>Based on total recorded spend and current mandate balance; this is not a daily-limit meter.</small></div>
        <div className="mandate-addresses"><div><span>Agent</span><a href={explorerAddress(m.agent)} target="_blank" rel="noreferrer">{short(m.agent)} <ExternalLink size={12}/></a></div><div><span>Allowed recipients ({m.recipients.length})</span><div className="recipient-chips">{m.recipients.map(r=><a key={r} href={explorerAddress(r)} target="_blank" rel="noreferrer">{short(r)}</a>)}</div></div><div><span>Expiry</span><strong>{new Date(Number(m.expiresAt)*1000).toLocaleString()}</strong></div></div>
        <div className="mandate-actions"><a className="subtle-button" href={explorerAddress(getContractAddress())} target="_blank" rel="noreferrer">View contract <ArrowUpRight size={14}/></a>{m.active && <><button className="outline-button" disabled={submitting} onClick={() => void fund(m)}><Plus size={14}/> Fund</button><button className="danger-button" disabled={submitting} onClick={() => void revoke(m)}><X size={14}/> Revoke & refund</button></>}</div>
      </article>)}</div>}
  </WorkspaceFrame>;
}

export function AgentsWorkspace({ account }: SharedProps) {
  const [mandates, setMandates] = useState<ProbonMandate[]>([]);
  useEffect(() => { if (account && getContractAddress()) void loadMandates(account).then(setMandates).catch(()=>setMandates([])); else setMandates([]); }, [account]);
  if (!account) return <WorkspaceFrame title="Agents" subtitle="Agent identities are read from your on-chain mandates."><WalletRequired/></WorkspaceFrame>;
  const unique = [...new Map(mandates.map(m => [m.agent.toLowerCase(), m])).values()];
  return <WorkspaceFrame title="Agents" subtitle="Agent identities and their associated payment permissions.">{!PROBON_CONTRACT_ADDRESS && <ContractMissing/>}{unique.length ? <div className="mandate-list">{unique.map(m=><article className="mandate-card agent-card" key={m.agent}><div className="mandate-card-top"><div className="mandate-icon"><Bot size={18}/></div><div className="mandate-title"><strong>{short(m.agent)}</strong><span>{mandates.filter(x=>x.agent.toLowerCase()===m.agent.toLowerCase()).length} mandate(s)</span></div><a href={explorerAddress(m.agent)} target="_blank" rel="noreferrer"><ExternalLink size={14}/></a></div><p>Permissioned by mandate #{m.id.toString()}. Contract enforcement applies to every payment attempt.</p></article>)}</div>:<div className="workspace-empty"><Bot size={26}/><strong>No agents registered</strong><span>Create a mandate to assign an agent wallet and define its payment permissions.</span></div>}</WorkspaceFrame>;
}

export function TransactionsWorkspace({ account, onNotice }: SharedProps) {
  const [payments, setPayments] = useState<ProbonPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [mandates, setMandates] = useState<ProbonMandate[]>([]);
  const [mandateId, setMandateId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async()=>{if(!PROBON_CONTRACT_ADDRESS){setPayments([]);return;}setLoading(true);try{setPayments(await loadPayments());if(account)setMandates(await loadMandates(account));}catch{setError("On-chain activity could not be loaded right now. Please try again shortly.");}finally{setLoading(false);}},[account]);
  function exportPayments() {
    if (!payments.length) { setError("There are no loaded payment events to export."); return; }
    const headers = ["mandate_id","agent","recipient","amount_usdc","block_number","transaction_hash","arc_explorer_url"];
    const rows = payments.map(p => [p.mandateId.toString(), p.agent, p.recipient, formatNativeUsdc(p.amount, 18), p.blockNumber.toString(), p.transactionHash, explorerTx(p.transactionHash)]);
    const csv = [headers, ...rows].map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = "probon-arc-mainnet-transactions.csv"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  useEffect(()=>{void refresh();},[refresh]);
  async function pay(event:FormEvent){event.preventDefault();if(!account)return;setBusy(true);setError("");try{const hash=await executePaymentOnChain(account,BigInt(mandateId),recipient,amount);onNotice("Payment submitted. Waiting for confirmation…");await publicClient.waitForTransactionReceipt({hash});onNotice("Payment executed on Arc Mainnet: "+hash);await refresh();}catch{setError("The payment could not be completed. Check the wallet confirmation and try again.");}finally{setBusy(false);}}
  return <WorkspaceFrame title="Transactions" subtitle="On-chain payments emitted by the Probon contract.">{!account?<WalletRequired/>:!PROBON_CONTRACT_ADDRESS?<ContractMissing/>:<>
    {error&&<div className="workspace-error"><CircleAlert size={16}/>{error}</div>}
    <form className="mandate-form payment-form" onSubmit={pay}><div className="form-heading"><div><h3>Execute a policy-checked payment</h3><p>The connected wallet must be the agent assigned to the selected mandate.</p></div></div><div className="form-grid"><label>Mandate<select required value={mandateId} onChange={e=>setMandateId(e.target.value)}><option value="">Select mandate</option>{mandates.filter(m=>m.active).map(m=><option key={m.id.toString()} value={m.id.toString()}>#{m.id.toString()} · balance {formatNativeUsdc(m.balance)} USDC</option>)}</select></label><label>Recipient address<input required value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="0x…"/></label><label>Amount (USDC)<input required type="number" min="0.000000000000000001" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/></label></div><div className="form-note"><ShieldCheck size={16}/><span>The contract checks the connected agent, recipient allowlist, expiry, per-payment cap, daily cap, and available mandate balance. A rejected payment reverts on-chain.</span></div><button className="primary-button" disabled={busy||mandates.filter(m=>m.active).length===0}>{busy?<LoaderCircle className="spin" size={16}/>:<ArrowUpRight size={16}/>} Submit payment</button></form>
    <div className="workspace-toolbar"><span>Recent on-chain payments · up to 50 latest events</span><div className="toolbar-actions"><button className="subtle-button" onClick={exportPayments} disabled={payments.length===0}><Download size={14}/> Export CSV</button><button className="subtle-button" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={14} className={loading?"spin":""}/> Refresh</button></div></div>
    {loading?<div className="workspace-empty"><LoaderCircle className="spin" size={22}/><span>Loading on-chain events…</span></div>:payments.length===0?<div className="workspace-empty"><Wallet size={25}/><strong>No confirmed payments</strong><span>Real payment events will appear here after a transaction succeeds.</span></div>:<div className="payment-list">{payments.map(p=><article className="payment-row" key={p.transactionHash}><div className="mandate-icon"><ArrowUpRight size={17}/></div><div className="payment-main"><strong>{formatNativeUsdc(p.amount)} USDC · Mandate #{p.mandateId.toString()}</strong><span>To {short(p.recipient)} · Block {p.blockNumber.toString()}</span></div><a href={explorerTx(p.transactionHash)} target="_blank" rel="noreferrer">View tx <ExternalLink size={13}/></a></article>)}</div>}
  </>}</WorkspaceFrame>;
}


export function PortfolioWorkspace({ account }: { account: Address | null }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [mandates, setMandates] = useState<ProbonMandate[]>([]);
  const [payments, setPayments] = useState<ProbonPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!account) { setBalance(null); setMandates([]); setPayments([]); return; }
    setLoading(true); setError("");
    try {
      const [nextBalance, nextMandates, nextPayments] = await Promise.all([
        getNativeUsdcBalance(account),
        PROBON_CONTRACT_ADDRESS ? loadMandates(account) : Promise.resolve([]),
        PROBON_CONTRACT_ADDRESS ? loadPayments() : Promise.resolve([]),
      ]);
      setBalance(nextBalance); setMandates(nextMandates); setPayments(nextPayments);
    } catch {
      setError("Portfolio data could not be refreshed from Arc Mainnet. Check your wallet network and try again.");
    } finally { setLoading(false); }
  }, [account]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!account) return <WorkspaceFrame title="Portfolio" subtitle="Track native USDC and the funds assigned to your Probon mandates on Arc Mainnet."><WalletRequired /></WorkspaceFrame>;

  const mandateFunds = mandates.reduce((sum, m) => sum + m.balance, 0n);
  const totalRecordedSpend = mandates.reduce((sum, m) => sum + m.totalSpent, 0n);
  const activeMandates = mandates.filter(m => m.active && BigInt(Math.floor(Date.now()/1000)) < m.expiresAt);
  const totalKnown = (balance ?? 0n) + mandateFunds;
  const allocationPct = totalKnown > 0n ? Math.min(100, Number((mandateFunds * 10000n) / totalKnown) / 100) : 0;

  return <WorkspaceFrame title="Portfolio" subtitle="A clear view of your Arc-native USDC, mandate allocations, and recorded agent spending." action={<button className="outline-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Refresh portfolio</button>}>
    {error && <div className="workspace-error"><CircleAlert size={16}/>{error}</div>}
    <div className="portfolio-note"><WalletCards size={17}/><span>Arc Mainnet only · Values below cover native USDC and Probon mandate balances, not every ERC-20 token in your wallet.</span></div>
    <div className="portfolio-stats">
      <article className="stat-card"><div className="stat-top"><span>Wallet balance</span><span className="stat-icon purple"><Wallet size={17}/></span></div><div className="stat-value">{balance === null ? "—" : formatNativeUsdc(balance)} <span className="stat-unit">USDC</span></div><div className="stat-foot">Native USDC on Arc Mainnet</div></article>
      <article className="stat-card"><div className="stat-top"><span>In active mandates</span><span className="stat-icon cyan"><Fingerprint size={17}/></span></div><div className="stat-value">{formatNativeUsdc(activeMandates.reduce((sum,m)=>sum+m.balance,0n))} <span className="stat-unit">USDC</span></div><div className="stat-foot">{activeMandates.length} active mandate(s)</div></article>
      <article className="stat-card"><div className="stat-top"><span>Recorded spend</span><span className="stat-icon green"><TrendingUp size={17}/></span></div><div className="stat-value">{formatNativeUsdc(totalRecordedSpend)} <span className="stat-unit">USDC</span></div><div className="stat-foot">Lifetime spend reported by your mandates</div></article>
      <article className="stat-card"><div className="stat-top"><span>Loaded payments</span><span className="stat-icon orange"><ArrowUpRight size={17}/></span></div><div className="stat-value">{payments.length}</div><div className="stat-foot">Latest indexed Probon events</div></article>
    </div>
    <article className="mandate-card portfolio-allocation"><div className="form-heading"><div><h3>Funds overview</h3><p>Wallet funds versus USDC currently held by active mandates.</p></div></div><div className="portfolio-allocation-row"><div><span>Wallet available</span><strong>{balance === null ? "—" : formatNativeUsdc(balance)} USDC</strong></div><div><span>Active mandate balances</span><strong>{formatNativeUsdc(activeMandates.reduce((sum,m)=>sum+m.balance,0n))} USDC</strong></div><div><span>Mandate allocation</span><strong>{allocationPct.toFixed(1)}%</strong></div></div><div className="spend-progress-track" role="progressbar" aria-label="Share of known wallet and mandate funds allocated" aria-valuemin={0} aria-valuemax={100} aria-valuenow={allocationPct}><span style={{width: allocationPct + "%"}}/></div><small className="portfolio-caption">Allocation uses wallet native USDC plus active mandate balances. It excludes other tokens and funds held outside Probon.</small></article>
    <div className="workspace-toolbar"><span>Mandate allocation breakdown</span><span>{mandates.length} mandate(s)</span></div>
    {loading ? <div className="workspace-empty"><LoaderCircle className="spin" size={22}/><span>Reading Arc Mainnet portfolio…</span></div> : mandates.length === 0 ? <div className="workspace-empty"><WalletCards size={25}/><strong>No mandate allocations yet</strong><span>Create a mandate to see its current Arc-native USDC balance and spending progress here.</span></div> : <div className="mandate-list">{mandates.map(m => { const denom = m.totalSpent + m.balance; const pct = denom > 0n ? Math.min(100, Number((m.totalSpent * 10000n) / denom) / 100) : 0; return <article className="mandate-card" key={m.id}><div className="mandate-card-top"><div className="mandate-icon"><Fingerprint size={18}/></div><div className="mandate-title"><strong>Mandate #{m.id.toString()}</strong><span>{m.active && BigInt(Math.floor(Date.now()/1000)) < m.expiresAt ? "Active" : m.active ? "Expired" : "Revoked"}</span></div><span className={"mandate-badge " + (m.active && BigInt(Math.floor(Date.now()/1000)) < m.expiresAt ? "badge-active" : "badge-off")}>{m.active && BigInt(Math.floor(Date.now()/1000)) < m.expiresAt ? "ACTIVE" : "INACTIVE"}</span></div><div className="mandate-stats"><div><span>Current balance</span><strong>{formatNativeUsdc(m.balance)} USDC</strong></div><div><span>Total spent</span><strong>{formatNativeUsdc(m.totalSpent)} USDC</strong></div><div><span>Daily limit</span><strong>{formatNativeUsdc(m.dailyLimit)} USDC</strong></div><div><span>Max per payment</span><strong>{formatNativeUsdc(m.maxPerTx)} USDC</strong></div></div><div className="spend-progress"><div className="spend-progress-label"><span>Funding used</span><strong>{pct.toFixed(1)}%</strong></div><div className="spend-progress-track" role="progressbar" aria-label={"Mandate " + m.id.toString() + " funding used"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{width:pct+"%"}}/></div><small>Recorded spend relative to spend plus current balance; not a daily-limit indicator.</small></div></article>; })}</div>}
  </WorkspaceFrame>;
}

export function MarketResearchWorkspace() {
  const [asset, setAsset] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function research(event: FormEvent) {
    event.preventDefault();
    if (!asset.trim() || !snapshot.trim()) { setError("Enter an Arc token or trading pair and a recent market snapshot."); return; }
    setLoading(true); setError(""); setAnalysis("");
    try {
      const response = await fetch("/api/market-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset: asset.trim(), snapshot: snapshot.trim() }),
      });
      const payload = await response.json() as { analysis?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "AI market research is temporarily unavailable.");
      setAnalysis(payload.analysis || "No analysis was returned.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate market research.");
    } finally { setLoading(false); }
  }

  return <WorkspaceFrame title="AI Market Research" subtitle="Analyze Arc Mainnet tokens and trading pairs using a market snapshot, with AI-generated context and risk considerations.">
    <div className="research-source-card"><div className="mandate-icon"><BrainCircuit size={19}/></div><div><strong>Arc-native market research</strong><p>Use an Arc market screener to collect current price, 24-hour change, volume, liquidity, and any notable activity, then paste those observations below. Probon analyzes the data you provide; it does not pretend to have a live market feed.</p><a href="https://arcdexscan.com/" target="_blank" rel="noreferrer">Open Arc DEX Scan <ExternalLink size={13}/></a><a href="https://arcscreener.io/" target="_blank" rel="noreferrer">Open Arc DEX Screener <ExternalLink size={13}/></a></div></div>
    <form className="mandate-form research-form" onSubmit={research}><div className="form-heading"><div><h3>Analyze an Arc market</h3><p>Only Arc Mainnet assets and pairs are in scope. Do not include private keys or seed phrases.</p></div></div><label>Token / pair / contract address<input required value={asset} onChange={e=>setAsset(e.target.value)} placeholder="Token symbol, pair, or 0x…"/></label><label>Market snapshot<textarea required rows={6} value={snapshot} onChange={e=>setSnapshot(e.target.value)} placeholder={"Example:\nPrice: $0.012\n24h change: +8%\n24h volume: $45,000\nLiquidity: $18,000\nRecent observations: buy volume increased, price is volatile…"} maxLength={8000}/><span className="field-hint">Paste the latest available figures and source timestamp. Maximum 8,000 characters.</span></label><div className="form-note"><ShieldCheck size={16}/><span>Research is informational, based on the snapshot you provide, and is not a guarantee of performance or a trade instruction.</span></div><button className="primary-button" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16}/> : <BrainCircuit size={16}/>} {loading ? "Analyzing snapshot…" : "Generate AI research"}</button></form>
    {error && <div className="workspace-error"><CircleAlert size={16}/>{error}</div>}
    {analysis && <article className="mandate-card research-result"><div className="mandate-card-top"><div className="mandate-icon"><BrainCircuit size={19}/></div><div className="mandate-title"><strong>Research summary · {asset}</strong><span>Generated from user-supplied market data</span></div></div><div className="research-analysis">{analysis}</div><small className="portfolio-caption">Verify all figures against current Arc market sources before acting. This analysis does not execute trades.</small></article>}
  </WorkspaceFrame>;
}

export function SecurityWorkspace({ account, onNotice }: SharedProps) {
  const [mandates, setMandates] = useState<ProbonMandate[]>([]);
  const [contractOwner, setContractOwner] = useState<Address | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!account || !PROBON_CONTRACT_ADDRESS) {
      setMandates([]); setContractOwner(null); setPaused(false); return;
    }
    try {
      const [nextMandates, owner, pauseState] = await Promise.all([
        loadMandates(account), getContractOwner(), getContractPauseState(),
      ]);
      setMandates(nextMandates);
      setContractOwner(owner);
      setPaused(pauseState);
    } catch {
      setError("Security settings could not be loaded right now. Please try again shortly.");
    }
  }, [account]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function togglePause() {
    if (!account || !window.confirm(paused ? "Resume new payments across Probon?" : "Pause new payments across Probon? Existing mandate owners can still revoke and recover their remaining funds.")) return;
    setBusy(true); setError("");
    try {
      const hash = await setEmergencyPause(account, !paused);
      onNotice("Emergency control transaction submitted. Waiting for confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      setPaused(!paused);
      onNotice(paused ? "Probon global payment pause has been lifted." : "Probon global payment pause is active.");
      await refresh();
    } catch {
      setError("The security setting could not be updated. Check your wallet and try again.");
    } finally { setBusy(false); }
  }

  return <WorkspaceFrame title="Security" subtitle="Review the enforcement rules that protect each agent payment.">
    {!account ? <WalletRequired/> : !PROBON_CONTRACT_ADDRESS ? <ContractMissing/> : <>
      {error && <div className="workspace-error"><CircleAlert size={16}/>{error}</div>}
      <article className="mandate-card global-pause-card">
        <div className="mandate-card-top">
          <div className="mandate-icon"><ShieldCheck size={19}/></div>
          <div className="mandate-title"><strong>Global emergency pause</strong><span>{paused ? "New agent payments are blocked by the contract." : "The contract currently allows policy-valid payments."}</span></div>
          <span className={"mandate-badge " + (paused ? "badge-off" : "badge-active")}>{paused ? "PAUSED" : "LIVE"}</span>
        </div>
        {contractOwner?.toLowerCase() === account.toLowerCase()
          ? <button className={paused ? "primary-button" : "danger-button"} disabled={busy} onClick={() => void togglePause()}>{busy ? <LoaderCircle className="spin" size={15}/> : <ShieldCheck size={15}/>} {paused ? "Resume payments" : "Pause all payments"}</button>
          : <p className="global-pause-note">Only the contract administrator can change the global pause. Any mandate owner can revoke their own mandate and recover its remaining funds.</p>}
      </article>
      <div className="security-feature-grid">
        <article><div className="mandate-icon"><Fingerprint size={19}/></div><strong>Recipient allowlist</strong><p>Payments to any address not explicitly allowed by a mandate revert.</p></article>
        <article><div className="mandate-icon"><ShieldCheck size={19}/></div><strong>Per-payment cap</strong><p>Each payment is bounded by the mandate's max-per-transaction amount.</p></article>
        <article><div className="mandate-icon"><RefreshCw size={19}/></div><strong>Daily spend limit</strong><p>Spend is counted by chain timestamp day and enforced on-chain.</p></article>
        <article><div className="mandate-icon"><X size={19}/></div><strong>Revoke & refund</strong><p>Mandate owners can revoke access and recover any remaining balance.</p></article>
      </div>
      <div className="workspace-toolbar"><span>Mandate security status</span><span>{mandates.filter(m => m.active && BigInt(Math.floor(Date.now()/1000)) < m.expiresAt).length} active</span></div>
      {mandates.length === 0
        ? <div className="workspace-empty"><ShieldCheck size={25}/><strong>No mandate policies found</strong><span>Create a mandate to activate contract-enforced rules.</span></div>
        : <div className="mandate-list">{mandates.map(m => <article className="mandate-card security-row" key={m.id.toString()}><div className="mandate-card-top"><div className="mandate-icon"><ShieldCheck size={18}/></div><div className="mandate-title"><strong>Mandate #{m.id.toString()}</strong><span>{m.recipients.length} allowed recipient(s)</span></div><span className={"mandate-badge " + (m.active ? "badge-active" : "badge-off")}>{m.active ? "ACTIVE" : "REVOKED"}</span></div><p>Max payment {formatNativeUsdc(m.maxPerTx)} USDC · Daily cap {formatNativeUsdc(m.dailyLimit)} USDC · Expires {new Date(Number(m.expiresAt)*1000).toLocaleDateString()}</p></article>)}</div>}
    </>}
  </WorkspaceFrame>;
}


function WorkspaceFrame({title,subtitle,action,children}:{title:string;subtitle:string;action?:ReactNode;children:ReactNode}) {
  return <section className="workspace-page"><div className="workspace-page-heading"><div><div className="eyebrow">PROBON · ARC MAINNET</div><h1>{title}<span className="heading-period">.</span></h1><p>{subtitle}</p></div>{action}</div>{children}</section>;
}
