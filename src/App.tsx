import { useEffect, useState } from "react";
import type { Address } from "viem";
import { connectWallet, formatNativeUsdc, getNativeUsdcBalance, loadMandates } from "./lib/probonClient";
import { ARC_CHAIN_ID, PROBON_CONTRACT_ADDRESS } from "./lib/arc";
import { AgentsWorkspace, MandatesWorkspace, SecurityWorkspace, SettingsWorkspace, TransactionsWorkspace } from "./components/Workspaces";
import {
  Activity, ArrowDownLeft, ArrowUpRight, Bell, Bot, ChevronDown,
  CircleHelp, ExternalLink, Fingerprint, Gauge,
  LayoutDashboard, LockKeyhole, Menu, Plus, Settings2, Shield,
  ShieldAlert, ShieldCheck, SlidersHorizontal, Wallet, X
} from "lucide-react";

type NavItem = "Overview" | "Mandates" | "Agents" | "Transactions" | "Security" | "Settings";

const navItems: { label: NavItem; icon: typeof LayoutDashboard }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Mandates", icon: Fingerprint },
  { label: "Agents", icon: Bot },
  { label: "Transactions", icon: Activity },
  { label: "Security", icon: ShieldCheck },
  { label: "Settings", icon: Settings2 },
];

const transactions: { name: string; detail: string; amount: string; time: string; state: string; kind: string }[] = [];

function App() {
  const [active, setActive] = useState<NavItem>("Overview");
  const [walletAddress, setWalletAddress] = useState<Address | null>(null);
  const [nativeBalance, setNativeBalance] = useState<bigint | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [mandateCount, setMandateCount] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState("");

  const handleNav = (label: NavItem) => {
    setActive(label);
    setMobileNav(false);
    setNotice("");
  };

  const handleWallet = async () => {
    if (walletAddress) {
      setWalletAddress(null);
      setNativeBalance(null);
      setNotice("Wallet disconnected from this app session.");
      return;
    }
    setWalletBusy(true);
    try {
      const address = await connectWallet();
      setWalletAddress(address);
      const balance = await getNativeUsdcBalance(address);
      setNativeBalance(balance);
      setNotice("Wallet connected to Arc Mainnet.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Wallet connection failed.");
    } finally {
      setWalletBusy(false);
    }
  };

  useEffect(() => {
    if (!walletAddress) { setMandateCount(0); return; }
    let cancelled = false;
    const refresh = async () => {
      try {
        const [balance, mandates] = await Promise.all([getNativeUsdcBalance(walletAddress), loadMandates(walletAddress)]);
        if (!cancelled) {
          setNativeBalance(balance);
          setMandateCount(mandates.filter(m => m.active && BigInt(Math.floor(Date.now() / 1000)) < m.expiresAt).length);
        }
      } catch {
        if (!cancelled) setMandateCount(0);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [walletAddress]);

  return (
    <div className="app-shell">
      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Shield size={19} strokeWidth={2.5} /></div>
          <span>probon<span className="brand-period">.</span></span>
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={18} /></button>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">A</div>
          <div className="workspace-copy"><strong>Acme Studio</strong><span>Personal workspace</span></div>
          <ChevronDown size={15} className="muted-icon" />
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${active === label ? "nav-item-active" : ""}`} onClick={() => handleNav(label)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {label === "Security" && <span className="nav-count">2</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon"><CircleHelp size={17} /></div>
            <div><strong>Need a hand?</strong><p>Explore the docs and get started.</p><button onClick={() => setNotice("Documentation link will be connected soon.")}>Open documentation <ArrowUpRight size={13} /></button></div>
          </div>
          <button className="profile-row" onClick={() => handleNav("Settings")}>
            <div className="profile-avatar">AW</div>
            <div className="profile-copy"><strong>Workspace owner</strong><span>Owner access</span></div>
            <ChevronDown size={15} className="muted-icon" />
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
            <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{active}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="network-pill"><span className="network-dot" /> Arc Testnet <ChevronDown size={13} /></div>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice("You're all caught up. No new notifications.")}><Bell size={18} /><i /></button>
            <button className={`connect-button ${walletAddress ? "connected-button" : ""}`} onClick={() => void handleWallet()} disabled={walletBusy}>
              <Wallet size={16} /> {walletBusy ? "Connecting…" : walletAddress ? walletAddress.slice(0, 6) + "…" + walletAddress.slice(-4) : "Connect wallet"}
            </button>
          </div>
        </header>

        <div className="page-content">
          {notice && <div className="notice-bar"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></button></div>}
          {active === "Overview" ? (
            <>
              <section className="welcome-row">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> AGENT PAYMENT CONTROL</div>
                  <h1>Good afternoon<span className="heading-period">.</span></h1>
                  <p className="page-subtitle">Your agents are working. Your rules are in control.</p>
                </div>
                <button className="primary-button" onClick={() => handleNav("Mandates")}><Plus size={17} /> Create mandate</button>
              </section>

              <section className="security-banner">
                <div className="banner-symbol"><ShieldCheck size={21} /></div>
                <div className="banner-copy"><strong>Your spending layer is ready to be configured</strong><span>Set clear boundaries before your agents make their first payment.</span></div>
                <button onClick={() => handleNav("Security")}>Review controls <ArrowUpRight size={15} /></button>
                <div className="banner-glow" />
              </section>

              <section className="stats-grid" aria-label="Account overview">
                <article className="stat-card">
                  <div className="stat-top"><span>Protected balance</span><span className="stat-icon purple"><Wallet size={17} /></span></div>
                  <div className="stat-value">{nativeBalance === null ? "—" : formatNativeUsdc(nativeBalance)} <span className="stat-unit">USDC</span></div>
                  <div className="stat-foot"><span className="status-dot neutral" /> {walletAddress ? "Arc Mainnet wallet balance" : "Connect wallet to read balance"}</div>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span>Active mandates</span><span className="stat-icon cyan"><Fingerprint size={17} /></span></div>
                  <div className="stat-value">{mandateCount} <span className="stat-unit">mandates</span></div>
                  <div className="stat-foot"><span className="status-dot neutral" /> {walletAddress ? "Active on-chain mandates" : "Connect wallet to load mandates"}</div>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span>Payments this month</span><span className="stat-icon green"><ArrowUpRight size={17} /></span></div>
                  <div className="stat-value">$0.00 <span className="stat-unit">USDC</span></div>
                  <div className="stat-foot"><span className="status-dot neutral" /> Activity appears here</div>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span>Blocked attempts</span><span className="stat-icon orange"><ShieldAlert size={17} /></span></div>
                  <div className="stat-value">0 <span className="stat-unit">blocked</span></div>
                  <div className="stat-foot"><span className="status-dot neutral" /> Policy checks are not active</div>
                </article>
              </section>

              <section className="content-grid">
                <article className="panel activity-panel">
                  <div className="panel-heading"><div><h2>Payment activity</h2><p>Track what your agents are spending.</p></div><button className="subtle-button" onClick={() => handleNav("Transactions")}>View activity <ArrowUpRight size={14} /></button></div>
                  <div className="chart-summary"><div><strong>$0.00</strong><span>USDC spent</span></div><div className="chart-period"><span className="period-dot" /> Last 7 days <ChevronDown size={13} /></div></div>
                  <div className="chart-area">
                    <div className="chart-y-labels"><span>$40</span><span>$30</span><span>$20</span><span>$10</span><span>$0</span></div>
                    <div className="chart-plot">
                      <div className="chart-gridline line-1" /><div className="chart-gridline line-2" /><div className="chart-gridline line-3" /><div className="chart-gridline line-4" /><div className="chart-gridline line-5" />
                      <svg className="chart-svg" viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label="No payment activity yet">
                        <defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8172f7" stopOpacity=".18" /><stop offset="100%" stopColor="#8172f7" stopOpacity="0" /></linearGradient></defs>
                        <path d="M0 144 C35 144 40 140 70 142 S115 132 145 139 S185 134 215 140 S255 125 285 135 S325 132 355 138 S395 120 425 132 S470 129 500 136 S555 126 600 130 L600 160 L0 160 Z" fill="url(#areaFill)" />
                        <path d="M0 144 C35 144 40 140 70 142 S115 132 145 139 S185 134 215 140 S255 125 285 135 S325 132 355 138 S395 120 425 132 S470 129 500 136 S555 126 600 130" fill="none" stroke="#8172f7" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 6" opacity=".65" />
                      </svg>
                      <div className="empty-chart-label"><span><Activity size={16} /></span><strong>No activity yet</strong><small>Your payment history will appear here.</small></div>
                    </div>
                    <div className="chart-x-labels"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
                  </div>
                </article>

                <article className="panel controls-panel">
                  <div className="panel-heading"><div><h2>Security controls</h2><p>Core protections for your agents.</p></div><span className="controls-status">SETUP</span></div>
                  <div className="control-list">
                    <button className="control-row" onClick={() => handleNav("Mandates")}><span className="control-icon"><Fingerprint size={17} /></span><span className="control-copy"><strong>Spending mandates</strong><small>Define what agents can spend</small></span><span className="control-state pending">Not set</span><ChevronDown size={15} className="control-chevron" /></button>
                    <button className="control-row" onClick={() => handleNav("Security")}><span className="control-icon"><LockKeyhole size={17} /></span><span className="control-copy"><strong>Recipient allowlist</strong><small>Restrict payments to trusted addresses</small></span><span className="control-state pending">Not set</span><ChevronDown size={15} className="control-chevron" /></button>
                    <button className="control-row" onClick={() => handleNav("Security")}><span className="control-icon"><Gauge size={17} /></span><span className="control-copy"><strong>Spending limits</strong><small>Set transaction and daily caps</small></span><span className="control-state pending">Not set</span><ChevronDown size={15} className="control-chevron" /></button>
                    <button className="control-row" onClick={() => handleNav("Security")}><span className="control-icon"><ShieldCheck size={17} /></span><span className="control-copy"><strong>Emergency stop</strong><small>Revoke agent permissions quickly</small></span><span className="control-state ready">Available</span><ChevronDown size={15} className="control-chevron" /></button>
                  </div>
                  <button className="outline-button full-width" onClick={() => handleNav("Security")}><SlidersHorizontal size={15} /> Configure security</button>
                </article>
              </section>

              <section className="panel transactions-panel">
                <div className="panel-heading"><div><h2>Recent transactions</h2><p>Latest payment activity across your agents.</p></div><button className="subtle-button" onClick={() => handleNav("Transactions")}>View all <ArrowUpRight size={14} /></button></div>
                <div className="table-wrap">
                  <table><thead><tr><th>PAYMENT</th><th>AGENT / WALLET</th><th>AMOUNT</th><th>TIME</th><th>STATUS</th><th /></tr></thead>
                    <tbody>{transactions.slice(0, 3).map((tx) => <tr key={tx.name}><td><div className="transaction-name"><span className={`tx-icon tx-${tx.kind}`}>{tx.kind === "blocked" ? <ShieldAlert size={15} /> : tx.kind === "in" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span><strong>{tx.name}</strong></div></td><td className="tx-detail">{tx.detail}</td><td className={`tx-amount ${tx.kind === "in" ? "amount-in" : tx.kind === "blocked" ? "amount-blocked" : ""}`}>{tx.amount}</td><td className="tx-time">{tx.time}</td><td><span className={`tx-status status-${tx.kind}`}><span />{tx.state}</span></td><td><button className="row-action" aria-label={`Open ${tx.name} details`} onClick={() => setNotice("Transaction details will be available after on-chain integration.")}><ExternalLink size={14} /></button></td></tr>)}</tbody>
                  </table>
                </div>
                <div className="table-foot"><span><span className="status-dot neutral" /> {PROBON_CONTRACT_ADDRESS ? "Live contract integration" : "No contract address configured yet"}</span><button onClick={() => handleNav("Transactions")}>Explore transactions <ArrowUpRight size={14} /></button></div>
              </section>

              <footer className="page-footer"><span>© 2026 Probon</span><span><span className="footer-dot" /> Built for safer agent payments</span><button onClick={() => handleNav("Settings")}>Arc Mainnet · {ARC_CHAIN_ID} <ExternalLink size={12} /></button></footer>
            </>
          ) : active === "Mandates" ? (
            <MandatesWorkspace account={walletAddress} onNotice={setNotice} />
          ) : active === "Agents" ? (
            <AgentsWorkspace account={walletAddress} onNotice={setNotice} />
          ) : active === "Transactions" ? (
            <TransactionsWorkspace account={walletAddress} onNotice={setNotice} />
          ) : active === "Security" ? (
            <SecurityWorkspace account={walletAddress} onNotice={setNotice} />
          ) : (
            <SettingsWorkspace account={walletAddress} onNotice={setNotice} />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
