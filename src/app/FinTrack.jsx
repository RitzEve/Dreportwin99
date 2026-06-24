import { useState, useMemo, useRef, useEffect } from "react";
import FluidDropdown from "../components/FluidDropdown.jsx";
import useIsMobile from "../lib/useIsMobile.js";

// Short labels for the mobile bottom tab bar (the desktop sidebar uses the full
// nav labels, but "Bank Accounts" / "Transactions" are too wide for a phone tab).
const MOBILE_TAB_LABEL = { dashboard:"Home", transactions:"Record", banks:"Banks", members:"Members", search:"Search" };

// ============================================================================
// SESSION — when this goes online, your login frontend/backend injects the
// authenticated operator and their company here (e.g. from an auth token).
// The whole app auto-reads from this object: no manual operator entry, the
// sidebar shows the company name + operator ID, and every transaction is
// auto-stamped with SESSION.operatorId. For multi-tenant use, load the right
// company's data based on SESSION.companyId.
//
// IMPORTANT: read this FRESH on every mount via readSession() — NOT once at
// module load. The portal sets window.FINTRACK_SESSION before this component
// renders. Logging out and back in as a different company re-mounts the app but
// keeps this module cached in memory, so a value captured once would stay stuck
// on the first company (wrong name in the sidebar/header AND wrong data key).
// ============================================================================
const SESSION_DEFAULT = {
  companyId: "demo-co",
  companyName: "Demo Company Pty Ltd",
  companyLogo: "",
  timezone: "Australia/Sydney",
  operatorId: "OP-001",
  operatorName: "Operator",
};
const readSession = () => (typeof window!=="undefined" && window.FINTRACK_SESSION) || SESSION_DEFAULT;


const ENTRY_TYPES = ["Regular Deposit","Regular Withdrawal","Unclaimed Credit","Transfer","Store","Mistake","Rental","Adjust","Other"];
const SIGNED_TYPES = ["Unclaimed Credit","Mistake","Rental","Store","Adjust","Other"];
const INIT_BANKS = ["Acleda Bank","ABA Bank","Canadia Bank","Maybank","Wing Bank"];
const BANK_CHOICES = [
  "Commonwealth Bank of Australia (CBA)","Westpac Banking Corporation","National Australia Bank (NAB)",
  "Australia and New Zealand Banking Group (ANZ)","Bank of Queensland (BOQ)","Bendigo and Adelaide Bank",
  "Suncorp Bank","Macquarie Bank","Bankwest","Bank of Melbourne","St.George","BankSA","Bank Australia",
  "Great Southern Bank","Beyond Bank","People First Bank","Newcastle Greater Mutual Group (NGM)",
  "Teachers Mutual Bank","ING Australia","HSBC Bank Australia","Judo Bank","Ubank","Up Bank",
  "Payment Gateway","Others"
];
const TYPE_COLORS = {
  "Regular Deposit":"#16a34a","Regular Withdrawal":"#dc2626",
  "Unclaimed Credit":"#d97706","Mistake":"#7c3aed",
  "Rental":"#0891b2","Store":"#FFDE63","Transfer":"#6366f1","Adjust":"#0d9488",
  "Transfer Out":"#dc2626","Transfer In":"#16a34a","Other":"#64748b"
};
// Store's brand colour (#FFDE63) is a pale yellow — readable on a dark background
// but nearly invisible as plain text on a light one. So everywhere Store would be
// pale-yellow text we instead render a "GOLD CHIP WITH DARK TEXT": the yellow as a
// solid fill with dark ink on top. Reads cleanly in BOTH light and dark themes.
const STORE_COLOR = "#FFDE63";
const STORE_INK = "#3d2f00"; // dark brown text shown on the solid-yellow chip
const isPaleColor = c => c===STORE_COLOR; // colours too light to use as plain text
const goldChip = { background: STORE_COLOR, color: STORE_INK, borderRadius: 5, padding: "1px 7px", fontWeight: 600 };
// Keyboard shortcuts: Alt + first letter picks an entry type on the Transactions page.
const SHORTCUT_LETTER = {"Regular Deposit":"D","Regular Withdrawal":"W","Unclaimed Credit":"U","Transfer":"T","Store":"S","Mistake":"M","Rental":"R","Adjust":"A","Other":"O"};
const TYPE_SHORTCUTS = {d:"Regular Deposit",w:"Regular Withdrawal",u:"Unclaimed Credit",t:"Transfer",s:"Store",m:"Mistake",r:"Rental",a:"Adjust",o:"Other"};
const today = new Date().toISOString().split("T")[0];
const thisMonth = today.slice(0,7);
const fmt = n => { const v = Number(n)||0; return (v<0?"-$":"$")+Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); };
const monthLabel = ym => {
  const [y,m] = ym.split("-");
  return new Date(Number(y),Number(m)-1,1).toLocaleString("en-US",{month:"long",year:"numeric"});
};
const dateNDaysAgo = n => { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split("T")[0]; };
const yesterday = dateNDaysAgo(1);
const weekAgo = dateNDaysAgo(6);
// --- Time-zone aware "now" helpers. Each company stamps its transaction
// date/time in its own zone (SESSION.timezone), not the browser's. ---
const dateInTz = tz => { try { return new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); } catch(e){ return new Date().toISOString().split("T")[0]; } };
const timeInTz = tz => { try { return new Intl.DateTimeFormat("en-GB",{timeZone:tz,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date()); } catch(e){ return new Date().toTimeString().slice(0,5); } };
const dateNDaysAgoInTz = (n,tz) => { const d=new Date(dateInTz(tz)+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().split("T")[0]; };
// Short, friendly city name from an IANA zone, e.g. "Australia/Sydney" -> "Sydney".
const tzCity = tz => String(tz||"").split("/").pop().replace(/_/g," ");
const csvEscape = v => { const s=String(v??""); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
const downloadBlob = (content,filename,mime) => {
  const blob = new Blob([content],{type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
};
const TX_COLS = ["date","time","type","amount","memberId","memberName","bank","operator","receipt","notes","deleted"];

// A short, globally-unique id stamped on every transaction leg the moment it's
// created. Because the whole company shares ONE data record, two devices used at the
// same time must never produce colliding ids — this (time + randomness) guarantees
// that, so merges below can safely tell every entry apart.
const mkUid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;

// Union two saved data blobs so concurrent edits from different devices/operators
// don't clobber each other. The DB keeps ONE row per company, so a naive overwrite
// loses whatever the other device added in between. Transactions are matched by their
// unique `uid` (older rows fall back to `#id`); an entry deleted on EITHER side stays
// deleted. Members/banks union by id; nextId takes the higher of the two.
const mergeData = (remote, local) => {
  remote = remote || {}; local = local || {};
  const keyOf = t => t && t.uid ? t.uid : `#${t && t.id}`;
  const txMap = new Map();
  for(const t of (remote.transactions||[])) txMap.set(keyOf(t), t);
  for(const t of (local.transactions||[])){
    const k = keyOf(t), prev = txMap.get(k);
    txMap.set(k, prev ? {...prev,...t,deleted:!!(prev.deleted||t.deleted)} : t);
  }
  const transactions = [...txMap.values()];
  const memMap = new Map();
  for(const m of (remote.members||[])) memMap.set(m.id, m);
  for(const m of (local.members||[])){
    const prev = memMap.get(m.id);
    memMap.set(m.id, !prev ? m : ((m.lastActivity||"")>=(prev.lastActivity||"") ? {...prev,...m} : {...m,...prev}));
  }
  const members = [...memMap.values()];
  const bankMap = new Map();
  for(const b of (remote.banks||[])) bankMap.set(b.id, b);
  for(const b of (local.banks||[])) bankMap.set(b.id, b);   // local bank edits/toggles win
  const banks = [...bankMap.values()];
  const nextId = Math.max(local.nextId||0, remote.nextId||0);
  return {transactions,banks,members,nextId};
};
// ---- balance helpers (single definition) ----
function ftTxDelta(t){
  if(["Unclaimed Credit","Mistake","Rental","Store","Adjust","Other"].includes(t.type)) return t.amount;
  if(t.type==="Regular Deposit") return t.amount;
  if(t.type==="Transfer In") return t.amount;
  if(t.type==="Regular Withdrawal") return -t.amount;
  if(t.type==="Transfer Out") return -t.amount;
  return 0;
}
// A transaction belongs to a bank by the bank's UNIQUE id (t.bankId). Two banks
// can share the same institution name (e.g. two "Ubank" accounts with different
// holders), so matching by name alone wrongly mixes their balances/history.
// Older records saved before this only have the name, so fall back to name match.
function txInBank(t, bank){ return t.bankId!=null ? t.bankId===bank.id : t.bank===bank.name; }
function bankOfTx(t, banks){ return (banks||[]).find(b => (t.bankId!=null ? b.id===t.bankId : b.name===t.bank)); }
// Display priority: ACTIVE banks first, most-recently-activated on top, then the
// inactive ones. Falls back to the bank id (its creation timestamp) when a bank
// has no activatedAt yet (older records or never toggled).
const bankSortKey = b => (b.activatedAt ?? b.id ?? 0);
const orderBanks = arr => [...arr].sort((a,b)=>{
  const aA = a.active!==false, bA = b.active!==false;
  if(aA !== bA) return aA ? -1 : 1;
  return bankSortKey(b) - bankSortKey(a);
});
function ftBankBalance(bank, txs){
  let bal = bank.openingBalance ?? 0;
  for(const t of txs){
    if(t.deleted) continue;
    if(t.bucketLeg) continue; // Store/Mistake "bucket" side never belongs to a real bank
    if(txInBank(t,bank)) bal += ftTxDelta(t);
  }
  return bal;
}
// Running balance for a bank as of the END of a given date (date <= asOf) — used to
// show "yesterday's closing balance" on the bank cards.
function ftBankBalanceAsOf(bank, txs, asOf){
  let bal = bank.openingBalance ?? 0;
  for(const t of txs){
    if(t.deleted) continue;
    if(t.bucketLeg) continue;
    if(asOf && t.date > asOf) continue;
    if(txInBank(t,bank)) bal += ftTxDelta(t);
  }
  return bal;
}
// ---- end balance helpers ----
const ftHelpersDefined = true;
// Live balance for a bank = its opening balance + all active transaction effects.
const _removedDupA = null;
const exportCSV = (rows,name) => {
  const header = TX_COLS.join(",");
  const lines = rows.map(r=>TX_COLS.map(c=>csvEscape(r[c])).join(","));
  downloadBlob([header,...lines].join("\n"),`${name}.csv`,"text/csv;charset=utf-8;");
};
const exportExcel = (rows,name) => {
  const head = "<tr>"+TX_COLS.map(c=>`<th>${c}</th>`).join("")+"</tr>";
  const body = rows.map(r=>"<tr>"+TX_COLS.map(c=>`<td>${String(r[c]??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")}</td>`).join("")+"</tr>").join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">${head}${body}</table></body></html>`;
  downloadBlob(html,`${name}.xls`,"application/vnd.ms-excel");
};
const exportPDF = (rows,title) => {
  const w = window.open("","_blank");
  if(!w) return;
  const head = "<tr>"+["Date","Time","Type","Amount","ID","Member/Ref","Bank","Operator","Receipt","Notes"].map(c=>`<th>${c}</th>`).join("")+"</tr>";
  const body = rows.map(r=>"<tr>"+[r.date,r.time,r.type,amtDisplay(r).sign+amtDisplay(r).val,r.memberId||"",r.memberName,r.bank,r.operator||"",r.receipt||"",r.notes||""].map(c=>`<td>${String(c).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</td>`).join("")+"</tr>").join("");
  w.document.write(`<html><head><title>${title}</title><style>body{font-family:sans-serif;padding:20px}h2{font-weight:500}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0}</style></head><body><h2>${title}</h2><table>${head}${body}</table><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
};

const _themeAttr = typeof document!=="undefined" && document.documentElement && document.documentElement.dataset ? document.documentElement.dataset.theme : "";
const dark = _themeAttr ? _themeAttr==="dark" : (typeof window!=="undefined" && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
// Palette mirrors the "collapsible dashboard" template: clean gray / white / blue,
// with a true gray-950 dark mode. Every FinTrack page reads from C, so changing
// it here re-themes the whole app (and it follows the light/dark toggle).
const C = {
  bg: dark ? "#030712" : "#f9fafb",
  surface: dark ? "#111827" : "#ffffff",
  surface2: dark ? "#1f2937" : "#f3f4f6",
  header: dark ? "#1f2937" : "#f3f4f6",
  text: dark ? "#f3f4f6" : "#111827",
  muted: dark ? "#9ca3af" : "#6b7280",
  border: dark ? "#1f2937" : "#d6dae0",
  borderStrong: dark ? "#374151" : "#c3c8d0",
  accent: dark ? "#3b82f6" : "#2563eb",
  accentBg: dark ? "rgba(59,130,246,0.16)" : "#eff6ff",
};

const editBtnStyle = {cursor:"pointer",padding:"4px 10px",fontSize:12,fontWeight:500,border:"1px solid #2563eb",borderRadius:6,background:dark?"#1e3a5f":"#2563eb14",color:dark?"#85b7eb":"#2563eb",display:"inline-flex",alignItems:"center",gap:4};
const deleteBtnStyle = {cursor:"pointer",padding:"4px 10px",fontSize:12,fontWeight:500,border:"1px solid #dc2626",borderRadius:6,background:dark?"#4a1515":"#dc262614",color:dark?"#f09595":"#dc2626",display:"inline-flex",alignItems:"center",gap:4};
const bankActiveBtnStyle = {cursor:"pointer",padding:"4px 10px",fontSize:11,fontWeight:500,border:"1px solid #16a34a",borderRadius:6,background:dark?"#14331f":"#16a34a14",color:dark?"#7dd59e":"#16a34a",display:"inline-flex",alignItems:"center",gap:4};
const bankInactiveBtnStyle = {cursor:"pointer",padding:"4px 10px",fontSize:11,fontWeight:500,border:`1px solid ${C.borderStrong}`,borderRadius:6,background:C.surface2,color:C.muted,display:"inline-flex",alignItems:"center",gap:4};
const sectionStyle = {background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 20px",marginBottom:20,boxShadow:dark?"none":"0 1px 2px rgba(0,0,0,0.05)"};
const cardStyle = {background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"18px 20px",boxShadow:dark?"none":"0 1px 2px rgba(0,0,0,0.05)"};

// ---- Spotlight glow-border (see [data-glow] rules in global.css) ----
// One global pointermove listener writes the cursor position onto :root so every
// GlowCard can light up the part of the spotlight that overlaps it. Bound once.
let _glowPointerBound = false;
function bindGlowPointer(){
  if(_glowPointerBound || typeof window==="undefined") return;
  _glowPointerBound = true;
  const root = document.documentElement;
  window.addEventListener("pointermove", e=>{
    root.style.setProperty("--glow-x", e.clientX.toFixed(1));
    root.style.setProperty("--glow-y", e.clientY.toFixed(1));
  }, {passive:true});
}
// A card that glows on its border in `color` as the mouse passes near it.
// Drop-in for a plain <div>: pass color + the same style/onClick/etc. you'd use.
function GlowCard({color, glowSize, style, children, ...rest}){
  useEffect(bindGlowPointer, []);
  return (
    <div
      data-glow
      style={{position:"relative", "--glow-color":color||C.accent, ...(glowSize?{"--glow-size":typeof glowSize==="number"?`${glowSize}px`:glowSize}:null), ...style}}
      {...rest}
    >
      {children}
    </div>
  );
}

const initBanks = [];
const initMembers = [];

const initTx = [];

const isCreditType = t => ["Regular Deposit","Unclaimed Credit"].includes(t.type);
const amtDisplay = t => {
  if(t.type==="Transfer In") return {sign:"+",val:fmt(Math.abs(t.amount)),color:"#16a34a"};
  if(t.type==="Transfer Out") return {sign:"-",val:fmt(Math.abs(t.amount)),color:"#dc2626"};
  if(SIGNED_TYPES.includes(t.type)){
    const pos = t.amount>=0;
    const posColor = t.type==="Adjust" ? "#0d9488" : (TYPE_COLORS[t.type]||"#16a34a");
    const color = pos?posColor:"#dc2626";
    return {sign:pos?"+":"-",val:fmt(Math.abs(t.amount)),color};
  }
  const credit=isCreditType(t); return {sign:credit?"+":"-",val:fmt(t.amount),color:credit?"#16a34a":"#dc2626"};
};

// Renders a transaction amount: pale (Store) colours show as a gold chip with dark
// text; every other type stays as plain coloured text.
function Amt({t}) {
  const a = amtDisplay(t);
  return (isPaleColor(a.color) && !dark)
    ? <span style={{...goldChip,whiteSpace:"nowrap"}}>{a.sign}{a.val}</span>
    : <span style={{color:a.color}}>{a.sign}{a.val}</span>;
}

function TxBadge({type}) {
  const c = TYPE_COLORS[type]||"#888";
  if(isPaleColor(c) && !dark) return <span style={{background:c,color:STORE_INK,fontSize:11,padding:"2px 8px",borderRadius:4,fontWeight:600,whiteSpace:"nowrap",border:`1px solid ${STORE_INK}55`}}>{type}</span>;
  return <span style={{background:c+"26",color:c,fontSize:11,padding:"2px 8px",borderRadius:4,fontWeight:500,whiteSpace:"nowrap",border:`1px solid ${c}55`}}>{type}</span>;
}

function TxTable({data, showDelete, onDelete, banks, startIndex=0}) {
  const isCredit = t => ["Regular Deposit","Unclaimed Credit","Adjust"].includes(t.type);
  const bankCell = name => {
    const b = (banks||[]).find(x=>x.name===name);
    return b ? <span><span style={{display:"block"}}>{b.holder}</span><span style={{fontSize:11,color:C.muted}}>{name}</span></span> : name;
  };
  return (
    <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:10}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead>
          <tr style={{background:C.header}}>
            {["No.","Date / Time","Type","Member / Ref","ID","Amount","Bank","Operator","Notes",...(showDelete?["Action"]:[])]
              .map((h,i)=><th key={i} style={{textAlign:"left",padding:"10px",color:C.muted,fontWeight:500,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.length===0&&<tr><td colSpan={10} style={{padding:"24px 10px",textAlign:"center",color:C.muted}}>No entries found.</td></tr>}
          {data.map((t,idx)=>(
            <tr key={t.id} style={{borderBottom:`1px solid ${C.border}`,background:t.deleted?"rgba(220,38,38,0.10)":(idx%2?C.surface:"transparent"),opacity:t.deleted?0.7:1}}>
              <td style={{padding:"9px 10px",color:C.muted,whiteSpace:"nowrap"}}>{startIndex+idx+1}</td>
              <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.muted}}>{t.date} {t.time}</td>
              <td style={{padding:"9px 10px"}}>
                <TxBadge type={t.type}/>
                {t.isNew&&<span style={{marginLeft:4,background:"#16a34a26",color:"#16a34a",fontSize:10,padding:"1px 6px",borderRadius:4,border:"1px solid #16a34a55"}}>New</span>}
                {t.deleted&&<span style={{marginLeft:4,background:"#dc262630",color:"#ef5350",fontSize:10,padding:"1px 6px",borderRadius:4}}>Deleted</span>}
              </td>
              <td style={{padding:"9px 10px",color:C.text,textDecoration:t.deleted?"line-through":"none"}}>{t.memberName}</td>
              <td style={{padding:"9px 10px",color:C.muted,textDecoration:t.deleted?"line-through":"none"}}>{t.memberId||"—"}</td>
              <td style={{padding:"9px 10px",fontWeight:500,textDecoration:t.deleted?"line-through":"none"}}><Amt t={t}/></td>
              <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.text}}>{(()=>{
                const b = bankOfTx(t, banks);
                if(t.redeposit) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#2563eb"}}><i className="ti ti-refresh" aria-hidden="true"/>Redeposit</span>;
                if(t.fromUnclaimed) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#d97706"}}><i className="ti ti-coin" aria-hidden="true"/>From unclaimed credit{t.claimedFromDate?` · ${t.claimedFromDate}`:""}</span>;
                const holder = (b&&b.holder) || t.bankHolder || "";
                return (<span>
                  <span style={{display:"block"}}>{holder || t.bank}</span>
                  <span style={{fontSize:11,color:C.muted}}>{t.bank}{t.counterparty?(t.type==="Transfer In"?` ← ${t.counterparty}`:` → ${t.counterparty}`):""}</span>
                </span>);
              })()}</td>
              <td style={{padding:"9px 10px",color:C.muted,whiteSpace:"nowrap"}}>{t.operator?<span style={{display:"inline-flex",alignItems:"center",gap:4}}><i className="ti ti-user-cog" aria-hidden="true" style={{fontSize:13}}/>{t.operator}</span>:"—"}</td>
              <td style={{padding:"9px 10px",color:C.muted}}>{t.notes||"—"}{t.receipt?<span style={{display:"block",fontSize:11,color:C.muted}}><i className="ti ti-receipt" aria-hidden="true" style={{fontSize:12,marginRight:3}}/>Receipt: {t.receipt}</span>:null}</td>
              {showDelete&&<td style={{padding:"9px 8px"}}>
                {!t.deleted&&<button onClick={()=>onDelete(t.uid||t.id)} style={deleteBtnStyle}><i className="ti ti-trash" aria-hidden="true"/> Delete</button>}
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({label,count,amount,color,onClick,note}) {
  const accent = color||C.accent;
  const viewHint = <span style={{display:"inline-flex",alignItems:"center",gap:2,fontWeight:500,whiteSpace:"nowrap",...((isPaleColor(accent)&&!dark)?goldChip:{color:accent})}}>View <i className="ti ti-arrow-right" aria-hidden="true" style={{fontSize:12}}/></span>;
  return (
    <GlowCard color={color||C.borderStrong} onClick={onClick}
      style={{background:C.surface,borderRadius:10,padding:"10px 12px",border:`1px solid ${C.border}`,borderLeft:`3px solid ${color||C.borderStrong}`,boxShadow:dark?"none":"0 1px 2px rgba(0,0,0,0.05)",cursor:onClick?"pointer":"default"}}
      title={onClick?"Click to view these entries for the selected date":undefined}>
      <div style={{fontSize:11.5,color:C.muted,marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={label}>{label}</div>
      <div style={{fontSize:17,fontWeight:600,color:(isPaleColor(color)&&!dark)?C.text:(color||C.text)}}>{(isPaleColor(color)&&!dark)?<span style={{...goldChip,padding:"1px 8px",borderRadius:6}}>{fmt(amount)}</span>:fmt(amount)}</div>
      {count!==undefined
        ? <div style={{fontSize:11,color:C.muted,marginTop:2,display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}><span>{count} {count===1?"entry":"entries"}</span>{onClick&&viewHint}</div>
        : (onClick&&<div style={{fontSize:11,marginTop:2}}>{viewHint}</div>)}
      {note&&<div style={{fontSize:10.5,color:C.muted,marginTop:3}}>{note}</div>}
    </GlowCard>
  );
}

// Totals across all bank accounts: all / active-only / inactive-only.
function BankTotals({banksLive}) {
  const sum = arr => arr.reduce((s,b)=>s+(b.balance||0),0);
  const ysum = arr => arr.reduce((s,b)=>s+(b.yBalance||0),0);
  const active = banksLive.filter(b=>b.active!==false);
  const inactive = banksLive.filter(b=>b.active===false);
  const Card = ({label,amount,yamount,count,color,icon}) => (
    <GlowCard color={color} style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`,borderLeft:`3px solid ${color}`}}>
      <div style={{fontSize:12,color:C.muted,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><i className={`ti ${icon}`} aria-hidden="true" style={{color}}/>{label}</div>
      <div style={{fontSize:20,fontWeight:500,color:C.text}}>{fmt(amount)}</div>
      <div style={{fontSize:12,color:C.muted,marginTop:2}}>{count} {count===1?"bank":"banks"} · Yesterday: {fmt(yamount)}</div>
    </GlowCard>
  );
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
      <Card label="All banks total" amount={sum(banksLive)} yamount={ysum(banksLive)} count={banksLive.length} color={C.accent} icon="ti-building-bank"/>
      <Card label="Active banks total" amount={sum(active)} yamount={ysum(active)} count={active.length} color="#16a34a" icon="ti-circle-check"/>
      <Card label="Inactive banks total" amount={sum(inactive)} yamount={ysum(inactive)} count={inactive.length} color="#64748b" icon="ti-circle-off"/>
    </div>
  );
}

// Transaction log with a page-size dropdown (default 50) + simple pager.
const PAGE_SIZES = [50,100,200,500,1000];
const pagerBtn = disabled => ({cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.4:1,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 9px",color:C.text,display:"inline-flex",alignItems:"center"});
function TxLog({data, showDelete, onDelete, banks}) {
  const [pageSize,setPageSize] = useState(50);
  const [page,setPage] = useState(1);
  useEffect(()=>{ setPage(1); },[pageSize]);
  const total = data.length;
  const pages = Math.max(1, Math.ceil(total/pageSize));
  const curPage = Math.min(page, pages);
  const start = (curPage-1)*pageSize;
  const slice = data.slice(start, start+pageSize);
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.muted}}>
          <span>Show</span>
          <FluidDropdown width={100} value={pageSize} ariaLabel="Rows per page"
            options={PAGE_SIZES.map(n=>({value:n,label:String(n)}))}
            onChange={v=>setPageSize(Number(v))}/>
          <span>per page</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12.5,color:C.muted}}>
          <span>{total===0?0:start+1}–{Math.min(start+pageSize,total)} of {total}</span>
          <button onClick={()=>setPage(Math.max(1,curPage-1))} disabled={curPage<=1} style={pagerBtn(curPage<=1)} aria-label="Previous page"><i className="ti ti-chevron-left" aria-hidden="true"/></button>
          <span>{curPage}/{pages}</span>
          <button onClick={()=>setPage(Math.min(pages,curPage+1))} disabled={curPage>=pages} style={pagerBtn(curPage>=pages)} aria-label="Next page"><i className="ti ti-chevron-right" aria-hidden="true"/></button>
        </div>
      </div>
      <TxTable data={slice} showDelete={showDelete} onDelete={onDelete} banks={banks} startIndex={start}/>
    </div>
  );
}

function Confirm({message,onConfirm,onCancel}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
      <div style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,padding:"24px 28px",maxWidth:360,width:"90%",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",color:C.text}}>
        <div style={{fontWeight:500,fontSize:16,marginBottom:10}}>Confirm action</div>
        <div style={{fontSize:13,color:C.muted,marginBottom:22,lineHeight:1.5}}>{message}</div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onCancel} style={{cursor:"pointer",padding:"8px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
          <button onClick={onConfirm} style={{cursor:"pointer",padding:"8px 18px",fontSize:13,fontWeight:500,background:"#dc2626",color:"#fff",border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6}}>
            <i className="ti ti-trash" aria-hidden="true"/> Confirm delete
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({title,subtitle,transactions,onClose,banks,yesterday}) {
  const [search,setSearch] = useState("");
  const [sortKey,setSortKey] = useState("date");
  const [sortDir,setSortDir] = useState("desc");
  const [dateFrom,setDateFrom] = useState("");
  const [dateTo,setDateTo] = useState("");
  const isMobile = useIsMobile();
  const SORT_COLS = [
    {key:"date",label:"Date / Time"},{key:"type",label:"Type"},{key:"memberName",label:"Member / Ref"},
    {key:"memberId",label:"ID"},{key:"amount",label:"Amount"},{key:"bank",label:"Bank"},
    {key:"operator",label:"Operator"},{key:"notes",label:"Notes"},
  ];
  const sortVal = (t,key)=> key==="amount" ? (t.amount||0) : key==="date" ? `${t.date} ${t.time}` : String(t[key]||"").toLowerCase();
  const q = search.trim().toLowerCase();
  const inRange = t => (!dateFrom || t.date>=dateFrom) && (!dateTo || t.date<=dateTo);
  const matchesQ = t => !q || [t.memberName,t.memberId,t.bank,t.type,t.operator,t.notes,t.date,t.receipt].some(v=>String(v||"").toLowerCase().includes(q)) || String(t.amount||"").includes(q);
  const filtered = transactions.filter(t=>inRange(t) && matchesQ(t));
  const rows = [...filtered].sort((a,b)=>{ const av=sortVal(a,sortKey),bv=sortVal(b,sortKey); const cmp=av<bv?-1:av>bv?1:0; return sortDir==="asc"?cmp:-cmp; });
  const toggleSort = key => { if(sortKey===key) setSortDir(d=>d==="asc"?"desc":"asc"); else { setSortKey(key); setSortDir((key==="amount"||key==="date")?"desc":"asc"); } };
  const arrow = key => sortKey===key ? <i className={`ti ti-${sortDir==="asc"?"arrow-up":"arrow-down"}`} aria-hidden="true" style={{fontSize:12,marginLeft:3,verticalAlign:"middle"}}/> : null;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:isMobile?"stretch":"center",justifyContent:"center",zIndex:998,padding:isMobile?0:"24px 16px"}} onClick={onClose}>
      <div style={{background:C.bg,border:isMobile?"none":`2px solid ${C.border}`,borderRadius:isMobile?0:14,width:isMobile?"100%":"96%",maxWidth:isMobile?"none":1240,height:isMobile?"100%":"auto",maxHeight:isMobile?"none":"82vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
          <div>
            <div style={{fontWeight:500,fontSize:17}}>{title}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:3}}>{subtitle}</div>
          </div>
          <button onClick={onClose} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}>
            <i className="ti ti-x" aria-hidden="true" style={{fontSize:15}}/> Close
          </button>
        </div>
        <div style={{padding:"16px",overflowY:"auto",background:C.bg}}>
          {typeof yesterday==="number"&&(
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,padding:"9px 12px",borderRadius:8,background:C.surface2,border:`1px solid ${C.border}`,fontSize:12.5}}>
              <i className="ti ti-history" aria-hidden="true" style={{color:C.accent,fontSize:16,flexShrink:0}}/>
              <span style={{color:C.muted}}>Yesterday's closing balance:</span>
              <strong style={{color:C.text,fontSize:14}}>{fmt(yesterday)}</strong>
            </div>
          )}
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
            <div style={{position:"relative",flex:"1 1 220px",maxWidth:340}}>
              <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
              <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search this log…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
              {search&&<button type="button" onClick={()=>setSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.muted}}>
              <span>Sort</span>
              <FluidDropdown width={150} value={sortKey} ariaLabel="Sort by"
                options={SORT_COLS.map(c=>({value:c.key,label:c.label}))}
                onChange={v=>setSortKey(v)}/>
              <button type="button" onClick={()=>setSortDir(d=>d==="asc"?"desc":"asc")} title={sortDir==="asc"?"Ascending — click for descending":"Descending — click for ascending"}
                style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4,padding:"7px 10px",border:`1px solid ${C.border}`,borderRadius:8,background:C.surface2,color:C.text,fontSize:12,fontWeight:500}}>
                <i className={`ti ti-${sortDir==="asc"?"sort-ascending":"sort-descending"}`} aria-hidden="true" style={{fontSize:15}}/>{sortDir==="asc"?"Asc":"Desc"}
              </button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.muted,flexWrap:"wrap"}}>
              <i className="ti ti-calendar-event" aria-hidden="true" style={{fontSize:15,color:C.accent}}/>
              <span>Date</span>
              <input type="date" value={dateFrom} max={dateTo||undefined} onChange={e=>setDateFrom(e.target.value)} aria-label="From date" style={{padding:"6px 8px",fontSize:12.5}}/>
              <span>→</span>
              <input type="date" value={dateTo} min={dateFrom||undefined} onChange={e=>setDateTo(e.target.value)} aria-label="To date" style={{padding:"6px 8px",fontSize:12.5}}/>
              {(dateFrom||dateTo)&&<button type="button" onClick={()=>{setDateFrom("");setDateTo("");}} title="Clear date filter"
                style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4,padding:"6px 9px",border:`1px solid ${C.border}`,borderRadius:8,background:C.surface2,color:C.text,fontSize:12,fontWeight:500}}>
                <i className="ti ti-x" aria-hidden="true" style={{fontSize:14}}/>Clear
              </button>}
            </div>
            <span style={{fontSize:12,color:C.muted,marginLeft:"auto"}}>{rows.length===transactions.length?`${transactions.length} ${transactions.length===1?"entry":"entries"}`:`${rows.length} of ${transactions.length}`}</span>
          </div>
          {rows.length===0
            ?<div style={{padding:"30px",textAlign:"center",color:C.muted,fontSize:13}}>{(search||dateFrom||dateTo)?"No entries match your filters.":"No transactions found."}</div>
            :<div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:10}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:C.header}}>
                    <th style={{textAlign:"left",padding:"10px",color:C.muted,fontWeight:500,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`,...(isMobile?{position:"sticky",left:0,zIndex:2,background:C.header}:null)}}>No.</th>
                    {SORT_COLS.map(c=>(
                      <th key={c.key} onClick={()=>toggleSort(c.key)} title="Click to sort by this column"
                        style={{textAlign:"left",padding:"10px",color:sortKey===c.key?C.text:C.muted,fontWeight:500,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`,cursor:"pointer",userSelect:"none"}}>
                        {c.label}{arrow(c.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t,idx)=>(
                    <tr key={t.id} style={{borderBottom:`1px solid ${C.border}`,background:t.deleted?"rgba(220,38,38,0.10)":(idx%2?C.surface:"transparent"),opacity:t.deleted?0.7:1}}>
                      <td style={{padding:"9px 10px",color:C.muted,whiteSpace:"nowrap",...(isMobile?{position:"sticky",left:0,zIndex:1,background:idx%2?C.surface:C.bg}:null)}}>{idx+1}</td>
                      <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.muted}}>{t.date} {t.time}</td>
                      <td style={{padding:"9px 10px"}}><TxBadge type={t.type}/>{t.deleted&&<span style={{marginLeft:4,background:"#dc262630",color:"#ef5350",fontSize:10,padding:"1px 6px",borderRadius:4}}>Deleted</span>}</td>
                      <td style={{padding:"9px 10px",color:C.text,textDecoration:t.deleted?"line-through":"none"}}>{t.memberName}</td>
                      <td style={{padding:"9px 10px",color:C.muted,textDecoration:t.deleted?"line-through":"none"}}>{t.memberId||"—"}</td>
                      <td style={{padding:"9px 10px",fontWeight:500,textDecoration:t.deleted?"line-through":"none"}}><Amt t={t}/></td>
                      <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.text}}>{(()=>{
                        const b = bankOfTx(t, banks);
                        if(t.redeposit) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#2563eb"}}><i className="ti ti-refresh" aria-hidden="true"/>Redeposit</span>;
                if(t.fromUnclaimed) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#d97706"}}><i className="ti ti-coin" aria-hidden="true"/>From unclaimed credit{t.claimedFromDate?` · ${t.claimedFromDate}`:""}</span>;
                        const holder = (b&&b.holder) || t.bankHolder || "";
                        return (<span>
                          <span style={{display:"block"}}>{holder || t.bank}</span>
                          <span style={{fontSize:11,color:C.muted}}>{t.bank}{t.counterparty?(t.type==="Transfer In"?` ← ${t.counterparty}`:` → ${t.counterparty}`):""}</span>
                        </span>);
                      })()}</td>
                      <td style={{padding:"9px 10px",color:C.muted,whiteSpace:"nowrap"}}>{t.operator||"—"}</td>
                      <td style={{padding:"9px 10px",color:C.muted}}>{t.notes||"—"}{t.receipt?<span style={{display:"block",fontSize:11,color:C.muted}}><i className="ti ti-receipt" aria-hidden="true" style={{fontSize:12,marginRight:3}}/>Receipt: {t.receipt}</span>:null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        </div>
      </div>
    </div>
  );
}

function ComparisonChart({data}) {
  const max = Math.max(1,...data.flatMap(d=>[d.dep,d.wd]));
  const W=520, H=200, pad=30, bw=Math.min(40,(W-pad*2)/data.length/2.6);
  const groupW = (W-pad*2)/Math.max(1,data.length);
  return (
    <div style={{overflowX:"auto"}}>
      <svg viewBox={`0 0 ${W} ${H+50}`} style={{width:"100%",minWidth:480}} role="img" aria-label="Monthly deposits versus withdrawals comparison chart">
        {[0,0.25,0.5,0.75,1].map(f=>(
          <g key={f}>
            <line x1={pad} y1={H-f*H+10} x2={W-pad} y2={H-f*H+10} stroke={C.border} strokeWidth="1"/>
            <text x={pad-4} y={H-f*H+13} textAnchor="end" fontSize="9" fill={C.muted}>{Math.round(max*f/1000)}k</text>
          </g>
        ))}
        {data.map((d,i)=>{
          const gx = pad+i*groupW+groupW/2;
          const dh = (d.dep/max)*H, wh=(d.wd/max)*H;
          return (
            <g key={d.ym}>
              <rect x={gx-bw-2} y={H-dh+10} width={bw} height={dh} fill="#16a34a" rx="2"/>
              <rect x={gx+2} y={H-wh+10} width={bw} height={wh} fill="#dc2626" rx="2"/>
              <text x={gx} y={H+26} textAnchor="middle" fontSize="10" fill={C.text}>{d.label}</text>
            </g>
          );
        })}
      </svg>
      <div style={{display:"flex",gap:18,fontSize:12,color:C.muted,marginTop:4,paddingLeft:pad}}>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:11,height:11,borderRadius:2,background:"#16a34a"}}/>Deposits (incl. credits)</span>
        <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:11,height:11,borderRadius:2,background:"#dc2626"}}/>Withdrawals (incl. rental/store/mistakes)</span>
      </div>
    </div>
  );
}

export default function App() {
  // Read the live session for THIS mount (see readSession note up top). The
  // component re-mounts on every login, so company name, operator, and the data
  // key below all track whichever company just signed in.
  const SESSION = readSession();
  // This company's time zone (set per company by the provider). All "now" dates
  // and times below are computed in this zone so the log follows it.
  const tz = SESSION.timezone || "Australia/Sydney";
  const today = dateInTz(tz);
  const yesterday = dateNDaysAgoInTz(1,tz);
  const weekAgo = dateNDaysAgoInTz(6,tz);
  const thisMonth = today.slice(0,7);
  // Live clock for the top bar, ticking in the company's time zone.
  const [clockNow,setClockNow] = useState(()=>timeInTz(tz));
  useEffect(()=>{ setClockNow(timeInTz(tz)); const id=setInterval(()=>setClockNow(timeInTz(tz)),20000); return ()=>clearInterval(id); },[tz]);
  const [page,setPage] = useState("dashboard");
  const [memberPage,setMemberPage] = useState(1);
  const [memberPageSize,setMemberPageSize] = useState(50);
  const [memberSearch,setMemberSearch] = useState("");
  useEffect(()=>{ setMemberPage(1); },[memberPageSize,memberSearch]);
  // Sidebar behaviour: "expanded" | "collapsed" | "hover" (expand-on-hover) — default hover.
  const [sidebarMode,setSidebarMode] = useState(()=>{ try{ return localStorage.getItem("fintrack-sidebar-mode-v2")||"hover"; }catch(e){ return "hover"; } });
  useEffect(()=>{ try{ localStorage.setItem("fintrack-sidebar-mode-v2",sidebarMode); }catch(e){} },[sidebarMode]);
  const [sidebarHovered,setSidebarHovered] = useState(false);
  const [showSidebarMenu,setShowSidebarMenu] = useState(false);
  const [sbHover,setSbHover] = useState(null); // sidebar-control fluid highlight
  const sidebarHoverExpanding = sidebarMode==="hover" && sidebarHovered;
  const sidebarExpanded = sidebarMode==="expanded" || sidebarHoverExpanding;
  // Wide enough for the 2:1 dashboard split + 5 stat cards per row.
  const [isWideView,setIsWideView] = useState(()=>typeof window!=="undefined" && window.matchMedia("(min-width: 1000px)").matches);
  useEffect(()=>{ const mq=window.matchMedia("(min-width: 1000px)"); const h=e=>setIsWideView(e.matches); mq.addEventListener("change",h); return ()=>mq.removeEventListener("change",h); },[]);
  const isMobile = useIsMobile();
  const [loaded,setLoaded] = useState(false);
  const [transactions,setTransactions] = useState(initTx);
  const [banks,setBanks] = useState(initBanks);
  const [members,setMembers] = useState(initMembers);
  const [nextId,setNextId] = useState(1);
  const [confirm,setConfirm] = useState(null);
  const [detailModal,setDetailModal] = useState(null);
  const [dashView,setDashView] = useState("today");
  const [selMonth,setSelMonth] = useState(thisMonth);
  const [rangeFrom,setRangeFrom] = useState(weekAgo);
  const [rangeTo,setRangeTo] = useState(today);

  const [form,setForm] = useState({type:"Regular Deposit",amount:"",memberId:"",memberName:"",memberPhone:"",bankId:null,notes:"",toBankId:null,date:"",fromUnclaimed:false,redeposit:false,claimDate:"",receipt:""});
  const [formError,setFormError] = useState("");
  const [nameSuggestions,setNameSuggestions] = useState([]);
  const [idSuggestions,setIdSuggestions] = useState([]);
  const [phoneSuggestions,setPhoneSuggestions] = useState([]);
  const [suggestIndex,setSuggestIndex] = useState(-1); // keyboard highlight in member-suggestion lists
  const suggestRef = useRef(null);
  const idSuggestRef = useRef(null);
  const phoneSuggestRef = useRef(null);

  const [newBank,setNewBank] = useState({name:"",holder:"",bsb:"",account:"",payid:"",balance:""});
  const [bankError,setBankError] = useState("");
  const [editingBank,setEditingBank] = useState(null);
  const [editBankForm,setEditBankForm] = useState({});
  const [editBankError,setEditBankError] = useState("");

  const [editingMember,setEditingMember] = useState(null);
  const [editMemberForm,setEditMemberForm] = useState({});
  const [editMemberError,setEditMemberError] = useState("");
  const [showBankModal,setShowBankModal] = useState(false);
  const [showEntryModal,setShowEntryModal] = useState(false);
  const [showMemberModal,setShowMemberModal] = useState(false);
  const [newMember,setNewMember] = useState({name:"",phone:"",id:""});
  const [newMemberError,setNewMemberError] = useState("");
  const [showOperatorMenu,setShowOperatorMenu] = useState(false);
  const [showMoreTypes,setShowMoreTypes] = useState(false); // "More" entry-type drawer
  const [showMoreStats,setShowMoreStats] = useState(false); // "More stats" drawer (Transactions page)
  const [showShortcuts,setShowShortcuts] = useState(()=>{ try{ return localStorage.getItem("ft_show_shortcuts")!=="0"; }catch{ return true; } }); // collapsible shortcut strip (remembered)
  const [showPasswordModal,setShowPasswordModal] = useState(false);
  const [pwForm,setPwForm] = useState({current:"",next:"",confirm:""});
  const [pwError,setPwError] = useState("");
  const [pwSuccess,setPwSuccess] = useState("");
  const opMenuRef = useRef(null);
  const sidebarMenuRef = useRef(null);
  const moreTypesRef = useRef(null);
  const moreStatsRef = useRef(null);
  const amountRef = useRef(null); // entry modal: first field to focus on open
  const lastSyncRef = useRef(""); // last data we loaded/saved — lets us sync across devices without save/load loops
  const dataRef = useRef({transactions:[],banks:[],members:[],nextId:1}); // always-current state, so the poller can merge without restarting its timer

  const [search,setSearch] = useState({term:"",dateFrom:"",dateTo:"",type:"",bank:"",member:""});

  // Apply a stored data blob to state (with the one-time opening-balance migration).
  const applyData = (d) => {
    if(d.transactions) setTransactions(d.transactions);
    if(d.banks) setBanks(d.banks.map(b=>{
      if(b.openingBalance!=null) return b;
      // migrate older records: derive opening from stored balance minus its tx effects
      const eff = (d.transactions||[]).reduce((acc,t)=>{
        if(t.deleted) return acc;
        if(t.type==="Transfer"){ if(t.bank===b.name) return acc-t.amount; if(t.toBank===b.name) return acc+t.amount; return acc; }
        if(t.bank===b.name) return acc+ftTxDelta(t);
        return acc;
      },0);
      return {...b,openingBalance:(b.balance??0)-eff};
    }));
    if(d.members) setMembers(d.members);
    if(d.nextId) setNextId(d.nextId);
  };

  useEffect(()=>{
    (async()=>{
      const key = `fintrack-${SESSION.companyId}-v2`;
      try{
        const r = await window.storage.get(key);
        if(r&&r.value){ applyData(JSON.parse(r.value)); lastSyncRef.current = r.value; }
        try{ await window.storage.delete("fintrack-data"); }catch(e){}
      }catch(e){ /* first run, no saved data */ }
      setLoaded(true);
    })();
  },[]);

  // Keep a ref to the latest state so the poller below can MERGE against it without
  // having to restart its timer every time something changes.
  useEffect(()=>{ dataRef.current = {transactions,banks,members,nextId}; });

  // Save. Because the whole company shares ONE record, we don't blindly overwrite:
  // we re-read the latest saved data and MERGE our changes into it, so an entry that
  // another device/operator added in the meantime is never wiped out. We only mark
  // the data "synced" on a confirmed successful write (so a failed save retries).
  useEffect(()=>{
    if(!loaded) return;
    const serialized = JSON.stringify({transactions,banks,members,nextId});
    if(serialized === lastSyncRef.current) return; // nothing new to persist (incl. data we just pulled in)
    let cancelled = false;
    (async()=>{
      try{
        const key = `fintrack-${SESSION.companyId}-v2`;
        let remote = null;
        try{ const r = await window.storage.get(key); if(r&&r.value) remote = JSON.parse(r.value); }catch(e){}
        const merged = remote ? mergeData(remote,{transactions,banks,members,nextId}) : {transactions,banks,members,nextId};
        const mergedStr = JSON.stringify(merged);
        const ok = await window.storage.set(key,mergedStr);
        if(cancelled || !ok) return;
        lastSyncRef.current = mergedStr;
        if(mergedStr !== serialized) applyData(merged); // reflect any entries the merge pulled in from other devices
      }catch(e){ /* save failed — will retry on the next change or poll */ }
    })();
    return ()=>{ cancelled = true; };
  },[transactions,banks,members,nextId,loaded]);

  // Auto-refresh: every 10s pull the latest saved data so changes made on other
  // devices/operators appear here. We MERGE it into whatever we have locally (rather
  // than replacing), so a refresh never drops an entry we just made that hasn't
  // finished saving yet.
  useEffect(()=>{
    if(!loaded) return;
    const key = `fintrack-${SESSION.companyId}-v2`;
    const id = setInterval(async()=>{
      try{
        const r = await window.storage.get(key);
        if(r&&r.value && r.value !== lastSyncRef.current){
          const merged = mergeData(JSON.parse(r.value), dataRef.current);
          const mergedStr = JSON.stringify(merged);
          applyData(merged);
          lastSyncRef.current = mergedStr;
        }
      }catch(e){ /* offline / transient */ }
    },10000);
    return ()=>clearInterval(id);
  },[loaded]);

  useEffect(()=>{
    const handler = e => {
      if(suggestRef.current&&!suggestRef.current.contains(e.target)) setNameSuggestions([]);
      if(idSuggestRef.current&&!idSuggestRef.current.contains(e.target)) setIdSuggestions([]);
      if(phoneSuggestRef.current&&!phoneSuggestRef.current.contains(e.target)) setPhoneSuggestions([]);
    };
    document.addEventListener("mousedown",handler);
    return ()=>document.removeEventListener("mousedown",handler);
  },[]);

  useEffect(()=>{
    const handler = e => {
      if(opMenuRef.current&&!opMenuRef.current.contains(e.target)) setShowOperatorMenu(false);
      if(sidebarMenuRef.current&&!sidebarMenuRef.current.contains(e.target)) setShowSidebarMenu(false);
      if(moreTypesRef.current&&!moreTypesRef.current.contains(e.target)) setShowMoreTypes(false);
      if(moreStatsRef.current&&!moreStatsRef.current.contains(e.target)) setShowMoreStats(false);
    };
    document.addEventListener("mousedown",handler);
    return ()=>document.removeEventListener("mousedown",handler);
  },[]);

  const handleChangePassword = async () => {
    if(!pwForm.current||!pwForm.next||!pwForm.confirm){setPwError("Fill all fields.");return;}
    if(pwForm.next.length<6){setPwError("New password must be at least 6 characters.");return;}
    if(pwForm.next!==pwForm.confirm){setPwError("New passwords do not match.");return;}
    // Host (the portal) wires this to the real account system; falls back to a
    // stub if the artifact is run standalone without a host.
    if(typeof window!=="undefined" && window.FINTRACK_CHANGE_PASSWORD){
      const res = await window.FINTRACK_CHANGE_PASSWORD(pwForm.current, pwForm.next);
      if(res && res.ok===false){ setPwError(res.error||"Could not change password."); return; }
    }
    setPwError(""); setPwSuccess("Password updated.");
    setPwForm({current:"",next:"",confirm:""});
    setTimeout(()=>{ setShowPasswordModal(false); setPwSuccess(""); },1400);
  };

  const handleLogout = () => {
    // When online, this clears the auth session/token and returns to your login page.
    if(typeof window!=="undefined" && window.FINTRACK_LOGOUT){ window.FINTRACK_LOGOUT(); return; }
    setConfirm({message:"Log out of this session? (When online, this returns you to the login page.)",onConfirm:()=>{ setConfirm(null); setShowOperatorMenu(false); }});
  };

  const availableMonths = useMemo(()=>{
    const set = new Set(transactions.map(t=>t.date.slice(0,7)));
    set.add(thisMonth);
    return Array.from(set).sort().reverse();
  },[transactions]);

  const computeStats = (list) => {
    const active = list.filter(t=>!t.deleted);
    // The funding (bank-side) leg of a Store/Mistake entry is tagged fundLeg so it
    // moves the bank balance but is NOT double-counted in the type's total here.
    const f = type => active.filter(t=>t.type===type && !t.fundLeg);
    const sum = arr => arr.reduce((a,b)=>a+b.amount,0);
    return {
      deposits:f("Regular Deposit"),withdrawals:f("Regular Withdrawal"),
      unclaimed:f("Unclaimed Credit"),mistakes:f("Mistake"),
      rentals:f("Rental"),store:f("Store"),transfers:f("Transfer Out"),adjustments:f("Adjust"),
      newMembers:active.filter(t=>t.isNew),sum,active
    };
  };

  // Ordered by priority (active first, latest-activated on top). This single order
  // drives the Bank Accounts cards, the dashboard per-bank list, and the totals.
  const banksLive = useMemo(()=>orderBanks(banks.map(b=>{
    // Today's entry counts for this bank: deposits in, withdrawals out, transfers
    // (counted on both the source (Transfer Out) and destination (Transfer In) bank), and store
    // entries (whose bank-side leg is tagged fundLeg — money taken from the bank into the store).
    let depToday=0, wdToday=0, tfToday=0, stToday=0;
    for(const t of transactions){
      if(t.deleted||t.date!==today) continue;
      if(t.type==="Store"){ if(t.fundLeg && txInBank(t,b)) stToday++; continue; }
      if(t.fundLeg||!txInBank(t,b)) continue;
      if(t.type==="Regular Deposit") depToday++;
      else if(t.type==="Regular Withdrawal") wdToday++;
      else if(t.type==="Transfer In"||t.type==="Transfer Out") tfToday++;
    }
    return {...b,balance:ftBankBalance(b,transactions),yBalance:ftBankBalanceAsOf(b,transactions,yesterday),depToday,wdToday,tfToday,stToday};
  })),[banks,transactions,yesterday,today]);
  // Active banks only, in the same priority order — used in the dashboard per-bank
  // list and the entry-form bank dropdowns (so the top bank is the default choice).
  const activeBanks = useMemo(()=>banksLive.filter(b=>b.active!==false),[banksLive]);

  const todayTx = transactions.filter(t=>t.date===today);
  const dashTx = useMemo(()=>{
    if(dashView==="today") return transactions.filter(t=>t.date===today);
    if(dashView==="yesterday") return transactions.filter(t=>t.date===yesterday);
    if(dashView==="week") return transactions.filter(t=>t.date>=weekAgo&&t.date<=today);
    if(dashView==="range"){
      const lo = rangeFrom||"0000-00-00", hi = rangeTo||"9999-99-99";
      return transactions.filter(t=>t.date>=lo&&t.date<=hi);
    }
    return transactions.filter(t=>t.date.slice(0,7)===selMonth);
  },[transactions,dashView,selMonth,rangeFrom,rangeTo]);
  const stats = useMemo(()=>computeStats(dashTx),[dashTx]);
  // All-time unclaimed-credit balance (what a "Deposit from unclaimed credit" draws on).
  const unclaimedBalance = useMemo(()=>transactions.filter(t=>!t.deleted&&t.type==="Unclaimed Credit"&&!t.fundLeg).reduce((s,t)=>s+(t.amount||0),0),[transactions]);
  // Net unclaimed credit recorded PER DATE (credits minus claim legs, both dated to
  // that day). A "Deposit from unclaimed credit" can pick which date to claim from;
  // its claim leg is dated to that day, so it reduces that date's remaining balance.
  const unclaimedByDate = useMemo(()=>{
    const m = {};
    for(const t of transactions){
      if(t.deleted || t.type!=="Unclaimed Credit" || t.fundLeg) continue;
      m[t.date] = (m[t.date]||0) + (t.amount||0);
    }
    return m;
  },[transactions]);
  // Dates that still have credit left to claim, newest first, for the claim-from picker.
  const claimableDates = useMemo(()=>Object.keys(unclaimedByDate).filter(d=>unclaimedByDate[d]>1e-9).sort((a,b)=>b.localeCompare(a)),[unclaimedByDate]);
  // Store entries are a running TOTAL (a balance), not a daily flow — so the Store
  // card always shows the all-time accumulation, ignoring the selected date scope.
  const storeAllTime = useMemo(()=>transactions.filter(t=>!t.deleted&&t.type==="Store"&&!t.fundLeg),[transactions]);
  // Store total as of the end of yesterday (date <= yesterday) — the "yesterday close".
  const storeYesterday = useMemo(()=>transactions.filter(t=>!t.deleted&&t.type==="Store"&&!t.fundLeg&&t.date<=yesterday).reduce((s,t)=>s+(t.amount||0),0),[transactions,yesterday]);

  const monthlyComparison = useMemo(()=>{
    const months = availableMonths.slice(0,6).reverse();
    return months.map(ym=>{
      const list = transactions.filter(t=>t.date.slice(0,7)===ym&&!t.deleted);
      const dep = list.filter(t=>["Regular Deposit","Unclaimed Credit"].includes(t.type)).reduce((a,b)=>a+b.amount,0);
      const wd = list.filter(t=>["Regular Withdrawal","Rental","Store","Mistake"].includes(t.type)).reduce((a,b)=>a+b.amount,0);
      return {ym,label:monthLabel(ym).replace(/ \d+$/,m=>m.slice(0,3)),dep,wd};
    });
  },[transactions,availableMonths]);

  const filteredTx = useMemo(()=>{
    const selBank = banks.find(bk=>String(bk.id)===String(search.bank)); // search.bank holds a bank id
    return transactions.filter(t=>{
      const term = (search.term||"").toLowerCase();
      const matchTerm = !term||t.memberId.toLowerCase().includes(term)||t.memberName.toLowerCase().includes(term)||t.bank.toLowerCase().includes(term);
      const matchFrom = !search.dateFrom||t.date>=search.dateFrom;
      const matchTo = !search.dateTo||t.date<=search.dateTo;
      const matchType = !search.type||t.type===search.type;
      const matchBank = !search.bank||(selBank?txInBank(t,selBank):false);
      const matchMember = !search.member||(t.memberId===search.member||t.memberName===search.member);
      return matchTerm&&matchFrom&&matchTo&&matchType&&matchBank&&matchMember;
    }).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  },[transactions,search,banks]);

  const closeEntryModal = () => { setForm({type:"Regular Deposit",amount:"",memberId:"",memberName:"",memberPhone:"",bankId:activeBanks[0]?.id??null,notes:"",toBankId:null,date:"",fromUnclaimed:false,redeposit:false,claimDate:"",receipt:""}); setFormError(""); setNameSuggestions([]); setIdSuggestions([]); setPhoneSuggestions([]); setShowEntryModal(false); };
  // Open the entry form pre-set to a given type (shared by the type tiles + "More" drawer).
  const openEntryType = (t) => { setForm({type:t,amount:"",memberId:"",memberName:"",memberPhone:"",bankId:activeBanks[0]?.id??null,notes:"",toBankId:null,date:"",fromUnclaimed:false,redeposit:false,claimDate:"",receipt:""}); setFormError(""); setNameSuggestions([]); setIdSuggestions([]); setPhoneSuggestions([]); setShowMoreTypes(false); setShowEntryModal(true); };
  const closeBankModal = () => { setNewBank({name:"",holder:"",bsb:"",account:"",payid:"",balance:""}); setBankError(""); setShowBankModal(false); };
  const closePasswordModal = () => { setPwForm({current:"",next:"",confirm:""}); setPwError(""); setPwSuccess(""); setShowPasswordModal(false); };

  const handleNameInput = val => {
    setForm(f=>({...f,memberName:val})); setSuggestIndex(-1); setIdSuggestions([]); setPhoneSuggestions([]);
    setNameSuggestions(val.length>0 ? members.filter(m=>m.name.toLowerCase().includes(val.toLowerCase())) : []);
  };
  const handleIdInput = val => {
    setForm(f=>({...f,memberId:val})); setSuggestIndex(-1); setNameSuggestions([]); setPhoneSuggestions([]);
    setIdSuggestions(val.length>0 ? members.filter(m=>(m.id||"").toLowerCase().includes(val.toLowerCase())) : []);
  };
  const handlePhoneInput = val => {
    setForm(f=>({...f,memberPhone:val})); setSuggestIndex(-1); setNameSuggestions([]); setIdSuggestions([]);
    setPhoneSuggestions(val.length>0 ? members.filter(m=>(m.phone||"").toLowerCase().includes(val.toLowerCase())) : []);
  };
  // Picking any suggestion fills the member's name + ID + phone, and closes all lists.
  const selectMember = m => { setForm(f=>({...f,memberName:m.name,memberId:m.id,memberPhone:m.phone||""})); setNameSuggestions([]); setIdSuggestions([]); setPhoneSuggestions([]); setSuggestIndex(-1); };
  // Keyboard nav for the member-suggestion lists: ↑/↓ move, Enter selects the
  // highlighted row (and stops the Enter from also submitting the form), Esc closes.
  // With nothing highlighted, Enter falls through so the form still saves.
  const onSuggestKey = (e, suggestions) => {
    if(!suggestions || suggestions.length===0) return;
    if(e.key==="ArrowDown"){ e.preventDefault(); e.stopPropagation(); setSuggestIndex(i=>Math.min(suggestions.length-1,(i<0?-1:i)+1)); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); e.stopPropagation(); setSuggestIndex(i=>Math.max(0,(i<0?0:i)-1)); }
    else if(e.key==="Enter"){ if(suggestIndex>=0&&suggestIndex<suggestions.length){ e.preventDefault(); e.stopPropagation(); selectMember(suggestions[suggestIndex]); } }
    else if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); setNameSuggestions([]); setIdSuggestions([]); setPhoneSuggestions([]); setSuggestIndex(-1); }
  };

  // When the entry modal opens, move focus into it (so Tab cycles the fields).
  useEffect(()=>{ if(!showEntryModal) return undefined; const id=setTimeout(()=>amountRef.current?.focus(),40); return ()=>clearTimeout(id); },[showEntryModal]);

  // Alt + first letter picks an entry type while on the Transactions page.
  useEffect(()=>{
    const onKey = (e)=>{
      if(!e.altKey||e.ctrlKey||e.metaKey) return;
      if(page!=="transactions") return;
      const type = TYPE_SHORTCUTS[(e.key||"").toLowerCase()];
      if(!type) return;
      e.preventDefault();
      if(showEntryModal) setForm(f=>({...f,type}));   // already open → just switch type (keeps typed data)
      else openEntryType(type);                        // closed → open fresh on that type
    };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[page,showEntryModal,activeBanks]);

  const handleDeleteTx = key => {
    // `key` is the row's uid (preferred) or its numeric id for older rows. Matching on
    // uid means we delete EXACTLY this row even if another device happened to reuse the
    // same numeric id.
    const sameRow = (t,k)=> t.uid ? t.uid===k : t.id===k;
    const target = transactions.find(t=>sameRow(t,key));
    const isPair = target && target.pairId;
    setConfirm({message: isPair
        ? "Delete this transfer? Both the OUT and IN sides will be marked deleted together."
        : "Mark this entry as deleted? It will remain visible in the log for audit purposes.",
      onConfirm:()=>{
        setTransactions(prev=>prev.map(t=>{
          if(sameRow(t,key)) return {...t,deleted:true};
          if(isPair && t.pairId===target.pairId) return {...t,deleted:true};
          return t;
        }));
        setConfirm(null);
      }});
  };

  const handleAddTx = () => {
    const isSigned = SIGNED_TYPES.includes(form.type);
    // Regular Deposit / Withdrawal still require a name/reference (it tracks the
    // member). The bank is OPTIONAL for every type now. All other types may also
    // leave the name/reference blank.
    const needsName = form.type==="Regular Deposit" || form.type==="Regular Withdrawal";
    if(form.amount===""||isNaN(form.amount)||(!isSigned&&Number(form.amount)<=0)||(isSigned&&Number(form.amount)===0)){setFormError(isSigned?"Enter a non-zero amount (use a minus sign for negative).":"Enter a valid amount.");window.showToast?.("Error , Please Try Again","error");return;}
    if(needsName && !form.memberName.trim()){setFormError("Enter a name/reference.");window.showToast?.("Error , Please Try Again","error");return;}
    const srcBank = banks.find(b=>b.id===form.bankId);
    setFormError("");
    const destBank = banks.find(b=>b.id===form.toBankId);
    const amt = Number(form.amount);
    const op = SESSION.operatorId;
    const time = timeInTz(tz);
    const txDate = form.date || today;   // chosen "Entry date", else default to today
    const ref = form.memberName.trim();
    const rcpt = (form.receipt||"").trim();   // optional receipt number, stamped on every leg
    const blank = {type:"Regular Deposit",amount:"",memberId:"",memberName:"",memberPhone:"",bankId:activeBanks[0]?.id??null,notes:"",toBankId:null,date:"",fromUnclaimed:false,redeposit:false,claimDate:"",receipt:""};
    // Entry saved OK — close the form, reset it, and pop the success toast.
    const done = ()=>{ setShowEntryModal(false); setForm(blank); window.showToast?.("Action Done !","success"); };

    // ---- Transfer: make a leg for whichever bank(s) are chosen ----
    if(form.type==="Transfer"){
      if(!srcBank && !destBank){setFormError("Pick a source and/or destination bank.");window.showToast?.("Error , Please Try Again","error");return;}
      const pairId = `TR-${nextId}`;
      const rows = []; let idc = nextId;
      if(srcBank) rows.push({id:idc++,date:txDate,time,type:"Transfer Out",amount:amt,memberId:"",memberName:ref||(destBank?`Transfer to ${destBank.name}`:"Transfer out"),bank:srcBank.name,bankId:srcBank.id,bankHolder:srcBank.holder||"",counterparty:destBank?destBank.name:"",pairId,notes:form.notes||(destBank?`To ${destBank.name}`:""),receipt:rcpt,uid:mkUid(),operator:op,isNew:false,deleted:false});
      if(destBank) rows.push({id:idc++,date:txDate,time,type:"Transfer In",amount:amt,memberId:"",memberName:ref||(srcBank?`Transfer from ${srcBank.name}`:"Transfer in"),bank:destBank.name,bankId:destBank.id,bankHolder:destBank.holder||"",counterparty:srcBank?srcBank.name:"",pairId,notes:form.notes||(srcBank?`From ${srcBank.name}`:""),receipt:rcpt,uid:mkUid(),operator:op,isNew:false,deleted:false});
      setTransactions(prev=>[...rows.reverse(),...prev]);
      setNextId(idc);
      done();
      return;
    }

    // ---- Store / Mistake: money moves OUT of the chosen bank and INTO the
    // Store/Mistake "bucket". With a bank => two linked legs (bank leg, tagged
    // fundLeg, + bucket leg). With no bank => one bucket leg that just adds the
    // amount to the Store/Mistake total. ----
    if(form.type==="Store" || form.type==="Mistake"){
      if(srcBank){
        const pairId = `${form.type==="Store"?"ST":"MK"}-${nextId}`;
        const bankLeg = {id:nextId,date:txDate,time,type:form.type,amount:amt,memberId:"",memberName:ref||form.type,bank:srcBank.name,bankId:srcBank.id,bankHolder:srcBank.holder||"",counterparty:form.type,pairId,notes:form.notes,receipt:rcpt,uid:mkUid(),operator:op,isNew:false,deleted:false,fundLeg:true};
        const bucketLeg = {id:nextId+1,date:txDate,time,type:form.type,amount:-amt,memberId:"",memberName:ref||form.type,bank:form.type,pairId,notes:form.notes,receipt:rcpt,uid:mkUid(),operator:op,isNew:false,deleted:false,bucketLeg:true};
        setTransactions(prev=>[bucketLeg,bankLeg,...prev]);
        setNextId(n=>n+2);
      } else {
        const bucketLeg = {id:nextId,date:txDate,time,type:form.type,amount:amt,memberId:"",memberName:ref||form.type,bank:form.type,notes:form.notes,receipt:rcpt,uid:mkUid(),operator:op,isNew:false,deleted:false,bucketLeg:true};
        setTransactions(prev=>[bucketLeg,...prev]);
        setNextId(n=>n+1);
      }
      done();
      return;
    }

    // ---- Regular Deposit funded by Unclaimed Credit (the "Deposit from unclaimed
    // credit" tick-box): it COUNTS as a deposit AND reduces the unclaimed-credit
    // balance, WITHOUT touching any bank balance (the money is already in a bank
    // from when the unclaimed credit was recorded). The user picks WHICH DATE's
    // unclaimed credit to claim from: the deposit leg is dated today (txDate) but the
    // claim (-amt) leg is dated the chosen day, so it lands in THAT day's log and
    // reduces that day's remaining unclaimed credit. Two linked legs, no bank. ----
    if(form.type==="Regular Deposit" && form.fromUnclaimed){
      const claimFrom = form.claimDate || claimableDates[0] || txDate;   // which day's credit we draw from
      const availForDate = unclaimedByDate[claimFrom] || 0;
      if(amt > availForDate + 1e-9){ setFormError(`Not enough unclaimed credit on ${claimFrom} to claim. Available that day: ${fmt(availForDate)}.`); window.showToast?.("Error , Please Try Again","error"); return; }
      const pairId = `UC-${nextId}`;
      const existingMember = members.find(m=>(form.memberId && m.id===form.memberId)||(ref && m.name.toLowerCase()===ref.toLowerCase()));
      const isNew = !existingMember && !!ref;
      const assignedId = form.memberId.trim() || `M${String(nextId).padStart(3,"0")}`;
      const depLeg = {id:nextId,date:txDate,time,type:"Regular Deposit",amount:amt,memberId:assignedId,memberName:ref,bank:"",bankId:null,bankHolder:"",notes:form.notes,receipt:rcpt,uid:mkUid(),operator:op,isNew,deleted:false,pairId,fromUnclaimed:true,claimedFromDate:claimFrom};
      const ucLeg  = {id:nextId+1,date:claimFrom,time,type:"Unclaimed Credit",amount:-amt,memberId:assignedId,memberName:ref,bank:"",bankId:null,bankHolder:"",notes:form.notes||`Claimed by deposit on ${txDate}`,receipt:rcpt,uid:mkUid(),operator:op,isNew:false,deleted:false,pairId,claimLeg:true};
      setTransactions(prev=>[ucLeg,depLeg,...prev]);
      setNextId(n=>n+2);
      if(isNew){
        setMembers(prev=>[...prev,{id:assignedId,name:ref,phone:form.memberPhone||"",joined:txDate,lastActivity:txDate}]);
      } else if(existingMember){
        setMembers(prev=>prev.map(m=>m.id===existingMember.id?{...m,lastActivity:txDate}:m));
      }
      done();
      return;
    }

    // ---- Regular Withdrawal flagged as a "Redeposit" (the Redeposit tick-box):
    // the player takes money out and immediately puts it back. It COUNTS as BOTH a
    // withdrawal AND a deposit for the day, but moves NO bank balance even if a bank
    // is selected. Two linked, bank-less legs (withdrawal first, deposit after) tied
    // by an RD- pairId so deleting one deletes both; the deposit leg shows a
    // "Redeposit" tag in the bank column. ----
    if(form.type==="Regular Withdrawal" && form.redeposit){
      const pairId = `RD-${nextId}`;
      const existingMember = members.find(m=>(form.memberId && m.id===form.memberId)||(ref && m.name.toLowerCase()===ref.toLowerCase()));
      const isNew = !existingMember && !!ref;
      const assignedId = form.memberId.trim() || (existingMember?existingMember.id:`M${String(nextId).padStart(3,"0")}`);
      const wdLeg  = {id:nextId,date:txDate,time,type:"Regular Withdrawal",amount:amt,memberId:assignedId,memberName:ref,bank:"",bankId:null,bankHolder:"",notes:form.notes,receipt:rcpt,uid:mkUid(),operator:op,isNew:false,deleted:false,pairId,redeposit:true};
      const depLeg = {id:nextId+1,date:txDate,time,type:"Regular Deposit",amount:amt,memberId:assignedId,memberName:ref,bank:"",bankId:null,bankHolder:"",notes:form.notes,receipt:rcpt,uid:mkUid(),operator:op,isNew,deleted:false,pairId,redeposit:true};
      setTransactions(prev=>[wdLeg,depLeg,...prev]);
      setNextId(n=>n+2);
      if(isNew){
        setMembers(prev=>[...prev,{id:assignedId,name:ref,phone:form.memberPhone||"",joined:txDate,lastActivity:txDate}]);
      } else if(existingMember){
        setMembers(prev=>prev.map(m=>m.id===existingMember.id?{...m,lastActivity:txDate}:m));
      }
      done();
      return;
    }

    // ---- Single-entry types: Regular Deposit/Withdrawal, Unclaimed Credit,
    // Rental, Adjust, Other. Bank is optional for all of them. ----
    const isDeposit = form.type==="Regular Deposit";
    const existingMember = members.find(m=>
      (form.memberId && m.id===form.memberId) ||
      (ref && m.name.toLowerCase()===ref.toLowerCase())
    );
    const isNew = isDeposit && !existingMember && !!ref;
    const assignedId = isDeposit ? (form.memberId.trim() || `M${String(nextId).padStart(3,"0")}`) : form.memberId;
    const newTx = {id:nextId,date:txDate,time,type:form.type,amount:amt,memberId:assignedId,memberName:ref,bank:srcBank?srcBank.name:"",bankId:srcBank?srcBank.id:null,bankHolder:srcBank?srcBank.holder||"":"",notes:form.notes,receipt:rcpt,uid:mkUid(),operator:op,isNew,deleted:false};
    setTransactions(prev=>[newTx,...prev]); setNextId(n=>n+1);
    if(isNew){
      setMembers(prev=>[...prev,{id:assignedId,name:ref,phone:form.memberPhone||"",joined:txDate,lastActivity:txDate}]);
    } else if(existingMember){
      setMembers(prev=>prev.map(m=>m.id===existingMember.id?{...m,lastActivity:txDate}:m));
    }
    done();
  };

  const handleAddBank = () => {
    if(!newBank.name.trim()||!newBank.holder.trim()||isNaN(newBank.balance)){setBankError("Bank name, holder's name, and opening balance are required.");return;}
    setBankError("");
    setBanks(prev=>[...prev,{id:Date.now(),name:newBank.name,holder:newBank.holder,bsb:newBank.bsb,account:newBank.account,payid:newBank.payid,openingBalance:Number(newBank.balance),activatedAt:Date.now()}]);
    setNewBank({name:"",holder:"",bsb:"",account:"",payid:"",balance:""});
    setShowBankModal(false);
  };
  const startEditBank = b => { setEditingBank(b.id); setEditBankForm({name:b.name,holder:b.holder,bsb:b.bsb||"",account:b.account||"",payid:b.payid||"",balance:String(b.openingBalance??0)}); setEditBankError(""); };
  const handleSaveBank = id => {
    if(!editBankForm.name.trim()||!editBankForm.holder.trim()||isNaN(editBankForm.balance)){setEditBankError("Bank name, holder, and opening balance are required.");return;}
    setBanks(prev=>prev.map(b=>b.id===id?{...b,name:editBankForm.name,holder:editBankForm.holder,bsb:editBankForm.bsb,account:editBankForm.account,payid:editBankForm.payid,openingBalance:Number(editBankForm.balance)}:b)); setEditingBank(null);
  };
  const handleDeleteBank = (id,name) => setConfirm({message:`Delete "${name}"? This cannot be undone.`,onConfirm:()=>{setBanks(prev=>prev.filter(b=>b.id!==id));setConfirm(null);}});
  // Toggle a bank between active and inactive. Inactive hides it from the
  // dashboard per-bank list and the entry-form dropdowns (history is kept).
  const handleToggleBankActive = id => setBanks(prev=>prev.map(b=>{
    if(b.id!==id) return b;
    const nowActive = b.active===false; // was inactive -> we're activating it now
    return nowActive ? {...b,active:true,activatedAt:Date.now()} : {...b,active:false};
  }));

  const startEditMember = m => { setEditingMember(m.id); setEditMemberForm({id:m.id,name:m.name,phone:m.phone||""}); setEditMemberError(""); };
  const handleSaveMember = id => {
    if(!editMemberForm.id.trim()||!editMemberForm.name.trim()){setEditMemberError("ID and name are required.");return;}
    setMembers(prev=>prev.map(m=>m.id===id?{...m,id:editMemberForm.id,name:editMemberForm.name,phone:editMemberForm.phone}:m)); setEditingMember(null);
  };
  const handleDeleteMember = (id,name) => setConfirm({message:`Delete member "${name}"? Their transaction history will be kept.`,onConfirm:()=>{setMembers(prev=>prev.filter(m=>m.id!==id));setConfirm(null);}});

  const closeMemberModal = () => { setNewMember({name:"",phone:"",id:""}); setNewMemberError(""); setShowMemberModal(false); };
  const handleAddMember = () => {
    if(!newMember.name.trim()){setNewMemberError("Member name is required.");return;}
    const assignedId = newMember.id.trim() || `M${String(nextId).padStart(3,"0")}`;
    if(members.some(m=>m.id===assignedId)){setNewMemberError("That Member ID already exists.");return;}
    if(members.some(m=>m.name.toLowerCase()===newMember.name.trim().toLowerCase())){setNewMemberError("A member with that name already exists.");return;}
    setMembers(prev=>[...prev,{id:assignedId,name:newMember.name.trim(),phone:newMember.phone.trim(),joined:today,lastActivity:today}]);
    if(!newMember.id.trim()) setNextId(n=>n+1);
    setNewMember({name:"",phone:"",id:""}); setNewMemberError(""); setShowMemberModal(false);
  };

  const memberRows = () => members.map(m=>{
    const mTx = transactions.filter(t=>(t.memberId===m.id||t.memberName===m.name)&&!t.deleted);
    const totalDep = mTx.filter(t=>t.type==="Regular Deposit").reduce((a,b)=>a+b.amount,0);
    return {id:m.id,name:m.name,phone:m.phone||"",joined:m.joined,transactions:mTx.length,totalDeposits:totalDep,lastActivity:m.lastActivity};
  });
  const M_COLS = ["id","name","phone","joined","transactions","totalDeposits","lastActivity"];
  const exportMembersCSV = () => {
    const rows = memberRows();
    const lines = rows.map(r=>M_COLS.map(c=>csvEscape(r[c])).join(","));
    downloadBlob([M_COLS.join(","),...lines].join("\n"),"fintrack_members.csv","text/csv;charset=utf-8;");
  };
  const exportMembersExcel = () => {
    const rows = memberRows();
    const head = "<tr>"+M_COLS.map(c=>`<th>${c}</th>`).join("")+"</tr>";
    const body = rows.map(r=>"<tr>"+M_COLS.map(c=>`<td>${String(r[c]??"")}</td>`).join("")+"</tr>").join("");
    downloadBlob(`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">${head}${body}</table></body></html>`,"fintrack_members.xls","application/vnd.ms-excel");
  };
  const exportMembersPDF = () => {
    const rows = memberRows();
    const w = window.open("","_blank"); if(!w) return;
    const head = "<tr>"+["Member ID","Name","Phone","Joined","Transactions","Total deposits","Last activity"].map(c=>`<th>${c}</th>`).join("")+"</tr>";
    const body = rows.map(r=>"<tr>"+[r.id,r.name,r.phone,r.joined,r.transactions,fmt(r.totalDeposits),r.lastActivity].map(c=>`<td>${String(c)}</td>`).join("")+"</tr>").join("");
    w.document.write(`<html><head><title>FinTrack — Members</title><style>body{font-family:sans-serif;padding:20px}h2{font-weight:500}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0}</style></head><body><h2>FinTrack — Members directory</h2><table>${head}${body}</table><script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  };

  const openMemberDetail = m => {
    const tx = transactions.filter(t=>t.memberId===m.id||t.memberName===m.name).sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time));
    const total = tx.filter(t=>t.type==="Regular Deposit"&&!t.deleted).reduce((a,b)=>a+b.amount,0);
    setDetailModal({title:m.name,subtitle:`${m.id}${m.phone?" · "+m.phone:""} · Joined ${m.joined} · ${tx.length} transactions · Total deposits: ${fmt(total)}`,transactions:tx});
  };
  const openBankDetail = b => {
    const tx = transactions.filter(t=>txInBank(t,b)).sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time));
    setDetailModal({title:b.name,subtitle:`Holder: ${b.holder} · BSB: ${b.bsb||"—"} · Acc: ${b.account} · ${tx.length} transactions · Balance: ${fmt(b.balance)}`,transactions:tx,yesterday:b.yBalance});
  };

  const nav = [
    {id:"dashboard",icon:"ti-layout-dashboard",label:"Dashboard"},
    {id:"transactions",icon:"ti-transfer",label:"Transactions"},
    {id:"banks",icon:"ti-building-bank",label:"Bank Accounts"},
    {id:"members",icon:"ti-users",label:"Members"},
    {id:"search",icon:"ti-search",label:"Search"},
  ];

  // Members list: optional search (name / ID / phone) then pagination.
  const memberFiltered = useMemo(()=>{
    const q = memberSearch.trim().toLowerCase();
    if(!q) return members;
    return members.filter(m=>(m.name||"").toLowerCase().includes(q)||(m.id||"").toLowerCase().includes(q)||(m.phone||"").toLowerCase().includes(q));
  },[members,memberSearch]);
  const memberTotal = memberFiltered.length;
  const memberPages = Math.max(1, Math.ceil(memberTotal/memberPageSize));
  const memberCurPage = Math.min(memberPage, memberPages);
  const memberStart = (memberCurPage-1)*memberPageSize;
  const memberSlice = memberFiltered.slice(memberStart, memberStart+memberPageSize);

  const labelStyle = {fontSize:12,color:C.muted,display:"block",marginBottom:4};  const SectionTitle = ({icon,children,right}) => (
    <div style={{display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",justifyContent:"space-between",gap:isMobile?10:0,margin:"0 0 12px"}}>
      <h3 style={{fontSize:15,fontWeight:500,margin:0,display:"flex",alignItems:"center",gap:8,color:C.text}}>
        <i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:18,color:C.accent}}/>{children}
      </h3>
      {right}
    </div>
  );

  const toggleBtn = (active,onClick,label) => (
    <button onClick={onClick} style={{cursor:"pointer",padding:"6px 14px",fontSize:13,fontWeight:500,border:`1px solid ${active?C.accent:C.border}`,borderRadius:8,background:active?C.accent:C.surface2,color:active?"#fff":C.text}}>{label}</button>
  );

  const dashScopeLabel = dashView==="today" ? `Today — ${today}`
    : dashView==="yesterday" ? `Yesterday — ${yesterday}`
    : dashView==="week" ? `Last 7 days — ${weekAgo} to ${today}`
    : dashView==="range" ? `${rangeFrom||"start"} to ${rangeTo||"end"}`
    : monthLabel(selMonth);
  const scopeName = dashView==="today" ? `today_${today}`
    : dashView==="yesterday" ? `yesterday_${yesterday}`
    : dashView==="week" ? `week_${weekAgo}_${today}`
    : dashView==="range" ? `range_${rangeFrom}_${rangeTo}`
    : `month_${selMonth}`;

  // Click a dashboard stat card → open the detail popup listing that stat's
  // transactions for the currently selected date scope (today / yesterday / etc.).
  const openStatDetail = (label, rows, totalOverride, scopeOverride, yesterdayAmount) => {
    const list = rows.slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
    const total = totalOverride!==undefined ? totalOverride : rows.reduce((s,t)=>s+(t.amount||0),0);
    setDetailModal({
      title: label,
      subtitle: `${scopeOverride||dashScopeLabel} · ${rows.length} ${rows.length===1?"entry":"entries"} · Total: ${fmt(total)}`,
      transactions: list,
      yesterday: yesterdayAmount,
    });
  };

  // Stat-card definitions (shared). On Transactions, the 5 "primary" cards stay
  // visible and the rest fold into a "More stats" drawer.
  const win = stats.sum(stats.deposits)-stats.sum(stats.withdrawals);
  const statCardDefs = [
    {label:"Total deposits", count:stats.deposits.length, amount:stats.sum(stats.deposits), color:"#16a34a", onClick:()=>openStatDetail("Total deposits", stats.deposits)},
    {label:"Total withdrawals", count:stats.withdrawals.length, amount:stats.sum(stats.withdrawals), color:"#dc2626", onClick:()=>openStatDetail("Total withdrawals", stats.withdrawals)},
    {label:"Win / Loss", amount:win, color:win>=0?"#16a34a":"#dc2626", onClick:()=>openStatDetail("Win / Loss (deposits & withdrawals)", [...stats.deposits, ...stats.withdrawals], win)},
    {label:"New members", count:stats.newMembers.length, amount:stats.sum(stats.newMembers), color:"#2563eb", onClick:()=>openStatDetail("New members", stats.newMembers)},
    {label:"Unclaimed credits", count:stats.unclaimed.length, amount:stats.sum(stats.unclaimed), color:"#d97706", onClick:()=>openStatDetail("Unclaimed credits", stats.unclaimed)},
    {label:"Mistakes", count:stats.mistakes.length, amount:stats.sum(stats.mistakes), color:"#7c3aed", onClick:()=>openStatDetail("Mistakes", stats.mistakes)},
    {label:"Rentals", count:stats.rentals.length, amount:stats.sum(stats.rentals), color:"#0891b2", onClick:()=>openStatDetail("Rentals", stats.rentals)},
    {label:"Store entries", count:storeAllTime.length, amount:stats.sum(storeAllTime), color:"#FFDE63", note:`Yesterday: ${fmt(storeYesterday)}`, onClick:()=>openStatDetail("Store entries", storeAllTime, undefined, "All time (running total)", storeYesterday)},
    {label:"Transfers", count:stats.transfers.length, amount:stats.sum(stats.transfers), color:"#6366f1", onClick:()=>openStatDetail("Transfers", stats.transfers)},
    {label:"Adjustments", count:stats.adjustments.length, amount:stats.sum(stats.adjustments), color:"#0d9488", onClick:()=>openStatDetail("Adjustments", stats.adjustments)},
  ];
  const PRIMARY_STATS = ["Total deposits","Total withdrawals","Win / Loss","Unclaimed credits","Store entries"];
  const primaryStatCards = statCardDefs.filter(c=>PRIMARY_STATS.includes(c.label));
  const drawerStatCards  = statCardDefs.filter(c=>!PRIMARY_STATS.includes(c.label));
  const statCardsGrid = (<>{statCardDefs.map(c=><StatCard key={c.label} {...c}/>)}</>);

  // Scope tabs + export row — the shared header above either stat grid.
  const statScopeBar = (<>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
      {toggleBtn(dashView==="today",()=>setDashView("today"),"Today")}
      {toggleBtn(dashView==="yesterday",()=>setDashView("yesterday"),"Yesterday")}
      {toggleBtn(dashView==="week",()=>setDashView("week"),"This week")}
      {toggleBtn(dashView==="month",()=>setDashView("month"),"Monthly")}
      {toggleBtn(dashView==="range",()=>setDashView("range"),"Date range")}
      {dashView==="month"&&(
        <FluidDropdown width={190} style={{marginLeft:4}} value={selMonth} ariaLabel="Select month"
          options={availableMonths.map(m=>({value:m,label:monthLabel(m)}))}
          onChange={v=>setSelMonth(v)}/>
      )}
      {dashView==="range"&&(
        <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:4,flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:C.muted}}>From</span>
          <input type="date" value={rangeFrom} max={rangeTo||undefined} onChange={e=>setRangeFrom(e.target.value)} style={{boxSizing:"border-box"}}/>
          <span style={{fontSize:12,color:C.muted}}>To</span>
          <input type="date" value={rangeTo} min={rangeFrom||undefined} onChange={e=>setRangeTo(e.target.value)} style={{boxSizing:"border-box"}}/>
        </div>
      )}
      <span style={{fontSize:13,color:C.muted,marginLeft:"auto"}}>{dashScopeLabel}</span>
    </div>

    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18,flexWrap:"wrap"}}>
      <span style={{fontSize:12,color:C.muted,marginRight:2}}>Export this view:</span>
      <button onClick={()=>exportCSV(dashTx,`fintrack_${scopeName}`)} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"6px 12px",border:`1px solid ${C.border}`,borderRadius:6,background:C.surface2,color:C.text,display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-text" aria-hidden="true"/> CSV</button>
      <button onClick={()=>exportExcel(dashTx,`fintrack_${scopeName}`)} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"6px 12px",border:`1px solid #16a34a`,borderRadius:6,background:dark?"#163524":"#16a34a14",color:"#16a34a",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-spreadsheet" aria-hidden="true"/> Excel</button>
      <button onClick={()=>exportPDF(dashTx,`FinTrack — ${dashScopeLabel}`)} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"6px 12px",border:`1px solid #dc2626`,borderRadius:6,background:dark?"#3a1515":"#dc262614",color:"#dc2626",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-type-pdf" aria-hidden="true"/> PDF</button>
    </div>
  </>);

  // Dashboard overview — scope bar + ALL 10 stat cards.
  const statOverview = (<>
    {statScopeBar}
    <div style={{display:"grid",gridTemplateColumns:isWideView?"repeat(5, minmax(0,1fr))":"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:18}}>
      {statCardsGrid}
    </div>
  </>);

  // Transactions overview — scope bar + 5 primary cards + a "More stats" drawer.
  const statOverviewCompact = (<>
    {statScopeBar}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:18}}>
      {primaryStatCards.map(c=><StatCard key={c.label} {...c}/>)}
      <div style={{position:"relative"}} ref={moreStatsRef}>
        <button type="button" onClick={()=>setShowMoreStats(s=>!s)} aria-haspopup="menu" aria-expanded={showMoreStats}
          style={{width:"100%",height:"100%",minHeight:78,boxSizing:"border-box",cursor:"pointer",padding:"10px 12px",fontSize:13,fontWeight:500,borderRadius:10,border:`1.5px dashed ${showMoreStats?C.accent:C.borderStrong}`,background:showMoreStats?C.surface2:"transparent",color:showMoreStats?C.text:C.muted,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,transition:"all 0.12s"}}
          onMouseEnter={e=>{e.currentTarget.style.background=C.surface2;e.currentTarget.style.color=C.text;}}
          onMouseLeave={e=>{if(!showMoreStats){e.currentTarget.style.background="transparent";e.currentTarget.style.color=C.muted;}}}>
          <i className="ti ti-dots" aria-hidden="true" style={{fontSize:18}}/>More stats
        </button>
        {showMoreStats&&(
          <div role="menu" style={{position:"absolute",top:"calc(100% + 6px)",right:0,width:260,maxWidth:"82vw",maxHeight:"60vh",overflowY:"auto",background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,boxShadow:dark?"0 12px 32px rgba(0,0,0,0.5)":"0 12px 32px rgba(0,0,0,0.15)",zIndex:60,padding:8,display:"flex",flexDirection:"column",gap:8,transformOrigin:"top",animation:"fluid-dd-in 0.18s ease"}}>
            {drawerStatCards.map(c=><StatCard key={c.label} {...c}/>)}
          </div>
        )}
      </div>
    </div>
  </>);

  // "Current active bank" card (reused on the Dashboard + Transactions pages).
  // Small coloured line: how many deposit / withdrawal / transfer ENTRIES hit this bank today.
  const bankTodayCounts = (b, compact=false) => (
    <div style={{display:"flex",alignItems:"center",gap:compact?7:8,marginTop:compact?3:6,fontSize:compact?10:11.5,flexWrap:"wrap"}}>
      {!compact&&<span style={{color:C.muted}}>Today:</span>}
      <span style={{display:"inline-flex",alignItems:"center",gap:3,color:"#16a34a",fontWeight:600}} title="Deposit entries recorded today">
        <i className="ti ti-arrow-down-left" aria-hidden="true" style={{fontSize:compact?11:13}}/>{b.depToday||0}{compact?"":" deposits"}
      </span>
      {!compact&&<span aria-hidden="true" style={{color:C.border}}>·</span>}
      <span style={{display:"inline-flex",alignItems:"center",gap:3,color:"#dc2626",fontWeight:600}} title="Withdrawal entries recorded today">
        <i className="ti ti-arrow-up-right" aria-hidden="true" style={{fontSize:compact?11:13}}/>{b.wdToday||0}{compact?"":" withdrawals"}
      </span>
      {!compact&&<span aria-hidden="true" style={{color:C.border}}>·</span>}
      <span style={{display:"inline-flex",alignItems:"center",gap:3,color:"#6366f1",fontWeight:600}} title="Transfer entries (in + out) recorded today">
        <i className="ti ti-arrows-exchange" aria-hidden="true" style={{fontSize:compact?11:13}}/>{b.tfToday||0}{compact?"":" transfers"}
      </span>
      {!compact&&<span aria-hidden="true" style={{color:C.border}}>·</span>}
      <span style={{display:"inline-flex",alignItems:"center",gap:3,fontWeight:600,...(dark?{color:STORE_COLOR}:{background:STORE_COLOR,color:STORE_INK,borderRadius:5,padding:compact?"0 5px":"1px 7px"})}} title="Store entries from this bank today">
        <i className="ti ti-building-store" aria-hidden="true" style={{fontSize:compact?11:13}}/>{b.stToday||0}{compact?"":" store"}
      </span>
    </div>
  );

  const activeBankCard = (
    <div style={cardStyle}>
      <h3 style={{fontSize:16,fontWeight:600,margin:"0 0 14px",color:C.text,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-building-bank" aria-hidden="true" style={{color:C.accent}}/> Current active bank</h3>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {activeBanks.length===0&&<div style={{fontSize:13,color:C.muted,padding:"14px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No active banks.</div>}
        {activeBanks.map(b=>(
          <GlowCard key={b.id} color={C.accent} onClick={()=>openBankDetail(b)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:C.bg,borderRadius:10,padding:"11px 14px",cursor:"pointer",border:`1px solid ${C.border}`}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
            onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:600,fontSize:13,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={b.holder||b.name}>{b.holder||b.name}</div>
              <div style={{fontSize:11.5,color:C.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name}</div>
              {bankTodayCounts(b,true)}
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:14,fontWeight:600,color:C.text,whiteSpace:"nowrap"}}>{fmt(b.balance)}</div>
              <div style={{fontSize:10,color:C.muted,whiteSpace:"nowrap"}}>Yest: {fmt(b.yBalance)}</div>
            </div>
          </GlowCard>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{display:"flex",minHeight:isMobile?"auto":620,fontFamily:"var(--font-sans)",position:"relative",overflow:"hidden",borderRadius:isMobile?0:12,border:isMobile?"none":`1px solid ${C.border}`}}>
      <style>{`
        .ft-scope input, .ft-scope select, .ft-modal input, .ft-modal select {
          border-radius: 8px;
          border: 1px solid ${C.border};
          padding: 8px 11px;
          font-size: 13px;
          background: ${C.bg};
          color: ${C.text};
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s;
          font-family: inherit;
          appearance: none;
        }
        .ft-scope select, .ft-modal select {
          padding-right: 30px;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${dark?'%23a8a69e':'%235f5e5a'}' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
          background-repeat: no-repeat;
          background-position: right 10px center;
        }
        .ft-scope input:focus, .ft-scope select:focus, .ft-modal input:focus, .ft-modal select:focus {
          border-color: ${C.accent};
          box-shadow: 0 0 0 3px ${C.accent}22;
        }
        .ft-scope input::placeholder, .ft-modal input::placeholder { color: ${C.muted}; opacity: 0.7; }
        .ft-scope input[type="date"]::-webkit-calendar-picker-indicator, .ft-modal input[type="date"]::-webkit-calendar-picker-indicator {
          filter: ${dark?"invert(0.7)":"invert(0.3)"};
          cursor: pointer;
        }
      `}</style>
      <div className="ft-scope" style={{display:"flex",width:"100%",minWidth:0}}>
      {confirm&&<Confirm message={confirm.message} onConfirm={confirm.onConfirm} onCancel={()=>setConfirm(null)}/>}
      {detailModal&&<DetailModal title={detailModal.title} subtitle={detailModal.subtitle} transactions={detailModal.transactions} banks={banks} yesterday={detailModal.yesterday} onClose={()=>setDetailModal(null)}/>}

      {showPasswordModal&&(
        <div className="ft-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1001,padding:"24px 16px"}} onClick={closePasswordModal}>
          <div style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:420,boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header}}>
              <div style={{fontWeight:500,fontSize:16,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-key" aria-hidden="true" style={{color:C.accent}}/> Change password</div>
              <button onClick={closePasswordModal} style={{cursor:"pointer",padding:"7px 14px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}><i className="ti ti-x" aria-hidden="true"/> Close</button>
            </div>
            <div style={{padding:"18px 20px"}}>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Operator <strong style={{color:C.text}}>{SESSION.operatorId}</strong> — {SESSION.companyName}</div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div><label style={labelStyle}>Current password</label>
                  <input type="password" value={pwForm.current} onChange={e=>setPwForm(f=>({...f,current:e.target.value}))} placeholder="••••••••" style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div><label style={labelStyle}>New password</label>
                  <input type="password" value={pwForm.next} onChange={e=>setPwForm(f=>({...f,next:e.target.value}))} placeholder="At least 6 characters" style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div><label style={labelStyle}>Confirm new password</label>
                  <input type="password" value={pwForm.confirm} onChange={e=>setPwForm(f=>({...f,confirm:e.target.value}))} placeholder="Re-enter new password" style={{width:"100%",boxSizing:"border-box"}}/></div>
              </div>
              {pwError&&<div style={{fontSize:12,color:"#dc2626",marginTop:10}}>{pwError}</div>}
              {pwSuccess&&<div style={{fontSize:12,color:"#16a34a",marginTop:10,display:"flex",alignItems:"center",gap:6}}><i className="ti ti-circle-check" aria-hidden="true"/>{pwSuccess}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:18}}>
                <button onClick={closePasswordModal} style={{cursor:"pointer",padding:"9px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
                <button onClick={handleChangePassword} style={{cursor:"pointer",fontWeight:500,background:C.accent,color:"#fff",border:"none",borderRadius:8,padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> Update password</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMemberModal&&(
        <div className="ft-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:"24px 16px"}} onClick={closeMemberModal}>
          <div style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:460,boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header}}>
              <div style={{fontWeight:500,fontSize:16,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-user-plus" aria-hidden="true" style={{color:C.accent}}/> Add new member</div>
              <button onClick={closeMemberModal} style={{cursor:"pointer",padding:"7px 14px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}><i className="ti ti-x" aria-hidden="true"/> Close</button>
            </div>
            <div style={{padding:"18px 20px"}}>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div><label style={labelStyle}>Name</label>
                  <input type="text" placeholder="Member full name" value={newMember.name} onChange={e=>setNewMember(m=>({...m,name:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div><label style={labelStyle}>Phone number <span style={{color:C.muted,fontWeight:400}}>(optional)</span></label>
                  <input type="text" placeholder="e.g. 0499 000 000" value={newMember.phone} onChange={e=>setNewMember(m=>({...m,phone:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div><label style={labelStyle}>Member ID <span style={{color:C.muted,fontWeight:400}}>(optional — auto-assigned if blank)</span></label>
                  <input type="text" placeholder="Leave blank to auto-generate" value={newMember.id} onChange={e=>setNewMember(m=>({...m,id:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
              </div>
              {newMemberError&&<div style={{fontSize:12,color:"#dc2626",marginTop:10}}>{newMemberError}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:18}}>
                <button onClick={closeMemberModal} style={{cursor:"pointer",padding:"9px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
                <button onClick={handleAddMember} style={{cursor:"pointer",fontWeight:500,background:C.accent,color:"#fff",border:"none",borderRadius:8,padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> Add member</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBankModal&&(
        <div className="ft-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:"24px 16px"}} onClick={closeBankModal}>
          <div style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:560,maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
              <div style={{fontWeight:500,fontSize:17,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-building-bank" aria-hidden="true" style={{color:C.accent}}/> Add new bank account</div>
              <button onClick={closeBankModal} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}><i className="ti ti-x" aria-hidden="true"/> Close</button>
            </div>
            <div style={{padding:"18px 20px",overflowY:"auto"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                <div style={{gridColumn:"1/-1"}}><label style={labelStyle}>Bank name</label>
                  <FluidDropdown value={newBank.name} placeholder="— Select bank —" ariaLabel="Bank name"
                    options={[{value:"",label:"— Select bank —"},...BANK_CHOICES.map(b=>({value:b,label:b}))]}
                    onChange={v=>setNewBank(b=>({...b,name:v}))}/></div>
                {[["holder","Holder's name","e.g. Company Ltd"],["bsb","BSB number (optional)","e.g. 062-000"],["account","Account number (optional)","e.g. 1234567890"],["payid","PayID (optional)","e.g. name@company.com"],["balance","Opening balance","0"]].map(([k,label,ph])=>(
                  <div key={k}><label style={labelStyle}>{label}</label>
                    <input type={k==="balance"?"number":"text"} placeholder={ph} value={newBank[k]} onChange={e=>setNewBank(b=>({...b,[k]:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                ))}
              </div>
              {bankError&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{bankError}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6}}>
                <button onClick={closeBankModal} style={{cursor:"pointer",padding:"9px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
                <button onClick={handleAddBank} style={{cursor:"pointer",fontWeight:500,background:C.accent,color:"#fff",border:"none",borderRadius:8,padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> Add bank</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEntryModal&&(
        <div className="ft-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:isMobile?"stretch":"center",justifyContent:"center",zIndex:1000,padding:isMobile?0:"24px 16px"}} onClick={closeEntryModal}>
          <div style={{background:C.bg,border:isMobile?"none":`2px solid ${C.border}`,borderRadius:isMobile?0:14,width:"100%",maxWidth:isMobile?"none":640,height:isMobile?"100%":"auto",maxHeight:isMobile?"none":"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}
            onKeyDown={e=>{ if(e.key==="Enter"){ const tag=e.target.tagName; if(tag==="BUTTON"||tag==="TEXTAREA") return; e.preventDefault(); handleAddTx(); } }}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
              <div style={{fontWeight:500,fontSize:17,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-plus" aria-hidden="true" style={{color:C.accent}}/> New transaction entry</div>
              <button onClick={closeEntryModal} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}><i className="ti ti-x" aria-hidden="true"/> Close</button>
            </div>
            <div style={{padding:"18px 20px",overflowY:"auto"}}>
              <label style={labelStyle}>Entry type</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
                {ENTRY_TYPES.map(t=>{
                  const c = TYPE_COLORS[t]||C.accent;
                  const active = form.type===t;
                  return <button key={t} onClick={()=>setForm(f=>({...f,type:t,fromUnclaimed:false,redeposit:false,claimDate:""}))} style={{cursor:"pointer",padding:"8px 14px",fontSize:13,fontWeight:500,borderRadius:8,border:`1.5px solid ${c}`,background:active?c:(dark?c+"22":c+"14"),color:active?"#fff":c}}>{t}</button>;
                })}
              </div>
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:12}}>
                <div><label style={labelStyle}>Bank account affected (optional)</label>
                  <FluidDropdown value={form.bankId??""} placeholder="— None —" ariaLabel="Bank account affected"
                    options={[{value:"",label:"— None —"},...activeBanks.map((b,i)=>({value:b.id,label:`${i+1}. ${b.holder} — ${b.name}`}))]}
                    onChange={v=>setForm(f=>({...f,bankId:v===""?null:Number(v)}))}/></div>
                <div><label style={labelStyle}>Amount ($){SIGNED_TYPES.includes(form.type)?" — use minus for negative":""}</label>
                  <input ref={amountRef} type="number" placeholder={SIGNED_TYPES.includes(form.type)?"e.g. 100 or -100":"0.00"} value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                {form.type==="Transfer"&&<div style={{gridColumn:"1/-1"}}><label style={labelStyle}>Destination bank (optional)</label>
                  <FluidDropdown value={form.toBankId??""} placeholder="— None —" ariaLabel="Destination bank"
                    options={[{value:"",label:"— None —"},...activeBanks.filter(b=>b.id!==form.bankId).map((b,i)=>({value:b.id,label:`${i+1}. ${b.holder} — ${b.name}`}))]}
                    onChange={v=>setForm(f=>({...f,toBankId:v===""?null:Number(v)}))}/></div>}
                <div style={{position:"relative",gridColumn:"1/-1"}} ref={suggestRef}>
                  <label style={labelStyle}>Member name / reference{(form.type!=="Regular Deposit"&&form.type!=="Regular Withdrawal")?" (optional)":""}</label>
                  <input type="text" placeholder="Type to search members..." value={form.memberName} onChange={e=>handleNameInput(e.target.value)} onKeyDown={e=>onSuggestKey(e,nameSuggestions)} style={{width:"100%",boxSizing:"border-box"}}/>
                  {nameSuggestions.length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,background:C.bg,border:`2px solid ${C.accent}`,borderRadius:8,zIndex:50,boxShadow:"0 6px 24px rgba(0,0,0,0.25)",marginTop:2,overflow:"hidden"}}>
                      {nameSuggestions.map((m,idx)=>(
                        <div key={m.id} onMouseDown={()=>selectMember(m)} onMouseEnter={()=>setSuggestIndex(idx)} style={{padding:"10px 12px",cursor:"pointer",fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.border}`,background:idx===suggestIndex?C.surface2:C.bg,color:C.text}}>
                          <span style={{fontWeight:500}}><i className="ti ti-user" aria-hidden="true" style={{fontSize:14,marginRight:6,color:C.accent}}/>{m.name}</span>
                          <span style={{color:C.muted,fontSize:11,background:C.surface2,padding:"2px 8px",borderRadius:4,fontWeight:500}}>{m.id}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{position:"relative"}} ref={idSuggestRef}><label style={labelStyle}>Member ID <span style={{color:C.muted,fontWeight:400}}>(optional — auto-assigned if blank)</span></label>
                  <input type="text" placeholder="Type to search by ID…" value={form.memberId} onChange={e=>handleIdInput(e.target.value)} onKeyDown={e=>onSuggestKey(e,idSuggestions)} style={{width:"100%",boxSizing:"border-box"}}/>
                  {idSuggestions.length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,background:C.bg,border:`2px solid ${C.accent}`,borderRadius:8,zIndex:50,boxShadow:"0 6px 24px rgba(0,0,0,0.25)",marginTop:2,overflow:"hidden",maxHeight:220,overflowY:"auto"}}>
                      {idSuggestions.map((m,idx)=>(
                        <div key={m.id} onMouseDown={()=>selectMember(m)} onMouseEnter={()=>setSuggestIndex(idx)} style={{padding:"10px 12px",cursor:"pointer",fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.border}`,background:idx===suggestIndex?C.surface2:C.bg,color:C.text}}>
                          <span style={{fontWeight:500}}><i className="ti ti-id" aria-hidden="true" style={{fontSize:14,marginRight:6,color:C.accent}}/>{m.id}</span>
                          <span style={{color:C.muted,fontSize:11}}>{m.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{position:"relative"}} ref={phoneSuggestRef}><label style={labelStyle}>Phone number <span style={{color:C.muted,fontWeight:400}}>(optional)</span></label>
                  <input type="text" placeholder="Type to search by phone…" value={form.memberPhone} onChange={e=>handlePhoneInput(e.target.value)} onKeyDown={e=>onSuggestKey(e,phoneSuggestions)} style={{width:"100%",boxSizing:"border-box"}}/>
                  {phoneSuggestions.length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,background:C.bg,border:`2px solid ${C.accent}`,borderRadius:8,zIndex:50,boxShadow:"0 6px 24px rgba(0,0,0,0.25)",marginTop:2,overflow:"hidden",maxHeight:220,overflowY:"auto"}}>
                      {phoneSuggestions.map((m,idx)=>(
                        <div key={m.id} onMouseDown={()=>selectMember(m)} onMouseEnter={()=>setSuggestIndex(idx)} style={{padding:"10px 12px",cursor:"pointer",fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.border}`,background:idx===suggestIndex?C.surface2:C.bg,color:C.text}}>
                          <span style={{fontWeight:500}}><i className="ti ti-phone" aria-hidden="true" style={{fontSize:14,marginRight:6,color:C.accent}}/>{m.phone||"—"}</span>
                          <span style={{color:C.muted,fontSize:11}}>{m.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{gridColumn:"1/-1"}}><label style={labelStyle}>Receipt number <span style={{color:C.muted,fontWeight:400}}>(optional)</span></label>
                  <input type="text" placeholder="e.g. receipt / reference no." value={form.receipt} onChange={e=>setForm(f=>({...f,receipt:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div style={{gridColumn:"1/-1"}}><label style={labelStyle}>Notes</label>
                  <input type="text" placeholder="Optional notes" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                {form.type==="Regular Deposit"&&(
                  <div style={{gridColumn:"1/-1",display:"flex",flexDirection:"column",gap:10}}>
                    <label style={{display:"inline-flex",alignItems:"center",gap:10,padding:"6px 12px",borderRadius:8,border:`1px solid ${form.fromUnclaimed?"#16a34a":C.border}`,background:C.surface2,cursor:"pointer",userSelect:"none",transition:"border-color 0.15s",alignSelf:"flex-start"}}>
                      <input type="checkbox" checked={!!form.fromUnclaimed} onChange={e=>{const on=e.target.checked;setForm(f=>({...f,fromUnclaimed:on,claimDate:on?(f.claimDate||claimableDates[0]||today):f.claimDate}));}} style={{position:"absolute",opacity:0,width:0,height:0}}/>
                      <span aria-hidden="true" style={{width:20,height:20,borderRadius:6,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",background:form.fromUnclaimed?"#16a34a":"#0b0f16",border:`1px solid ${form.fromUnclaimed?"#16a34a":C.borderStrong}`,boxShadow:form.fromUnclaimed?"0 0 0 3px rgba(22,163,74,0.30), 0 0 9px rgba(22,163,74,0.7)":"none",transition:"all 0.15s"}}>
                        {form.fromUnclaimed&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:14}}/>}
                      </span>
                      <span style={{display:"flex",flexDirection:"column",lineHeight:1.25}}>
                        <span style={{fontSize:13,fontWeight:500,color:C.text}}>Unclaimed Credit</span>
                        <span style={{fontSize:10.5,color:C.muted}}>Available now: {fmt(unclaimedBalance)}</span>
                      </span>
                    </label>
                    {form.fromUnclaimed&&(claimableDates.length===0
                      ? <div style={{fontSize:12,color:"#d97706",paddingLeft:2,display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-alert-triangle" aria-hidden="true"/>No unclaimed credit available to claim yet.</div>
                      : <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",fontSize:12.5,color:C.muted,paddingLeft:2}}>
                          <span style={{fontWeight:500,color:C.text}}>Claim from</span>
                          <FluidDropdown width={230} value={form.claimDate} ariaLabel="Claim from which date"
                            options={claimableDates.map(d=>({value:d,label:`${d} — ${fmt(unclaimedByDate[d])} left`}))}
                            onChange={v=>setForm(f=>({...f,claimDate:v}))}/>
                          <span>· the deposit still counts as today</span>
                        </div>
                    )}
                  </div>
                )}
                {form.type==="Regular Withdrawal"&&(
                  <div style={{gridColumn:"1/-1"}}>
                    <label style={{display:"inline-flex",alignItems:"center",gap:10,padding:"6px 12px",borderRadius:8,border:`1px solid ${form.redeposit?"#2563eb":C.border}`,background:C.surface2,cursor:"pointer",userSelect:"none",transition:"border-color 0.15s"}}>
                      <input type="checkbox" checked={!!form.redeposit} onChange={e=>setForm(f=>({...f,redeposit:e.target.checked}))} style={{position:"absolute",opacity:0,width:0,height:0}}/>
                      <span aria-hidden="true" style={{width:20,height:20,borderRadius:6,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",background:form.redeposit?"#2563eb":"#0b0f16",border:`1px solid ${form.redeposit?"#2563eb":C.borderStrong}`,boxShadow:form.redeposit?"0 0 0 3px rgba(37,99,235,0.30), 0 0 9px rgba(37,99,235,0.7)":"none",transition:"all 0.15s"}}>
                        {form.redeposit&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:14}}/>}
                      </span>
                      <span style={{display:"flex",flexDirection:"column",lineHeight:1.25}}>
                        <span style={{fontSize:13,fontWeight:500,color:C.text}}>Redeposit</span>
                        <span style={{fontSize:10.5,color:C.muted}}>No bank change · counts as withdrawal + deposit</span>
                      </span>
                    </label>
                  </div>
                )}
                <div style={{gridColumn:"1/-1",display:"flex",alignItems:"center",gap:8,padding:"10px 12px",background:C.surface2,borderRadius:8,border:`1px solid ${C.border}`}}>
                  <i className="ti ti-user-cog" aria-hidden="true" style={{fontSize:16,color:C.accent}}/>
                  <span style={{fontSize:12,color:C.muted}}>Recording as operator</span>
                  <span style={{fontSize:13,fontWeight:500,color:C.text}}>{SESSION.operatorId}</span>
                  <span style={{fontSize:12,color:C.muted}}>· auto-stamped on this entry</span>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <label style={labelStyle}>Entry date <span style={{color:C.muted,fontWeight:400}}>(optional — leave blank to use today)</span></label>
                  <input type="date" value={form.date} max={today} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/>
                  {form.date&&form.date!==today&&(
                    <div style={{fontSize:11.5,color:C.accent,marginTop:5,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                      <span><i className="ti ti-calendar-event" aria-hidden="true" style={{marginRight:4}}/>This entry will be dated {form.date} instead of today.</span>
                      <button type="button" onClick={()=>setForm(f=>({...f,date:""}))} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:11.5,textDecoration:"underline",padding:0}}>Reset to today</button>
                    </div>
                  )}
                </div>
              </div>
              {formError&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{formError}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6,...(isMobile?{position:"sticky",bottom:0,background:C.bg,paddingTop:12,paddingBottom:"calc(6px + env(safe-area-inset-bottom))",borderTop:`1px solid ${C.border}`,margin:"6px -20px 0",paddingLeft:20,paddingRight:20}:null)}}>
                <button onClick={closeEntryModal} style={{cursor:"pointer",padding:"11px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,flex:isMobile?1:"none",minHeight:isMobile?46:"auto"}}>Cancel</button>
                <button onClick={handleAddTx} style={{padding:"11px 22px",cursor:"pointer",fontWeight:500,background:C.accent,color:"#fff",border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,flex:isMobile?1:"none",minHeight:isMobile?46:"auto"}}><i className="ti ti-check" aria-hidden="true"/> Add entry</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isMobile && (
      <aside style={{width:sidebarMode==="expanded"?240:64,minWidth:sidebarMode==="expanded"?240:64,position:"relative",flexShrink:0,overflow:(sidebarHoverExpanding||showSidebarMenu)?"visible":"hidden",zIndex:(sidebarHoverExpanding||showSidebarMenu)?40:"auto",transition:"width 0.3s ease, min-width 0.3s ease"}}
        onMouseEnter={()=>setSidebarHovered(true)} onMouseLeave={()=>{setSidebarHovered(false); setShowSidebarMenu(false);}}>
        <div style={{position:sidebarHoverExpanding?"absolute":"relative",top:0,left:0,width:sidebarExpanded?240:64,height:"100%",display:"flex",flexDirection:"column",background:C.surface,borderRight:`1px solid ${C.border}`,boxShadow:sidebarHoverExpanding?(dark?"0 14px 44px rgba(0,0,0,0.6)":"0 14px 44px rgba(0,0,0,0.18)"):"none",transition:"width 0.25s ease"}}>
          {/* Title section — logo / name + the Sidebar-control button */}
          <div style={{borderBottom:`1px solid ${C.border}`,padding:"10px 8px"}}>
            <div style={{display:"flex",flexDirection:sidebarExpanded?"row":"column",alignItems:"center",justifyContent:sidebarExpanded?"space-between":"center",gap:8,padding:6,borderRadius:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                {SESSION.companyLogo ? (
                  <img src={SESSION.companyLogo} alt={SESSION.companyName} title={SESSION.companyName} style={{width:40,height:40,objectFit:"contain",borderRadius:8,flexShrink:0}}/>
                ) : (
                  <div style={{width:40,height:40,borderRadius:10,background:"linear-gradient(135deg,#3b82f6,#2563eb)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:17,flexShrink:0,boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}}>
                    {(SESSION.companyName||"?").trim().charAt(0).toUpperCase()}
                  </div>
                )}
                {sidebarExpanded&&(
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:13.5,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={SESSION.companyName}>{SESSION.companyName}</div>
                    <div style={{fontSize:11,color:C.muted}}>Financial System</div>
                  </div>
                )}
              </div>
              {(sidebarExpanded||sidebarMode==="collapsed")&&(
                <div style={{position:"relative",flexShrink:0}} ref={sidebarMenuRef}>
                  <button onClick={()=>setShowSidebarMenu(s=>!s)} title="Sidebar control" aria-label="Sidebar control"
                    style={{cursor:"pointer",background:showSidebarMenu?C.surface2:"transparent",border:"none",color:showSidebarMenu?C.text:C.muted,fontSize:18,padding:4,display:"flex",borderRadius:6}}
                    onMouseEnter={e=>{e.currentTarget.style.background=C.surface2;e.currentTarget.style.color=C.text;}}
                    onMouseLeave={e=>{if(!showSidebarMenu){e.currentTarget.style.background="transparent";e.currentTarget.style.color=C.muted;}}}>
                    <i className="ti ti-layout-sidebar" aria-hidden="true"/>
                  </button>
                  {showSidebarMenu&&(()=>{
                    const modes=[["expanded","Expanded","ti-layout-sidebar"],["collapsed","Collapsed","ti-layout-sidebar-left-collapse"],["hover","Expand on hover","ti-pointer"]];
                    const activeIdx=modes.findIndex(([v])=>(sbHover||sidebarMode)===v);
                    return (
                    <div style={{position:"absolute",...(sidebarExpanded?{top:"calc(100% + 8px)",right:0}:{top:0,left:"calc(100% + 10px)"}),minWidth:210,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,boxShadow:dark?"0 12px 32px rgba(0,0,0,0.5)":"0 12px 32px rgba(0,0,0,0.15)",zIndex:80,overflow:"hidden",padding:6,transformOrigin:"top",animation:"fluid-dd-in 0.18s ease"}}>
                      <div style={{fontSize:11,color:C.muted,fontWeight:600,letterSpacing:"0.03em",padding:"4px 10px 8px"}}>Sidebar control</div>
                      <div style={{position:"relative"}}>
                        {activeIdx>=0&&<div aria-hidden="true" style={{position:"absolute",left:0,right:0,top:0,height:38,borderRadius:8,background:C.surface2,transform:`translateY(${activeIdx*38}px)`,transition:"transform 0.25s cubic-bezier(0.25,0.1,0.25,1)",pointerEvents:"none"}}/>}
                        {modes.map(([val,label,icon])=>{
                          const sel = sidebarMode===val; const act=(sbHover||sidebarMode)===val;
                          return (
                            <button key={val} onClick={()=>{ setSidebarMode(val); setShowSidebarMenu(false); setSbHover(null); }}
                              onMouseEnter={()=>setSbHover(val)} onMouseLeave={()=>setSbHover(null)}
                              style={{position:"relative",zIndex:1,height:38,display:"flex",alignItems:"center",gap:10,width:"100%",padding:"0 10px",borderRadius:8,border:"none",cursor:"pointer",background:"transparent",color:act?C.text:C.muted,fontSize:13,fontWeight:sel?600:500,textAlign:"left",transition:"color 0.15s"}}>
                              <i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:16,flexShrink:0}}/>
                              {label}
                              {sel&&<i className="ti ti-check" aria-hidden="true" style={{marginLeft:"auto",fontSize:15,color:C.accent}}/>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Navigation */}
          <nav style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:"10px 8px",display:"flex",flexDirection:"column",gap:4}}>
            {nav.map(n=>{
              const active = page===n.id;
              return (
                <button key={n.id} onClick={()=>setPage(n.id)} title={n.label}
                  style={{position:"relative",display:"flex",alignItems:"center",height:44,width:"100%",borderRadius:8,border:"none",borderLeft:`2px solid ${active?C.accent:"transparent"}`,cursor:"pointer",background:active?C.accentBg:"transparent",color:active?C.accent:C.muted,fontWeight:active?600:500,transition:"background 0.15s, color 0.15s",padding:0}}
                  onMouseEnter={e=>{if(!active){e.currentTarget.style.background=C.surface2;e.currentTarget.style.color=C.text;}}}
                  onMouseLeave={e=>{if(!active){e.currentTarget.style.background="transparent";e.currentTarget.style.color=C.muted;}}}>
                  <span style={{width:sidebarExpanded?44:"100%",minWidth:sidebarExpanded?44:0,display:"grid",placeContent:"center"}}><i className={`ti ${n.icon}`} aria-hidden="true" style={{fontSize:18}}/></span>
                  {sidebarExpanded&&<span style={{fontSize:13.5}}>{n.label}</span>}
                </button>
              );
            })}
          </nav>

          {/* Logged-in operator */}
          <div style={{padding:"10px 8px",borderTop:`1px solid ${C.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:sidebarExpanded?"8px 10px":0,justifyContent:sidebarExpanded?"flex-start":"center",borderRadius:10,background:sidebarExpanded?C.surface2:"transparent"}}>
              <div style={{width:32,height:32,borderRadius:"50%",background:C.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>
                {(SESSION.operatorId||"?").replace(/[^A-Za-z0-9]/g,"").slice(-2).toUpperCase()}
              </div>
              {sidebarExpanded&&(
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12.5,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={SESSION.operatorName||SESSION.operatorId}>{SESSION.operatorName||SESSION.operatorId}</div>
                  <div style={{fontSize:10.5,color:C.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{SESSION.operatorId}{SESSION.role?` · ${String(SESSION.role).toUpperCase()}`:""}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
      )}

      <main style={{flex:1,padding:isMobile?"12px 12px calc(82px + env(safe-area-inset-bottom))":"16px 24px 24px",overflowY:"auto",minWidth:0,background:C.bg}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:500,color:C.text}}>{nav.find(n=>n.id===page)?.label}</h2>

          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",justifyContent:"flex-end"}}>
            <button onClick={()=>window.FINTRACK_SET_THEME&&window.FINTRACK_SET_THEME(dark?"light":"dark")} title={dark?"Switch to light mode":"Switch to dark mode"} aria-label="Toggle theme"
              style={{position:"relative",width:56,height:30,flexShrink:0,borderRadius:999,border:`2px solid ${dark?"#2d2a4e":"#e8d5b7"}`,background:dark?"#1a1838":"#fef3c7",cursor:"pointer",padding:0,transition:"background 0.3s, border-color 0.3s"}}>
              <span style={{position:"absolute",top:"50%",transform:"translateY(-50%)",left:dark?"calc(100% - 24px)":2,width:22,height:22,borderRadius:"50%",display:"grid",placeItems:"center",background:dark?"#e8e6f0":"#ff9500",color:dark?"#1a1838":"#ffffff",boxShadow:"0 1px 3px rgba(0,0,0,0.3)",transition:"left 0.3s, background 0.3s"}}>
                <i className={`ti ti-${dark?"moon":"sun"}`} aria-hidden="true" style={{fontSize:13,display:"block",lineHeight:1}}/>
              </span>
            </button>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:C.muted,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:"5px 10px"}} title={`This company's time zone: ${tz}. Entries are stamped with this clock.`}>
              <i className="ti ti-clock-hour-4" aria-hidden="true" style={{fontSize:15,color:C.accent}}/>
              <span style={{fontWeight:600,color:C.text}}>{clockNow}</span>
              <span style={{whiteSpace:"nowrap"}}>{tzCity(tz)} time</span>
            </div>
            {!isMobile && (
            <div style={{display:"flex",alignItems:"center",gap:7,fontSize:13,color:C.text}}>
              {SESSION.companyLogo ? (
                <img src={SESSION.companyLogo} alt={SESSION.companyName} title={SESSION.companyName} style={{height:26,maxWidth:170,objectFit:"contain",display:"block"}}/>
              ) : (
                <>
                  <i className="ti ti-building" aria-hidden="true" style={{fontSize:16,color:C.accent}}/>
                  <span style={{fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:200}} title={SESSION.companyName}>{SESSION.companyName}</span>
                </>
              )}
            </div>
            )}
            <div style={{position:"relative"}} ref={opMenuRef}>
              <button onClick={()=>setShowOperatorMenu(o=>!o)} style={{cursor:"pointer",display:"flex",alignItems:"center",gap:8,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px 6px 6px",color:C.text}}>
                <div style={{width:26,height:26,borderRadius:"50%",background:C.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:600,flexShrink:0}}>
                  {(SESSION.operatorId||"?").replace(/[^A-Za-z0-9]/g,"").slice(-2).toUpperCase()}
                </div>
                <span style={{fontSize:13,fontWeight:500}}>{SESSION.operatorId}</span>
                <i className={`ti ti-chevron-${showOperatorMenu?"up":"down"}`} aria-hidden="true" style={{fontSize:14,color:C.muted}}/>
              </button>
              {showOperatorMenu&&(
                <div style={{position:"absolute",top:"100%",right:0,marginTop:6,background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 8px 28px rgba(0,0,0,0.25)",zIndex:60,minWidth:200,overflow:"hidden"}}>
                  <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
                    <div style={{fontSize:13,fontWeight:500,color:C.text}}>{SESSION.operatorName||"Operator"}</div>
                    <div style={{fontSize:11,color:C.muted}}>ID: {SESSION.operatorId}</div>
                    <div style={{fontSize:11,color:C.muted}}>{SESSION.companyName}</div>
                  </div>
                  <button onClick={()=>{ setShowOperatorMenu(false); setPwForm({current:"",next:"",confirm:""}); setPwError(""); setPwSuccess(""); setShowPasswordModal(true); }} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 14px",background:"transparent",border:"none",cursor:"pointer",fontSize:13,color:C.text,textAlign:"left"}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.surface2} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <i className="ti ti-key" aria-hidden="true" style={{fontSize:16,color:C.accent}}/> Change password
                  </button>
                  <button onClick={handleLogout} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 14px",background:"transparent",border:"none",borderTop:`1px solid ${C.border}`,cursor:"pointer",fontSize:13,color:"#dc2626",textAlign:"left",fontWeight:500}}
                    onMouseEnter={e=>e.currentTarget.style.background=dark?"#3a1515":"#dc262610"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <i className="ti ti-logout" aria-hidden="true" style={{fontSize:16}}/> Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {page==="dashboard"&&(
          <div>
            {statOverview}

            <div style={{display:"grid",gridTemplateColumns:isWideView?"2fr 1fr":"1fr",gap:20,alignItems:"start"}}>
              {/* Recent transactions — newest 10, "Show all" jumps to Transactions */}
              <div style={cardStyle}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                  <h3 style={{fontSize:16,fontWeight:600,margin:0,color:C.text,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-list" aria-hidden="true" style={{color:C.accent}}/> Recent transactions</h3>
                  <button onClick={()=>setPage("transactions")} style={{cursor:"pointer",fontSize:13,fontWeight:500,color:C.accent,background:"transparent",border:"none",display:"inline-flex",alignItems:"center",gap:4}}>Show all <i className="ti ti-arrow-right" aria-hidden="true"/></button>
                </div>
                <TxTable data={transactions.slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).slice(0,10)} showDelete={false} onDelete={handleDeleteTx} banks={banks}/>
              </div>

              {/* Right column — bank totals + current active banks */}
              <div style={{display:"flex",flexDirection:"column",gap:20}}>
                <div style={cardStyle}>
                  <h3 style={{fontSize:16,fontWeight:600,margin:"0 0 14px",color:C.text,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-wallet" aria-hidden="true" style={{color:C.accent}}/> Bank balances</h3>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {[
                      {label:"All banks total",arr:banksLive,color:C.accent,icon:"ti-building-bank"},
                      {label:"Active banks total",arr:banksLive.filter(b=>b.active!==false),color:"#16a34a",icon:"ti-circle-check"},
                      {label:"Inactive banks total",arr:banksLive.filter(b=>b.active===false),color:"#64748b",icon:"ti-circle-off"},
                    ].map(row=>(
                      <GlowCard key={row.label} color={row.color} style={{background:C.bg,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`,borderLeft:`3px solid ${row.color}`}}>
                        <div style={{fontSize:12,color:C.muted,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><i className={`ti ${row.icon}`} aria-hidden="true" style={{color:row.color}}/>{row.label}</div>
                        <div style={{fontSize:19,fontWeight:600,color:C.text}}>{fmt(row.arr.reduce((s,b)=>s+(b.balance||0),0))}</div>
                        <div style={{fontSize:11.5,color:C.muted,marginTop:2}}>{row.arr.length} {row.arr.length===1?"bank":"banks"} · Yesterday: {fmt(row.arr.reduce((s,b)=>s+(b.yBalance||0),0))}</div>
                      </GlowCard>
                    ))}
                  </div>
                </div>

                {activeBankCard}
              </div>
            </div>
          </div>
        )}

        {page==="transactions"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:isWideView?"1fr 1.8fr":"1fr",gap:20,alignItems:"start",marginBottom:20}}>
              <div>{activeBankCard}</div>
              <div>{statOverviewCompact}</div>
            </div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-plus">Record a transaction</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Choose an entry type to open the entry form.</div>
              {banks.length===0&&<div style={{fontSize:13,color:"#d97706",marginBottom:14,padding:"10px 14px",background:dark?"#3a2a10":"#fdf3e0",borderRadius:8,border:`1px solid #d9770655`}}><i className="ti ti-alert-triangle" aria-hidden="true"/> Add a bank account on the Bank Accounts page before recording transactions.</div>}
              <div style={{marginBottom:14,padding:"8px 12px",background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8}}>
                <button type="button" onClick={()=>{ const v=!showShortcuts; setShowShortcuts(v); try{ localStorage.setItem("ft_show_shortcuts",v?"1":"0"); }catch{} }} aria-expanded={showShortcuts}
                  style={{display:"flex",alignItems:"center",gap:6,width:"100%",background:"transparent",border:"none",cursor:"pointer",color:C.text,fontSize:12,fontWeight:600,padding:0,textAlign:"left",fontFamily:"inherit"}}>
                  <i className="ti ti-keyboard" aria-hidden="true" style={{fontSize:15,color:C.accent}}/>
                  Keyboard shortcuts
                  <i className={`ti ti-chevron-${showShortcuts?"up":"down"}`} aria-hidden="true" style={{fontSize:14,color:C.muted,marginLeft:4}}/>
                  {!showShortcuts&&<span style={{fontSize:11,color:C.muted,fontWeight:400,marginLeft:"auto"}}>Alt + first letter · tap to show</span>}
                </button>
                {showShortcuts&&(
                  <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:8,marginTop:10}}>
                    {ENTRY_TYPES.map(t=>{
                      const c = TYPE_COLORS[t]||C.accent;
                      return <span key={t} style={{fontSize:11.5,color:C.muted,display:"inline-flex",alignItems:"center",gap:5}}>
                        <kbd style={{fontFamily:"inherit",fontSize:11,fontWeight:700,color:(isPaleColor(c)&&!dark)?STORE_INK:c,background:(isPaleColor(c)&&!dark)?c:(dark?c+"22":c+"14"),border:`1px solid ${(isPaleColor(c)&&!dark)?STORE_INK+"55":c+"66"}`,borderRadius:5,padding:"2px 6px"}}>Alt+{SHORTCUT_LETTER[t]}</kbd>{t.replace("Regular ","")}
                      </span>;
                    })}
                    <span style={{fontSize:11.5,color:C.muted,marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:6}}>In the form — <strong style={{color:C.text,fontWeight:600}}>Enter</strong> saves · <strong style={{color:C.text,fontWeight:600}}>Tab</strong> moves · <strong style={{color:C.text,fontWeight:600}}>↑↓</strong> in dropdowns · <strong style={{color:C.text,fontWeight:600}}>Esc</strong> closes</span>
                  </div>
                )}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
                {ENTRY_TYPES.slice(0,5).map(t=>{
                  const c = TYPE_COLORS[t]||C.accent;
                  return <button key={t} type="button" onClick={()=>openEntryType(t)}
                    style={{cursor:"pointer",padding:"16px 14px",fontSize:14,fontWeight:500,borderRadius:10,border:`1.5px solid ${c}`,background:dark?c+"22":c+"12",color:c,display:"flex",flexDirection:"column",alignItems:"center",gap:8,transition:"transform 0.1s"}}
                    onMouseEnter={e=>{e.currentTarget.style.background=c;e.currentTarget.style.color="#fff";}}
                    onMouseLeave={e=>{e.currentTarget.style.background=dark?c+"22":c+"12";e.currentTarget.style.color=c;}}>
                    <i className="ti ti-plus" aria-hidden="true" style={{fontSize:18}}/>{t}
                  </button>;
                })}
                {/* "More" drawer — the less-common types (Mistake, Rental, Adjust, Other) */}
                <div style={{position:"relative"}} ref={moreTypesRef}>
                  <button type="button" onClick={()=>setShowMoreTypes(s=>!s)} aria-haspopup="menu" aria-expanded={showMoreTypes}
                    style={{width:"100%",height:"100%",boxSizing:"border-box",cursor:"pointer",padding:"16px 14px",fontSize:14,fontWeight:500,borderRadius:10,border:`1.5px dashed ${showMoreTypes?C.accent:C.borderStrong}`,background:showMoreTypes?C.surface2:"transparent",color:showMoreTypes?C.text:C.muted,display:"flex",flexDirection:"column",alignItems:"center",gap:8,transition:"all 0.12s"}}
                    onMouseEnter={e=>{e.currentTarget.style.background=C.surface2;e.currentTarget.style.color=C.text;}}
                    onMouseLeave={e=>{if(!showMoreTypes){e.currentTarget.style.background="transparent";e.currentTarget.style.color=C.muted;}}}>
                    <i className="ti ti-dots" aria-hidden="true" style={{fontSize:18}}/>More
                  </button>
                  {showMoreTypes&&(
                    <div role="menu" style={{position:"absolute",top:"calc(100% + 6px)",left:0,minWidth:200,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,boxShadow:dark?"0 12px 32px rgba(0,0,0,0.5)":"0 12px 32px rgba(0,0,0,0.15)",zIndex:60,overflow:"hidden",padding:6,transformOrigin:"top",animation:"fluid-dd-in 0.18s ease"}}>
                      {ENTRY_TYPES.slice(5).map(t=>{
                        const c = TYPE_COLORS[t]||C.accent;
                        return (
                          <button key={t} type="button" role="menuitem" onClick={()=>openEntryType(t)}
                            style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 12px",borderRadius:8,border:"none",cursor:"pointer",background:"transparent",color:C.text,fontSize:13.5,fontWeight:500,textAlign:"left",transition:"background 0.12s"}}
                            onMouseEnter={e=>e.currentTarget.style.background=C.surface2}
                            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <span style={{width:9,height:9,borderRadius:"50%",background:c,flexShrink:0}}/>
                            <i className="ti ti-plus" aria-hidden="true" style={{fontSize:14,color:c,flexShrink:0}}/>
                            <span>{t}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-list">Today's transactions</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Deleted entries remain visible with a red background for audit purposes. All history is saved — use Search to view past months.</div>
              <TxLog data={todayTx} showDelete={true} onDelete={handleDeleteTx} banks={banks}/>
            </div>
          </div>
        )}

        {page==="banks"&&(
          <div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-building-bank" right={
                <button onClick={()=>{ setNewBank({name:"",holder:"",bsb:"",account:"",payid:"",balance:""}); setBankError(""); setShowBankModal(true); }} style={{cursor:"pointer",padding:"9px 20px",fontWeight:500,background:C.accent,color:"#fff",border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6,fontSize:14}}>
                  <i className="ti ti-plus" aria-hidden="true"/> Add bank
                </button>
              }>Bank accounts</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Click a card to view its full transaction history.</div>
              {banks.length>0&&<div style={{marginBottom:16}}><BankTotals banksLive={banksLive}/></div>}
              {banks.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No bank accounts yet. Click "Add bank" to create one.</div>}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(max(220px, calc((100% - 48px) / 5)), 1fr))",gap:12}}>
                {banksLive.map(b=>(
                  <GlowCard key={b.id} color={C.accent} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 16px",cursor:editingBank===b.id?"default":"pointer"}}
                    onMouseEnter={e=>{if(editingBank!==b.id)e.currentTarget.style.borderColor=C.accent;}}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}
                    onClick={()=>{if(editingBank!==b.id) openBankDetail(b);}}>
                    {editingBank===b.id?(
                      <div onClick={e=>e.stopPropagation()}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                          {[["name","Bank name"],["holder","Holder's name"],["bsb","BSB number"],["account","Account number"],["payid","PayID"],["balance","Opening balance"]].map(([k,lbl])=>(
                            <div key={k}><label style={{fontSize:11,color:C.muted,display:"block",marginBottom:2}}>{lbl}</label>
                              <input type={k==="balance"?"number":"text"} value={editBankForm[k]} onChange={e=>setEditBankForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",boxSizing:"border-box",fontSize:12,padding:"4px 8px"}}/></div>
                          ))}
                        </div>
                        {editBankError&&<div style={{fontSize:11,color:"#dc2626",marginBottom:6}}>{editBankError}</div>}
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={()=>handleSaveBank(b.id)} style={{cursor:"pointer",fontSize:12,padding:"5px 14px",background:"#16a34a",color:"#fff",border:"none",borderRadius:6,fontWeight:500}}><i className="ti ti-check" aria-hidden="true"/> Save</button>
                          <button onClick={()=>setEditingBank(null)} style={{cursor:"pointer",fontSize:12,padding:"5px 14px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:6}}>Cancel</button>
                        </div>
                      </div>
                    ):(
                      <>
                        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0,marginBottom:8}}>
                          <i className="ti ti-building-bank" aria-hidden="true" style={{fontSize:20,color:C.accent,flexShrink:0}}/>
                          <span title={b.holder||b.name} style={{fontWeight:500,fontSize:14,color:C.text,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.holder||b.name}</span>
                        </div>
                        <div style={{fontSize:12,color:C.muted,marginBottom:2}}>Bank: {b.name}</div>
                        <div style={{fontSize:12,color:C.muted,marginBottom:2}}>BSB: {b.bsb||"—"}</div>
                        <div style={{fontSize:12,color:C.muted,marginBottom:2}}>Account: {b.account}</div>
                        <div style={{fontSize:12,color:C.muted,marginBottom:8}}>PayID: {b.payid||"—"}</div>
                        <div style={{fontSize:20,fontWeight:500,color:C.text}}>{fmt(b.balance)}</div>
                        <div style={{fontSize:11,color:C.muted,marginTop:2}}>Yesterday: {fmt(b.yBalance)}</div>
                        {bankTodayCounts(b)}
                        <div style={{fontSize:11,color:C.muted,marginTop:6}}>Click card to view history</div>
                        <div onClick={e=>e.stopPropagation()} style={{display:"flex",flexDirection:"column",gap:8,marginTop:10}}>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={()=>startEditBank(b)} style={{...editBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-edit" aria-hidden="true"/> Edit</button>
                            <button onClick={()=>handleDeleteBank(b.id,b.name)} style={{...deleteBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-trash" aria-hidden="true"/> Del</button>
                          </div>
                          <button onClick={()=>handleToggleBankActive(b.id)}
                            style={{...(b.active===false?bankInactiveBtnStyle:bankActiveBtnStyle),justifyContent:"center"}}
                            title={b.active===false?"Inactive — click to show this bank in the dashboard & entry dropdowns":"Active — click to hide this bank from the dashboard & entry dropdowns"}>
                            <i className={`ti ti-${b.active===false?"circle-off":"circle-check"}`} aria-hidden="true"/> {b.active===false?"Inactive":"Active"}
                          </button>
                        </div>
                      </>
                    )}
                  </GlowCard>
                ))}
              </div>
            </div>
          </div>
        )}

        {page==="members"&&(
          <div style={sectionStyle}>
            <SectionTitle icon="ti-users" right={
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <button onClick={()=>{ setNewMember({name:"",phone:"",id:""}); setNewMemberError(""); setShowMemberModal(true); }} style={{cursor:"pointer",fontSize:13,fontWeight:500,padding:"7px 16px",border:"none",borderRadius:8,background:C.accent,color:"#fff",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-user-plus" aria-hidden="true"/> Add member</button>
                <button onClick={()=>exportMembersCSV()} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid ${C.border}`,borderRadius:6,background:C.surface2,color:C.text,display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-text" aria-hidden="true"/> CSV</button>
                <button onClick={()=>exportMembersExcel()} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid #16a34a`,borderRadius:6,background:dark?"#163524":"#16a34a14",color:"#16a34a",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-spreadsheet" aria-hidden="true"/> Excel</button>
                <button onClick={()=>exportMembersPDF()} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid #dc2626`,borderRadius:6,background:dark?"#3a1515":"#dc262614",color:"#dc2626",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-type-pdf" aria-hidden="true"/> PDF</button>
              </div>
            }>Members directory</SectionTitle>
            <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Click a row to view a member's full transaction history.</div>
            <div style={{position:"relative",maxWidth:380,marginBottom:12}}>
              <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
              <input type="text" value={memberSearch} onChange={e=>setMemberSearch(e.target.value)} placeholder="Search by name, ID or phone…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
              {memberSearch&&<button type="button" onClick={()=>setMemberSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.muted}}>
                <span>Show</span>
                <FluidDropdown width={100} value={memberPageSize} ariaLabel="Rows per page"
                  options={PAGE_SIZES.map(n=>({value:n,label:String(n)}))}
                  onChange={v=>setMemberPageSize(Number(v))}/>
                <span>per page</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12.5,color:C.muted}}>
                <span>{memberTotal===0?0:memberStart+1}–{Math.min(memberStart+memberPageSize,memberTotal)} of {memberTotal}</span>
                <button onClick={()=>setMemberPage(Math.max(1,memberCurPage-1))} disabled={memberCurPage<=1} style={pagerBtn(memberCurPage<=1)} aria-label="Previous page"><i className="ti ti-chevron-left" aria-hidden="true"/></button>
                <span>{memberCurPage}/{memberPages}</span>
                <button onClick={()=>setMemberPage(Math.min(memberPages,memberCurPage+1))} disabled={memberCurPage>=memberPages} style={pagerBtn(memberCurPage>=memberPages)} aria-label="Next page"><i className="ti ti-chevron-right" aria-hidden="true"/></button>
              </div>
            </div>
            <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:10}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:C.header}}>
                    {["Member ID","Name","Phone","Joined","Transactions","Last activity","Status","Actions"].map((h,i)=>(
                      <th key={i} style={{textAlign:"left",padding:"10px",color:C.muted,fontWeight:500,borderBottom:`1px solid ${C.border}`}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {memberSlice.map((m,idx)=>{
                    const mTx = transactions.filter(t=>(t.memberId===m.id||t.memberName===m.name)&&!t.deleted);
                    if(editingMember===m.id) return (
                      <tr key={m.id} style={{borderBottom:`1px solid ${C.border}`,background:C.surface2}}>
                        <td style={{padding:"9px 10px"}}><input value={editMemberForm.id} onChange={e=>setEditMemberForm(f=>({...f,id:e.target.value}))} style={{width:80,fontSize:12,padding:"3px 6px",boxSizing:"border-box"}}/></td>
                        <td style={{padding:"9px 10px"}}><input value={editMemberForm.name} onChange={e=>setEditMemberForm(f=>({...f,name:e.target.value}))} style={{width:120,fontSize:12,padding:"3px 6px",boxSizing:"border-box"}}/></td>
                        <td style={{padding:"9px 10px"}}><input value={editMemberForm.phone} onChange={e=>setEditMemberForm(f=>({...f,phone:e.target.value}))} placeholder="Phone" style={{width:120,fontSize:12,padding:"3px 6px",boxSizing:"border-box"}}/></td>
                        <td colSpan={4} style={{padding:"9px 10px"}}>
                          {editMemberError&&<span style={{fontSize:11,color:"#dc2626",marginRight:8}}>{editMemberError}</span>}
                          <button onClick={()=>handleSaveMember(m.id)} style={{cursor:"pointer",fontSize:12,padding:"5px 14px",background:"#16a34a",color:"#fff",border:"none",borderRadius:6,marginRight:6,fontWeight:500}}><i className="ti ti-check" aria-hidden="true"/> Save</button>
                          <button onClick={()=>setEditingMember(null)} style={{cursor:"pointer",fontSize:12,padding:"5px 14px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:6}}>Cancel</button>
                        </td>
                        <td/>
                      </tr>
                    );
                    return (
                      <tr key={m.id} onClick={()=>openMemberDetail(m)} style={{borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:idx%2?C.surface:"transparent"}}
                        onMouseEnter={e=>e.currentTarget.style.background=C.surface2}
                        onMouseLeave={e=>e.currentTarget.style.background=idx%2?C.surface:"transparent"}>
                        <td style={{padding:"9px 10px",fontWeight:500,color:C.accent}}>{m.id}</td>
                        <td style={{padding:"9px 10px",fontWeight:500,color:C.text}}>{m.name}</td>
                        <td style={{padding:"9px 10px",color:C.muted}}>{m.phone||"—"}</td>
                        <td style={{padding:"9px 10px",color:C.muted}}>{m.joined}</td>
                        <td style={{padding:"9px 10px",color:C.text}}>{mTx.length}</td>
                        <td style={{padding:"9px 10px",color:C.muted}}>{m.lastActivity}</td>
                        <td style={{padding:"9px 10px"}}>
                          {m.joined===today
                            ?<span style={{background:"#16a34a26",color:"#16a34a",fontSize:11,padding:"2px 8px",borderRadius:4,border:"1px solid #16a34a55"}}>New today</span>
                            :<span style={{background:C.surface2,color:C.muted,fontSize:11,padding:"2px 8px",borderRadius:4}}>Active</span>}
                        </td>
                        <td style={{padding:"9px 10px"}} onClick={e=>e.stopPropagation()}>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={()=>startEditMember(m)} style={editBtnStyle}><i className="ti ti-edit" aria-hidden="true"/> Edit</button>
                            <button onClick={()=>handleDeleteMember(m.id,m.name)} style={deleteBtnStyle}><i className="ti ti-trash" aria-hidden="true"/> Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {memberSlice.length===0&&(
                    <tr><td colSpan={8} style={{padding:"18px",textAlign:"center",color:C.muted,fontSize:13}}>{memberSearch?`No members match “${memberSearch}”.`:"No members yet — add one above."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {page==="search"&&(
          <div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-filter">Filter all history</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Search across all saved transactions — any date, member, bank, or type.</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
                <div><label style={labelStyle}>Keyword</label><input type="text" placeholder="Name, ID, bank..." value={search.term} onChange={e=>setSearch(s=>({...s,term:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div><label style={labelStyle}>Member</label><FluidDropdown value={search.member} placeholder="All members" ariaLabel="Filter by member" options={[{value:"",label:"All members"},...members.map(m=>({value:String(m.id),label:`${m.name} (${m.id})`}))]} onChange={v=>setSearch(s=>({...s,member:v}))}/></div>
                <div><label style={labelStyle}>Bank</label><FluidDropdown value={search.bank} placeholder="All banks" ariaLabel="Filter by bank" options={[{value:"",label:"All banks"},...banks.map(b=>({value:String(b.id),label:b.holder?`${b.holder} — ${b.name}`:b.name}))]} onChange={v=>setSearch(s=>({...s,bank:v}))}/></div>
                <div><label style={labelStyle}>From date</label><input type="date" value={search.dateFrom} onChange={e=>setSearch(s=>({...s,dateFrom:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div><label style={labelStyle}>To date</label><input type="date" value={search.dateTo} onChange={e=>setSearch(s=>({...s,dateTo:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div><label style={labelStyle}>Entry type</label><FluidDropdown value={search.type} placeholder="All types" ariaLabel="Filter by type" options={[{value:"",label:"All types"},...ENTRY_TYPES.map(t=>({value:t,label:t,color:TYPE_COLORS[t]}))]} onChange={v=>setSearch(s=>({...s,type:v}))}/></div>
              </div>
              <div style={{marginTop:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontSize:12,color:C.muted}}>{filteredTx.length} result{filteredTx.length!==1?"s":""} found</div>
                <button onClick={()=>setSearch({term:"",dateFrom:"",dateTo:"",type:"",bank:"",member:""})} style={{fontSize:12,cursor:"pointer",padding:"6px 14px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:6}}><i className="ti ti-refresh" aria-hidden="true"/> Clear filters</button>
              </div>
            </div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-list" right={
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button onClick={()=>exportCSV(filteredTx,"fintrack_search")} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid ${C.border}`,borderRadius:6,background:C.surface2,color:C.text,display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-text" aria-hidden="true"/> CSV</button>
                  <button onClick={()=>exportExcel(filteredTx,"fintrack_search")} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid #16a34a`,borderRadius:6,background:dark?"#163524":"#16a34a14",color:"#16a34a",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-spreadsheet" aria-hidden="true"/> Excel</button>
                  <button onClick={()=>exportPDF(filteredTx,"FinTrack — Search results")} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid #dc2626`,borderRadius:6,background:dark?"#3a1515":"#dc262614",color:"#dc2626",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-type-pdf" aria-hidden="true"/> PDF</button>
                </div>
              }>Results</SectionTitle>
              {(search.bank||search.member)&&(
                <div style={{marginBottom:12,padding:"10px 14px",background:C.accentBg,borderRadius:8,fontSize:13,border:`1px solid ${C.accent}55`,color:C.text}}>
                  Showing all history for:
                  {search.member&&<strong style={{marginLeft:6}}>{members.find(m=>m.id===search.member)?.name}</strong>}
                  {search.member&&search.bank&&<span style={{margin:"0 6px",color:C.muted}}>+</span>}
                  {search.bank&&<strong style={{marginLeft:search.member?0:6}}>{search.bank}</strong>}
                </div>
              )}
              <TxLog data={filteredTx} showDelete={true} onDelete={handleDeleteTx} banks={banks}/>
            </div>
          </div>
        )}
      </main>

      {/* Mobile bottom tab bar — replaces the hover sidebar (no hover on touch).
          position:fixed so it sits at the very bottom of the phone screen. */}
      {isMobile && (
        <nav className="safe-bottom" aria-label="Main navigation" style={{position:"fixed",bottom:0,left:0,right:0,zIndex:50,display:"flex",background:C.surface,borderTop:`1px solid ${C.border}`,boxShadow:dark?"0 -4px 18px rgba(0,0,0,0.45)":"0 -4px 18px rgba(0,0,0,0.08)"}}>
          {nav.map(n=>{
            const active = page===n.id;
            return (
              <button key={n.id} onClick={()=>setPage(n.id)} aria-label={n.label} aria-current={active?"page":undefined}
                style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,padding:"7px 2px",minHeight:56,border:"none",borderTop:`2px solid ${active?C.accent:"transparent"}`,background:active?C.accentBg:"transparent",cursor:"pointer",color:active?C.accent:C.muted,fontWeight:active?600:500,transition:"color 0.15s, background 0.15s"}}>
                <i className={`ti ${n.icon}`} aria-hidden="true" style={{fontSize:21}}/>
                <span style={{fontSize:10.5,lineHeight:1,whiteSpace:"nowrap"}}>{MOBILE_TAB_LABEL[n.id]||n.label}</span>
              </button>
            );
          })}
        </nav>
      )}
      </div>
    </div>
  );
}
