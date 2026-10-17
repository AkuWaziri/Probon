import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, Bot, CircleAlert, ExternalLink, Fingerprint, LoaderCircle, Plus, RefreshCw, ShieldCheck, Wallet, X } from "lucide-react";
import type { Address } from "viem";
import { ARC_EXPLORER_URL, PROBON_CONTRACT_ADDRESS } from "../lib/arc";
import {
  createMandateOnChain, executePaymentOnChain, formatNativeUsdc, getContractAddress,
  loadMandates, loadPayments, publicClient, revokeMandateOnChain,
  fundMandateOnChain, type ProbonMandate, type ProbonPayment,
} from "../lib/probonClient";

type SharedProps = { account: Address | null; onNotice: (message: string) => void };
const short = (value: string) => value.length > 14 ? value.slice(0, 7) + "…" + value.slice(-5) : value;
const explorerTx = (hash: string) => ARC_EXPLORER_URL + "/tx/" + hash;
const explorerAddress = (address: string) => ARC_EXPLORER_URL + "/address/" + address;

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

  const refresh = useCallback(async () => {
    if (!account || !getContractAddress()) { setMandates([]); return; }
    setLoading(true); setError("");
    try { setMandates(await loadMandates(account)); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load mandates from Arc Mainnet."); }
    finally { setLoading(false); }
  }, [account]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!account) return;
    setSubmitting(true); setError("");
    try {
      const hash = await createMandateOnChain({
        account, agent, recipients: recipients.split(/[\n,;]/), maxPerTx, dailyLimit,
        expiryDays: Number(expiryDays), initialFunding,
      });
      onNotice("Mandate transaction submitted. Waiting for Arc Mainnet confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      onNotice("Mandate created on Arc Mainnet. Transaction: " + hash);
      setShowForm(false); setAgent(""); setRecipients(""); setInitialFunding("0");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Mandate creation failed."); }
    finally { setSubmitting(false); }
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
    } catch (e) { setError(e instanceof Error ? e.message : "Revocation failed."); }
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
    } catch (e) { setError(e instanceof Error ? e.message : "Funding failed."); }
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
      <button className="primary-button" type="submit" disabled={submitting || !PROBON_CONTRACT_ADDRESS}>{submitting ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} {submitting ? "Waiting for transaction…" : "Review & create mandate"}</button>
    </form>}
    <div className="workspace-toolbar"><span>{mandates.length} mandate{mandates.length === 1 ? "" : "s"} found for this wallet</span><button className="subtle-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Refresh</button></div>
    {loading ? <div className="workspace-empty"><LoaderCircle className="spin" size={22}/><span>Reading Arc Mainnet…</span></div> : mandates.length === 0 ? <div className="workspace-empty"><Fingerprint size={26}/><strong>No mandates yet</strong><span>Create your first on-chain spending policy. Nothing is stored until a wallet transaction confirms.</span>{PROBON_CONTRACT_ADDRESS && <button className="primary-button" onClick={() => setShowForm(true)}><Plus size={16}/> Create mandate</button>}</div> :
      <div className="mandate-list">{mandates.map(m => <article className="mandate-card" key={m.id}>
        <div className="mandate-card-top"><div className="mandate-icon"><Fingerprint size={18}/></div><div className="mandate-title"><strong>Mandate #{m.id.toString()}</strong><span>{m.active ? (BigInt(Math.floor(Date.now()/1000)) >= m.expiresAt ? "Expired" : "Active") : "Revoked"}</span></div><span className={"mandate-badge " + (m.active && BigInt(Math.floor(Date.now()/1000)) < m.expiresAt ? "badge-active" : "badge-off")}>{m.active && BigInt(Math.floor(Date.now()/1000)) < m.expiresAt ? "ENFORCED" : "INACTIVE"}</span></div>
        <div className="mandate-stats"><div><span>Available balance</span><strong>{formatNativeUsdc(m.balance)} USDC</strong></div><div><span>Max per payment</span><strong>{formatNativeUsdc(m.maxPerTx)} USDC</strong></div><div><span>Daily limit</span><strong>{formatNativeUsdc(m.dailyLimit)} USDC</strong></div><div><span>Total spent</span><strong>{formatNativeUsdc(m.totalSpent)} USDC</strong></div></div>
        <div className="mandate-addresses"><div><span>Agent</span><a href={explorerAddress(m.agent)} target="_blank" rel="noreferrer">{short(m.agent)} <ExternalLink size={12}/></a></div><div><span>Allowed recipients ({m.recipients.length})</span><div className="recipient-chips">{m.recipients.map(r=><a key={r} href={explorerAddress(r)} target="_blank" rel="noreferrer">{short(r)}</a>)}</div></div><div><span>Expiry</span><strong>{new Date(Number(m.expiresAt)*1000).toLocaleString()}</strong></div></div>
        <div className="mandate-actions"><a className="subtle-button" href={explorerAddress(getContractAddress())} target="_blank" rel="noreferrer">View contract <ArrowUpRight size={14}/></a>{m.active && <><button className="outline-button" disabled={submitting} onClick={() => void fund(m)}><Plus size={14}/> Fund</button><button className="danger-button" disabled={submitting} onClick={() => void revoke(m)}><X size={14}/> Revoke & refund</button></>}</div>
      </article>)}</div>}
  </WorkspaceFrame>;
}

export function AgentsWorkspace({ account }: SharedProps) {
  const [mandates, setMandates] = useState<ProbonMandate[]>([]);
  useEffect(() => { if (account && getContractAddress()) void loadMandates(account).then(setMandates).catch(()=>setMandates([])); else setMandates([]); }, [account]);
  if (!account) return <WorkspaceFrame title="Agents" subtitle="Agent identities are read from your on-chain mandates."><WalletRequired account={account}/></WorkspaceFrame>;
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
  const refresh = useCallback(async()=>{if(!PROBON_CONTRACT_ADDRESS){setPayments([]);return;}setLoading(true);try{setPayments(await loadPayments());if(account)setMandates(await loadMandates(account));}catch(e){setError(e instanceof Error?e.message:"Unable to load on-chain activity.");}finally{setLoading(false);}},[account]);
  useEffect(()=>{void refresh();},[refresh]);
  async function pay(event:FormEvent){event.preventDefault();if(!account)return;setBusy(true);setError("");try{const hash=await executePaymentOnChain(account,BigInt(mandateId),recipient,amount);onNotice("Payment submitted. Waiting for confirmation…");await publicClient.waitForTransactionReceipt({hash});onNotice("Payment executed on Arc Mainnet: "+hash);await refresh();}catch(e){setError(e instanceof Error?e.message:"Payment failed.");}finally{setBusy(false);}}
  return <WorkspaceFrame title="Transactions" subtitle="On-chain payments emitted by the Probon contract.">{!account?<WalletRequired account={account}/>:!PROBON_CONTRACT_ADDRESS?<ContractMissing/>:<>
    {error&&<div className="workspace-error"><CircleAlert size={16}/>{error}</div>}
    <form className="mandate-form payment-form" onSubmit={pay}><div className="form-heading"><div><h3>Execute a policy-checked payment</h3><p>The connected wallet must be the agent assigned to the selected mandate.</p></div></div><div className="form-grid"><label>Mandate<select required value={mandateId} onChange={e=>setMandateId(e.target.value)}><option value="">Select mandate</option>{mandates.filter(m=>m.active).map(m=><option key={m.id.toString()} value={m.id.toString()}>#{m.id.toString()} · balance {formatNativeUsdc(m.balance)} USDC</option>)}</select></label><label>Recipient address<input required value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="0x…"/></label><label>Amount (USDC)<input required type="number" min="0.000000000000000001" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/></label></div><div className="form-note"><ShieldCheck size={16}/><span>The contract checks the connected agent, recipient allowlist, expiry, per-payment cap, daily cap, and available mandate balance. A rejected payment reverts on-chain.</span></div><button className="primary-button" disabled={busy||mandates.filter(m=>m.active).length===0}>{busy?<LoaderCircle className="spin" size={16}/>:<ArrowUpRight size={16}/>} Submit payment</button></form>
    <div className="workspace-toolbar"><span>Recent on-chain payments</span><button className="subtle-button" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={14} className={loading?"spin":""}/> Refresh</button></div>
    {loading?<div className="workspace-empty"><LoaderCircle className="spin" size={22}/><span>Loading on-chain events…</span></div>:payments.length===0?<div className="workspace-empty"><Wallet size={25}/><strong>No confirmed payments</strong><span>Real payment events will appear here after a transaction succeeds.</span></div>:<div className="payment-list">{payments.map(p=><article className="payment-row" key={p.transactionHash}><div className="mandate-icon"><ArrowUpRight size={17}/></div><div className="payment-main"><strong>{formatNativeUsdc(p.amount)} USDC · Mandate #{p.mandateId.toString()}</strong><span>To {short(p.recipient)} · Block {p.blockNumber.toString()}</span></div><a href={explorerTx(p.transactionHash)} target="_blank" rel="noreferrer">View tx <ExternalLink size={13}/></a></article>)}</div>}
  </>}</WorkspaceFrame>;
}

export function SecurityWorkspace({ account }: SharedProps) {
  const [mandates,setMandates]=useState<ProbonMandate[]>([]);
  useEffect(()=>{if(account&&PROBON_CONTRACT_ADDRESS)void loadMandates(account).then(setMandates).catch(()=>setMandates([]));else setMandates([]);},[account]);
  return <WorkspaceFrame title="Security" subtitle="Review the enforcement rules that protect each agent payment.">{!account?<WalletRequired account={account}/>:!PROBON_CONTRACT_ADDRESS?<ContractMissing/>:<><div className="security-feature-grid"><article><div className="mandate-icon"><Fingerprint size={19}/></div><strong>Recipient allowlist</strong><p>Payments to any address not explicitly allowed by a mandate revert.</p></article><article><div className="mandate-icon"><ShieldCheck size={19}/></div><strong>Per-payment cap</strong><p>Each payment is bounded by the mandate's max-per-transaction amount.</p></article><article><div className="mandate-icon"><RefreshCw size={19}/></div><strong>Daily spend limit</strong><p>Spend is counted by UTC-like chain timestamp day and enforced on-chain.</p></article><article><div className="mandate-icon"><X size={19}/></div><strong>Revoke & refund</strong><p>Mandate owners can revoke access and recover any remaining balance.</p></article></div><div className="workspace-toolbar"><span>Mandate security status</span><span>{mandates.filter(m=>m.active&&BigInt(Math.floor(Date.now()/1000))<m.expiresAt).length} active</span></div>{mandates.length===0?<div className="workspace-empty"><ShieldCheck size={25}/><strong>No mandate policies found</strong><span>Create a mandate to activate contract-enforced rules.</span></div>:<div className="mandate-list">{mandates.map(m=><article className="mandate-card security-row" key={m.id}><div className="mandate-card-top"><div className="mandate-icon"><ShieldCheck size={18}/></div><div className="mandate-title"><strong>Mandate #{m.id.toString()}</strong><span>{m.recipients.length} allowed recipient(s)</span></div><span className={"mandate-badge "+(m.active?"badge-active":"badge-off")}>{m.active?"ACTIVE":"REVOKED"}</span></div><p>Max payment {formatNativeUsdc(m.maxPerTx)} USDC · Daily cap {formatNativeUsdc(m.dailyLimit)} USDC · Expires {new Date(Number(m.expiresAt)*1000).toLocaleDateString()}</p></article>)}</div>}</>}</WorkspaceFrame>;
}

export function SettingsWorkspace({ account }: SharedProps) {
  return <WorkspaceFrame title="Settings" subtitle="Network and contract configuration for Probon."><div className="settings-list"><div><span>Network</span><strong>Arc Mainnet</strong><small>Chain ID {ARC_CHAIN_ID_LABEL} · Real-value network</small></div><div><span>RPC endpoint</span><strong>rpc.mainnet.arc.io</strong><small>Official Arc Mainnet endpoint</small></div><div><span>Connected wallet</span><strong>{account?short(account):"Not connected"}</strong>{account&&<a href={explorerAddress(account)} target="_blank" rel="noreferrer">View on Arc Explorer <ExternalLink size={13}/></a>}</div><div><span>Probon contract</span><strong>{PROBON_CONTRACT_ADDRESS?short(PROBON_CONTRACT_ADDRESS):"Not deployed / not configured"}</strong>{PROBON_CONTRACT_ADDRESS&&<a href={explorerAddress(PROBON_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">View contract <ExternalLink size={13}/></a>}</div><div><span>Asset and precision</span><strong>Native USDC · 18 decimal native-value units</strong><small>Transaction amounts in this app are sent as Arc native value, not ERC-20 approval transfers.</small></div></div>{!PROBON_CONTRACT_ADDRESS&&<ContractMissing/>}<div className="form-note settings-warning"><CircleAlert size={16}/><span>Arc Mainnet transactions can move real USDC. Review every amount and address in your wallet before signing. Probon does not have access to your private key.</span></div></WorkspaceFrame>;
}

const ARC_CHAIN_ID_LABEL = "5042";

function WorkspaceFrame({title,subtitle,action,children}:{title:string;subtitle:string;action?:ReactNode;children:ReactNode}) {
  return <section className="workspace-page"><div className="workspace-page-heading"><div><div className="eyebrow">PROBON · ARC MAINNET</div><h1>{title}<span className="heading-period">.</span></h1><p>{subtitle}</p></div>{action}</div>{children}</section>;
}
