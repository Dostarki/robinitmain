import React, { useEffect, useRef, useState } from 'react';
import CreatorInsights from './CreatorInsights';
import './style.css';
import './brand.css';

const NETWORKS = { solana: 'Solana', ethereum: 'Ethereum', base: 'Base', arbitrum: 'Arbitrum', optimism: 'Optimism', bsc: 'BNB Chain', polygon: 'Polygon' };
const STORE = 'test-risk-reports-v2';
const normalize = r => ({ ...r, score: r.analysisVersion === 'TEST-RISK-v1' && r.scoreScale !== 'safety' ? 100 - r.score : r.score, scoreScale: 'safety' });
const tokenKey = r => r.chain + ':' + (r.chain === 'solana' ? r.address : r.address.toLowerCase());
const merge = reports => {
  const found = new Map();
  for (const report of reports.filter(Boolean).sort((a,b) => b.analyzedAt - a.analyzedAt)) if (!found.has(tokenKey(report))) found.set(tokenKey(report), normalize(report));
  return [...found.values()].slice(0,100);
};
function restored() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '[]');
    const legacy = JSON.parse(localStorage.getItem('test-risk-chats-v1') || '[]').flatMap(c => (c.messages || []).map(m => m.report).filter(Boolean));
    return merge([...saved, ...legacy]);
  } catch { return []; }
}
function extract(text, chain) {
  const evm = text.match(/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/);
  const mint = text.match(/(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/);
  const pump = text.match(/(?:https?:\/\/)?(?:www\.)?pump\.fun\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/i);
  if (pump) return { chain: 'solana', address: pump[1] };
  if (evm) return { chain: chain === 'solana' ? 'ethereum' : chain, address: evm[0] };
  if (mint) return { chain: 'solana', address: mint[1] };
  return null;
}
function Icon({ type, size = 18 }) {
  const paths = { arrow: <><path d="M12 19V5m-6 6 6-6 6 6" /></>, search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>, spark: <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" />, close: <path d="m6 6 12 12M18 6 6 18" />, refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15" /></>, menu: <path d="M4 6h16M4 12h16M4 18h16" /> };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}
function Typed({ text }) {
  const [length, setLength] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setLength(text.length); return; }
    setLength(0); const timer = setInterval(() => setLength(n => { if (n >= text.length) clearInterval(timer); return Math.min(n + 4, text.length); }), 18);
    return () => clearInterval(timer);
  }, [text]);
  return <p className="reply-text">{text.slice(0, length)}{length < text.length && <span className="cursor" />}</p>;
}
function TokenAvatar({ report, logo, large = false }) {
  const [failed, setFailed] = useState(null);
  const source = typeof (logo || report.logo) === 'string' && /^https:\/\//i.test(logo || report.logo) ? logo || report.logo : null;
  return <span className={'token-glyph ' + (large ? 'token-portrait' : '')}>{source && source !== failed ? <img src={source} alt={report.name + ' token icon'} loading={large ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => setFailed(source)}/> : <span>{(report.symbol && report.symbol !== '—' ? report.symbol : report.name).slice(0,1)}</span>}</span>;
}
function Report({ report, logo }) {
  const criteria = report.criteria || (report.signals || []).map(s => ({ title: s.title, points: s.weight, status: 'warning', note: 'A risk signal was returned for this control.' }));
  const warnings = criteria.filter(c => c.status === 'warning');
  const tier = report.score >= 80 ? 'green' : report.score >= 55 ? 'amber' : 'red';
  return <div className="report" key={report.id || report.address}>
    <section className={'score-card enter ' + tier} style={{ '--delay': '500ms' }}>
      <div className="asset-heading"><TokenAvatar report={report} logo={logo} large/><div><span className="eyebrow">SAFETY ASSESSMENT</span><h2>{report.name}</h2><span className="asset-meta">{report.symbol} <i /> {NETWORKS[report.chain] || report.chain}</span></div></div>
      <div className="score-value"><strong>{report.score}</strong><span>/ 100</span><small>{tier === 'green' ? 'Fewer flagged signals' : tier === 'amber' ? 'Review with care' : 'Significant concerns'}</small></div>
      <div className="score-bar"><div style={{ width: report.score + '%' }} /></div>
    </section>
    <section className="findings enter" style={{ '--delay': '800ms' }}><div className="section-title"><h3>What needs your attention</h3><span>{warnings.length} flagged</span></div>
      {warnings.length ? warnings.map((c, i) => <div className="finding enter" key={c.title} style={{ '--delay': 950 + i * 140 + 'ms' }}><div className="warning-dot" /><div><strong>{c.title}</strong><p>{c.note || 'Review this privileged capability before interacting with the token.'}</p></div><span className="deduction">−{c.points || c.weight || 0}</span></div>) : <p className="quiet-note">No listed controls were flagged in this assessment. Available checks do not cover every possible risk.</p>}
    </section>
    <details className="all-checks enter" style={{ '--delay': '1200ms' }}><summary>All security checks <span>{criteria.length} checks <b>＋</b></span></summary><div className="checks-grid">{criteria.map(c => <div className="check" key={c.title}><span>{c.title}</span><small className={c.status === 'warning' ? 'flagged' : ''}>{c.status === 'warning' ? '−' + c.points : 'No flag · 0'}</small><p>{c.note}</p></div>)}</div></details>
    <CreatorInsights report={report}/>
    <div className="report-footer enter" style={{ '--delay': '1350ms' }}><code>{report.address}</code><span>{new Date(report.analyzedAt).toLocaleString()} · {report.cached ? 'Cached assessment' : 'Saved assessment'}</span></div>
  </div>;
}
export function RiskApp() {
  const [history, setHistory] = useState(restored), [selected, setSelected] = useState(null), [input, setInput] = useState(''), [chain, setChain] = useState('ethereum'), [busy, setBusy] = useState(false), [stage, setStage] = useState(0), [messages, setMessages] = useState([]), [sidebar, setSidebar] = useState(false);
  const textarea = useRef();
  const [icons, setIcons] = useState({});
  const requestedIcons = useRef(new Set());
  useEffect(() => {
    const grouped = {};
    for (const report of history) {
      const key = tokenKey(report);
      if (report.logo || requestedIcons.current.has(key)) continue;
      requestedIcons.current.add(key);
      (grouped[report.chain] ||= []).push(report.address);
    }
    for (const [network, addresses] of Object.entries(grouped)) for (let offset = 0; offset < addresses.length; offset += 30) {
      fetch('/api/risk/token-icons', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chain:network, addresses:addresses.slice(offset,offset+30)}), signal:AbortSignal.timeout(10000) })
        .then(response => { if (!response.ok) throw Error(); return response.json(); })
        .then(data => setIcons(old => ({ ...old, ...Object.fromEntries(Object.entries(data.icons).map(([address, logo]) => [tokenKey({chain:network,address}), logo])) })))
        .catch(() => {});
    }
  }, [history]);
  useEffect(() => { fetch('/api/risk/recent').then(r => { if (!r.ok) throw Error(); return r.json(); }).then(d => setHistory(old => merge([...old, ...d.reports]))).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(history)); } catch {} }, [history]);
  useEffect(() => { if (!busy) return; const timer = setInterval(() => setStage(n => Math.min(2, n + 1)), 2000); return () => clearInterval(timer); }, [busy]);
  function reply(text) { setMessages(old => [...old, { role: 'assistant', text, id: crypto.randomUUID() }]); }
  function view(report) { if (busy) return; setSelected(report); setMessages([]); setSidebar(false); }
  async function analyze(asset, text) {
    setBusy(true); setStage(0); setSelected(null); setMessages([{ role:'user', text, id:crypto.randomUUID() }]);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/risk/analyze', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(asset), signal:controller.signal });
      const data = await response.json(); if (!response.ok) throw Error(data.error || 'The analysis could not be completed.');
      const report = normalize(data.report); setSelected(report); setHistory(old => merge([report, ...old]));
      reply('Assessment: ' + report.name + '.');
    } catch (error) { reply(error.name === 'AbortError' ? 'The analysis service took too long to respond. Please try again.' : error instanceof TypeError ? 'Unable to reach the analysis service. Please try again.' : error.message); }
    finally { clearTimeout(timeout); setBusy(false); }
  }
  function submit(event) {
    event?.preventDefault(); const text=input.trim(); if (!text || busy) return; setInput('');
    if (text.toLowerCase() === '!clear') { setSelected(null); setMessages([]); return; }
    if (text.toLowerCase() === '!help') { setSelected(null); setMessages([{ role:'user', text, id:crypto.randomUUID() }]); reply('Available commands\n\n!help — show this guide.\n!clear — clear the central analysis view. Your token history stays available.\n!refresh — run a new request for the displayed token; recent data may be cached.\n\nPaste a Solana mint, an EVM contract, or a Pump.fun coin link to analyse a token. Select its network for EVM addresses.'); return; }
    if (text.toLowerCase() === '!refresh') { if (selected) analyze({ chain:selected.chain, address:selected.address }, '!refresh'); else reply('Select a token from history before using !refresh.'); return; }
    const asset=extract(text,chain); if (!asset) { reply('Paste a valid token address or Pump.fun coin link. Type !help to see the available commands.'); return; } analyze(asset,text);
  }
  const expanded = selected || messages.length || busy;
  return <div className="app-shell">
    {sidebar && <button className="scrim" onClick={() => setSidebar(false)} aria-label="Close history" />}
    <aside className={'history-panel ' + (sidebar ? 'open' : '')}><a className="brand" href="/landing.html"><img className="brand-logo" src="/assets/robinity-logo.png" width="38" height="26" alt="" aria-hidden="true"/><span className="brand-name">Robinity <span>Intelligence</span></span></a><div className="history-heading"><span>Recent analyses</span><span>{history.length.toString().padStart(2,'0')}</span></div><nav aria-label="Token analysis history">{history.length ? history.map(report => <button disabled={busy} key={report.chain + report.address} className={'token-history ' + (selected?.address === report.address && selected?.chain === report.chain ? 'active' : '')} onClick={() => view(report)} aria-label={'View ' + (report.symbol || report.name) + ', safety score ' + report.score + ' of 100'}><TokenAvatar report={report} logo={icons[tokenKey(report)]}/><span className="token-name">{report.symbol && report.symbol !== '—' ? report.symbol.slice(0,14) : report.name.slice(0,16)}</span><span className="history-arrow">↗</span><span className="score-tooltip">{report.score}/100 safety · {NETWORKS[report.chain]}</span></button>) : <p className="history-empty">Your analysed tokens<br />will appear here.</p>}</nav><a className="sidebar-bottom" href="/landing.html">← Robinity Intelligence</a></aside>
    <main className="workspace"><div className={'intelligence-watermark ' + (busy ? 'is-thinking' : '')} aria-hidden="true"><span className="watermark-halo"/><img src="/assets/robinity-logo.png" width="826" height="548" alt=""/><span className="watermark-glint"/></div><header className="topbar"><button className="mobile-menu" onClick={() => setSidebar(true)} aria-label="Show token history"><Icon type="menu" /></button><span>Risk intelligence <span className="beta">BETA</span></span><span className="top-status"><i />On-chain analysis</span></header><div className={'center-column ' + (expanded ? 'has-result' : '')}>
      {!expanded && <section className="welcome"><div className="orb-scene" aria-hidden="true"><div className="orb-ring" /><div className="emblem-stage"><img className="welcome-emblem" src="/assets/robinity-logo.png" width="106" height="72" alt=""/></div><span className="orbit-dot" /></div><span className="eyebrow">Robinity Intelligence</span><h1>Check the token.</h1><p>Paste an address to view security and creator activity.</p></section>}
      {messages.map(m => <div key={m.id} className={'message ' + m.role}>{m.role==='user' ? <p>{m.text}</p> : <><span className="assistant-icon"><img src="/assets/robinity-logo.png" width="22" height="15" alt="" aria-hidden="true"/></span><Typed text={m.text}/></>}</div>)}
      {busy && <div className="loading" role="status"><span className="thinking-orb" /><div><strong>{['Checking token','Checking signals','Building report'][stage]}</strong><span>Analysis in progress</span></div><div className="loading-dots"><i/><i/><i/></div></div>}
      {selected && !busy && <Report report={selected} logo={icons[tokenKey(selected)]}/>}<form className="composer" onSubmit={submit}><div className="input-row"><textarea ref={textarea} aria-label="Contract address or analysis command" placeholder="Paste a contract address or Pump.fun link…" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}}} rows={2} disabled={busy}/><button type="submit" disabled={busy||!input.trim()} aria-label="Analyse token"><Icon type="arrow" /></button></div><div className="composer-bottom"><label><span className="network-dot"/><select aria-label="EVM token network" value={chain} onChange={e=>setChain(e.target.value)}>{Object.entries(NETWORKS).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><button type="button" onClick={()=>{setInput('!help');textarea.current?.focus();}}>Type <kbd>!help</kbd> for commands</button></div></form><p className="footnote">Scores do not guarantee safety.</p>
    </div></main></div>;
}
