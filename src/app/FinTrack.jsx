import { useState, useMemo, useRef, useEffect } from "react";
import FluidDropdown from "../components/FluidDropdown.jsx";
import UpdateBell from "../components/UpdateBell.jsx";
import useIsMobile from "../lib/useIsMobile.js";
import { mergeData, dedupeByKey, txKey, idKey } from "../lib/mergeData.js";
import { NATIONALITIES, nationalityCode } from "../lib/nationalities.js";
import { digitsOnly, countryFromPhone, normalizePhone, normalizeName, extractNumbers } from "../lib/phone.js";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

// Short labels for the mobile bottom tab bar (the desktop sidebar uses the full
// nav labels, but "Bank Accounts" / "Transactions" are too wide for a phone tab).
const MOBILE_TAB_LABEL = { dashboard:"Home", transactions:"Record", banks:"Banks", bankdetails:"Details", members:"Members", search:"Search", offdays:"Shifts" };
// The bottom tab bar has room for 6 slots. These 5 always stay as their own tab;
// everything else (Off Days, and Bank Details for master/manager) collapses into
// a 6th "More" tab instead of cramming a 7th+ item into the bar.
const MOBILE_PRIMARY_IDS = ["dashboard","transactions","banks","members","search"];

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

// The company's real accounts (master/manager/staff), used to build the shift
// roster cards and the off-day counts — read fresh per mount, same reason as
// readSession() above. Empty until the portal wires it up (e.g. local demo).
const TEAM_DEFAULT = [];
const readTeam = () => (typeof window!=="undefined" && window.FINTRACK_TEAM) || TEAM_DEFAULT;


const ENTRY_TYPES = ["Regular Deposit","Regular Withdrawal","Unclaimed Credit","Transfer","Store","Mistake","Rental","Adjust","Other","Bank Block","Buy/Sell AUD"];
const SIGNED_TYPES = ["Unclaimed Credit","Mistake","Rental","Store","Adjust","Other","Buy/Sell AUD"];
// Buy/Sell AUD entry: amount × rate is auto-written to the note (e.g. 5x3=15). The
// tracked value is the top amount; the rate/product are note-only. Returns "" unless
// both are present so it never clears a manual note.
const buyNote = (amt, rate) => {
  const a = Number(amt), r = Number(rate);
  return (amt!=="" && rate!=="" && amt!=null && rate!=null && !isNaN(a) && !isNaN(r)) ? `${amt}x${rate}=${Math.round(a*r*100)/100}` : "";
};
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
  "Transfer Out":"#dc2626","Transfer In":"#16a34a","Other":"#64748b","Bank Block":"#5b7a99","Buy/Sell AUD":"#db2777"
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
// Dates are STORED as ISO `YYYY-MM-DD` so they keep sorting/filtering/month-grouping
// correctly. fmtDate is DISPLAY-only: it turns that into DD-MMM-YY with a short month
// name, e.g. 2026-06-26 -> "26-Jun-26". Empty / non-ISO values pass straight through.
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = iso => {
  if(!iso || typeof iso!=="string") return iso||"";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${MONTHS_SHORT[Number(m[2])-1]}-${m[1].slice(2)}` : iso;
};
const monthLabel = ym => {
  const [y,m] = ym.split("-");
  return new Date(Number(y),Number(m)-1,1).toLocaleString("en-US",{month:"short",year:"numeric"});
};
const dateNDaysAgo = n => { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split("T")[0]; };
const yesterday = dateNDaysAgo(1);
const weekAgo = dateNDaysAgo(6);
// --- Time-zone aware "now" helpers. Each company stamps its transaction
// date/time in its own zone (SESSION.timezone), not the browser's. ---
const dateInTz = tz => { try { return new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); } catch(e){ return new Date().toISOString().split("T")[0]; } };
// Includes seconds (HH:MM:SS) — drives both the live top-bar clock and the timestamp
// stamped onto every saved log record.
const timeInTz = tz => { try { return new Intl.DateTimeFormat("en-GB",{timeZone:tz,hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(new Date()); } catch(e){ return new Date().toTimeString().slice(0,8); } };
// Order-independent signature of a data blob. The server stores `data` as JSONB and returns
// its keys in Postgres's own canonical order, which never matches the browser's JSON.stringify
// order. Comparing raw strings therefore ALWAYS looked "changed", so the save effect re-sent
// the same data forever (a save -> merge -> apply -> save loop that hammered the database).
// Sorting keys before stringifying makes "did anything actually change?" reliable.
const sortedStringify = (v) => {
  if (Array.isArray(v)) return '[' + v.map(sortedStringify).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + sortedStringify(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
};
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
// Gate for every user-entered "link" field (Bank Details' OTP link, Bank Accounts'
// OTP link, Company Credentials' Link field) before it's ever rendered as a clickable
// <a href>. Without this, a stored `javascript:` URI would execute in the clicking
// user's session the moment a co-master/co-manager opened it from a card or record
// panel — same-tenant privilege escalation via social engineering, since rel=
// "noopener noreferrer" blocks window.opener access but does NOT block javascript:
// execution. Only http(s) URLs render as a real link; every call site falls back to
// plain (still visible/copyable) text for anything else.
const isSafeHttpUrl = v => /^https?:\/\//i.test(String(v||"").trim());
const TX_COLS = ["date","time","type","amount","memberId","memberName","memberPhone","bank","operator","receipt","notes","deleted"];
// Transactions don't carry a phone number themselves (only the member record does) —
// look it up by memberId, falling back to a name match, same pairing rule used
// everywhere else in this file (e.g. the entry form's own member lookup).
const phoneForTx = (t, members) => {
  const m = (members||[]).find(x => (t.memberId && x.id===t.memberId) || (t.memberName && x.name && x.name.toLowerCase()===t.memberName.toLowerCase()));
  return m ? (m.phone||"") : "";
};

// A short, globally-unique id stamped on every transaction leg the moment it's
// created. Because the whole company shares ONE data record, two devices used at the
// same time must never produce colliding ids — this (time + randomness) guarantees
// that, so merges below can safely tell every entry apart.
const mkUid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;

// mergeData (union two data blobs) now lives in ../lib/mergeData.js so the storage
// bridge can reuse it for its fallback merge. Imported at the top of this file.
// ---- balance helpers (single definition) ----
function ftTxDelta(t){
  if(["Unclaimed Credit","Mistake","Rental","Store","Adjust","Other","Bank Block","Buy/Sell AUD"].includes(t.type)) return t.amount;
  if(t.type==="Regular Deposit") return t.amount;
  if(t.type==="Transfer In") return t.amount;
  if(t.type==="Regular Withdrawal") return -t.amount;
  if(t.type==="Transfer Out") return -t.amount;
  return 0;
}
// Split a set of transaction legs into money-in (credit) and money-out (debit) by
// each leg's balance effect (ftTxDelta). Skips deleted legs and the fundLeg "mirror"
// (the bank side of a Store/Mistake/actual-paid entry) so the same money isn't
// counted twice. Returns the count + summed magnitude for each side and the net.
function ftCreditDebit(rows){
  let cN=0,cSum=0,dN=0,dSum=0;
  for(const t of (rows||[])){
    if(t.deleted || t.fundLeg) continue;
    const d = ftTxDelta(t);
    if(d>1e-9){ cN++; cSum+=d; }
    else if(d<-1e-9){ dN++; dSum+=-d; }
  }
  return {credits:{n:cN,sum:cSum}, debits:{n:dN,sum:dSum}, net:cSum-dSum};
}
// A transaction belongs to a bank by the bank's UNIQUE id (t.bankId). Two banks
// can share the same institution name (e.g. two "Ubank" accounts with different
// holders), so matching by name alone wrongly mixes their balances/history.
// Older records saved before this only have the name, so fall back to name match.
// Compare bank ids LOOSELY (as strings). The id is a number when an entry is created,
// but after data round-trips through the database merge it can come back as a string;
// a strict === would then silently stop matching, so the entry shows its bank in the
// log (that uses the stored name) but no longer counts toward the bank's balance.
function txInBank(t, bank){ return t.bankId!=null ? String(t.bankId)===String(bank.id) : t.bank===bank.name; }
function bankOfTx(t, banks){ return (banks||[]).find(b => (t.bankId!=null ? String(b.id)===String(t.bankId) : b.name===t.bank)); }
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
const exportCSV = (rows,name,members) => {
  const header = TX_COLS.join(",");
  const lines = rows.map(r=>TX_COLS.map(c=>csvEscape(c==="date"?fmtDate(r.date):c==="memberPhone"?phoneForTx(r,members):r[c])).join(","));
  downloadBlob([header,...lines].join("\n"),`${name}.csv`,"text/csv;charset=utf-8;");
};
const exportExcel = (rows,name,members) => {
  const head = "<tr>"+TX_COLS.map(c=>`<th>${c}</th>`).join("")+"</tr>";
  const body = rows.map(r=>"<tr>"+TX_COLS.map(c=>`<td>${String((c==="date"?fmtDate(r.date):c==="memberPhone"?phoneForTx(r,members):r[c])??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")}</td>`).join("")+"</tr>").join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">${head}${body}</table></body></html>`;
  downloadBlob(html,`${name}.xls`,"application/vnd.ms-excel");
};
const exportPDF = (rows,title,members) => {
  const w = window.open("","_blank");
  if(!w) return;
  const head = "<tr>"+["Date","Time","Type","Amount","ID","Member/Ref","Phone","Bank","Operator","Receipt","Notes"].map(c=>`<th>${c}</th>`).join("")+"</tr>";
  const body = rows.map(r=>"<tr>"+[fmtDate(r.date),r.time,r.type,amtDisplay(r).sign+amtDisplay(r).val,r.memberId||"",r.memberName,phoneForTx(r,members),r.bank,r.operator||"",r.receipt||"",r.notes||""].map(c=>`<td>${String(c).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</td>`).join("")+"</tr>").join("");
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
  accent: dark ? "#e3b341" : "#a67c00",          // DRW brand gold (paired with the near-black base)
  accentBg: dark ? "rgba(227,179,65,0.16)" : "#fbf4dc",
  onAccent: "#1a1206",                            // dark ink for text/icons sitting ON a gold accent fill
};

const editBtnStyle = {cursor:"pointer",padding:"4px 10px",minHeight:32,fontSize:12,fontWeight:500,border:`1px solid ${C.accent}`,borderRadius:6,background:dark?"rgba(227,179,65,0.14)":"#fbf4dc",color:C.accent,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4};
const deleteBtnStyle = {cursor:"pointer",padding:"4px 10px",minHeight:32,fontSize:12,fontWeight:500,border:"1px solid #dc2626",borderRadius:6,background:dark?"#4a1515":"#dc262614",color:dark?"#f09595":"#dc2626",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4};
const bankActiveBtnStyle = {cursor:"pointer",padding:"4px 10px",minHeight:32,fontSize:11,fontWeight:500,border:"1px solid #16a34a",borderRadius:6,background:dark?"#14331f":"#16a34a14",color:dark?"#7dd59e":"#16a34a",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4};
const bankInactiveBtnStyle = {cursor:"pointer",padding:"4px 10px",minHeight:32,fontSize:11,fontWeight:500,border:`1px solid ${C.borderStrong}`,borderRadius:6,background:C.surface2,color:C.muted,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4};
// Freeze toggle: neutral when the bank is open (the "Freeze" action), icy blue when it's
// frozen (the "Unfreeze" action) — so a frozen bank reads at a glance. (The persisted data
// field stays `blocked` for backwards/merge compatibility; only the wording is "Freeze".)
const bankBlockBtnStyle = {cursor:"pointer",padding:"4px 10px",minHeight:32,fontSize:11,fontWeight:500,border:`1px solid ${C.borderStrong}`,borderRadius:6,background:C.surface2,color:C.muted,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4};
const bankBlockedBtnStyle = {cursor:"pointer",padding:"4px 10px",minHeight:32,fontSize:11,fontWeight:500,border:"1px solid #38bdf8",borderRadius:6,background:dark?"#0e2a3a":"#e0f2fe",color:dark?"#7dd3fc":"#0369a1",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4};
const FROST_BORDER = "#38bdf8";
// A subtle "frozen" look for a frozen bank card: icy tint + sky-blue border.
const frozenCardStyle = {background:dark?"linear-gradient(160deg,#0d2331,#0a141c)":"linear-gradient(160deg,#eef7fd,#f7fcff)",borderColor:FROST_BORDER};
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
  if(SIGNED_TYPES.includes(t.type) || t.type==="Bank Block"){
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
            <tr key={t.uid || t.id} style={{borderBottom:`1px solid ${C.border}`,background:t.deleted?"rgba(220,38,38,0.10)":(idx%2?C.surface:"transparent"),opacity:t.deleted?0.7:1}}>
              <td style={{padding:"9px 10px",color:C.muted,whiteSpace:"nowrap"}}>{startIndex+idx+1}</td>
              <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.muted}}>{fmtDate(t.date)} {t.time}</td>
              <td style={{padding:"9px 10px"}}>
                <TxBadge type={t.type}/>
                {t.isNew&&<span style={{marginLeft:4,background:"#16a34a26",color:"#16a34a",fontSize:10,padding:"1px 6px",borderRadius:4,border:"1px solid #16a34a55"}}>New</span>}
                {t.deleted&&<span style={{marginLeft:4,background:"#dc262630",color:"#ef5350",fontSize:10,padding:"1px 6px",borderRadius:4}}>Deleted</span>}
                {t.deleted&&(t.deletedBy||t.deletedDate)&&<span style={{display:"block",fontSize:10.5,color:C.muted,marginTop:3,whiteSpace:"nowrap"}}><i className="ti ti-user-x" aria-hidden="true" style={{fontSize:11,marginRight:3}}/>by {t.deletedBy||"—"}{t.deletedDate?` · ${fmtDate(t.deletedDate)}${t.deletedTime?` ${t.deletedTime}`:""}`:""}</span>}
              </td>
              <td style={{padding:"9px 10px",color:C.text,textDecoration:t.deleted?"line-through":"none"}}>{t.memberName}</td>
              <td style={{padding:"9px 10px",color:C.muted,textDecoration:t.deleted?"line-through":"none"}}>{t.memberId||"—"}</td>
              <td style={{padding:"9px 10px",fontWeight:500,textDecoration:t.deleted?"line-through":"none"}}><Amt t={t}/></td>
              <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.text}}>{(()=>{
                const b = bankOfTx(t, banks);
                if(t.storeAndPaid && t.bankId==null) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#7c3aed"}}><i className="ti ti-arrows-split-2" aria-hidden="true"/>Store + paid</span>; if(t.actualPaid && t.bankId==null) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#0d9488"}}><i className="ti ti-cash" aria-hidden="true"/>Actual paid</span>;
                if(t.storeWithdraw) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#d97706"}}><i className="ti ti-building-store" aria-hidden="true"/>Store withdraw</span>;
                if(t.redeposit) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#2563eb"}}><i className="ti ti-refresh" aria-hidden="true"/>Redeposit</span>;
                if(t.depositExtra) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#7c3aed"}}><i className="ti ti-plus" aria-hidden="true"/>Deposit extra</span>;
                if(t.buyAud) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#db2777"}}><i className="ti ti-currency-dollar" aria-hidden="true"/>Buy AUD</span>;
                if(t.fromUnclaimed) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#d97706"}}><i className="ti ti-coin" aria-hidden="true"/>From unclaimed credit{t.claimedFromDate?` · ${fmtDate(t.claimedFromDate)}`:""}</span>;
                const holder = (b&&b.holder) || t.bankHolder || "";
                const isTransferLeg = t.type==="Transfer In"||t.type==="Transfer Out";
                const bankLabel = isTransferLeg ? (holder||t.bank) : t.bank;
                const cpLabel = isTransferLeg ? (t.counterpartyHolder||t.counterparty) : t.counterparty;
                return (<span>
                  <span style={{display:"block"}}>{holder || t.bank}</span>
                  <span style={{fontSize:11,color:C.muted}}>{bankLabel}{t.counterparty?(t.type==="Transfer In"?` ← ${cpLabel}`:` → ${cpLabel}`):""}</span>
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

/*
 * Inline blacklist warning shown under the entry form's name / phone field.
 *
 * A WARNING and nothing more — it never disables the field, and it never blocks
 * saving. There are legitimate reasons to record a transaction against someone
 * on the list (paying them out, closing their balance, correcting an earlier
 * entry), and a hard block would just get routed around by typing the name
 * slightly differently, which would be worse: the entry still happens, and now
 * nobody can see it was flagged.
 */
function BlacklistWarning({hit, matchedOn}) {
  if(!hit) return null;
  return (
    <div role="status" style={{marginTop:6,display:"flex",alignItems:"flex-start",gap:7,fontSize:11.5,lineHeight:1.5,
      color:"#dc2626",background:dark?"#3a1515":"#fee2e2",border:"1px solid #dc262655",borderRadius:8,padding:"7px 9px"}}>
      <i className="ti ti-alert-triangle" aria-hidden="true" style={{fontSize:13,marginTop:1,flexShrink:0}}/>
      <span>
        <strong>On the blacklist</strong> — this {matchedOn} matches <strong>{hit.name}</strong>{hit.reason?`: ${hit.reason}`:""}
        {hit.addedByCompany&&<span style={{display:"block",marginTop:2,color:C.muted}}>Reported by {hit.addedByCompany}</span>}
      </span>
    </div>
  );
}

function StatCard({label,count,amount,color,onClick,note}) {
  const accent = color||C.accent;
  const viewHint = <span style={{display:"inline-flex",alignItems:"center",gap:2,fontWeight:500,whiteSpace:"nowrap",...((isPaleColor(accent)&&!dark)?goldChip:{color:accent})}}>View <i className="ti ti-arrow-right" aria-hidden="true" style={{fontSize:12}}/></span>;
  return (
    <GlowCard color={color||C.borderStrong} onClick={onClick}
      role={onClick?"button":undefined} tabIndex={onClick?0:undefined}
      onKeyDown={onClick?(e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); onClick(); } }):undefined}
      aria-label={onClick?`${label}: ${fmt(amount)} — view entries`:undefined}
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

// Small labelled figure tile used in the stat-popup + search summary strips.
function SumTile({label,value,color,icon}) {
  return (
    <div style={{background:C.surface2,border:`1px solid ${C.border}`,borderLeft:`3px solid ${color}`,borderRadius:10,padding:"9px 12px",minWidth:0}}>
      <div style={{fontSize:11,color:C.muted,marginBottom:3,display:"flex",alignItems:"center",gap:5}}>
        <i className={`ti ${icon}`} aria-hidden="true" style={{color,fontSize:13,flexShrink:0}}/>
        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
      </div>
      <div style={{fontSize:16,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{value}</div>
    </div>
  );
}

// Totals across all bank accounts: all / active-only / inactive-only.
function BankTotals({banksLive, asOf, isPast}) {
  const sum = arr => arr.reduce((s,b)=>s+(b.balance||0),0);
  const ysum = arr => arr.reduce((s,b)=>s+(b.yBalance||0),0);
  const asum = arr => arr.reduce((s,b)=>s+(b.asOfBalance||0),0);   // closing as of the selected date
  const active = banksLive.filter(b=>b.active!==false);
  const inactive = banksLive.filter(b=>b.active===false);
  // When a past date is chosen the headline shows THAT day's closing (with the live
  // total as a secondary note); otherwise it's the live total + yesterday, as before.
  const Card = ({label,amount,yamount,asAmount,count,color,icon}) => (
    <GlowCard color={color} style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`,borderLeft:`3px solid ${color}`}}>
      <div style={{fontSize:12,color:C.muted,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><i className={`ti ${icon}`} aria-hidden="true" style={{color}}/>{label}{isPast&&<span style={{fontSize:10.5,color,fontWeight:600}}>· as of {fmtDate(asOf)}</span>}</div>
      <div style={{fontSize:20,fontWeight:500,color:C.text}}>{fmt(isPast?asAmount:amount)}</div>
      <div style={{fontSize:12,color:C.muted,marginTop:2}}>{count} {count===1?"bank":"banks"} · {isPast?`Now: ${fmt(amount)}`:`Yesterday: ${fmt(yamount)}`}</div>
    </GlowCard>
  );
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
      <Card label="All banks total" amount={sum(banksLive)} yamount={ysum(banksLive)} asAmount={asum(banksLive)} count={banksLive.length} color={C.accent} icon="ti-building-bank"/>
      <Card label="Active banks total" amount={sum(active)} yamount={ysum(active)} asAmount={asum(active)} count={active.length} color="#16a34a" icon="ti-circle-check"/>
      <Card label="Inactive banks total" amount={sum(inactive)} yamount={ysum(inactive)} asAmount={asum(inactive)} count={inactive.length} color="#64748b" icon="ti-circle-off"/>
    </div>
  );
}

// ---- Bank Details: master/manager-only drop-account records ----------------
// Separate from `banks` (used for live entry) — this is just a record, not
// wired to transactions unless explicitly copied over via "Add to bank
// accounts". Lives in its own Supabase table (migration-021), reached through
// window.FINTRACK_BANK_DETAILS_API (null for staff — see AppScreen.jsx).
// One field-list drives the add/edit form AND the read-only record panel, so
// the two stay in sync automatically instead of being maintained twice.
const BD_GROUPS = [
  {title:"Identity", icon:"ti-fingerprint", fields:[
    ["phoneModel","Phone model","text","ti-device-mobile"],["bankName","Bank name","bankSelect","ti-building-bank"],["holderName","Holder name","text","ti-user"],
    ["dateOfBirth","Date of birth","date","ti-cake"],["phoneNumber","Phone number","text","ti-phone"],["agent","Agent","text","ti-briefcase"],
  ]},
  {title:"Access & security", icon:"ti-shield-lock", fields:[
    ["email","Email","text","ti-mail"],["customerLoginId","Customer / login ID","text","ti-id"],["emailPassword","Email password","password","ti-lock"],
    ["internetPassword","Internet / login password","password","ti-lock"],["loginPin","Login PIN","password","ti-key"],["vpn","VPN","text","ti-map-pin"],
  ]},
  {title:"Card", icon:"ti-credit-card", fields:[
    ["cardLast4","Card last 4 digits","text","ti-credit-card"],["cardPin","Card PIN","password","ti-key"],
  ]},
  {title:"Banking details", icon:"ti-building-bank", fields:[
    ["bsb","BSB","text","ti-building-bank"],["account","Account number","text","ti-hash"],["payid","PayID","text","ti-send"],["otpLink","OTP link","text","ti-link"],
  ]},
  {title:"Notes", icon:"ti-note", fields:[
    ["openDate","Open date","date","ti-calendar"],["others","Others","text","ti-dots-circle-horizontal"],["remarks","Remarks","textarea","ti-note"],
  ]},
];
const BD_FIELDS = BD_GROUPS.flatMap(g=>g.fields.map(([key])=>key));
const BD_BLANK = Object.fromEntries(BD_FIELDS.map(k=>[k,""]));
// The 8 fields shown on the compact card face (everything else lives in the record panel).
const BD_CARD_FIELDS = [["phoneModel","Phone model"],["agent","Agent"],["bsb","BSB"],["account","Account"],["vpn","VPN"],["loginPin","Login PIN",true]];

// Masked value with a one-tap reveal — used for every credential-shaped field
// (Login PIN, Card PIN, Email/Internet password), both on the compact card and
// in the full record panel. stopPropagation so tapping it never also opens/
// closes whatever card or panel it's sitting inside.
function Masked({value}) {
  const [show,setShow] = useState(false);
  if(!value) return <span style={{color:C.muted,fontWeight:400}}>—</span>;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:6}} onClick={e=>e.stopPropagation()}>
      <span style={{fontFamily:"ui-monospace,Consolas,monospace",letterSpacing:show?0:2}}>{show?value:"•".repeat(Math.min(value.length,8))}</span>
      <button type="button" onClick={()=>setShow(s=>!s)} style={{cursor:"pointer",fontSize:9.5,fontWeight:700,color:C.accent,background:C.accentBg,border:`1px solid ${C.accent}`,borderRadius:4,padding:"1px 5px",lineHeight:1.6}}>{show?"HIDE":"SHOW"}</button>
    </span>
  );
}

// Read-only rendering for one field in the record panel: masked for credentials,
// date-formatted for dates, a clickable chip for the OTP link, plain text otherwise.
function BdFieldValue({fieldKey,type,value}) {
  if(type==="password") return <Masked value={value}/>;
  if(!value) return <span style={{color:C.muted,fontWeight:400}}>—</span>;
  if(type==="date") return fmtDate(value);
  if(fieldKey==="otpLink") return isSafeHttpUrl(value)
    ? <a href={value} target="_blank" rel="noopener noreferrer" style={{color:C.accent,textDecoration:"none",display:"inline-flex",alignItems:"center",gap:4,wordBreak:"break-all"}}><i className="ti ti-link" aria-hidden="true" style={{fontSize:12,flexShrink:0}}/>{value}</a>
    : <span style={{wordBreak:"break-word"}}>{value}</span>;
  return <span style={{wordBreak:"break-word"}}>{value}</span>;
}

function BankDetailCard({bd, onOpen, onEdit, onDelete, onToggleFrozen, onAddToBankAccounts}) {
  const added = !!bd.addedToBankAccountsAt;
  return (
    <GlowCard className="bd-card" color={C.accent} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 16px",cursor:"pointer",...(bd.frozen?frozenCardStyle:null)}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=bd.frozen?FROST_BORDER:C.border;}}
      onClick={onOpen}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:2}}>
        <span style={{fontSize:12.5,fontWeight:600,color:C.accent,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{bd.bankName||"—"}</span>
        {bd.frozen&&<span style={{flexShrink:0,fontSize:10,fontWeight:600,color:dark?"#7dd3fc":"#0369a1",background:dark?"#0e2a3a":"#e0f2fe",border:"1px solid #38bdf8",borderRadius:4,padding:"1px 6px",display:"inline-flex",alignItems:"center",gap:3}}><i className="ti ti-snowflake" aria-hidden="true" style={{fontSize:11}}/>Frozen</span>}
      </div>
      <div title={bd.holderName} style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:added?6:11,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{bd.holderName||"Unnamed record"}</div>
      {added&&<div style={{marginBottom:9}}><span style={{fontSize:10,fontWeight:600,color:C.accent,background:C.accentBg,border:`1px solid ${C.accent}`,borderRadius:20,padding:"2px 8px",display:"inline-flex",alignItems:"center",gap:3}}><i className="ti ti-check" aria-hidden="true" style={{fontSize:11}}/>Added to Bank Accounts</span></div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px 12px",background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 10px",marginBottom:11,fontSize:12}}>
        {BD_CARD_FIELDS.map(([key,label,masked])=>(
          <div key={key}><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>{label}</div>
            <div style={{color:C.text,fontWeight:500}}>{masked?<Masked value={bd[key]}/>:(bd[key]||"—")}</div></div>
        ))}
        <div style={{gridColumn:"1/-1"}}><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>PayID</div><div style={{color:C.text,fontWeight:500,wordBreak:"break-all"}}>{bd.payid||"—"}</div></div>
        <div style={{gridColumn:"1/-1"}}>
          <div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>OTP link</div>
          {bd.otpLink
            ? (isSafeHttpUrl(bd.otpLink)
                ? <a href={bd.otpLink} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{color:C.accent,fontWeight:500,textDecoration:"none",display:"inline-flex",alignItems:"center",gap:4}}><i className="ti ti-link" aria-hidden="true" style={{fontSize:12}}/>Open</a>
                : <span style={{color:C.text,fontWeight:500,wordBreak:"break-all"}}>{bd.otpLink}</span>)
            : <span style={{color:C.text,fontWeight:500}}>—</span>}
        </div>
      </div>
      {/* Every control here writes, so the whole block is dropped for a read-only
          viewer (an owner) — the page passes onEdit=null in that case. */}
      {onEdit&&(
      <div onClick={e=>e.stopPropagation()} style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{display:"flex",gap:6}}>
          <button onClick={onEdit} style={{...editBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-edit" aria-hidden="true"/> Edit</button>
          <button onClick={onDelete} style={{...deleteBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-trash" aria-hidden="true"/> Del</button>
        </div>
        <button onClick={onToggleFrozen} style={{...(bd.frozen?bankBlockedBtnStyle:bankBlockBtnStyle),justifyContent:"center"}}
          title={bd.frozen?"Frozen — click to unfreeze":"Click to freeze this record"}>
          <i className={`ti ti-${bd.frozen?"snowflake-off":"snowflake"}`} aria-hidden="true"/> {bd.frozen?"Unfreeze":"Freeze"}
        </button>
        <button onClick={onAddToBankAccounts} style={{cursor:"pointer",padding:"5px 10px",minHeight:32,fontSize:11,fontWeight:600,border:`1px solid ${C.accent}`,borderRadius:6,background:C.accent,color:C.onAccent,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4}}>
          <i className="ti ti-building-bank" aria-hidden="true"/> {added?"Add again":"Add to bank accounts"}
        </button>
      </div>
      )}
    </GlowCard>
  );
}

function BankDetailPanel({bd, onClose, panelRef}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:998,padding:"24px 16px"}} onClick={onClose}>
      <div ref={panelRef} style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:720,maxHeight:"86vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
          <div>
            <div style={{fontWeight:500,fontSize:17}}>{bd.bankName||"—"} — {bd.holderName||"Unnamed record"}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:3}}>{bd.frozen?"Frozen":"Active"}{bd.addedToBankAccountsAt?" · Added to Bank Accounts":""}</div>
          </div>
          <button onClick={onClose} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}>
            <i className="ti ti-x" aria-hidden="true" style={{fontSize:15}}/> Close
          </button>
        </div>
        <div style={{padding:"18px 20px",overflowY:"auto",background:C.bg}}>
          {BD_GROUPS.map(g=>(
            <div key={g.title} style={{marginBottom:18}}>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:9,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                <i className={`ti ${g.icon}`} aria-hidden="true" style={{fontSize:13}}/>{g.title}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"9px 18px"}}>
                {g.fields.map(([key,label,type,icon])=>(
                  <div key={key} style={type==="textarea"?{gridColumn:"1/-1"}:null}>
                    <div style={{display:"flex",alignItems:"center",gap:4,fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.03em",color:C.muted,marginBottom:2}}>
                      <i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:10.5}}/>{label}
                    </div>
                    <div style={{fontSize:13,fontWeight:500}}><BdFieldValue fieldKey={key} type={type} value={bd[key]}/></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Company Credentials: master/manager-only general login/credential vault ----
// Unlike Bank Details, records here have no fixed schema — each one can carry
// totally different fields (a Google account needs Email/Password; "Teams
// Live" is a single passkey). CRED_COMMON_FIELDS covers the frequent case with
// ready-made boxes; anything else goes in a record's own customFields array
// (each {label,value,sensitive} — sensitive ones get the same mask+reveal
// treatment as Password, plus a copy button). Lives in its own table
// (migration-022), same isolation reasoning as Bank Details — see
// window.FINTRACK_COMPANY_CREDENTIALS_API.
const CRED_COMMON_FIELDS = [
  ["username","Username / ID","text","ti-user"],
  ["email","Email","text","ti-mail"],
  ["password","Password","password","ti-lock"],
  ["link","Link","text","ti-link"],
];
const CRED_BLANK = {name:"",category:"",username:"",email:"",password:"",link:"",customFields:[]};

// Renders one credential value with a COPY button, and — when `masked` — the
// same show/hide treatment as Bank Details' Masked component. Kept as its own
// component rather than extending Masked, so Bank Details' Masked stays
// completely untouched by this feature.
function CopyableValue({value, masked, isLink}) {
  const [show,setShow] = useState(false);
  const [copied,setCopied] = useState(false);
  if(!value) return <span style={{color:C.muted,fontWeight:400}}>—</span>;
  const doCopy = e => {
    e.stopPropagation();
    try {
      navigator.clipboard.writeText(value).then(
        ()=>{ setCopied(true); setTimeout(()=>setCopied(false),1500); },
        ()=>{ /* copy rejected — leave button as-is, nothing to recover */ }
      );
    } catch(e) { /* clipboard API unavailable in this context */ }
  };
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:6,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
      {isLink && isSafeHttpUrl(value) ? (
        <a href={value} target="_blank" rel="noopener noreferrer" style={{color:C.accent,textDecoration:"none",display:"inline-flex",alignItems:"center",gap:4,wordBreak:"break-all"}}><i className="ti ti-link" aria-hidden="true" style={{fontSize:12,flexShrink:0}}/>{value}</a>
      ) : (
        <span style={{fontFamily:masked?"ui-monospace,Consolas,monospace":"inherit",letterSpacing:masked&&!show?2:0,wordBreak:"break-word"}}>{masked&&!show?"•".repeat(Math.min(value.length,8)):value}</span>
      )}
      {masked&&<button type="button" onClick={()=>setShow(s=>!s)} style={{cursor:"pointer",fontSize:9.5,fontWeight:700,color:C.accent,background:C.accentBg,border:`1px solid ${C.accent}`,borderRadius:4,padding:"1px 5px",lineHeight:1.6}}>{show?"HIDE":"SHOW"}</button>}
      <button type="button" onClick={doCopy} style={{cursor:"pointer",fontSize:9.5,fontWeight:700,color:copied?"#16a34a":C.accent,background:copied?(dark?"#14331f":"#16a34a14"):C.accentBg,border:`1px solid ${copied?"#16a34a":C.accent}`,borderRadius:4,padding:"1px 5px",lineHeight:1.6}}>{copied?"COPIED":"COPY"}</button>
    </span>
  );
}

function CredentialCard({cred, onOpen, onEdit, onDelete}) {
  const extraCount = cred.customFields.length;
  return (
    <GlowCard className="cred-card" color={C.accent} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 16px",cursor:"pointer"}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;}}
      onClick={onOpen}>
      {cred.category&&<div style={{fontSize:12.5,fontWeight:600,color:C.accent,marginBottom:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{cred.category}</div>}
      <div title={cred.name} style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:10,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{cred.name}</div>
      {(cred.username||cred.email||cred.password)&&(
        <div style={{display:"flex",flexDirection:"column",gap:6,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 10px",marginBottom:8,fontSize:12}}>
          {cred.username&&<div><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>Username / ID</div><div style={{color:C.text,fontWeight:500,wordBreak:"break-word"}}>{cred.username}</div></div>}
          {cred.email&&<div><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>Email</div><div style={{color:C.text,fontWeight:500,wordBreak:"break-word"}}>{cred.email}</div></div>}
          {cred.password&&<div><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>Password</div><CopyableValue value={cred.password} masked/></div>}
        </div>
      )}
      {extraCount>0&&<div style={{fontSize:11,color:C.muted,marginBottom:10}}>+ {extraCount} more field{extraCount===1?"":"s"}</div>}
      {/* Dropped for a read-only viewer (an owner) — page passes onEdit=null. */}
      {onEdit&&(
      <div onClick={e=>e.stopPropagation()} style={{display:"flex",gap:6}}>
        <button onClick={onEdit} style={{...editBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-edit" aria-hidden="true"/> Edit</button>
        <button onClick={onDelete} style={{...deleteBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-trash" aria-hidden="true"/> Del</button>
      </div>
      )}
    </GlowCard>
  );
}

function CredentialPanel({cred, onClose, panelRef}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:998,padding:"24px 16px"}} onClick={onClose}>
      <div ref={panelRef} style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:560,maxHeight:"86vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
          <div style={{fontWeight:500,fontSize:17}}>{cred.name}{cred.category&&<span style={{fontSize:10,fontWeight:600,color:C.accent,border:`1px solid ${C.accent}`,borderRadius:20,padding:"2px 8px",marginLeft:8}}>{cred.category}</span>}</div>
          <button onClick={onClose} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}>
            <i className="ti ti-x" aria-hidden="true" style={{fontSize:15}}/> Close
          </button>
        </div>
        <div style={{padding:"18px 20px",overflowY:"auto",background:C.bg}}>
          {CRED_COMMON_FIELDS.map(([key,label,type,icon])=>(
            cred[key] ? (
              <div key={key} style={{marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",gap:4,fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.03em",color:C.muted,marginBottom:2}}>
                  <i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:10.5}}/>{label}
                </div>
                <div style={{fontSize:13,fontWeight:500}}><CopyableValue value={cred[key]} masked={type==="password"} isLink={key==="link"}/></div>
              </div>
            ) : null
          ))}
          {cred.customFields.length>0&&(
            <div style={{marginTop:16}}>
              <div style={{fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:9,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>Custom fields</div>
              {cred.customFields.map((f,i)=>(
                <div key={i} style={{marginBottom:12}}>
                  <div style={{fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.03em",color:C.muted,marginBottom:2}}>{f.label||"Untitled field"}</div>
                  <div style={{fontSize:13,fontWeight:500}}><CopyableValue value={f.value} masked={!!f.sensitive}/></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Payment Gateway Details: master/manager-only payment gateway vault ----
// Same shape as Company Credentials — fixed common fields cover the frequent
// case (backend link/login ID/password/API key/merchant key/merchant code),
// customFields covers anything a specific gateway needs beyond that (webhook
// secrets, support PINs, settlement notes...). Lives in its own table
// (migration-023), same isolation reasoning as Bank Details / Company
// Credentials — see window.FINTRACK_PAYMENT_GATEWAYS_API. Reuses CopyableValue
// as-is rather than a new component, since the mask/reveal/copy behaviour is
// identical.
const PG_COMMON_FIELDS = [
  ["backendLink","Backend Link","text","ti-link"],
  ["loginId","Login ID","text","ti-user"],
  ["password","Password","password","ti-lock"],
  ["apiKey","API Key","password","ti-key"],
  ["merchantKey","Merchant Key","password","ti-shield-lock"],
  ["merchantCode","Merchant Code","text","ti-hash"],
];
const PG_BLANK = {name:"",backendLink:"",loginId:"",password:"",apiKey:"",merchantKey:"",merchantCode:"",customFields:[]};

function PaymentGatewayCard({pg, onOpen, onEdit, onDelete}) {
  const extraCount = pg.customFields.length;
  return (
    <GlowCard className="pg-card" color={C.accent} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 16px",cursor:"pointer"}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;}}
      onClick={onOpen}>
      <div title={pg.name} style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:10,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{pg.name}</div>
      {(pg.loginId||pg.merchantCode||pg.password)&&(
        <div style={{display:"flex",flexDirection:"column",gap:6,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 10px",marginBottom:8,fontSize:12}}>
          {pg.loginId&&<div><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>Login ID</div><div style={{color:C.text,fontWeight:500,wordBreak:"break-word"}}>{pg.loginId}</div></div>}
          {pg.merchantCode&&<div><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>Merchant Code</div><div style={{color:C.text,fontWeight:500,wordBreak:"break-word"}}>{pg.merchantCode}</div></div>}
          {pg.password&&<div><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>Password</div><CopyableValue value={pg.password} masked/></div>}
        </div>
      )}
      {extraCount>0&&<div style={{fontSize:11,color:C.muted,marginBottom:10}}>+ {extraCount} more field{extraCount===1?"":"s"}</div>}
      {/* Dropped for a read-only viewer (an owner) — page passes onEdit=null. */}
      {onEdit&&(
      <div onClick={e=>e.stopPropagation()} style={{display:"flex",gap:6}}>
        <button onClick={onEdit} style={{...editBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-edit" aria-hidden="true"/> Edit</button>
        <button onClick={onDelete} style={{...deleteBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-trash" aria-hidden="true"/> Del</button>
      </div>
      )}
    </GlowCard>
  );
}

function PaymentGatewayPanel({pg, onClose, panelRef}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:998,padding:"24px 16px"}} onClick={onClose}>
      <div ref={panelRef} style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:560,maxHeight:"86vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
          <div style={{fontWeight:500,fontSize:17}}>{pg.name}</div>
          <button onClick={onClose} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}>
            <i className="ti ti-x" aria-hidden="true" style={{fontSize:15}}/> Close
          </button>
        </div>
        <div style={{padding:"18px 20px",overflowY:"auto",background:C.bg}}>
          {PG_COMMON_FIELDS.map(([key,label,type,icon])=>(
            pg[key] ? (
              <div key={key} style={{marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",gap:4,fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.03em",color:C.muted,marginBottom:2}}>
                  <i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:10.5}}/>{label}
                </div>
                <div style={{fontSize:13,fontWeight:500}}><CopyableValue value={pg[key]} masked={type==="password"} isLink={key==="backendLink"}/></div>
              </div>
            ) : null
          ))}
          {pg.customFields.length>0&&(
            <div style={{marginTop:16}}>
              <div style={{fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:9,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>Custom fields</div>
              {pg.customFields.map((f,i)=>(
                <div key={i} style={{marginBottom:12}}>
                  <div style={{fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.03em",color:C.muted,marginBottom:2}}>{f.label||"Untitled field"}</div>
                  <div style={{fontSize:13,fontWeight:500}}><CopyableValue value={f.value} masked={!!f.sensitive}/></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Game Kiosk Details: ALL-roles kiosk credential vault ----
// Same shape as Payment Gateway Details (fixed common fields + customFields
// for anything extra), but deliberately open to every role — master, manager,
// AND staff all get full add/edit/delete, not just master/manager. Lives in
// its own table (migration-024) so kiosk credentials still don't ride in the
// shared app_data blob, but the RLS only isolates by company, not by role —
// see window.FINTRACK_KIOSK_DETAILS_API. Reuses CopyableValue as-is.
const KIOSK_COMMON_FIELDS = [
  ["backendLink","Kiosk Backend Link","text","ti-link"],
  ["loginId","Login ID","text","ti-user"],
  ["password","Password","password","ti-lock"],
  ["merchantCode","Merchant Code","text","ti-hash"],
];
const KIOSK_BLANK = {name:"",backendLink:"",loginId:"",password:"",merchantCode:"",customFields:[]};

function KioskCard({kiosk, onOpen, onEdit, onDelete}) {
  const extraCount = kiosk.customFields.length;
  return (
    <GlowCard className="kiosk-card" color={C.accent} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 16px",cursor:"pointer"}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;}}
      onClick={onOpen}>
      <div title={kiosk.name} style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:10,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{kiosk.name}</div>
      {(kiosk.loginId||kiosk.merchantCode||kiosk.password)&&(
        <div style={{display:"flex",flexDirection:"column",gap:6,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 10px",marginBottom:8,fontSize:12}}>
          {kiosk.loginId&&<div><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>Login ID</div><div style={{color:C.text,fontWeight:500,wordBreak:"break-word"}}>{kiosk.loginId}</div></div>}
          {kiosk.merchantCode&&<div><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>Merchant Code</div><div style={{color:C.text,fontWeight:500,wordBreak:"break-word"}}>{kiosk.merchantCode}</div></div>}
          {kiosk.password&&<div><div style={{fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.04em",color:C.muted,marginBottom:1}}>Password</div><CopyableValue value={kiosk.password} masked/></div>}
        </div>
      )}
      {extraCount>0&&<div style={{fontSize:11,color:C.muted,marginBottom:10}}>+ {extraCount} more field{extraCount===1?"":"s"}</div>}
      {/* Dropped for a read-only viewer (an owner) — page passes onEdit=null. */}
      {onEdit&&(
      <div onClick={e=>e.stopPropagation()} style={{display:"flex",gap:6}}>
        <button onClick={onEdit} style={{...editBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-edit" aria-hidden="true"/> Edit</button>
        <button onClick={onDelete} style={{...deleteBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-trash" aria-hidden="true"/> Del</button>
      </div>
      )}
    </GlowCard>
  );
}

function KioskPanel({kiosk, onClose, panelRef}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:998,padding:"24px 16px"}} onClick={onClose}>
      <div ref={panelRef} style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:560,maxHeight:"86vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
          <div style={{fontWeight:500,fontSize:17}}>{kiosk.name}</div>
          <button onClick={onClose} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}>
            <i className="ti ti-x" aria-hidden="true" style={{fontSize:15}}/> Close
          </button>
        </div>
        <div style={{padding:"18px 20px",overflowY:"auto",background:C.bg}}>
          {KIOSK_COMMON_FIELDS.map(([key,label,type,icon])=>(
            kiosk[key] ? (
              <div key={key} style={{marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",gap:4,fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.03em",color:C.muted,marginBottom:2}}>
                  <i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:10.5}}/>{label}
                </div>
                <div style={{fontSize:13,fontWeight:500}}><CopyableValue value={kiosk[key]} masked={type==="password"} isLink={key==="backendLink"}/></div>
              </div>
            ) : null
          ))}
          {kiosk.customFields.length>0&&(
            <div style={{marginTop:16}}>
              <div style={{fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:9,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>Custom fields</div>
              {kiosk.customFields.map((f,i)=>(
                <div key={i} style={{marginBottom:12}}>
                  <div style={{fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.03em",color:C.muted,marginBottom:2}}>{f.label||"Untitled field"}</div>
                  <div style={{fontSize:13,fontWeight:500}}><CopyableValue value={f.value} masked={!!f.sensitive}/></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Transaction log with a page-size dropdown (default 50) + simple pager.
const PAGE_SIZES = [50,100,200,500,1000];
// ---- Blacklist Member: the one list shared ACROSS companies ----------------
// Pooled by country (migration-027), so an entry added at one company shows up
// at every other company in that country. Append-only by design: the table has
// no update or delete policy, so there is nothing here for editing a record.
const BL_FIELDS = [
  ["name",     "Name",           "ti-user",          true],
  ["phone",    "Phone number",   "ti-phone",         false],
  ["payid",    "PayID",          "ti-at",            false],
  ["bsb",      "BSB",            "ti-building-bank", false],
  ["accountNo","Account number", "ti-credit-card",   false],
  ["reason",   "Reason",         "ti-alert-triangle",false],
];
const BL_BLANK = { name:"", phone:"", payid:"", bsb:"", accountNo:"", reason:"" };
const BL_SORTS = [
  {value:"newest", label:"Newest added"},
  {value:"oldest", label:"Oldest added"},
  {value:"name",   label:"Name (A–Z)"},
  {value:"company",label:"Reported by"},
];

// Member directory sort options (value -> label shown in the Sort dropdown).
const MEMBER_SORTS = [
  {value:"newest",  label:"Newest joined"},
  {value:"oldest",  label:"Oldest joined"},
  {value:"name",    label:"Name (A–Z)"},
  {value:"nameDesc",label:"Name (Z–A)"},
  {value:"tx",      label:"Most transactions"},
  {value:"activity",label:"Recent activity"},
];
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

// Stable per-employee colour (same name -> same colour everywhere) so people are easy to tell
// apart on the calendar. Hash the lowercased name into a fixed palette of distinct mid-tones.
const EMP_COLORS = ['#2563eb','#16a34a','#d97706','#db2777','#7c3aed','#0891b2','#dc2626','#0d9488','#4f46e5','#ca8a04','#e11d48','#0284c7'];
const empColor = (name) => { const s=(name||'').trim().toLowerCase(); let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return EMP_COLORS[h%EMP_COLORS.length]; };
// Theme-readable variant of an employee colour for coloured text on the app background.
const empText = (col) => `color-mix(in srgb, ${col} ${dark?'58%, #ffffff':'85%, #000000'})`;

// Month calendar for the Off Days page. Presentational + module-level so it can read the shared
// C palette / fmtDate; the page owns selection state and passes it down. Monday-first. Each cell
// shows a large day number plus the colour-coded names of anyone off that day (events[iso] = [names]).
function MonthCalendar({ month, selected, onToggle, events, today, isMobile }){
  const [y,m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m-1, 1).getDay() + 6) % 7; // Monday-first leading blanks
  const pad = n => String(n).padStart(2,'0');
  const sel = new Set(selected);
  const wd = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const maxNames = isMobile ? 2 : 3;
  const cells = [];
  for(let i=0;i<lead;i++) cells.push(null);
  for(let d=1; d<=daysInMonth; d++) cells.push(d);
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:6,marginBottom:6}}>
        {wd.map(w=>(<div key={w} style={{textAlign:'center',fontSize:10.5,fontWeight:600,letterSpacing:'0.04em',textTransform:'uppercase',color:C.muted}}>{isMobile?w[0]:w}</div>))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:6}}>
        {cells.map((d,i)=>{
          if(d===null) return <div key={'b'+i} aria-hidden="true" />;
          const iso = `${y}-${pad(m)}-${pad(d)}`;
          const isSel = sel.has(iso), isToday = iso===today, isPast = iso < today;
          const names = events[iso] || [];
          return (
            <button key={iso} type="button" onClick={()=>onToggle(iso)} className="ft-cal-day" aria-pressed={isSel}
              aria-label={`${fmtDate(iso)}${names.length?` — off: ${names.join(', ')}`:''}`}
              style={{position:'relative',minHeight:isMobile?56:74,borderRadius:10,cursor:'pointer',overflow:'hidden',textAlign:'left',
                border:`${isSel?2:1}px solid ${isSel||isToday?C.accent:C.border}`,
                background:isSel?C.accentBg:C.surface2,
                display:'flex',flexDirection:'column',gap:2,padding:isMobile?'4px':'5px 6px',
                transition:'background 0.12s, border-color 0.12s, transform 0.06s'}}>
              <span style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:isMobile?15:17,fontWeight:700,lineHeight:1,color:isSel||isToday?C.accent:(isPast?C.muted:C.text)}}>
                {d}{isToday&&<span aria-hidden="true" style={{width:5,height:5,borderRadius:'50%',background:C.accent}}/>}
              </span>
              <span style={{display:'flex',flexDirection:'column',gap:1,minWidth:0}}>
                {names.slice(0,maxNames).map((nm,k)=>{ const col=empColor(nm); return (
                  <span key={k} title={nm} style={{fontSize:isMobile?9:10,lineHeight:1.3,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',borderRadius:3,padding:'0 4px',borderLeft:`2px solid ${col}`,background:`color-mix(in srgb, ${col} 15%, transparent)`,color:empText(col)}}>{nm}</span>
                ); })}
                {names.length>maxNames&&<span style={{fontSize:isMobile?9:10,lineHeight:1.3,color:C.muted,paddingLeft:3}}>+{names.length-maxNames} more</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Top-bar clock, kept as its own component so its 1-second tick re-renders only this
// little span — not the whole (large) FinTrack tree. Shows HH:MM:SS in the company zone.
function LiveClock({tz,color}){
  const [now,setNow] = useState(()=>timeInTz(tz));
  useEffect(()=>{ setNow(timeInTz(tz)); const id=setInterval(()=>setNow(timeInTz(tz)),1000); return ()=>clearInterval(id); },[tz]);
  return <span style={{fontWeight:600,color}}>{now}</span>;
}

function DetailModal({title,subtitle,transactions,onClose,banks,yesterday,summary}) {
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
          {summary&&(
            <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,minmax(0,1fr))":"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:14}}>
              {summary.store&&(<>
                <SumTile icon="ti-wallet" color={C.accent} label="Current store balance" value={fmt(summary.store.current)}/>
                <SumTile icon="ti-history" color={STORE_COLOR} label={summary.store.closingLabel} value={fmt(summary.store.closing)}/>
              </>)}
              <SumTile icon="ti-arrow-down-left" color="#16a34a" label={`Credit in · ${summary.credits.n} ${summary.credits.n===1?"entry":"entries"}`} value={fmt(summary.credits.sum)}/>
              <SumTile icon="ti-arrow-up-right" color="#dc2626" label={`Debit out · ${summary.debits.n} ${summary.debits.n===1?"entry":"entries"}`} value={fmt(summary.debits.sum)}/>
              <SumTile icon="ti-sum" color={summary.net>=0?"#16a34a":"#dc2626"} label="Net (in − out)" value={fmt(summary.net)}/>
            </div>
          )}
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
                    <tr key={t.uid || t.id} style={{borderBottom:`1px solid ${C.border}`,background:t.deleted?"rgba(220,38,38,0.10)":(idx%2?C.surface:"transparent"),opacity:t.deleted?0.7:1}}>
                      <td style={{padding:"9px 10px",color:C.muted,whiteSpace:"nowrap",...(isMobile?{position:"sticky",left:0,zIndex:1,background:idx%2?C.surface:C.bg}:null)}}>{idx+1}</td>
                      <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.muted}}>{fmtDate(t.date)} {t.time}</td>
                      <td style={{padding:"9px 10px"}}><TxBadge type={t.type}/>{t.deleted&&<span style={{marginLeft:4,background:"#dc262630",color:"#ef5350",fontSize:10,padding:"1px 6px",borderRadius:4}}>Deleted</span>}{t.deleted&&(t.deletedBy||t.deletedDate)&&<span style={{display:"block",fontSize:10.5,color:C.muted,marginTop:3,whiteSpace:"nowrap"}}><i className="ti ti-user-x" aria-hidden="true" style={{fontSize:11,marginRight:3}}/>by {t.deletedBy||"—"}{t.deletedDate?` · ${fmtDate(t.deletedDate)}${t.deletedTime?` ${t.deletedTime}`:""}`:""}</span>}</td>
                      <td style={{padding:"9px 10px",color:C.text,textDecoration:t.deleted?"line-through":"none"}}>{t.memberName}</td>
                      <td style={{padding:"9px 10px",color:C.muted,textDecoration:t.deleted?"line-through":"none"}}>{t.memberId||"—"}</td>
                      <td style={{padding:"9px 10px",fontWeight:500,textDecoration:t.deleted?"line-through":"none"}}><Amt t={t}/></td>
                      <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.text}}>{(()=>{
                        const b = bankOfTx(t, banks);
                        if(t.storeAndPaid && t.bankId==null) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#7c3aed"}}><i className="ti ti-arrows-split-2" aria-hidden="true"/>Store + paid</span>; if(t.actualPaid && t.bankId==null) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#0d9488"}}><i className="ti ti-cash" aria-hidden="true"/>Actual paid</span>;
                if(t.storeWithdraw) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#d97706"}}><i className="ti ti-building-store" aria-hidden="true"/>Store withdraw</span>;
                if(t.redeposit) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#2563eb"}}><i className="ti ti-refresh" aria-hidden="true"/>Redeposit</span>;
                if(t.depositExtra) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#7c3aed"}}><i className="ti ti-plus" aria-hidden="true"/>Deposit extra</span>;
                if(t.buyAud) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#db2777"}}><i className="ti ti-currency-dollar" aria-hidden="true"/>Buy AUD</span>;
                if(t.fromUnclaimed) return <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:500,color:"#d97706"}}><i className="ti ti-coin" aria-hidden="true"/>From unclaimed credit{t.claimedFromDate?` · ${fmtDate(t.claimedFromDate)}`:""}</span>;
                        const holder = (b&&b.holder) || t.bankHolder || "";
                        const isTransferLeg = t.type==="Transfer In"||t.type==="Transfer Out";
                        const bankLabel = isTransferLeg ? (holder||t.bank) : t.bank;
                        const cpLabel = isTransferLeg ? (t.counterpartyHolder||t.counterparty) : t.counterparty;
                        return (<span>
                          <span style={{display:"block"}}>{holder || t.bank}</span>
                          <span style={{fontSize:11,color:C.muted}}>{bankLabel}{t.counterparty?(t.type==="Transfer In"?` ← ${cpLabel}`:` → ${cpLabel}`):""}</span>
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
  // Normalise once here so every consumer below (cards, dropdowns, sorts, name
  // matching) can trust name/operatorId are non-empty strings — a single malformed
  // account row (e.g. a legacy profile with no name) must not be able to crash the
  // whole app the way an unguarded `.name.localeCompare(...)` would.
  const TEAM = readTeam().filter(Boolean).map(t=>({ id:t.id, operatorId:t.operatorId||t.id||"", name:t.name||"Unnamed", role:t.role, nationality:t.nationality||"" }));
  // Only master/manager can rearrange the shift roster — staff see it read-only.
  const canEditRoster = SESSION.role==="master" || SESSION.role==="manager";
  // An owner drilled into this company: reads everything, writes nothing. Their
  // own company_id is null, which is exactly what makes every write policy
  // (gated on company_id = my_company()) impossible for them — see migration-013
  // and migration-025. Used below to show the Details pages but not their
  // add/edit/delete controls.
  const isOwnerView = SESSION.role==="owner";
  // Who may DOWNLOAD data (the CSV / Excel / PDF buttons on the Dashboard,
  // Transactions, Members and Search pages). Everyone except staff — written as
  // an allow-list, not `!== "staff"`, so any role added later is denied until
  // it's considered explicitly.
  //
  // Worth being clear about what this is: it stops staff casually walking out
  // with a spreadsheet of the company's records. It is NOT a data-access
  // boundary — staff can still SEE these pages, because they need them to do
  // the job, so the underlying rows are in their browser either way. Only the
  // separately RLS-gated pages (Bank Details and the other vaults below) keep
  // data away from a staff session entirely.
  const canExport = SESSION.role==="master" || SESSION.role==="manager" || isOwnerView;
  // Bank Details is master/manager, plus an owner read-only — the nav item is
  // hidden for staff below, and the page content is guarded by this flag too
  // (defense in depth). The REAL gate is server-side RLS (migration-021, widened
  // for owners by migration-025): window.FINTRACK_BANK_DETAILS_API is null for a
  // staff session, so this flag and that null always agree.
  const canAccessBankDetails = SESSION.role==="master" || SESSION.role==="manager" || isOwnerView;
  // Company Credentials is the same audience — separately named from
  // canAccessBankDetails even though the expression is currently identical,
  // matching this file's existing convention (canEditRoster is the same
  // pattern) so either gate can change independently later without coupling.
  const canAccessCompanyCredentials = SESSION.role==="master" || SESSION.role==="manager" || isOwnerView;
  // Payment Gateway Details, same again — kept separately named for the same
  // future-independence reason.
  const canAccessPaymentGateways = SESSION.role==="master" || SESSION.role==="manager" || isOwnerView;
  // Who may ADD / EDIT / DELETE on the three vault pages above. Deliberately
  // narrower than the canAccess* flags: an owner sees the records but gets no
  // write controls at all (the server would reject the write anyway).
  const canEditVaults = SESSION.role==="master" || SESSION.role==="manager";
  // Game Kiosk Details is open to EVERY company role including staff
  // (migration-024), so its write gate is just "not a read-only owner".
  const canEditKiosk = !isOwnerView;
  // Blacklist: every company role may ADD (never edit or delete — the table has
  // no such policy). An owner can read the shared list but not contribute, same
  // read-only rule as everywhere else; without a company they'd fail RLS anyway.
  const canAddBlacklist = !isOwnerView;
  // Only a master can withdraw an entry. Nobody, master included, can EDIT one —
  // the table has no update policy, so what an entry says about a person is
  // fixed once saved; the only remedy for a wrong entry is removing it.
  const canDeleteBlacklist = SESSION.role==="master";
  // This company's time zone (set per company by the provider). All "now" dates
  // and times below are computed in this zone so the log follows it.
  const tz = SESSION.timezone || "Australia/Sydney";
  const today = dateInTz(tz);
  const yesterday = dateNDaysAgoInTz(1,tz);
  const weekAgo = dateNDaysAgoInTz(6,tz);
  const thisMonth = today.slice(0,7);
  // Live clock for the top bar, ticking in the company's time zone.
  const [page,setPage] = useState("dashboard");
  const [memberPage,setMemberPage] = useState(1);
  const [memberPageSize,setMemberPageSize] = useState(50);
  const [memberSearch,setMemberSearch] = useState("");
  const [memberSort,setMemberSort] = useState("newest"); // members directory order — most recently JOINED member on top by default
  useEffect(()=>{ setMemberPage(1); },[memberPageSize,memberSearch,memberSort]);
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
  const [offDays,setOffDays] = useState([]);
  const [offForm,setOffForm] = useState({employeeId:"",reason:""});
  const [offSelDates,setOffSelDates] = useState([]);
  const [offCalMonth,setOffCalMonth] = useState(thisMonth);
  const [offError,setOffError] = useState("");
  const [offLogSearch,setOffLogSearch] = useState("");
  const [offLogSort,setOffLogSort] = useState("date");
  const [dragOperatorId,setDragOperatorId] = useState(null); // operatorId currently being dragged (desktop DnD)
  const [dragFromUid,setDragFromUid] = useState(null);       // set when dragging an already-placed card (vs. from the pool)
  const [dragOverShift,setDragOverShift] = useState(null);   // shift bucket currently hovered while dragging
  const [mobileAssignFor,setMobileAssignFor] = useState(null); // operatorId with the tap-to-assign menu open (touch)
  const [offCountsNat,setOffCountsNat] = useState("");        // nationality filter for the off-day counts table ("" = all)
  const [offCountsAll,setOffCountsAll] = useState(false);     // "View more" — show every row instead of the first 10
  const [confirm,setConfirm] = useState(null);
  const [detailModal,setDetailModal] = useState(null);
  const [dashView,setDashView] = useState("today");
  const [selMonth,setSelMonth] = useState(thisMonth);
  const [rangeFrom,setRangeFrom] = useState(weekAgo);
  const [rangeTo,setRangeTo] = useState(today);

  const [form,setForm] = useState({type:"Regular Deposit",amount:"",memberId:"",memberName:"",memberPhone:"",bankId:null,notes:"",toBankId:null,date:"",fromUnclaimed:false,redeposit:false,claimDate:"",receipt:"",storeWithdraw:false,storeWithdrawAmount:"",actualPaid:false,actualPaidAmount:"",storeAndPaid:false,depositExtra:false,rate:"",buyAud:false,buyAudAmount:""});
  const [formError,setFormError] = useState("");
  const [nameSuggestions,setNameSuggestions] = useState([]);
  const [idSuggestions,setIdSuggestions] = useState([]);
  const [phoneSuggestions,setPhoneSuggestions] = useState([]);
  const [suggestIndex,setSuggestIndex] = useState(-1); // keyboard highlight in member-suggestion lists
  const suggestRef = useRef(null);
  const idSuggestRef = useRef(null);
  const phoneSuggestRef = useRef(null);

  const [newBank,setNewBank] = useState({name:"",holder:"",bsb:"",account:"",payid:"",otpLink:"",balance:""});
  const [bankError,setBankError] = useState("");
  const [bankSearch,setBankSearch] = useState(""); // Bank Accounts page: filter by holder / bank / account / PayID
  const [bankAsOfSel,setBankAsOfSel] = useState(""); // Bank Accounts page: "" = today/live, else a date → show closing balances as of that day
  const [editingBank,setEditingBank] = useState(null);
  const [editBankForm,setEditBankForm] = useState({});
  const [editBankError,setEditBankError] = useState("");

  // Bank Details — separate table, own state (not part of the transactions/banks/
  // members blob), so none of the merge/poll machinery above applies to it.
  const [bankDetails,setBankDetails] = useState([]);
  const [bdLoaded,setBdLoaded] = useState(false);
  const [bdLoadError,setBdLoadError] = useState("");
  const [bdSearch,setBdSearch] = useState("");
  const [bdModalOpen,setBdModalOpen] = useState(false);
  const [bdEditId,setBdEditId] = useState(null); // null = adding, else = id being edited
  const [bdForm,setBdForm] = useState(BD_BLANK);
  const [bdFormError,setBdFormError] = useState("");
  const [bdPanel,setBdPanel] = useState(null); // the record currently open in the full panel, or null
  const bdGridRef = useRef(null);
  const bdPanelRef = useRef(null);
  const bdModalRef = useRef(null);

  // Company Credentials — separate table, own state, no fixed schema
  // (customFields carries whatever's unique to each record).
  const [credentials,setCredentials] = useState([]);
  const [credLoaded,setCredLoaded] = useState(false);
  const [credLoadError,setCredLoadError] = useState("");
  const [credSearch,setCredSearch] = useState("");
  const [credModalOpen,setCredModalOpen] = useState(false);
  const [credEditId,setCredEditId] = useState(null); // null = adding, else = id being edited
  const [credForm,setCredForm] = useState(CRED_BLANK);
  const [credFormError,setCredFormError] = useState("");
  const [credPanel,setCredPanel] = useState(null); // the record currently open in the full panel, or null
  const credGridRef = useRef(null);
  const credPanelRef = useRef(null);
  const credModalRef = useRef(null);

  // Payment Gateway Details — separate table, own state, same shape as
  // Company Credentials (fixed common fields + customFields for anything extra).
  const [paymentGateways,setPaymentGateways] = useState([]);
  const [pgLoaded,setPgLoaded] = useState(false);
  const [pgLoadError,setPgLoadError] = useState("");
  const [pgSearch,setPgSearch] = useState("");
  const [pgModalOpen,setPgModalOpen] = useState(false);
  const [pgEditId,setPgEditId] = useState(null); // null = adding, else = id being edited
  const [pgForm,setPgForm] = useState(PG_BLANK);
  const [pgFormError,setPgFormError] = useState("");
  const [pgPanel,setPgPanel] = useState(null); // the record currently open in the full panel, or null
  const pgGridRef = useRef(null);
  const pgPanelRef = useRef(null);
  const pgModalRef = useRef(null);

  // Game Kiosk Details — separate table, own state, same shape as Payment
  // Gateway Details. No canAccess flag: every role gets this page, so there's
  // nothing to gate on (matches how Members/Search/Transactions have none either).
  const [kioskDetails,setKioskDetails] = useState([]);
  const [kioskLoaded,setKioskLoaded] = useState(false);
  const [kioskLoadError,setKioskLoadError] = useState("");
  const [kioskSearch,setKioskSearch] = useState("");
  const [kioskModalOpen,setKioskModalOpen] = useState(false);
  const [kioskEditId,setKioskEditId] = useState(null); // null = adding, else = id being edited
  const [kioskForm,setKioskForm] = useState(KIOSK_BLANK);
  const [kioskFormError,setKioskFormError] = useState("");
  const [kioskPanel,setKioskPanel] = useState(null); // the record currently open in the full panel, or null
  const kioskGridRef = useRef(null);
  const kioskPanelRef = useRef(null);
  const kioskModalRef = useRef(null);

  // Blacklist Member — the SHARED list (migration-027). Unlike every other page
  // here, these rows don't belong to this company: they're pooled across every
  // company in the same country, and RLS decides what comes back. Append-only,
  // so there's no edit id / no panel state — just the list, a search, a sort and
  // an add form.
  const [blacklist,setBlacklist] = useState([]);
  const [blLoaded,setBlLoaded] = useState(false);
  const [blLoadError,setBlLoadError] = useState("");
  const [blSearch,setBlSearch] = useState("");
  const [blSort,setBlSort] = useState("newest");
  // Paged like the Members directory. Without this the page rendered all 3,400+
  // rows at once — thousands of DOM cells for a list nobody reads end to end.
  const [blPage,setBlPage] = useState(1);
  const [blPageSize,setBlPageSize] = useState(50);
  // Any change to what's being listed sends you back to page 1 — staying on
  // page 40 of a search that now has 3 results just shows an empty table.
  useEffect(()=>{ setBlPage(1); },[blPageSize,blSearch,blSort]);
  const [blModalOpen,setBlModalOpen] = useState(false);
  const [blForm,setBlForm] = useState(BL_BLANK);
  const [blFormError,setBlFormError] = useState("");
  const [blSaving,setBlSaving] = useState(false);
  const blGridRef = useRef(null);
  const blModalRef = useRef(null);

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
  const [showMobileMore,setShowMobileMore] = useState(false); // mobile bottom-bar "More" sheet (overflow nav items)
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
  const lastMetaRef = useRef(null); // last seen server updated_at — the poller checks this (cheap) before downloading the full blob
  const dataRef = useRef({transactions:[],banks:[],members:[],nextId:1}); // always-current state, so the poller can merge without restarting its timer

  const [search,setSearch] = useState({term:"",dateFrom:"",dateTo:"",type:"",bank:"",member:""});

  // Apply a stored data blob to state (with the one-time opening-balance migration).
  const applyData = (d) => {
    // Dedupe on load: never hold (and therefore never send back) duplicate-keyed rows,
    // which is what the server merge would multiply. See migration-012 for the root fix.
    if(d.transactions) setTransactions(dedupeByKey(d.transactions, txKey));
    if(d.banks) setBanks(dedupeByKey(d.banks, idKey).map(b=>{
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
    if(d.members) setMembers(dedupeByKey(d.members, idKey));
    if(d.offDays) setOffDays(dedupeByKey(d.offDays, txKey));
    if(d.nextId) setNextId(d.nextId);
  };

  useEffect(()=>{
    (async()=>{
      const key = `fintrack-${SESSION.companyId}-v2`;
      try{
        const r = await window.storage.get(key);
        if(r&&r.value){ applyData(JSON.parse(r.value)); lastSyncRef.current = sortedStringify(JSON.parse(r.value)); lastMetaRef.current = r.updatedAt || null; }
        try{ await window.storage.delete("fintrack-data"); }catch(e){}
      }catch(e){ /* first run, no saved data */ }
      setLoaded(true);
    })();
  },[]);

  // Keep a ref to the latest state so the poller below can MERGE against it without
  // having to restart its timer every time something changes.
  useEffect(()=>{ dataRef.current = {transactions,banks,members,nextId,offDays}; });

  // Save. The storage bridge MERGES our changes into the shared company record (the DB
  // does it atomically when migration-008 is installed, else the bridge merges client-
  // side), so we send our local data and adopt the authoritative merged result it
  // returns. No pre-read here — that saved an entire extra blob download on every save.
  useEffect(()=>{
    if(!loaded) return;
    const payload = {transactions,banks,members,nextId,offDays};
    const serialized = JSON.stringify(payload); // what we send to the server
    const sig = sortedStringify(payload);       // order-independent "has anything changed?" key
    if(sig === lastSyncRef.current) return; // nothing semantically new (incl. data we just pulled in)
    let cancelled = false;
    (async()=>{
      try{
        const key = `fintrack-${SESSION.companyId}-v2`;
        const res = await window.storage.set(key,serialized);
        if(cancelled) return;
        if(!res){ window.showToast?.("Couldn't save — you may be in a read-only view, or check your connection.","error"); return; }
        const serverObj = JSON.parse((res && res.value) ? res.value : serialized);
        // If the server's merge doesn't know about offDays yet (migration-009 not applied),
        // keep our local copy so they aren't lost AND the change-check settles instead of
        // looping (the old function would echo back a blob with no offDays forever).
        if(serverObj && serverObj.offDays === undefined) serverObj.offDays = payload.offDays;
        const finalSig = sortedStringify(serverObj);
        lastSyncRef.current = finalSig;
        // Only adopt the server's copy when it's GENUINELY different (another device merged
        // something in) — not when it's the same data with JSONB's keys reordered. This is the
        // check that stops the runaway save -> merge -> apply -> save loop.
        if(finalSig !== sig) applyData(serverObj);
        // The write bumped the server's updated_at; let the next poll reconcile it (cheap).
      }catch(e){ /* save failed — will retry on the next change or poll */ }
    })();
    return ()=>{ cancelled = true; };
  },[transactions,banks,members,nextId,offDays,loaded]);

  // Auto-refresh — pull other devices' changes WITHOUT wasting egress. Every 20s (only
  // while the tab is visible) we check the tiny server `updated_at` via getMeta(); we
  // download the full data blob ONLY when it actually changed, then MERGE it into local
  // (so a refresh never drops an entry we just made). Also fires the moment the app
  // regains focus, so returning to it shows the latest right away.
  useEffect(()=>{
    if(!loaded) return;
    const key = `fintrack-${SESSION.companyId}-v2`;
    let busy = false;
    const syncIfChanged = async()=>{
      if(busy) return;
      if(typeof document!=="undefined" && document.visibilityState==="hidden") return;
      busy = true;
      try{
        const meta = window.storage.getMeta ? await window.storage.getMeta(key) : null;
        const stamp = meta && meta.updatedAt;
        if(stamp && stamp !== lastMetaRef.current){
          const r = await window.storage.get(key);
          if(r && r.value){
            const merged = mergeData(JSON.parse(r.value), dataRef.current);
            applyData(merged);
            lastSyncRef.current = sortedStringify(merged);
            lastMetaRef.current = r.updatedAt || stamp;
          }
        }
      }catch(e){ /* offline / transient */ }
      finally{ busy = false; }
    };
    const id = setInterval(syncIfChanged, 20000);
    const onVis = ()=>{ if(typeof document!=="undefined" && document.visibilityState==="visible") syncIfChanged(); };
    if(typeof document!=="undefined") document.addEventListener("visibilitychange", onVis);
    return ()=>{ clearInterval(id); if(typeof document!=="undefined") document.removeEventListener("visibilitychange", onVis); };
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
      other:f("Other"),bankBlocked:f("Bank Block"),buySellAud:f("Buy/Sell AUD"),
      newMembers:active.filter(t=>t.isNew),sum,active
    };
  };

  // Ordered by priority (active first, latest-activated on top). This single order
  // drives the Bank Accounts cards, the dashboard per-bank list, and the totals.
  const banksLive = useMemo(()=>orderBanks(banks.filter(b=>!b.deleted).map(b=>{
    // Today's entry counts for this bank: deposits in, withdrawals out, transfers
    // (counted on both the source (Transfer Out) and destination (Transfer In) bank), and store
    // entries (whose bank-side leg is tagged fundLeg — money taken from the bank into the store).
    let depToday=0, wdToday=0, tfToday=0, stToday=0;
    for(const t of transactions){
      if(t.deleted||t.date!==today) continue;
      if(t.type==="Store"){ if(t.fundLeg && txInBank(t,b)) stToday++; continue; }
      // "Actual paid" bank leg is a fundLeg (so it doesn't double-count in totals) but it
      // IS a real withdrawal from this bank — count it in the bank's daily withdrawals.
      if((t.actualPaid||t.storeAndPaid) && t.fundLeg){ if(t.type==="Regular Withdrawal" && txInBank(t,b)) wdToday++; continue; }
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
  // Bank Accounts page "balances as of": the closing date the totals + cards reflect.
  const bankAsOf = bankAsOfSel || today;          // "" → today (live)
  const bankIsPast = bankAsOf < today;             // a genuine past close (else = current balance)
  // Each bank's closing balance as of that date (skips the recompute when it's just today).
  const banksAsOf = useMemo(()=> bankIsPast
    ? banksLive.map(b=>({...b, asOfBalance: ftBankBalanceAsOf(b, transactions, bankAsOf)}))
    : banksLive.map(b=>({...b, asOfBalance: b.balance})),
  [banksLive,transactions,bankAsOf,bankIsPast]);
  // Bank Accounts page: filter the cards by holder name / bank name / account no. / PayID.
  const banksShown = useMemo(()=>{
    const q = bankSearch.trim().toLowerCase();
    if(!q) return banksAsOf;
    return banksAsOf.filter(b=>[b.holder,b.name,b.account,b.payid].some(v=>String(v||"").toLowerCase().includes(q)));
  },[banksAsOf,bankSearch]);

  // Newest first. (Sorting matters now that saves merge data — merged entries can land
  // anywhere in the underlying array, so we can't rely on insertion order here.)
  const todayTx = transactions.filter(t=>t.date===today).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
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
  // Running store-credit balance (what a "Store withdraw" draws on).
  const storeCredit = useMemo(()=>storeAllTime.reduce((s,t)=>s+(t.amount||0),0),[storeAllTime]);
  // Running Buy/Sell AUD balance (what a "Buy AUD" withdrawal draws on). Entry-type
  // legs add to it; the Buy AUD tick-box draws it down (negative bucket legs).
  const buySellAudBalance = useMemo(()=>transactions.filter(t=>!t.deleted&&t.type==="Buy/Sell AUD"&&!t.fundLeg).reduce((s,t)=>s+(t.amount||0),0),[transactions]);
  // Store total as of the end of yesterday (date <= yesterday) — the "yesterday close".
  const storeYesterday = useMemo(()=>transactions.filter(t=>!t.deleted&&t.type==="Store"&&!t.fundLeg&&t.date<=yesterday).reduce((s,t)=>s+(t.amount||0),0),[transactions,yesterday]);
  // Running store balance as of the END of a given day (date <= d). Mirrors storeYesterday.
  const storeBalanceAsOf = (d)=> storeAllTime.filter(t=>!d||t.date<=d).reduce((s,t)=>s+(t.amount||0),0);
  // The "as of" day for the current dashboard scope — the date whose CLOSING store
  // balance a stat popup shows (the end of the selected period). A past month uses its
  // last day; the current/future month and the live views use today.
  const scopeAsOf = useMemo(()=>{
    if(dashView==="yesterday") return yesterday;
    if(dashView==="range") return rangeTo||today;
    if(dashView==="month"){ const end=`${selMonth}-31`; return end<today?end:today; }
    return today; // today / week
  },[dashView,selMonth,rangeTo,today,yesterday]);

  const monthlyComparison = useMemo(()=>{
    const months = availableMonths.slice(0,6).reverse();
    return months.map(ym=>{
      const list = transactions.filter(t=>t.date.slice(0,7)===ym&&!t.deleted);
      const dep = list.filter(t=>["Regular Deposit","Unclaimed Credit"].includes(t.type)).reduce((a,b)=>a+b.amount,0);
      const wd = list.filter(t=>["Regular Withdrawal","Rental","Store","Mistake"].includes(t.type)).reduce((a,b)=>a+b.amount,0);
      return {ym,label:`${MONTHS_SHORT[Number(ym.slice(5,7))-1]} ${ym.slice(2,4)}`,dep,wd};
    });
  },[transactions,availableMonths]);

  const filteredTx = useMemo(()=>{
    const selBank = banks.find(bk=>String(bk.id)===String(search.bank)); // search.bank holds a bank id
    const term = (search.term||"").toLowerCase();
    // If the keyword is a number (commas/spaces allowed, e.g. "1,500"), match the
    // amount EXACTLY — compared on magnitude, since amounts show by size and the sign
    // comes from the entry type. A non-numeric keyword leaves amtQuery null (text only).
    const numTerm = term.replace(/[,\s]/g,"");
    const amtQuery = numTerm!=="" && !isNaN(Number(numTerm)) ? Math.abs(Number(numTerm)) : null;
    return transactions.filter(t=>{
      // Keyword matches name / ID / bank / notes (text, substring) OR the exact amount.
      const matchTerm = !term || [t.memberId,t.memberName,t.bank,t.notes].some(v=>String(v||"").toLowerCase().includes(term)) || (amtQuery!==null && Math.abs(Number(t.amount)||0)===amtQuery);
      const matchFrom = !search.dateFrom||t.date>=search.dateFrom;
      const matchTo = !search.dateTo||t.date<=search.dateTo;
      const matchType = !search.type||t.type===search.type;
      const matchBank = !search.bank||(selBank?txInBank(t,selBank):false);
      const matchMember = !search.member||(t.memberId===search.member||t.memberName===search.member);
      return matchTerm&&matchFrom&&matchTo&&matchType&&matchBank&&matchMember;
    }).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  },[transactions,search,banks]);
  // Money in/out + store balance for whatever the Search filters currently show.
  // "As of" the To date (or From, or today) drives the store closing balance.
  const searchSummary = useMemo(()=>{
    const asOf = search.dateTo||search.dateFrom||today;
    // Same rule as the stat popups: if the range ends today, today's close = current
    // (pointless), so show yesterday's close; a past end-date shows its own close.
    const closeDate = asOf >= today ? yesterday : asOf;
    return {...ftCreditDebit(filteredTx), current:storeCredit, closing:storeBalanceAsOf(closeDate),
      closingLabel: closeDate===yesterday ? "Yesterday's closing" : `Store closing · ${fmtDate(closeDate)}`, asOf};
  },[filteredTx,storeCredit,storeAllTime,search.dateTo,search.dateFrom,today,yesterday]);

  const closeEntryModal = () => { setForm({type:"Regular Deposit",amount:"",memberId:"",memberName:"",memberPhone:"",bankId:activeBanks[0]?.id??null,notes:"",toBankId:null,date:"",fromUnclaimed:false,redeposit:false,claimDate:"",receipt:"",storeWithdraw:false,storeWithdrawAmount:"",actualPaid:false,actualPaidAmount:"",storeAndPaid:false,depositExtra:false,rate:"",buyAud:false,buyAudAmount:""}); setFormError(""); setNameSuggestions([]); setIdSuggestions([]); setPhoneSuggestions([]); setShowEntryModal(false); };
  // Open the entry form pre-set to a given type (shared by the type tiles + "More" drawer).
  const openEntryType = (t) => { setForm({type:t,amount:"",memberId:"",memberName:"",memberPhone:"",bankId:(t==="Bank Block"||t==="Buy/Sell AUD")?null:(activeBanks[0]?.id??null),notes:"",toBankId:null,date:"",fromUnclaimed:false,redeposit:false,claimDate:"",receipt:"",storeWithdraw:false,storeWithdrawAmount:"",actualPaid:false,actualPaidAmount:"",storeAndPaid:false,depositExtra:false,rate:"",buyAud:false,buyAudAmount:""}); setFormError(""); setNameSuggestions([]); setIdSuggestions([]); setPhoneSuggestions([]); setShowMoreTypes(false); setShowEntryModal(true); };
  const closeBankModal = () => { setNewBank({name:"",holder:"",bsb:"",account:"",payid:"",otpLink:"",balance:""}); setBankError(""); setShowBankModal(false); };
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
        // Same operator/date/time stamping convention as a transaction's own creation
        // (SESSION.operatorId + dateInTz/timeInTz) — recorded so the deleted-log audit
        // trail shows WHO deleted an entry and WHEN, not just that it's gone.
        const deletedBy = SESSION.operatorId;
        const deletedDate = dateInTz(tz);
        const deletedTime = timeInTz(tz);
        setTransactions(prev=>prev.map(t=>{
          if(sameRow(t,key)) return {...t,deleted:true,deletedBy,deletedDate,deletedTime};
          if(isPair && t.pairId===target.pairId) return {...t,deleted:true,deletedBy,deletedDate,deletedTime};
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
    const blank = {type:"Regular Deposit",amount:"",memberId:"",memberName:"",memberPhone:"",bankId:activeBanks[0]?.id??null,notes:"",toBankId:null,date:"",fromUnclaimed:false,redeposit:false,claimDate:"",receipt:"",storeWithdraw:false,storeWithdrawAmount:"",actualPaid:false,actualPaidAmount:"",storeAndPaid:false,depositExtra:false,rate:"",buyAud:false,buyAudAmount:""};
    // Entry saved OK — close the form, reset it, and pop the success toast.
    const done = ()=>{ setShowEntryModal(false); setForm(blank); window.showToast?.("Action Done !","success"); };

    // ---- Transfer: make a leg for whichever bank(s) are chosen ----
    if(form.type==="Transfer"){
      if(!srcBank && !destBank){setFormError("Pick a source and/or destination bank.");window.showToast?.("Error , Please Try Again","error");return;}
      const pairId = `TR-${nextId}`;
      const rows = []; let idc = nextId;
      if(srcBank) rows.push({id:idc++,date:txDate,time,type:"Transfer Out",amount:amt,memberId:"",memberName:ref||(destBank?`Transfer to ${destBank.name}`:"Transfer out"),bank:srcBank.name,bankId:srcBank.id,bankHolder:srcBank.holder||"",counterparty:destBank?destBank.name:"",counterpartyHolder:destBank?(destBank.holder||""):"",pairId,notes:form.notes||(destBank?`To ${destBank.holder||destBank.name}`:""),receipt:rcpt,uid:mkUid(),operator:op,isNew:false,deleted:false});
      if(destBank) rows.push({id:idc++,date:txDate,time,type:"Transfer In",amount:amt,memberId:"",memberName:ref||(srcBank?`Transfer from ${srcBank.name}`:"Transfer in"),bank:destBank.name,bankId:destBank.id,bankHolder:destBank.holder||"",counterparty:srcBank?srcBank.name:"",counterpartyHolder:srcBank?(srcBank.holder||""):"",pairId,notes:form.notes||(srcBank?`From ${srcBank.holder||srcBank.name}`:""),receipt:rcpt,uid:mkUid(),operator:op,isNew:false,deleted:false});
      setTransactions(prev=>[...rows.reverse(),...prev]);
      setNextId(idc);
      done();
      return;
    }

    // ---- Bank Block: clear a frozen bank's balance. DEBITS the chosen bank by the
    // amount (a fundLeg, so the bank total drops) and adds the same amount to the
    // "Bank Blocked" card (a bucket leg). Touches NO deposit/withdrawal/store totals.
    // Two linked legs. ----
    if(form.type==="Bank Block"){
      if(!srcBank){ setFormError("Pick the bank to clear."); window.showToast?.("Error , Please Try Again","error"); return; }
      const pairId = `BB-${nextId}`;
      const common = {memberId:"",memberName:ref||(srcBank.holder||"Bank Block"),notes:form.notes,receipt:rcpt,operator:op,pairId,isNew:false,deleted:false};
      const bankLeg   = {id:nextId,  date:txDate,time,type:"Bank Block",amount:-amt,bank:srcBank.name,bankId:srcBank.id,bankHolder:srcBank.holder||"",uid:mkUid(),fundLeg:true,...common};
      const bucketLeg = {id:nextId+1,date:txDate,time,type:"Bank Block",amount:amt, bank:"Bank Block",bankId:null,bankHolder:"",uid:mkUid(),bucketLeg:true,...common};
      setTransactions(prev=>[bucketLeg,bankLeg,...prev]);
      setNextId(n=>n+2);
      done();
      return;
    }

    // ---- Mistake flagged "Deposit Extra": a mistaken extra deposit. It COUNTS as a
    // deposit (+amount to Total deposits) AND is logged as a Mistake (+amount to the
    // Mistake card). Two linked, bank-less legs. ----
    if(form.type==="Mistake" && form.depositExtra){
      const pairId = `DX-${nextId}`;
      const common = {memberId:"",memberName:ref||"Deposit Extra",bank:"",bankId:null,bankHolder:"",notes:form.notes,receipt:rcpt,operator:op,pairId,depositExtra:true,isNew:false,deleted:false};
      const rows = [
        {id:nextId,   date:txDate,time,type:"Regular Deposit",amount:amt, uid:mkUid(),...common},
        {id:nextId+1, date:txDate,time,type:"Mistake",         amount:amt, uid:mkUid(),bucketLeg:true,...common},
      ];
      setTransactions(prev=>[...rows,...prev]);
      setNextId(n=>n+2);
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
      if(amt > availForDate + 1e-9){ setFormError(`Not enough unclaimed credit on ${fmtDate(claimFrom)} to claim. Available that day: ${fmt(availForDate)}.`); window.showToast?.("Error , Please Try Again","error"); return; }
      const pairId = `UC-${nextId}`;
      const existingMember = members.find(m=>(form.memberId && m.id===form.memberId)||(ref && m.name.toLowerCase()===ref.toLowerCase()));
      const isNew = !existingMember && !!ref;
      const assignedId = form.memberId.trim() || `M${String(nextId).padStart(3,"0")}`;
      const depLeg = {id:nextId,date:txDate,time,type:"Regular Deposit",amount:amt,memberId:assignedId,memberName:ref,bank:"",bankId:null,bankHolder:"",notes:form.notes,receipt:rcpt,uid:mkUid(),operator:op,isNew,deleted:false,pairId,fromUnclaimed:true,claimedFromDate:claimFrom};
      const ucLeg  = {id:nextId+1,date:claimFrom,time,type:"Unclaimed Credit",amount:-amt,memberId:assignedId,memberName:ref,bank:"",bankId:null,bankHolder:"",notes:form.notes||`Claimed by deposit on ${fmtDate(txDate)}`,receipt:rcpt,uid:mkUid(),operator:op,isNew:false,deleted:false,pairId,claimLeg:true};
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
    // ---- Regular Withdrawal split across STORE credit + the BANK (the "Store + actual
    // paid" tick-box) — combines the two functions below. The headline withdrawal counts in
    // Total withdrawals (no bank); the store is reduced by the store amount, the selected
    // bank is debited by the paid amount, and whatever is left (top - store - paid) becomes
    // UNCLAIMED credit. Up to FOUR linked legs (the unclaimed leg only when there's a remainder):
    //   1) Regular Withdrawal +topAmount, NO bank            (counts in totals)
    //   2) Store              -storeAmount, bucketLeg         (reduces store credit)
    //   3) Regular Withdrawal +paidAmount, the bank, fundLeg  (debits the bank; NOT double-counted)
    //   4) Unclaimed Credit   +leftover                       (leftover = top - store - paid; only when > 0)
    if(form.type==="Regular Withdrawal" && form.storeAndPaid){
      if(!srcBank){ setFormError("Pick the bank the bank-side part is paid from."); window.showToast?.("Error , Please Try Again","error"); return; }
      const storeAmt = Number(form.storeWithdrawAmount);
      const paidAmt = Number(form.actualPaidAmount);
      if(form.storeWithdrawAmount===""||isNaN(storeAmt)||storeAmt<=0){ setFormError("Enter the amount to deduct from store credit."); window.showToast?.("Error , Please Try Again","error"); return; }
      if(form.actualPaidAmount===""||isNaN(paidAmt)||paidAmt<=0){ setFormError("Enter the amount paid from the bank."); window.showToast?.("Error , Please Try Again","error"); return; }
      if(storeAmt + paidAmt > amt + 1e-9){ setFormError("Store + bank amounts can't be more than the withdrawal amount above."); window.showToast?.("Error , Please Try Again","error"); return; }
      const leftover = Math.round((amt - storeAmt - paidAmt)*100)/100;   // remainder becomes unclaimed credit
      const pairId = `SP-${nextId}`;
      const existingMember = members.find(m=>(form.memberId && m.id===form.memberId)||(ref && m.name.toLowerCase()===ref.toLowerCase()));
      const assignedId = form.memberId.trim() || (existingMember?existingMember.id:`M${String(nextId).padStart(3,"0")}`);
      const common = {memberId:assignedId,memberName:ref,notes:form.notes,receipt:rcpt,operator:op,pairId,storeAndPaid:true,isNew:false,deleted:false};
      const rows = [
        {id:nextId,   date:txDate,time,type:"Regular Withdrawal",amount:amt,      bank:"",bankId:null,bankHolder:"",uid:mkUid(),...common},
        {id:nextId+1, date:txDate,time,type:"Store",             amount:-storeAmt, bank:"",bankId:null,bankHolder:"",bucketLeg:true,uid:mkUid(),...common},
        {id:nextId+2, date:txDate,time,type:"Regular Withdrawal",amount:paidAmt,   bank:srcBank.name,bankId:srcBank.id,bankHolder:srcBank.holder||"",fundLeg:true,uid:mkUid(),...common},
      ];
      let n = nextId+3;
      if(leftover > 1e-9){ rows.push({id:n,date:txDate,time,type:"Unclaimed Credit",amount:leftover,bank:"",bankId:null,bankHolder:"",uid:mkUid(),...common}); n++; }
      setTransactions(prev=>[...rows,...prev]);
      setNextId(n);
      if(existingMember){ setMembers(prev=>prev.map(m=>m.id===existingMember.id?{...m,lastActivity:txDate}:m)); }
      done();
      return;
    }

    // ---- Regular Withdrawal with "Actual paid amount" (the tick-box): the headline
    // withdrawal counts in Total withdrawals (no bank), but the SELECTED BANK is debited
    // only by the amount actually paid, and any leftover (withdrawal - paid) becomes
    // UNCLAIMED credit. THREE linked legs:
    //   1) Regular Withdrawal +topAmount, NO bank            (counts in totals; shows -top, no bank)
    //   2) Regular Withdrawal +paidAmount, the bank, fundLeg (debits the bank; NOT double-counted in totals)
    //   3) Unclaimed Credit   +leftover                      (leftover = top - paid; only when > 0)
    if(form.type==="Regular Withdrawal" && form.actualPaid){
      if(!srcBank){ setFormError("Pick the bank the money was actually paid from."); window.showToast?.("Error , Please Try Again","error"); return; }
      const paidAmt = Number(form.actualPaidAmount);
      if(form.actualPaidAmount===""||isNaN(paidAmt)||paidAmt<=0){ setFormError("Enter the amount actually paid from the bank."); window.showToast?.("Error , Please Try Again","error"); return; }
      if(paidAmt > amt + 1e-9){ setFormError("The actual paid amount can't be more than the withdrawal amount above."); window.showToast?.("Error , Please Try Again","error"); return; }
      const leftover = Math.round((amt - paidAmt)*100)/100;   // any remainder becomes unclaimed credit
      const pairId = `AP-${nextId}`;
      const existingMember = members.find(m=>(form.memberId && m.id===form.memberId)||(ref && m.name.toLowerCase()===ref.toLowerCase()));
      const assignedId = form.memberId.trim() || (existingMember?existingMember.id:`M${String(nextId).padStart(3,"0")}`);
      const common = {memberId:assignedId,memberName:ref,notes:form.notes,receipt:rcpt,operator:op,pairId,actualPaid:true,isNew:false,deleted:false};
      const rows = [
        {id:nextId,   date:txDate,time,type:"Regular Withdrawal",amount:amt,     bank:"",bankId:null,bankHolder:"",uid:mkUid(),...common},
        {id:nextId+1, date:txDate,time,type:"Regular Withdrawal",amount:paidAmt, bank:srcBank.name,bankId:srcBank.id,bankHolder:srcBank.holder||"",fundLeg:true,uid:mkUid(),...common},
      ];
      let n = nextId+2;
      if(leftover > 1e-9){ rows.push({id:n,date:txDate,time,type:"Unclaimed Credit",amount:leftover,bank:"",bankId:null,bankHolder:"",uid:mkUid(),...common}); n++; }
      setTransactions(prev=>[...rows,...prev]);
      setNextId(n);
      if(existingMember){ setMembers(prev=>prev.map(m=>m.id===existingMember.id?{...m,lastActivity:txDate}:m)); }
      done();
      return;
    }

    // ---- Regular Withdrawal funded by STORE credit (the "Store withdraw" tick-box):
    // the withdrawal still counts in Total withdrawals, but instead of moving a bank
    // balance it draws from STORE credit and pushes any leftover into UNCLAIMED credit.
    // No bank is touched even if one is selected. THREE linked, bank-less legs:
    //   1) Regular Withdrawal  +topAmount   (counts as a withdrawal; shows -topAmount)
    //   2) Store               -storeAmount  (reduces store credit; shows -storeAmount)
    //   3) Unclaimed Credit    +leftover     (leftover = top - store; only when > 0)
    if(form.type==="Regular Withdrawal" && form.storeWithdraw){
      const storeAmt = Number(form.storeWithdrawAmount);
      if(form.storeWithdrawAmount===""||isNaN(storeAmt)||storeAmt<=0){ setFormError("Enter the store-credit amount to use."); window.showToast?.("Error , Please Try Again","error"); return; }
      if(storeAmt > amt + 1e-9){ setFormError("The store amount can't be more than the withdrawal amount above."); window.showToast?.("Error , Please Try Again","error"); return; }
      // NOTE: deliberately NO "not enough store credit" guard — store credit is allowed
      // to go negative (the user wants to record it even when it overdraws the store).
      const leftover = Math.round((amt - storeAmt)*100)/100;   // any remainder becomes unclaimed credit
      const pairId = `SW-${nextId}`;
      const existingMember = members.find(m=>(form.memberId && m.id===form.memberId)||(ref && m.name.toLowerCase()===ref.toLowerCase()));
      const assignedId = form.memberId.trim() || (existingMember?existingMember.id:`M${String(nextId).padStart(3,"0")}`);
      const common = {memberId:assignedId,memberName:ref,bank:"",bankId:null,bankHolder:"",notes:form.notes,receipt:rcpt,operator:op,pairId,storeWithdraw:true,isNew:false,deleted:false};
      const rows = [
        {id:nextId,   date:txDate,time,type:"Regular Withdrawal",amount:amt,      uid:mkUid(),...common},
        {id:nextId+1, date:txDate,time,type:"Store",             amount:-storeAmt, uid:mkUid(),bucketLeg:true,...common},
      ];
      let n = nextId+2;
      if(leftover > 1e-9){ rows.push({id:n,date:txDate,time,type:"Unclaimed Credit",amount:leftover,uid:mkUid(),...common}); n++; }
      setTransactions(prev=>[...rows,...prev]);
      setNextId(n);
      if(existingMember){ setMembers(prev=>prev.map(m=>m.id===existingMember.id?{...m,lastActivity:txDate}:m)); }
      done();
      return;
    }

    // ---- Regular Withdrawal with "Buy AUD" (the tick-box): mirrors "Store withdraw"
    // but draws from the Buy/Sell AUD balance instead of store credit. The withdrawal
    // still counts in Total withdrawals; the Buy AUD amount is deducted from Buy/Sell AUD
    // and any leftover (top - buyAud) becomes UNCLAIMED credit. No bank touched. THREE
    // linked, bank-less legs:
    //   1) Regular Withdrawal +topAmount   (counts as a withdrawal; shows -topAmount)
    //   2) Buy/Sell AUD        -buyAudAmount (reduces the Buy/Sell AUD balance)
    //   3) Unclaimed Credit    +leftover     (leftover = top - buyAud; only when > 0)
    if(form.type==="Regular Withdrawal" && form.buyAud){
      const buyAmt = Number(form.buyAudAmount);
      if(form.buyAudAmount===""||isNaN(buyAmt)||buyAmt<=0){ setFormError("Enter the Buy AUD amount to use."); window.showToast?.("Error , Please Try Again","error"); return; }
      if(buyAmt > amt + 1e-9){ setFormError("The Buy AUD amount can't be more than the withdrawal amount above."); window.showToast?.("Error , Please Try Again","error"); return; }
      const leftover = Math.round((amt - buyAmt)*100)/100;   // any remainder becomes unclaimed credit
      const pairId = `BA-${nextId}`;
      const existingMember = members.find(m=>(form.memberId && m.id===form.memberId)||(ref && m.name.toLowerCase()===ref.toLowerCase()));
      const assignedId = form.memberId.trim() || (existingMember?existingMember.id:`M${String(nextId).padStart(3,"0")}`);
      const common = {memberId:assignedId,memberName:ref,bank:"",bankId:null,bankHolder:"",notes:form.notes,receipt:rcpt,operator:op,pairId,buyAud:true,isNew:false,deleted:false};
      const rows = [
        {id:nextId,   date:txDate,time,type:"Regular Withdrawal",amount:amt,     uid:mkUid(),...common},
        {id:nextId+1, date:txDate,time,type:"Buy/Sell AUD",       amount:-buyAmt, uid:mkUid(),bucketLeg:true,...common},
      ];
      let n = nextId+2;
      if(leftover > 1e-9){ rows.push({id:n,date:txDate,time,type:"Unclaimed Credit",amount:leftover,uid:mkUid(),...common}); n++; }
      setTransactions(prev=>[...rows,...prev]);
      setNextId(n);
      if(existingMember){ setMembers(prev=>prev.map(m=>m.id===existingMember.id?{...m,lastActivity:txDate}:m)); }
      done();
      return;
    }

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

  // Load once when this session can access Bank Details — no polling (unlike
  // transactions/banks/members, this is a plain table, not a merged blob, so
  // there's no cross-device merge race to guard against here).
  useEffect(()=>{
    if(!canAccessBankDetails || !window.FINTRACK_BANK_DETAILS_API){ setBdLoaded(true); return; }
    let alive = true;
    (async()=>{
      const res = await window.FINTRACK_BANK_DETAILS_API.list();
      if(!alive) return;
      if(res.ok) setBankDetails(res.rows); else setBdLoadError(res.error);
      setBdLoaded(true);
    })();
    return ()=>{ alive = false; };
  },[canAccessBankDetails]);

  const bdShown = useMemo(()=>{
    const q = bdSearch.trim().toLowerCase();
    if(!q) return bankDetails;
    return bankDetails.filter(b=>[b.holderName,b.bankName,b.agent,b.bsb,b.account,b.payid,b.phoneNumber].some(v=>String(v||"").toLowerCase().includes(q)));
  },[bankDetails,bdSearch]);

  const openBdAdd = () => { setBdEditId(null); setBdForm(BD_BLANK); setBdFormError(""); setBdModalOpen(true); };
  const openBdEdit = bd => { setBdEditId(bd.id); setBdForm(Object.fromEntries(BD_FIELDS.map(k=>[k,bd[k]||""]))); setBdFormError(""); setBdModalOpen(true); };
  const closeBdModal = () => setBdModalOpen(false);
  // Every write handler below checks for the SPECIFIC method it needs, not just
  // for the API object: a read-only session (an owner) gets an API with `list`
  // only, so `if(!api)` alone would sail past and throw. See AppScreen.jsx.
  const handleSaveBd = async () => {
    const api = window.FINTRACK_BANK_DETAILS_API;
    if(!api?.create || !api?.update){ setBdFormError("Not authorised."); return; }
    const res = bdEditId ? await api.update(bdEditId,bdForm) : await api.create(bdForm);
    if(!res.ok){ setBdFormError(res.error); return; }
    if(bdEditId) setBankDetails(prev=>prev.map(b=>b.id===bdEditId?{...b,...bdForm}:b));
    else setBankDetails(prev=>[res.row,...prev]);
    setBdModalOpen(false);
  };
  const handleDeleteBd = (id,label) => setConfirm({message:`Delete "${label||"this record"}"? This cannot be undone.`,onConfirm: async ()=>{
    setConfirm(null);
    const api = window.FINTRACK_BANK_DETAILS_API;
    if(!api?.remove) return;
    const res = await api.remove(id);
    if(res.ok) setBankDetails(prev=>prev.filter(b=>b.id!==id));
  }});
  const handleToggleBdFrozen = async bd => {
    const api = window.FINTRACK_BANK_DETAILS_API;
    if(!api?.setFrozen) return;
    const next = !bd.frozen;
    const res = await api.setFrozen(bd.id,next);
    if(res.ok) setBankDetails(prev=>prev.map(b=>b.id===bd.id?{...b,frozen:next}:b));
  };
  // Copies the record's Name/Holder/BSB/Acc/PayID/OTP link into a brand new Bank
  // Accounts entry (opening balance $0.00) via the exact same path "+ Add bank"
  // uses, then stamps the record as added so the card can show the badge.
  // Repeatable on purpose — the button stays enabled in case a second copy is
  // genuinely wanted (e.g. the first one was deleted from Bank Accounts).
  const handleAddBdToBankAccounts = async bd => {
    const api = window.FINTRACK_BANK_DETAILS_API;
    if(!api?.markAdded) return;   // read-only session — don't touch `banks` either
    setBanks(prev=>[...prev,{id:Date.now(),name:bd.bankName,holder:bd.holderName,bsb:bd.bsb,account:bd.account,payid:bd.payid,otpLink:bd.otpLink,openingBalance:0,activatedAt:Date.now(),updatedAt:Date.now()}]);
    const res = await api.markAdded(bd.id);
    if(res.ok) setBankDetails(prev=>prev.map(b=>b.id===bd.id?{...b,addedToBankAccountsAt:new Date().toISOString()}:b));
  };

  // Company Credentials fetch — same shape as Bank Details' effect (real
  // table, not a merged blob, so no cross-device merge race to guard here).
  useEffect(()=>{
    if(!canAccessCompanyCredentials || !window.FINTRACK_COMPANY_CREDENTIALS_API){ setCredLoaded(true); return; }
    let alive = true;
    (async()=>{
      const res = await window.FINTRACK_COMPANY_CREDENTIALS_API.list();
      if(!alive) return;
      if(res.ok) setCredentials(res.rows); else setCredLoadError(res.error);
      setCredLoaded(true);
    })();
    return ()=>{ alive = false; };
  },[canAccessCompanyCredentials]);

  const credShown = useMemo(()=>{
    const q = credSearch.trim().toLowerCase();
    if(!q) return credentials;
    return credentials.filter(c=>[c.name,c.category,c.username,c.email,c.link,...c.customFields.map(f=>f.label)].some(v=>String(v||"").toLowerCase().includes(q)));
  },[credentials,credSearch]);

  const openCredAdd = () => { setCredEditId(null); setCredForm(CRED_BLANK); setCredFormError(""); setCredModalOpen(true); };
  const openCredEdit = cred => { setCredEditId(cred.id); setCredForm({name:cred.name,category:cred.category,username:cred.username,email:cred.email,password:cred.password,link:cred.link,customFields:cred.customFields.map(f=>({...f}))}); setCredFormError(""); setCredModalOpen(true); };
  const closeCredModal = () => setCredModalOpen(false);
  const handleSaveCred = async () => {
    if(!credForm.name.trim()){ setCredFormError("Record name is required."); return; }
    const api = window.FINTRACK_COMPANY_CREDENTIALS_API;
    if(!api?.create || !api?.update){ setCredFormError("Not authorised."); return; }
    const cleanFields = credForm.customFields.filter(f=>f.label.trim()||f.value.trim());
    const payload = {...credForm, name: credForm.name.trim(), customFields:cleanFields};
    const res = credEditId ? await api.update(credEditId,payload) : await api.create(payload);
    if(!res.ok){ setCredFormError(res.error); return; }
    if(credEditId) setCredentials(prev=>prev.map(c=>c.id===credEditId?{...c,...payload}:c));
    else setCredentials(prev=>[res.row,...prev]);
    setCredModalOpen(false);
  };
  const handleDeleteCred = (id,label) => setConfirm({message:`Delete "${label||"this record"}"? This cannot be undone.`,onConfirm: async ()=>{
    setConfirm(null);
    const api = window.FINTRACK_COMPANY_CREDENTIALS_API;
    if(!api?.remove) return;
    const res = await api.remove(id);
    if(res.ok) setCredentials(prev=>prev.filter(c=>c.id!==id));
  }});

  // Custom-field row helpers for the Add/Edit form. Defaults to sensitive=true
  // (safer default — assume a hand-typed extra field is a secret unless told
  // otherwise) and drops fully-blank rows on save (Step above, handleSaveCred).
  const addCredCustomField = () => setCredForm(f=>({...f,customFields:[...f.customFields,{label:"",value:"",sensitive:true}]}));
  const updateCredCustomField = (i,patch) => setCredForm(f=>({...f,customFields:f.customFields.map((row,idx)=>idx===i?{...row,...patch}:row)}));
  const removeCredCustomField = i => setCredForm(f=>({...f,customFields:f.customFields.filter((_,idx)=>idx!==i)}));

  // Payment Gateway Details fetch — same shape as Company Credentials' effect.
  useEffect(()=>{
    if(!canAccessPaymentGateways || !window.FINTRACK_PAYMENT_GATEWAYS_API){ setPgLoaded(true); return; }
    let alive = true;
    (async()=>{
      const res = await window.FINTRACK_PAYMENT_GATEWAYS_API.list();
      if(!alive) return;
      if(res.ok) setPaymentGateways(res.rows); else setPgLoadError(res.error);
      setPgLoaded(true);
    })();
    return ()=>{ alive = false; };
  },[canAccessPaymentGateways]);

  const pgShown = useMemo(()=>{
    const q = pgSearch.trim().toLowerCase();
    if(!q) return paymentGateways;
    return paymentGateways.filter(p=>[p.name,p.loginId,p.merchantCode,p.backendLink,...p.customFields.map(f=>f.label)].some(v=>String(v||"").toLowerCase().includes(q)));
  },[paymentGateways,pgSearch]);

  const openPgAdd = () => { setPgEditId(null); setPgForm(PG_BLANK); setPgFormError(""); setPgModalOpen(true); };
  const openPgEdit = pg => { setPgEditId(pg.id); setPgForm({name:pg.name,backendLink:pg.backendLink,loginId:pg.loginId,password:pg.password,apiKey:pg.apiKey,merchantKey:pg.merchantKey,merchantCode:pg.merchantCode,customFields:pg.customFields.map(f=>({...f}))}); setPgFormError(""); setPgModalOpen(true); };
  const closePgModal = () => setPgModalOpen(false);
  const handleSavePg = async () => {
    if(!pgForm.name.trim()){ setPgFormError("Record name is required."); return; }
    const api = window.FINTRACK_PAYMENT_GATEWAYS_API;
    if(!api?.create || !api?.update){ setPgFormError("Not authorised."); return; }
    const cleanFields = pgForm.customFields.filter(f=>f.label.trim()||f.value.trim());
    const payload = {...pgForm, name: pgForm.name.trim(), customFields:cleanFields};
    const res = pgEditId ? await api.update(pgEditId,payload) : await api.create(payload);
    if(!res.ok){ setPgFormError(res.error); return; }
    if(pgEditId) setPaymentGateways(prev=>prev.map(p=>p.id===pgEditId?{...p,...payload}:p));
    else setPaymentGateways(prev=>[res.row,...prev]);
    setPgModalOpen(false);
  };
  const handleDeletePg = (id,label) => setConfirm({message:`Delete "${label||"this record"}"? This cannot be undone.`,onConfirm: async ()=>{
    setConfirm(null);
    const api = window.FINTRACK_PAYMENT_GATEWAYS_API;
    if(!api?.remove) return;
    const res = await api.remove(id);
    if(res.ok) setPaymentGateways(prev=>prev.filter(p=>p.id!==id));
  }});

  const addPgCustomField = () => setPgForm(f=>({...f,customFields:[...f.customFields,{label:"",value:"",sensitive:true}]}));
  const updatePgCustomField = (i,patch) => setPgForm(f=>({...f,customFields:f.customFields.map((row,idx)=>idx===i?{...row,...patch}:row)}));
  const removePgCustomField = i => setPgForm(f=>({...f,customFields:f.customFields.filter((_,idx)=>idx!==i)}));

  // Game Kiosk Details fetch — same shape as Payment Gateway Details' effect,
  // but with no role check: the API is always present for every session.
  useEffect(()=>{
    if(!window.FINTRACK_KIOSK_DETAILS_API){ setKioskLoaded(true); return; }
    let alive = true;
    (async()=>{
      const res = await window.FINTRACK_KIOSK_DETAILS_API.list();
      if(!alive) return;
      if(res.ok) setKioskDetails(res.rows); else setKioskLoadError(res.error);
      setKioskLoaded(true);
    })();
    return ()=>{ alive = false; };
  },[]);

  const kioskShown = useMemo(()=>{
    const q = kioskSearch.trim().toLowerCase();
    if(!q) return kioskDetails;
    return kioskDetails.filter(k=>[k.name,k.loginId,k.merchantCode,k.backendLink,...k.customFields.map(f=>f.label)].some(v=>String(v||"").toLowerCase().includes(q)));
  },[kioskDetails,kioskSearch]);

  // ---- Blacklist Member ----------------------------------------------------
  // Loaded once per session, like the other real-table pages. It's fetched even
  // when the page isn't open, because the transaction entry form checks against
  // it to warn about a blacklisted name/number — see blacklistIndex below.
  useEffect(()=>{
    if(!window.FINTRACK_BLACKLIST_API){ setBlLoaded(true); return; }
    let alive = true;
    (async()=>{
      const res = await window.FINTRACK_BLACKLIST_API.list();
      if(!alive) return;
      if(res.ok) setBlacklist(res.rows); else setBlLoadError(res.error);
      setBlLoaded(true);
    })();
    return ()=>{ alive = false; };
  },[]);

  const blShown = useMemo(()=>{
    const q = blSearch.trim().toLowerCase();
    const qDigits = digitsOnly(blSearch);
    let arr = blacklist;
    if(q){
      // Numbers are searched by digits so spacing and punctuation don't matter.
      // Both forms are checked: phoneDigits is NORMALISED (country code and the
      // trunk zero stripped), while the raw phone still has them — so typing
      // "0412 171" the way an Australian would has to hit the raw form, and
      // typing "412171" hits the normalised one. Checking only one of them
      // silently returns nothing for the more natural way of typing it.
      const qBare = qDigits.replace(/^0+/, "");
      arr = arr.filter(b=>
        [b.name,b.payid,b.bsb,b.accountNo,b.reason,b.addedByCompany,b.addedByName]
          .some(v=>String(v||"").toLowerCase().includes(q))
        || (qDigits.length>=3 && (
             digitsOnly(b.phone).includes(qDigits)
             || (qBare.length>=3 && String(b.phoneDigits||"").includes(qBare))
           ))
      );
    }
    const by = [...arr];
    if(blSort==="oldest")       by.sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
    else if(blSort==="name")    by.sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    else if(blSort==="company") by.sort((a,b)=>(a.addedByCompany||"").localeCompare(b.addedByCompany||"") || String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    else                        by.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))); // newest
    return by;
  },[blacklist,blSearch,blSort]);

  const blTotal   = blShown.length;
  const blPages   = Math.max(1, Math.ceil(blTotal/blPageSize));
  const blCurPage = Math.min(blPage, blPages);
  const blStart   = (blCurPage-1)*blPageSize;
  const blSlice   = blShown.slice(blStart, blStart+blPageSize);

  /*
   * Lookup index for the transaction-entry warning: normalised name -> entry and
   * normalised phone -> entry. Built once per blacklist change rather than
   * scanning the list on every keystroke, since the entry form checks on each
   * character typed.
   */
  const blacklistIndex = useMemo(()=>{
    const byName = new Map(), byPhone = new Map();
    for(const b of blacklist){
      const n = normalizeName(b.name);
      if(n && !byName.has(n)) byName.set(n, b);
      // phone_digits holds EVERY number on that entry, space-separated, so an
      // entry naming someone's two numbers matches on either. Older/manual rows
      // that only have the raw text fall back to parsing that.
      const nums = String(b.phoneDigits||"").trim()
        ? String(b.phoneDigits).trim().split(/\s+/)
        : extractNumbers(b.phone);
      for(const p of nums){ if(p && !byPhone.has(p)) byPhone.set(p, b); }
    }
    return { byName, byPhone };
  },[blacklist]);

  /* Returns the blacklist entry a typed name/phone matches, or null. */
  const blacklistHit = (name, phone) => {
    const p = normalizePhone(phone);
    if(p && blacklistIndex.byPhone.has(p)) return blacklistIndex.byPhone.get(p);
    const n = normalizeName(name);
    if(n && blacklistIndex.byName.has(n)) return blacklistIndex.byName.get(n);
    return null;
  };

  /*
   * Live blacklist check on whatever is typed into the entry form's name and
   * phone fields. Kept as two separate lookups rather than one combined hit, so
   * the warning appears against the field that actually matched — telling
   * someone "this name is blacklisted" when it was really the phone number that
   * matched would send them looking in the wrong place.
   */
  const entryNameHit = useMemo(()=>{
    const n = normalizeName(form.memberName);
    return n ? (blacklistIndex.byName.get(n) || null) : null;
  },[form.memberName,blacklistIndex]);
  const entryPhoneHit = useMemo(()=>{
    const p = normalizePhone(form.memberPhone);
    return p ? (blacklistIndex.byPhone.get(p) || null) : null;
  },[form.memberPhone,blacklistIndex]);

  const openBlAdd = () => { setBlForm(BL_BLANK); setBlFormError(""); setBlModalOpen(true); };
  const handleSaveBl = async () => {
    if(!blForm.name.trim()){ setBlFormError("Name is required."); return; }
    const api = window.FINTRACK_BLACKLIST_API;
    if(!api?.add){ setBlFormError("Not authorised."); return; }
    setBlSaving(true);
    // File the entry under the country its PHONE says, falling back to this
    // company's own country when the number isn't recognisable. RLS re-checks
    // this, so a bad guess is rejected rather than landing in the wrong pool.
    const country = countryFromPhone(blForm.phone) || SESSION.country || "";
    const res = await api.add({
      ...blForm,
      name: blForm.name.trim(),
      // Same normalisation the import uses, so a number added here and the same
      // number imported from the shared list index identically.
      phoneDigits: extractNumbers(blForm.phone).join(" "),
      country,
      companyName: SESSION.companyName,
    });
    setBlSaving(false);
    if(!res.ok){ setBlFormError(res.error); return; }
    setBlacklist(prev=>[res.row,...prev]);
    setBlModalOpen(false);
  };

  const handleDeleteBl = (b) => setConfirm({
    message:`Remove "${b.name}" from the blacklist? Every company in ${SESSION.country||"your country"} will stop seeing this entry. This can't be undone.`,
    onConfirm: async ()=>{
      setConfirm(null);
      const api = window.FINTRACK_BLACKLIST_API;
      if(!api?.remove) return;
      const res = await api.remove(b.id);
      if(res.ok) setBlacklist(prev=>prev.filter(x=>x.id!==b.id));
      else window.showToast?.(res.error,"error");
    }});

  const openKioskAdd = () => { setKioskEditId(null); setKioskForm(KIOSK_BLANK); setKioskFormError(""); setKioskModalOpen(true); };
  const openKioskEdit = kiosk => { setKioskEditId(kiosk.id); setKioskForm({name:kiosk.name,backendLink:kiosk.backendLink,loginId:kiosk.loginId,password:kiosk.password,merchantCode:kiosk.merchantCode,customFields:kiosk.customFields.map(f=>({...f}))}); setKioskFormError(""); setKioskModalOpen(true); };
  const closeKioskModal = () => setKioskModalOpen(false);
  const handleSaveKiosk = async () => {
    if(!kioskForm.name.trim()){ setKioskFormError("Record name is required."); return; }
    const api = window.FINTRACK_KIOSK_DETAILS_API;
    if(!api?.create || !api?.update){ setKioskFormError("Not authorised."); return; }
    const cleanFields = kioskForm.customFields.filter(f=>f.label.trim()||f.value.trim());
    const payload = {...kioskForm, name: kioskForm.name.trim(), customFields:cleanFields};
    const res = kioskEditId ? await api.update(kioskEditId,payload) : await api.create(payload);
    if(!res.ok){ setKioskFormError(res.error); return; }
    if(kioskEditId) setKioskDetails(prev=>prev.map(k=>k.id===kioskEditId?{...k,...payload}:k));
    else setKioskDetails(prev=>[res.row,...prev]);
    setKioskModalOpen(false);
  };
  const handleDeleteKiosk = (id,label) => setConfirm({message:`Delete "${label||"this record"}"? This cannot be undone.`,onConfirm: async ()=>{
    setConfirm(null);
    const api = window.FINTRACK_KIOSK_DETAILS_API;
    if(!api?.remove) return;
    const res = await api.remove(id);
    if(res.ok) setKioskDetails(prev=>prev.filter(k=>k.id!==id));
  }});

  const addKioskCustomField = () => setKioskForm(f=>({...f,customFields:[...f.customFields,{label:"",value:"",sensitive:true}]}));
  const updateKioskCustomField = (i,patch) => setKioskForm(f=>({...f,customFields:f.customFields.map((row,idx)=>idx===i?{...row,...patch}:row)}));
  const removeKioskCustomField = i => setKioskForm(f=>({...f,customFields:f.customFields.filter((_,idx)=>idx!==i)}));

  // Motion: a quiet staggered entrance for the card grid when Bank Details first
  // becomes visible (page switch, or once the data finishes loading if that
  // happens after — matchMedia skips it entirely under prefers-reduced-motion).
  useGSAP(()=>{
    if(page!=="bankdetails") return;
    const cards = bdGridRef.current ? bdGridRef.current.querySelectorAll(".bd-card") : null;
    if(!cards || !cards.length) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(cards,{autoAlpha:0,y:14,duration:0.4,stagger:0.05,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[page,bdLoaded,bdShown.length===0],scope:bdGridRef});

  // Motion: the record panel fades + scales in when opened.
  useGSAP(()=>{
    if(!bdPanel || !bdPanelRef.current) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(bdPanelRef.current,{autoAlpha:0,scale:0.96,duration:0.25,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[bdPanel],scope:bdPanelRef});

  // Motion: form field-groups settle in with a soft stagger when the Add/Edit modal opens.
  useGSAP(()=>{
    if(!bdModalOpen || !bdModalRef.current) return;
    const groups = bdModalRef.current.querySelectorAll(".bd-form-group");
    if(!groups.length) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(groups,{autoAlpha:0,y:12,duration:0.35,stagger:0.06,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[bdModalOpen],scope:bdModalRef});

  // Motion: a quiet staggered entrance for the card grid when Company
  // Credentials first becomes visible — same pattern as Bank Details.
  useGSAP(()=>{
    if(page!=="companycredentials") return;
    const cards = credGridRef.current ? credGridRef.current.querySelectorAll(".cred-card") : null;
    if(!cards || !cards.length) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(cards,{autoAlpha:0,y:14,duration:0.4,stagger:0.05,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[page,credLoaded,credShown.length===0],scope:credGridRef});

  // Motion: the record panel fades + scales in when opened.
  useGSAP(()=>{
    if(!credPanel || !credPanelRef.current) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(credPanelRef.current,{autoAlpha:0,scale:0.96,duration:0.25,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[credPanel],scope:credPanelRef});

  // Motion: form field-groups settle in with a soft stagger when the Add/Edit
  // modal opens (built in from the start this time, rather than added later —
  // see the Bank Details redesign-premium pass for why this was worth doing).
  useGSAP(()=>{
    if(!credModalOpen || !credModalRef.current) return;
    const groups = credModalRef.current.querySelectorAll(".cred-form-group");
    if(!groups.length) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(groups,{autoAlpha:0,y:12,duration:0.35,stagger:0.06,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[credModalOpen],scope:credModalRef});

  // Motion: blacklist rows fade in on the way down the table. Capped at the
  // first 25 rows — this list is shared across a whole country, so it can get
  // long, and staggering 500 rows would be a slow crawl rather than a flourish.
  useGSAP(()=>{
    if(page!=="blacklist") return;
    const rows = blGridRef.current ? blGridRef.current.querySelectorAll(".bl-row") : null;
    if(!rows || !rows.length) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(Array.from(rows).slice(0,25),{autoAlpha:0,y:8,duration:0.3,stagger:0.025,ease:"power2.out"});
    });
    return ()=>mm.revert();
    // Re-runs on page change too, so flipping to page 2 gets the same entrance
    // rather than the new rows appearing abruptly under the old ones.
  },{dependencies:[page,blLoaded,blCurPage,blShown.length===0],scope:blGridRef});

  // Motion: the add-to-blacklist form's fields stagger in, same as the others.
  useGSAP(()=>{
    if(!blModalOpen || !blModalRef.current) return;
    const groups = blModalRef.current.querySelectorAll(".bl-form-group");
    if(!groups.length) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(groups,{autoAlpha:0,y:12,duration:0.35,stagger:0.06,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[blModalOpen],scope:blModalRef});

  // Motion: a quiet staggered entrance for the card grid when Payment Gateway
  // Details first becomes visible — same pattern as Bank Details / Company Credentials.
  useGSAP(()=>{
    if(page!=="paymentgateways") return;
    const cards = pgGridRef.current ? pgGridRef.current.querySelectorAll(".pg-card") : null;
    if(!cards || !cards.length) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(cards,{autoAlpha:0,y:14,duration:0.4,stagger:0.05,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[page,pgLoaded,pgShown.length===0],scope:pgGridRef});

  // Motion: the record panel fades + scales in when opened.
  useGSAP(()=>{
    if(!pgPanel || !pgPanelRef.current) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(pgPanelRef.current,{autoAlpha:0,scale:0.96,duration:0.25,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[pgPanel],scope:pgPanelRef});

  // Motion: form field-groups settle in with a soft stagger when the Add/Edit modal opens.
  useGSAP(()=>{
    if(!pgModalOpen || !pgModalRef.current) return;
    const groups = pgModalRef.current.querySelectorAll(".pg-form-group");
    if(!groups.length) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(groups,{autoAlpha:0,y:12,duration:0.35,stagger:0.06,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[pgModalOpen],scope:pgModalRef});

  // Motion: a quiet staggered entrance for the card grid when Game Kiosk
  // Details first becomes visible — same pattern as the other vault pages.
  useGSAP(()=>{
    if(page!=="kioskdetails") return;
    const cards = kioskGridRef.current ? kioskGridRef.current.querySelectorAll(".kiosk-card") : null;
    if(!cards || !cards.length) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(cards,{autoAlpha:0,y:14,duration:0.4,stagger:0.05,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[page,kioskLoaded,kioskShown.length===0],scope:kioskGridRef});

  // Motion: the record panel fades + scales in when opened.
  useGSAP(()=>{
    if(!kioskPanel || !kioskPanelRef.current) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(kioskPanelRef.current,{autoAlpha:0,scale:0.96,duration:0.25,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[kioskPanel],scope:kioskPanelRef});

  // Motion: form field-groups settle in with a soft stagger when the Add/Edit modal opens.
  useGSAP(()=>{
    if(!kioskModalOpen || !kioskModalRef.current) return;
    const groups = kioskModalRef.current.querySelectorAll(".kiosk-form-group");
    if(!groups.length) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", ()=>{
      gsap.from(groups,{autoAlpha:0,y:12,duration:0.35,stagger:0.06,ease:"power2.out"});
    });
    return ()=>mm.revert();
  },{dependencies:[kioskModalOpen],scope:kioskModalRef});

  const handleAddBank = () => {
    if(!newBank.name.trim()||!newBank.holder.trim()||isNaN(newBank.balance)){setBankError("Bank name, holder's name, and opening balance are required.");return;}
    setBankError("");
    setBanks(prev=>[...prev,{id:Date.now(),name:newBank.name,holder:newBank.holder,bsb:newBank.bsb,account:newBank.account,payid:newBank.payid,otpLink:newBank.otpLink,openingBalance:Number(newBank.balance),activatedAt:Date.now(),updatedAt:Date.now()}]);
    setNewBank({name:"",holder:"",bsb:"",account:"",payid:"",otpLink:"",balance:""});
    setShowBankModal(false);
  };
  const startEditBank = b => { setEditingBank(b.id); setEditBankForm({name:b.name,holder:b.holder,bsb:b.bsb||"",account:b.account||"",payid:b.payid||"",otpLink:b.otpLink||"",balance:String(b.openingBalance??0)}); setEditBankError(""); };
  const handleSaveBank = id => {
    if(!editBankForm.name.trim()||!editBankForm.holder.trim()||isNaN(editBankForm.balance)){setEditBankError("Bank name, holder, and opening balance are required.");return;}
    setBanks(prev=>prev.map(b=>b.id===id?{...b,name:editBankForm.name,holder:editBankForm.holder,bsb:editBankForm.bsb,account:editBankForm.account,payid:editBankForm.payid,otpLink:editBankForm.otpLink,openingBalance:Number(editBankForm.balance),updatedAt:Date.now()}:b)); setEditingBank(null);
  };
  // Soft-delete: tag the bank deleted (with a fresh updatedAt) instead of dropping it, so the
  // newest-wins merge carries the deletion to other devices. The UI filters deleted banks out
  // (see banksLive); transaction logs still resolve a deleted bank's NAME from the full list.
  const handleDeleteBank = (id,name) => setConfirm({message:`Delete "${name}"? This cannot be undone.`,onConfirm:()=>{setBanks(prev=>prev.map(b=>b.id===id?{...b,deleted:true,updatedAt:Date.now()}:b));setConfirm(null);}});
  // Toggle a bank between active and inactive. Inactive hides it from the
  // dashboard per-bank list and the entry-form dropdowns (history is kept).
  const handleToggleBankActive = id => setBanks(prev=>prev.map(b=>{
    if(b.id!==id) return b;
    if(b.blocked) return b; // a blocked bank can't be activated — it must be unblocked first
    const nowActive = b.active===false; // was inactive -> we're activating it now
    // updatedAt lets the cross-device merge see this toggle is the latest change to the bank
    return nowActive ? {...b,active:true,activatedAt:Date.now(),updatedAt:Date.now()} : {...b,active:false,updatedAt:Date.now()};
  }));
  // Block / Unblock a bank. Blocking force-deactivates it and stops it being made active
  // again until it's unblocked (handleToggleBankActive refuses while blocked). updatedAt lets
  // the cross-device merge carry the block state as the bank's latest change.
  const handleToggleBankBlock = id => setBanks(prev=>prev.map(b=>{
    if(b.id!==id) return b;
    return b.blocked ? {...b,blocked:false,updatedAt:Date.now()} : {...b,blocked:true,active:false,updatedAt:Date.now()};
  }));

  // --- Off Days + shift roster: both live in the synced `offDays` array (shift rows carry kind:"shift"). ---
  const offLive = useMemo(()=>offDays.filter(o=>!o.deleted),[offDays]);
  const offRecords = useMemo(()=>offLive.filter(o=>o.kind!=='shift'),[offLive]);   // real days off
  const shiftRecords = useMemo(()=>offLive.filter(o=>o.kind==='shift'),[offLive]); // month shift roster rows
  const dayNames = useMemo(()=>{ const mp={}; for(const o of offRecords){ (mp[o.date]||(mp[o.date]=[])).push(o.employee); } return mp; },[offRecords]);
  const offMonths = useMemo(()=>{ const s=new Set(offRecords.map(o=>o.date.slice(0,7))); s.add(thisMonth); s.add(offCalMonth); return [...s].sort((a,b)=>b.localeCompare(a)); },[offRecords,offCalMonth]);
  // Who's on each shift for the displayed month.
  const monthShiftRows = useMemo(()=>shiftRecords.filter(r=>r.month===offCalMonth && r.employee),[shiftRecords,offCalMonth]);
  const shiftMorning = useMemo(()=>monthShiftRows.filter(r=>r.shift==='morning').sort((a,b)=>a.employee.localeCompare(b.employee)),[monthShiftRows]);
  const shiftNoon = useMemo(()=>monthShiftRows.filter(r=>r.shift==='noon').sort((a,b)=>a.employee.localeCompare(b.employee)),[monthShiftRows]);
  const shiftNight = useMemo(()=>monthShiftRows.filter(r=>r.shift==='night').sort((a,b)=>a.employee.localeCompare(b.employee)),[monthShiftRows]);
  // A record matches a team member by ID (rows created via the roster/picker) or, for rows
  // recorded before accounts were linked in, by name — so pre-existing history still counts.
  const matchesMember = (o,member)=> o.employeeId ? o.employeeId===member.operatorId : (o.employee||'').toLowerCase()===member.name.toLowerCase();
  // Team members not yet placed on any shift this month — the draggable pool.
  const shiftPool = useMemo(()=>TEAM.filter(t=>!monthShiftRows.some(r=>matchesMember(r,t))).sort((a,b)=>a.name.localeCompare(b.name)),[monthShiftRows,TEAM]);
  // Every team member's off-day count for the selected month + its year (used by the counts section below).
  const offCounts = useMemo(()=>{
    const y = offCalMonth.slice(0,4);
    return TEAM.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(member=>{
      const mine = offRecords.filter(o=>matchesMember(o,member));
      return { member, month: mine.filter(o=>o.date.slice(0,7)===offCalMonth).length, year: mine.filter(o=>o.date.slice(0,4)===y).length };
    });
  },[TEAM,offRecords,offCalMonth]);
  // Nationality filter + "View more" cap (10 by default) for the off-day counts table.
  const offCountsFiltered = useMemo(()=>offCountsNat ? offCounts.filter(c=>c.member.nationality===offCountsNat) : offCounts,[offCounts,offCountsNat]);
  const offCountsShown = offCountsAll ? offCountsFiltered : offCountsFiltered.slice(0,10);
  // The selected month's log: search, then merge an employee's consecutive same-reason days into one run, then sort.
  const offLog = useMemo(()=>{
    const term = offLogSearch.trim().toLowerCase();
    let recs = offRecords.filter(o=>o.date.slice(0,7)===offCalMonth);
    if(term) recs = recs.filter(o=>o.employee.toLowerCase().includes(term)||(o.reason||'').toLowerCase().includes(term));
    recs = recs.slice().sort((a,b)=>a.employee.localeCompare(b.employee)||a.date.localeCompare(b.date));
    const nextDay = iso=>{ const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); };
    const runs=[]; let cur=null;
    for(const o of recs){
      if(cur && cur.employee===o.employee && (cur.reason||'')===(o.reason||'') && nextDay(cur.dateTo)===o.date){
        cur.dateTo=o.date; cur.dates.push(o.date); cur.uids.push(o.uid);
      } else { cur={employee:o.employee,reason:o.reason||'',dateFrom:o.date,dateTo:o.date,dates:[o.date],uids:[o.uid],recordedBy:o.recordedBy||''}; runs.push(cur); }
    }
    runs.sort((a,b)=> offLogSort==='employee' ? (a.employee.localeCompare(b.employee)||a.dateFrom.localeCompare(b.dateFrom)) : (a.dateFrom.localeCompare(b.dateFrom)||a.employee.localeCompare(b.employee)));
    return runs;
  },[offRecords,offCalMonth,offLogSearch,offLogSort]);
  const toggleOffDate = (iso)=> setOffSelDates(prev=> prev.includes(iso) ? prev.filter(d=>d!==iso) : [...prev,iso].sort());
  const gotoMonth = (ym)=>{ setOffCalMonth(ym); setMobileAssignFor(null); };
  const handleAddOffDays = () => {
    const member = TEAM.find(t=>t.operatorId===offForm.employeeId);
    if(!member){ setOffError("Pick who's off."); window.showToast?.("Error , Please Try Again","error"); return; }
    if(offSelDates.length===0){ setOffError("Pick at least one day on the calendar."); window.showToast?.("Error , Please Try Again","error"); return; }
    const taken = new Set(offRecords.filter(o=>matchesMember(o,member)).map(o=>o.date));
    const fresh = offSelDates.filter(d=>!taken.has(d));
    if(fresh.length===0){ setOffError(`${member.name} is already booked off on the day(s) you picked.`); window.showToast?.("Error , Please Try Again","error"); return; }
    const recordedBy = SESSION.operatorName || SESSION.operatorId || "";
    const now = Date.now();
    const recs = fresh.map(d=>({uid:mkUid(),employee:member.name,employeeId:member.operatorId,date:d,reason:offForm.reason.trim(),recordedBy,createdAt:now,deleted:false}));
    setOffDays(prev=>[...recs,...prev]);
    setOffSelDates([]); setOffForm({employeeId:"",reason:""}); setOffError("");
    window.showToast?.("Action Done !","success");
  };
  const handleDeleteOffRun = (run) => setConfirm({message:`Remove ${run.employee}'s ${run.dates.length>1?`${run.dates.length} days off (${fmtDate(run.dateFrom)} – ${fmtDate(run.dateTo)})`:`day off on ${fmtDate(run.dateFrom)}`}?`,onConfirm:()=>{ const ids=new Set(run.uids); setOffDays(prev=>prev.map(o=>ids.has(o.uid)?{...o,deleted:true}:o)); setConfirm(null); }});
  // Drag (or tap, on touch) a team card onto a shift group to put them on it this month.
  const assignShift = (member,shiftValue)=>{
    if(!member || !canEditRoster) return;
    if(monthShiftRows.some(r=>r.shift===shiftValue && matchesMember(r,member))){ window.showToast?.(`${member.name} is already on that shift`,"error"); return; }
    const recordedBy = SESSION.operatorName || SESSION.operatorId || "";
    const now = Date.now();
    setOffDays(prev=>[{uid:mkUid(),kind:'shift',month:offCalMonth,shift:shiftValue,employee:member.name,employeeId:member.operatorId,recordedBy,updatedAt:now,createdAt:now,deleted:false},...prev]);
    setMobileAssignFor(null);
    window.showToast?.("Action Done !","success");
  };
  // Drag an already-placed card into a different group — moves them, doesn't duplicate.
  const moveShift = (uid,newShift)=>{
    if(!canEditRoster) return;
    setOffDays(prev=>prev.map(o=>o.uid===uid?{...o,shift:newShift,updatedAt:Date.now()}:o));
    setMobileAssignFor(null);
  };
  const deleteShift = (uid)=>{ if(!canEditRoster) return; setOffDays(prev=>prev.map(o=>o.uid===uid?{...o,deleted:true,updatedAt:Date.now()}:o)); };

  const startEditMember = m => { setEditingMember(m.id); setEditMemberForm({id:m.id,name:m.name,phone:m.phone||""}); setEditMemberError(""); };
  const handleSaveMember = id => {
    if(!editMemberForm.id.trim()||!editMemberForm.name.trim()){setEditMemberError("ID and name are required.");return;}
    setMembers(prev=>prev.map(m=>m.id===id?{...m,id:editMemberForm.id,name:editMemberForm.name,phone:editMemberForm.phone}:m)); setEditingMember(null);
  };
  const handleDeleteMember = (id,name) => setConfirm({message:`Delete member "${name}"? Their transaction history will be kept.`,onConfirm:()=>{setMembers(prev=>prev.filter(m=>m.id!==id));setConfirm(null);}});

  const closeMemberModal = () => { setNewMember({name:"",phone:"",id:""}); setNewMemberError(""); setShowMemberModal(false); };

  // Press Escape to close the top-most open popup (one per press) — mirrors each
  // modal's backdrop click / Cancel. Highest layer first, so a Confirm shown over
  // another popup closes before the popup beneath it. Yields to an open FluidDropdown
  // (it sets window.__fluidOpenCount) so Escape closes that first.
  useEffect(()=>{
    const onKey = (e)=>{
      if(e.key!=="Escape" && e.key!=="Esc") return;
      if((typeof window!=="undefined" ? (window.__fluidOpenCount||0) : 0) > 0) return;
      if(confirm){ setConfirm(null); return; }
      if(showPasswordModal){ closePasswordModal(); return; }
      if(showEntryModal){ closeEntryModal(); return; }
      if(showBankModal){ closeBankModal(); return; }
      if(showMemberModal){ closeMemberModal(); return; }
      if(detailModal){ setDetailModal(null); return; }
    };
    document.addEventListener("keydown", onKey);
    return ()=>document.removeEventListener("keydown", onKey);
  },[confirm,showPasswordModal,showEntryModal,showBankModal,showMemberModal,detailModal]);
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
    const lines = rows.map(r=>M_COLS.map(c=>csvEscape(c==="joined"||c==="lastActivity"?fmtDate(r[c]):r[c])).join(","));
    downloadBlob([M_COLS.join(","),...lines].join("\n"),"fintrack_members.csv","text/csv;charset=utf-8;");
  };
  const exportMembersExcel = () => {
    const rows = memberRows();
    const head = "<tr>"+M_COLS.map(c=>`<th>${c}</th>`).join("")+"</tr>";
    const body = rows.map(r=>"<tr>"+M_COLS.map(c=>`<td>${String((c==="joined"||c==="lastActivity"?fmtDate(r[c]):r[c])??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")}</td>`).join("")+"</tr>").join("");
    downloadBlob(`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">${head}${body}</table></body></html>`,"fintrack_members.xls","application/vnd.ms-excel");
  };
  const exportMembersPDF = () => {
    const rows = memberRows();
    const w = window.open("","_blank"); if(!w) return;
    const head = "<tr>"+["Member ID","Name","Phone","Joined","Transactions","Total deposits","Last activity"].map(c=>`<th>${c}</th>`).join("")+"</tr>";
    const body = rows.map(r=>"<tr>"+[r.id,r.name,r.phone,fmtDate(r.joined),r.transactions,fmt(r.totalDeposits),fmtDate(r.lastActivity)].map(c=>`<td>${String(c).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</td>`).join("")+"</tr>").join("");
    w.document.write(`<html><head><title>FinTrack — Members</title><style>body{font-family:sans-serif;padding:20px}h2{font-weight:500}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0}</style></head><body><h2>FinTrack — Members directory</h2><table>${head}${body}</table><script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  };

  const openMemberDetail = m => {
    const tx = transactions.filter(t=>t.memberId===m.id||t.memberName===m.name).sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time));
    const total = tx.filter(t=>t.type==="Regular Deposit"&&!t.deleted).reduce((a,b)=>a+b.amount,0);
    setDetailModal({title:m.name,subtitle:`${m.id}${m.phone?" · "+m.phone:""} · Joined ${fmtDate(m.joined)} · ${tx.length} transactions · Total deposits: ${fmt(total)}`,transactions:tx});
  };
  const openBankDetail = b => {
    const tx = transactions.filter(t=>txInBank(t,b)).sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time));
    setDetailModal({title:b.name,subtitle:`Holder: ${b.holder} · BSB: ${b.bsb||"—"} · Acc: ${b.account||"—"} · PayID: ${b.payid||"—"} · ${tx.length} transactions · Balance: ${fmt(b.balance)}`,transactions:tx,yesterday:b.yBalance});
  };

  const nav = [
    {id:"dashboard",icon:"ti-layout-dashboard",label:"Dashboard"},
    {id:"transactions",icon:"ti-transfer",label:"Transactions"},
    {id:"banks",icon:"ti-building-bank",label:"Bank Accounts"},
    // Master/manager, plus an owner read-only — hidden from staff here (nav),
    // guarded again on the page render below, and enforced for real by RLS
    // (migration-021, widened to owners by migration-025).
    ...(canAccessBankDetails ? [{id:"bankdetails",icon:"ti-id-badge-2",label:"Bank Details"}] : []),
    // Same audience — general credential vault, own table (migration-022).
    // Label uses the real company name, same source AccountMenu already reads.
    ...(canAccessCompanyCredentials ? [{id:"companycredentials",icon:"ti-key",label:`${SESSION.companyName} Details`}] : []),
    // Same audience — payment gateway credential vault, own table
    // (migration-023). Fixed label (not company-name-prefixed like the one above).
    ...(canAccessPaymentGateways ? [{id:"paymentgateways",icon:"ti-credit-card",label:"Payment Gateway Details"}] : []),
    // Unconditional — every role gets this page, own table (migration-024) but
    // RLS has no role restriction, just company isolation.
    {id:"kioskdetails",icon:"ti-device-desktop",label:"Game Kiosk Details"},
    // Unconditional too — every role can view AND add. The one page whose data
    // is shared with other companies in the same country (migration-027).
    {id:"blacklist",icon:"ti-user-off",label:"Blacklist Member"},
    {id:"members",icon:"ti-users",label:"Members"},
    {id:"search",icon:"ti-search",label:"Search"},
    {id:"offdays",icon:"ti-calendar-off",label:"Work Shifts/Off Day"},
  ];

  // Members list: optional search (name / ID / phone) then pagination.
  const memberFiltered = useMemo(()=>{
    const q = memberSearch.trim().toLowerCase();
    if(!q) return members;
    return members.filter(m=>(m.name||"").toLowerCase().includes(q)||(m.id||"").toLowerCase().includes(q)||(m.phone||"").toLowerCase().includes(q));
  },[members,memberSearch]);
  // Members are appended as they're added, so a member's index in `members` is its join
  // ORDER. Every sort reuses that index as a stable tiebreaker — and for the joined
  // sorts it's the only signal left when two members share a joined date, since
  // `joined` records a day with no time-of-day.
  const memberOrderIndex = useMemo(()=>{ const m=new Map(); members.forEach((mem,i)=>m.set(mem.id,i)); return m; },[members]);
  const memberSorted = useMemo(()=>{
    const ix = m => (memberOrderIndex.get(m.id) ?? 0);
    // Newest/Oldest follow the member's JOINED date — the same value shown in the
    // "Joined" column — not the order they happen to sit in the array. It's stored
    // as an ISO YYYY-MM-DD string, so a plain string compare is already
    // chronological. A member with no joined date at all (an older or merged-in
    // record from before the field was kept) sorts as the earliest, since they
    // predate it being recorded.
    const joinedKey = m => String(m.joined||"");
    const arr = [...memberFiltered];
    if(memberSort==="tx"){
      const cnt = new Map();
      for(const m of arr) cnt.set(m.id, transactions.filter(t=>(t.memberId===m.id||t.memberName===m.name)&&!t.deleted).length);
      arr.sort((a,b)=> (cnt.get(b.id)-cnt.get(a.id)) || (ix(b)-ix(a)));
    } else if(memberSort==="name"){
      arr.sort((a,b)=> (a.name||"").localeCompare(b.name||"") || (ix(a)-ix(b)));
    } else if(memberSort==="nameDesc"){
      arr.sort((a,b)=> (b.name||"").localeCompare(a.name||"") || (ix(b)-ix(a)));
    } else if(memberSort==="activity"){
      arr.sort((a,b)=> String(b.lastActivity||"").localeCompare(String(a.lastActivity||"")) || (ix(b)-ix(a)));
    } else if(memberSort==="oldest"){
      // Longest-standing member on top: earliest joined date first, and within the
      // same day whoever was entered first.
      arr.sort((a,b)=> joinedKey(a).localeCompare(joinedKey(b)) || (ix(a)-ix(b)));
    } else { // "newest" (default) — most recently JOINED member on top
      arr.sort((a,b)=> joinedKey(b).localeCompare(joinedKey(a)) || (ix(b)-ix(a)));
    }
    return arr;
  },[memberFiltered,memberSort,memberOrderIndex,transactions]);
  const memberTotal = memberSorted.length;
  const memberPages = Math.max(1, Math.ceil(memberTotal/memberPageSize));
  const memberCurPage = Math.min(memberPage, memberPages);
  const memberStart = (memberCurPage-1)*memberPageSize;
  const memberSlice = memberSorted.slice(memberStart, memberStart+memberPageSize);

  // Caption under a bank picker in the entry form: the picked bank's live balance, so the
  // operator sees how much is in the account before recording a deposit/withdrawal/transfer.
  const bankBalanceHint = (bankId) => {
    if(bankId==null) return null;
    const b = banksLive.find(x=>x.id===bankId);
    if(!b) return null;
    return (
      <div style={{marginTop:6,fontSize:12,display:"flex",alignItems:"center",gap:6,color:C.muted}}>
        <i className="ti ti-wallet" aria-hidden="true" style={{fontSize:13,color:C.accent}}/>
        <span>Current balance:</span>
        <strong style={{color:b.balance<0?"#dc2626":C.text}}>{fmt(b.balance)}</strong>
      </div>
    );
  };
  const labelStyle = {fontSize:12,color:C.muted,display:"block",marginBottom:4};  const SectionTitle = ({icon,children,right}) => (
    <div style={{display:"flex",flexDirection:isMobile?"column":"row",alignItems:isMobile?"stretch":"center",justifyContent:"space-between",gap:isMobile?10:0,margin:"0 0 12px"}}>
      <h3 style={{fontSize:15,fontWeight:500,margin:0,display:"flex",alignItems:"center",gap:8,color:C.text}}>
        <i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:18,color:C.accent}}/>{children}
      </h3>
      {right}
    </div>
  );

  const toggleBtn = (active,onClick,label) => (
    <button onClick={onClick} style={{cursor:"pointer",padding:"6px 14px",fontSize:13,fontWeight:500,border:`1px solid ${active?C.accent:C.border}`,borderRadius:8,background:active?C.accent:C.surface2,color:active?C.onAccent:C.text}}>{label}</button>
  );

  const dashScopeLabel = dashView==="today" ? `Today — ${fmtDate(today)}`
    : dashView==="yesterday" ? `Yesterday — ${fmtDate(yesterday)}`
    : dashView==="week" ? `Last 7 days — ${fmtDate(weekAgo)} to ${fmtDate(today)}`
    : dashView==="range" ? `${rangeFrom?fmtDate(rangeFrom):"start"} to ${rangeTo?fmtDate(rangeTo):"end"}`
    : monthLabel(selMonth);
  const scopeName = dashView==="today" ? `today_${today}`
    : dashView==="yesterday" ? `yesterday_${yesterday}`
    : dashView==="week" ? `week_${weekAgo}_${today}`
    : dashView==="range" ? `range_${rangeFrom}_${rangeTo}`
    : `month_${selMonth}`;

  // Click a dashboard stat card → open the detail popup listing that stat's
  // transactions for the currently selected date scope (today / yesterday / etc.).
  const openStatDetail = (label, rows, totalOverride, scopeOverride, opts={}) => {
    const list = rows.slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
    const total = totalOverride!==undefined ? totalOverride : rows.reduce((s,t)=>s+(t.amount||0),0);
    // Store "closing": the balance at the END of the selected period. When that period
    // ends today (live views), today's close just equals the current balance — pointless
    // — so show YESTERDAY's close instead. A past period shows its own end-date close.
    const closeDate = scopeAsOf >= today ? yesterday : scopeAsOf;
    const summary = {
      ...ftCreditDebit(rows),
      store: opts.store ? {
        current: storeCredit,
        closing: storeBalanceAsOf(closeDate),
        closingLabel: closeDate===yesterday ? "Yesterday's closing" : `Closing · ${fmtDate(closeDate)}`,
      } : undefined,
    };
    setDetailModal({
      title: label,
      subtitle: `${scopeOverride||dashScopeLabel} · ${rows.length} ${rows.length===1?"entry":"entries"} · Total: ${fmt(total)}`,
      transactions: list,
      summary,
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
    {label:"Store entries", count:stats.store.length, amount:stats.sum(storeAllTime), color:"#FFDE63", note:`Running store credit · yest. ${fmt(storeYesterday)}`, onClick:()=>openStatDetail("Store entries", stats.store, undefined, undefined, {store:true})},
    {label:"Transfers", count:stats.transfers.length, amount:stats.sum(stats.transfers), color:"#6366f1", onClick:()=>openStatDetail("Transfers", stats.transfers)},
    {label:"Adjustments", count:stats.adjustments.length, amount:stats.sum(stats.adjustments), color:"#0d9488", onClick:()=>openStatDetail("Adjustments", stats.adjustments)},
    {label:"Other", count:stats.other.length, amount:stats.sum(stats.other), color:"#64748b", onClick:()=>openStatDetail("Other", stats.other)},
    {label:"Bank Blocked", count:stats.bankBlocked.length, amount:stats.sum(stats.bankBlocked), color:"#5b7a99", onClick:()=>openStatDetail("Bank Blocked", stats.bankBlocked)},
    {label:"Buy/Sell AUD", count:stats.buySellAud.length, amount:stats.sum(stats.buySellAud), color:"#db2777", onClick:()=>openStatDetail("Buy/Sell AUD", stats.buySellAud)},
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

    {canExport&&<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18,flexWrap:"wrap"}}>
      <span style={{fontSize:12,color:C.muted,marginRight:2}}>Export this view:</span>
      <button onClick={()=>exportCSV(dashTx,`fintrack_${scopeName}`,members)} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"6px 12px",border:`1px solid ${C.border}`,borderRadius:6,background:C.surface2,color:C.text,display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-text" aria-hidden="true"/> CSV</button>
      <button onClick={()=>exportExcel(dashTx,`fintrack_${scopeName}`,members)} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"6px 12px",border:`1px solid #16a34a`,borderRadius:6,background:dark?"#163524":"#16a34a14",color:"#16a34a",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-spreadsheet" aria-hidden="true"/> Excel</button>
      <button onClick={()=>exportPDF(dashTx,`FinTrack — ${dashScopeLabel}`,members)} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"6px 12px",border:`1px solid #dc2626`,borderRadius:6,background:dark?"#3a1515":"#dc262614",color:"#dc2626",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-type-pdf" aria-hidden="true"/> PDF</button>
    </div>}
  </>);

  // Dashboard overview — scope bar + ALL 10 stat cards.
  const statOverview = (<>
    {statScopeBar}
    <div style={{display:"grid",gridTemplateColumns:isWideView?"repeat(6, minmax(0,1fr))":"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:18}}>
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
    <div style={{display:"flex",minHeight:isMobile?"auto":620,fontFamily:"var(--font-sans)",fontVariantNumeric:"tabular-nums",position:"relative",overflow:"hidden",borderRadius:isMobile?0:12,border:isMobile?"none":`1px solid ${C.border}`}}>
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
      {detailModal&&<DetailModal title={detailModal.title} subtitle={detailModal.subtitle} transactions={detailModal.transactions} banks={banks} yesterday={detailModal.yesterday} summary={detailModal.summary} onClose={()=>setDetailModal(null)}/>}

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
                <button onClick={handleChangePassword} style={{cursor:"pointer",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> Update password</button>
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
                <button onClick={handleAddMember} style={{cursor:"pointer",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> Add member</button>
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
                {[["holder","Holder's name","e.g. Company Ltd"],["bsb","BSB number (optional)","e.g. 062-000"],["account","Account number (optional)","e.g. 1234567890"],["payid","PayID (optional)","e.g. name@company.com"],["otpLink","OTP link (optional)","e.g. https://…"],["balance","Opening balance","0"]].map(([k,label,ph])=>(
                  <div key={k}><label style={labelStyle}>{label}</label>
                    <input type={k==="balance"?"number":"text"} placeholder={ph} value={newBank[k]} onChange={e=>setNewBank(b=>({...b,[k]:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                ))}
              </div>
              {bankError&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{bankError}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6}}>
                <button onClick={closeBankModal} style={{cursor:"pointer",padding:"9px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
                <button onClick={handleAddBank} style={{cursor:"pointer",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> Add bank</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {bdModalOpen&&(
        <div className="ft-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:"24px 16px"}} onClick={closeBdModal}>
          <div ref={bdModalRef} style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:680,maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
              <div style={{fontWeight:500,fontSize:17,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-id-badge-2" aria-hidden="true" style={{color:C.accent}}/> {bdEditId?"Edit bank detail":"Add bank detail"}</div>
              <button onClick={closeBdModal} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}><i className="ti ti-x" aria-hidden="true"/> Close</button>
            </div>
            <div style={{padding:"18px 20px",overflowY:"auto"}}>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Every field is optional.</div>
              {BD_GROUPS.map(g=>(
                <div key={g.title} className="bd-form-group" style={{marginBottom:20}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                    <i className={`ti ${g.icon}`} aria-hidden="true" style={{fontSize:13}}/>{g.title}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                    {g.fields.map(([key,label,type,icon])=>(
                      <div key={key} style={type==="textarea"||key==="bankName"?{gridColumn:"1/-1"}:null}>
                        <label style={{...labelStyle,display:"flex",alignItems:"center",gap:5}}><i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:12,color:C.muted}}/>{label}</label>
                        {key==="bankName" ? (
                          <FluidDropdown value={bdForm.bankName} placeholder="— Select bank —" ariaLabel="Bank name"
                            options={[{value:"",label:"— Select bank —"},...BANK_CHOICES.map(b=>({value:b,label:b}))]}
                            onChange={v=>setBdForm(f=>({...f,bankName:v}))}/>
                        ) : type==="textarea" ? (
                          <textarea value={bdForm[key]} onChange={e=>setBdForm(f=>({...f,[key]:e.target.value}))} rows={3} placeholder="Anything else worth noting about this record…" style={{width:"100%",boxSizing:"border-box",resize:"vertical",fontFamily:"inherit"}}/>
                        ) : (
                          <input type={type==="date"?"date":"text"} value={bdForm[key]} onChange={e=>setBdForm(f=>({...f,[key]:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {bdFormError&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{bdFormError}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6}}>
                <button onClick={closeBdModal} style={{cursor:"pointer",padding:"9px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
                <button onClick={handleSaveBd} style={{cursor:"pointer",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> {bdEditId?"Save changes":"Add record"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {bdPanel&&<BankDetailPanel bd={bdPanel} onClose={()=>setBdPanel(null)} panelRef={bdPanelRef}/>}

      {credModalOpen&&(
        <div className="ft-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:"24px 16px"}} onClick={closeCredModal}>
          <div ref={credModalRef} style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:640,maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
              <div style={{fontWeight:500,fontSize:17,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-key" aria-hidden="true" style={{color:C.accent}}/> {credEditId?"Edit record":"Add record"}</div>
              <button onClick={closeCredModal} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}><i className="ti ti-x" aria-hidden="true"/> Close</button>
            </div>
            <div style={{padding:"18px 20px",overflowY:"auto"}}>
              <div className="cred-form-group" style={{marginBottom:20}}>
                <label style={labelStyle}>Record name</label>
                <input type="text" placeholder="e.g. Nord VPN" value={credForm.name} onChange={e=>setCredForm(f=>({...f,name:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/>
              </div>
              <div className="cred-form-group" style={{marginBottom:20}}>
                <label style={labelStyle}>Category <span style={{color:C.muted,fontWeight:400}}>(optional — e.g. VPN, Console, Social)</span></label>
                <input type="text" value={credForm.category} onChange={e=>setCredForm(f=>({...f,category:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/>
              </div>
              <div className="cred-form-group" style={{marginBottom:20}}>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                  <i className="ti ti-id-badge-2" aria-hidden="true" style={{fontSize:13}}/>Common fields
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  {CRED_COMMON_FIELDS.map(([key,label,type,icon])=>(
                    <div key={key}>
                      <label style={{...labelStyle,display:"flex",alignItems:"center",gap:5}}><i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:12,color:C.muted}}/>{label} <span style={{color:C.muted,fontWeight:400}}>(optional)</span></label>
                      <input type="text" value={credForm[key]} onChange={e=>setCredForm(f=>({...f,[key]:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/>
                    </div>
                  ))}
                </div>
              </div>
              <div className="cred-form-group" style={{marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                  <i className="ti ti-list-details" aria-hidden="true" style={{fontSize:13}}/>Custom fields
                </div>
                <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Anything else — 2FA codes, passkeys, admin passwords, download links...</div>
                {credForm.customFields.map((cf,i)=>(
                  <div key={i} style={{display:"flex",gap:6,alignItems:"center",marginBottom:8}}>
                    <input type="text" placeholder="Field name" value={cf.label} onChange={e=>updateCredCustomField(i,{label:e.target.value})} style={{flex:1,boxSizing:"border-box"}}/>
                    <input type="text" placeholder="Value" value={cf.value} onChange={e=>updateCredCustomField(i,{value:e.target.value})} style={{flex:1,boxSizing:"border-box"}}/>
                    <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.muted,whiteSpace:"nowrap",cursor:"pointer"}}>
                      <input type="checkbox" checked={cf.sensitive} onChange={e=>updateCredCustomField(i,{sensitive:e.target.checked})} aria-label="Mark this field as sensitive" style={{position:"absolute",opacity:0,width:0,height:0}}/>
                      <span aria-hidden="true" style={{width:16,height:16,borderRadius:4,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",background:cf.sensitive?C.accent:"#0b0f16",border:`1px solid ${cf.sensitive?C.accent:C.borderStrong}`,transition:"all 0.15s"}}>
                        {cf.sensitive&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:11}}/>}
                      </span>
                      🔒
                    </label>
                    <button type="button" onClick={()=>removeCredCustomField(i)} aria-label="Remove field" style={{cursor:"pointer",background:"transparent",border:"none",color:C.muted,fontSize:16,padding:4,display:"flex"}}><i className="ti ti-x" aria-hidden="true"/></button>
                  </div>
                ))}
                <button type="button" onClick={addCredCustomField} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"7px 14px",border:`1px dashed ${C.borderStrong}`,borderRadius:8,background:"transparent",color:C.accent,display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-plus" aria-hidden="true"/> Add custom field</button>
              </div>
              {credFormError&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{credFormError}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6}}>
                <button onClick={closeCredModal} style={{cursor:"pointer",padding:"9px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
                <button onClick={handleSaveCred} style={{cursor:"pointer",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> {credEditId?"Save changes":"Add record"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {credPanel&&<CredentialPanel cred={credPanel} onClose={()=>setCredPanel(null)} panelRef={credPanelRef}/>}

      {pgModalOpen&&(
        <div className="ft-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:"24px 16px"}} onClick={closePgModal}>
          <div ref={pgModalRef} style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:640,maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
              <div style={{fontWeight:500,fontSize:17,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-credit-card" aria-hidden="true" style={{color:C.accent}}/> {pgEditId?"Edit record":"Add record"}</div>
              <button onClick={closePgModal} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}><i className="ti ti-x" aria-hidden="true"/> Close</button>
            </div>
            <div style={{padding:"18px 20px",overflowY:"auto"}}>
              <div className="pg-form-group" style={{marginBottom:20}}>
                <label style={labelStyle}>Record name <span style={{color:C.muted,fontWeight:400}}>(e.g. Stripe, PayPal, Airwallex)</span></label>
                <input type="text" placeholder="e.g. Stripe" value={pgForm.name} onChange={e=>setPgForm(f=>({...f,name:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/>
              </div>
              <div className="pg-form-group" style={{marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                  <i className="ti ti-id-badge-2" aria-hidden="true" style={{fontSize:13}}/>Common fields
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  {PG_COMMON_FIELDS.map(([key,label,type,icon])=>(
                    <div key={key}>
                      <label style={{...labelStyle,display:"flex",alignItems:"center",gap:5}}><i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:12,color:C.muted}}/>{label} <span style={{color:C.muted,fontWeight:400}}>(optional)</span></label>
                      <input type="text" value={pgForm[key]} onChange={e=>setPgForm(f=>({...f,[key]:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/>
                    </div>
                  ))}
                </div>
              </div>
              <div className="pg-form-group" style={{marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                  <i className="ti ti-list-details" aria-hidden="true" style={{fontSize:13}}/>Custom fields
                </div>
                <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Anything else — webhook secrets, support PINs, settlement notes...</div>
                {pgForm.customFields.map((cf,i)=>(
                  <div key={i} style={{display:"flex",gap:6,alignItems:"center",marginBottom:8}}>
                    <input type="text" placeholder="Field name" value={cf.label} onChange={e=>updatePgCustomField(i,{label:e.target.value})} style={{flex:1,boxSizing:"border-box"}}/>
                    <input type="text" placeholder="Value" value={cf.value} onChange={e=>updatePgCustomField(i,{value:e.target.value})} style={{flex:1,boxSizing:"border-box"}}/>
                    <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.muted,whiteSpace:"nowrap",cursor:"pointer"}}>
                      <input type="checkbox" checked={cf.sensitive} onChange={e=>updatePgCustomField(i,{sensitive:e.target.checked})} aria-label="Mark this field as sensitive" style={{position:"absolute",opacity:0,width:0,height:0}}/>
                      <span aria-hidden="true" style={{width:16,height:16,borderRadius:4,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",background:cf.sensitive?C.accent:"#0b0f16",border:`1px solid ${cf.sensitive?C.accent:C.borderStrong}`,transition:"all 0.15s"}}>
                        {cf.sensitive&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:11}}/>}
                      </span>
                      🔒
                    </label>
                    <button type="button" onClick={()=>removePgCustomField(i)} aria-label="Remove field" style={{cursor:"pointer",background:"transparent",border:"none",color:C.muted,fontSize:16,padding:4,display:"flex"}}><i className="ti ti-x" aria-hidden="true"/></button>
                  </div>
                ))}
                <button type="button" onClick={addPgCustomField} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"7px 14px",border:`1px dashed ${C.borderStrong}`,borderRadius:8,background:"transparent",color:C.accent,display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-plus" aria-hidden="true"/> Add custom field</button>
              </div>
              {pgFormError&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{pgFormError}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6}}>
                <button onClick={closePgModal} style={{cursor:"pointer",padding:"9px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
                <button onClick={handleSavePg} style={{cursor:"pointer",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> {pgEditId?"Save changes":"Add record"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pgPanel&&<PaymentGatewayPanel pg={pgPanel} onClose={()=>setPgPanel(null)} panelRef={pgPanelRef}/>}

      {blModalOpen&&(
        <div className="ft-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:"24px 16px"}} onClick={()=>setBlModalOpen(false)}>
          <div ref={blModalRef} style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:560,maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
              <div>
                <div style={{fontWeight:500,fontSize:17}}>Add to blacklist</div>
                <div style={{fontSize:12,color:C.muted,marginTop:3}}>Shared with every company in {SESSION.country||"your country"}</div>
              </div>
              <button onClick={()=>setBlModalOpen(false)} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>
                <i className="ti ti-x" aria-hidden="true" style={{fontSize:15}}/> Cancel
              </button>
            </div>
            <div style={{padding:"18px 20px",overflowY:"auto",background:C.bg}}>
              {/* Said up front, not after the fact: this cannot be undone by anyone. */}
              <div style={{fontSize:12.5,color:"#d97706",background:dark?"#3a2a10":"#fef3c7",border:"1px solid #d9770655",borderRadius:10,padding:"10px 12px",marginBottom:16,display:"flex",alignItems:"flex-start",gap:8}}>
                <i className="ti ti-alert-triangle" aria-hidden="true" style={{marginTop:1}}/>
                <span>Once saved this can't be edited or deleted — by you or anyone else. Every company in your country will see it, along with your name and company. Please double-check the details.</span>
              </div>
              {BL_FIELDS.map(([key,label,icon,required])=>(
                <div key={key} className="bl-form-group" style={{marginBottom:13}}>
                  <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.muted,marginBottom:5}}>
                    <i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:12.5}}/>{label}{required&&<span style={{color:"#dc2626"}}>*</span>}
                  </label>
                  {key==="reason" ? (
                    <textarea rows={3} value={blForm[key]} onChange={e=>setBlForm(f=>({...f,[key]:e.target.value}))}
                      placeholder="What happened? e.g. chargeback after withdrawal"
                      style={{width:"100%",boxSizing:"border-box",padding:"9px 11px",fontFamily:"inherit",resize:"vertical"}}/>
                  ) : (
                    <input type="text" value={blForm[key]} onChange={e=>setBlForm(f=>({...f,[key]:e.target.value}))}
                      placeholder={key==="phone"?"e.g. 0412 345 678 or +60 12 345 6789":""}
                      style={{width:"100%",boxSizing:"border-box",padding:"9px 11px"}}/>
                  )}
                  {key==="phone"&&blForm.phone.trim()&&(
                    <div style={{fontSize:11,color:C.muted,marginTop:4}}>
                      {countryFromPhone(blForm.phone)
                        ? <>Recognised as a <strong style={{color:C.text}}>{countryFromPhone(blForm.phone)}</strong> number — filed under that country's list.</>
                        : <>Number not recognised — this will be filed under {SESSION.country||"your company's country"}.</>}
                    </div>
                  )}
                </div>
              ))}
              {blFormError&&<div className="error-text" style={{marginBottom:10}}>{blFormError}</div>}
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:10,padding:"14px 20px",borderTop:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
              <button onClick={()=>setBlModalOpen(false)} style={{cursor:"pointer",padding:"9px 18px",fontSize:13.5,fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
              <button onClick={handleSaveBl} disabled={blSaving} style={{cursor:blSaving?"default":"pointer",opacity:blSaving?0.6:1,padding:"9px 20px",fontSize:13.5,fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6}}>
                <i className={`ti ti-${blSaving?"loader-2":"user-off"}`} aria-hidden="true"/> {blSaving?"Saving…":"Add to blacklist"}
              </button>
            </div>
          </div>
        </div>
      )}

      {kioskModalOpen&&(
        <div className="ft-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:"24px 16px"}} onClick={closeKioskModal}>
          <div ref={kioskModalRef} style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:640,maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${C.border}`,background:C.header,flexShrink:0}}>
              <div style={{fontWeight:500,fontSize:17,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-device-desktop" aria-hidden="true" style={{color:C.accent}}/> {kioskEditId?"Edit record":"Add record"}</div>
              <button onClick={closeKioskModal} style={{cursor:"pointer",padding:"7px 16px",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,background:"#dc2626",color:"#fff",border:"none",borderRadius:8}}><i className="ti ti-x" aria-hidden="true"/> Close</button>
            </div>
            <div style={{padding:"18px 20px",overflowY:"auto"}}>
              <div className="kiosk-form-group" style={{marginBottom:20}}>
                <label style={labelStyle}>Record name <span style={{color:C.muted,fontWeight:400}}>(e.g. Kiosk 1, Front Counter)</span></label>
                <input type="text" placeholder="e.g. Kiosk 1" value={kioskForm.name} onChange={e=>setKioskForm(f=>({...f,name:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/>
              </div>
              <div className="kiosk-form-group" style={{marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                  <i className="ti ti-id-badge-2" aria-hidden="true" style={{fontSize:13}}/>Common fields
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  {KIOSK_COMMON_FIELDS.map(([key,label,type,icon])=>(
                    <div key={key}>
                      <label style={{...labelStyle,display:"flex",alignItems:"center",gap:5}}><i className={`ti ${icon}`} aria-hidden="true" style={{fontSize:12,color:C.muted}}/>{label} <span style={{color:C.muted,fontWeight:400}}>(optional)</span></label>
                      <input type="text" value={kioskForm[key]} onChange={e=>setKioskForm(f=>({...f,[key]:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/>
                    </div>
                  ))}
                </div>
              </div>
              <div className="kiosk-form-group" style={{marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10.5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:C.accent,marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>
                  <i className="ti ti-list-details" aria-hidden="true" style={{fontSize:13}}/>Custom fields
                </div>
                <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Anything else — notes, install date, location...</div>
                {kioskForm.customFields.map((cf,i)=>(
                  <div key={i} style={{display:"flex",gap:6,alignItems:"center",marginBottom:8}}>
                    <input type="text" placeholder="Field name" value={cf.label} onChange={e=>updateKioskCustomField(i,{label:e.target.value})} style={{flex:1,boxSizing:"border-box"}}/>
                    <input type="text" placeholder="Value" value={cf.value} onChange={e=>updateKioskCustomField(i,{value:e.target.value})} style={{flex:1,boxSizing:"border-box"}}/>
                    <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.muted,whiteSpace:"nowrap",cursor:"pointer"}}>
                      <input type="checkbox" checked={cf.sensitive} onChange={e=>updateKioskCustomField(i,{sensitive:e.target.checked})} aria-label="Mark this field as sensitive" style={{position:"absolute",opacity:0,width:0,height:0}}/>
                      <span aria-hidden="true" style={{width:16,height:16,borderRadius:4,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",background:cf.sensitive?C.accent:"#0b0f16",border:`1px solid ${cf.sensitive?C.accent:C.borderStrong}`,transition:"all 0.15s"}}>
                        {cf.sensitive&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:11}}/>}
                      </span>
                      🔒
                    </label>
                    <button type="button" onClick={()=>removeKioskCustomField(i)} aria-label="Remove field" style={{cursor:"pointer",background:"transparent",border:"none",color:C.muted,fontSize:16,padding:4,display:"flex"}}><i className="ti ti-x" aria-hidden="true"/></button>
                  </div>
                ))}
                <button type="button" onClick={addKioskCustomField} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"7px 14px",border:`1px dashed ${C.borderStrong}`,borderRadius:8,background:"transparent",color:C.accent,display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-plus" aria-hidden="true"/> Add custom field</button>
              </div>
              {kioskFormError&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{kioskFormError}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6}}>
                <button onClick={closeKioskModal} style={{cursor:"pointer",padding:"9px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
                <button onClick={handleSaveKiosk} style={{cursor:"pointer",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,padding:"9px 22px",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> {kioskEditId?"Save changes":"Add record"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {kioskPanel&&<KioskPanel kiosk={kioskPanel} onClose={()=>setKioskPanel(null)} panelRef={kioskPanelRef}/>}

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
                  return <button key={t} onClick={()=>setForm(f=>({...f,type:t,fromUnclaimed:false,redeposit:false,claimDate:"",storeWithdraw:false,storeWithdrawAmount:"",actualPaid:false,actualPaidAmount:"",storeAndPaid:false,depositExtra:false,rate:"",buyAud:false,buyAudAmount:""}))} style={{cursor:"pointer",padding:"8px 14px",fontSize:13,fontWeight:500,borderRadius:8,border:`1.5px solid ${c}`,background:active?c:(dark?c+"22":c+"14"),color:active?"#fff":c}}>{t}</button>;
                })}
              </div>
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12,marginBottom:12}}>
                <div><label style={labelStyle}>{form.type==="Bank Block"?"Bank to clear":"Bank account affected (optional)"}</label>
                  <FluidDropdown value={form.bankId??""} placeholder="— None —" ariaLabel="Bank account affected"
                    options={[{value:"",label:"— None —"},...(form.type==="Bank Block"?banksLive:activeBanks).map((b,i)=>({value:b.id,label:`${i+1}. ${b.holder} — ${b.name}${b.blocked?" ❄":""}`}))]}
                    onChange={v=>setForm(f=>({...f,bankId:v===""?null:Number(v)}))}/>
                  {bankBalanceHint(form.bankId)}</div>
                <div><label style={labelStyle}>Amount ($){SIGNED_TYPES.includes(form.type)?" — use minus for negative":""}</label>
                  <input ref={amountRef} type="number" placeholder={SIGNED_TYPES.includes(form.type)?"e.g. 100 or -100":"0.00"} value={form.amount} onChange={e=>setForm(f=>{const nf={...f,amount:e.target.value}; if(f.type==="Buy/Sell AUD"){const n=buyNote(e.target.value,f.rate); if(n) nf.notes=n;} return nf;})} style={{width:"100%",boxSizing:"border-box"}}/></div>
                {form.type==="Buy/Sell AUD"&&<div><label style={labelStyle}>Rate</label>
                  <input type="number" placeholder="e.g. 3" value={form.rate} onChange={e=>setForm(f=>{const nf={...f,rate:e.target.value}; const n=buyNote(f.amount,e.target.value); if(n) nf.notes=n; return nf;})} style={{width:"100%",boxSizing:"border-box"}}/>
                  <span style={{fontSize:11,color:C.muted,marginTop:3,display:"block"}}>Amount × rate is written to the note{buyNote(form.amount,form.rate)?`: ${buyNote(form.amount,form.rate)}`:""}.</span></div>}
                {form.type==="Transfer"&&<div style={{gridColumn:"1/-1"}}><label style={labelStyle}>Destination bank (optional)</label>
                  <FluidDropdown value={form.toBankId??""} placeholder="— None —" ariaLabel="Destination bank"
                    options={[{value:"",label:"— None —"},...activeBanks.filter(b=>b.id!==form.bankId).map((b,i)=>({value:b.id,label:`${i+1}. ${b.holder} — ${b.name}`}))]}
                    onChange={v=>setForm(f=>({...f,toBankId:v===""?null:Number(v)}))}/>
                  {bankBalanceHint(form.toBankId)}</div>}
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
                  <BlacklistWarning hit={entryNameHit} matchedOn="name"/>
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
                  <BlacklistWarning hit={entryPhoneHit} matchedOn="number"/>
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
                            options={claimableDates.map(d=>({value:d,label:`${fmtDate(d)} — ${fmt(unclaimedByDate[d])} left`}))}
                            onChange={v=>setForm(f=>({...f,claimDate:v}))}/>
                          <span>· the deposit still counts as today</span>
                        </div>
                    )}
                  </div>
                )}
                {form.type==="Regular Withdrawal"&&(()=>{
                  // 3 withdrawal options as compact tick-boxes, 2 per row; the matching
                  // amount field appears full-width below when one is ticked. All three
                  // are mutually exclusive.
                  const pill = (active,accent)=>({position:"relative",display:"inline-flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:8,border:`1px solid ${active?accent:C.border}`,background:C.surface2,cursor:"pointer",userSelect:"none",transition:"border-color 0.15s",flex:"1 1 calc(50% - 4px)",minWidth:148,boxSizing:"border-box"});
                  const box = (active,accent)=>({width:18,height:18,borderRadius:5,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",background:active?accent:"#0b0f16",border:`1px solid ${active?accent:C.borderStrong}`,boxShadow:active?`0 0 0 3px ${accent}44`:"none",transition:"all 0.15s"});
                  const top = Number(form.amount)||0;
                  const swLeft = Math.round((top-(Number(form.storeWithdrawAmount)||0))*100)/100;
                  const apLeft = Math.round((top-(Number(form.actualPaidAmount)||0))*100)/100;
                  const spLeft = Math.round((top-(Number(form.storeWithdrawAmount)||0)-(Number(form.actualPaidAmount)||0))*100)/100;
                  const baLeft = Math.round((top-(Number(form.buyAudAmount)||0))*100)/100;
                  return (
                  <div style={{gridColumn:"1/-1",display:"flex",flexDirection:"column",gap:10}}>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      <label style={pill(form.redeposit,"#2563eb")}>
                        <input type="checkbox" checked={!!form.redeposit} onChange={e=>{const on=e.target.checked;setForm(f=>({...f,redeposit:on,storeWithdraw:on?false:f.storeWithdraw,actualPaid:on?false:f.actualPaid,storeAndPaid:on?false:f.storeAndPaid,buyAud:on?false:f.buyAud}));}} style={{position:"absolute",opacity:0,width:0,height:0}}/>
                        <span aria-hidden="true" style={box(form.redeposit,"#2563eb")}>{form.redeposit&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:13}}/>}</span>
                        <span style={{display:"flex",flexDirection:"column",lineHeight:1.2,minWidth:0}}>
                          <span style={{fontSize:12.5,fontWeight:500,color:C.text}}>Redeposit</span>
                          <span style={{fontSize:10,color:C.muted}}>No bank · withdraw + deposit</span>
                        </span>
                      </label>
                      <label style={pill(form.storeWithdraw,"#d97706")}>
                        <input type="checkbox" checked={!!form.storeWithdraw} onChange={e=>{const on=e.target.checked;setForm(f=>({...f,storeWithdraw:on,redeposit:on?false:f.redeposit,actualPaid:on?false:f.actualPaid,storeAndPaid:on?false:f.storeAndPaid,buyAud:on?false:f.buyAud}));}} style={{position:"absolute",opacity:0,width:0,height:0}}/>
                        <span aria-hidden="true" style={box(form.storeWithdraw,"#d97706")}>{form.storeWithdraw&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:13}}/>}</span>
                        <span style={{display:"flex",flexDirection:"column",lineHeight:1.2,minWidth:0}}>
                          <span style={{fontSize:12.5,fontWeight:500,color:C.text}}>Store withdraw</span>
                          <span style={{fontSize:10,color:C.muted}}>Uses store credit</span>
                        </span>
                      </label>
                      <label style={pill(form.actualPaid,"#0d9488")}>
                        <input type="checkbox" checked={!!form.actualPaid} onChange={e=>{const on=e.target.checked;setForm(f=>({...f,actualPaid:on,redeposit:on?false:f.redeposit,storeWithdraw:on?false:f.storeWithdraw,storeAndPaid:on?false:f.storeAndPaid,buyAud:on?false:f.buyAud}));}} style={{position:"absolute",opacity:0,width:0,height:0}}/>
                        <span aria-hidden="true" style={box(form.actualPaid,"#0d9488")}>{form.actualPaid&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:13}}/>}</span>
                        <span style={{display:"flex",flexDirection:"column",lineHeight:1.2,minWidth:0}}>
                          <span style={{fontSize:12.5,fontWeight:500,color:C.text}}>Actual paid amount</span>
                          <span style={{fontSize:10,color:C.muted}}>Bank pays part · leftover → unclaimed</span>
                        </span>
                      </label>
                      <label style={pill(form.storeAndPaid,"#7c3aed")}>
                        <input type="checkbox" checked={!!form.storeAndPaid} onChange={e=>{const on=e.target.checked;setForm(f=>({...f,storeAndPaid:on,redeposit:on?false:f.redeposit,storeWithdraw:on?false:f.storeWithdraw,actualPaid:on?false:f.actualPaid,buyAud:on?false:f.buyAud}));}} style={{position:"absolute",opacity:0,width:0,height:0}}/>
                        <span aria-hidden="true" style={box(form.storeAndPaid,"#7c3aed")}>{form.storeAndPaid&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:13}}/>}</span>
                        <span style={{display:"flex",flexDirection:"column",lineHeight:1.2,minWidth:0}}>
                          <span style={{fontSize:12.5,fontWeight:500,color:C.text}}>Store + actual paid</span>
                          <span style={{fontSize:10,color:C.muted}}>Store + bank · leftover → unclaimed</span>
                        </span>
                      </label>
                      <label style={pill(form.buyAud,"#db2777")}>
                        <input type="checkbox" checked={!!form.buyAud} onChange={e=>{const on=e.target.checked;setForm(f=>({...f,buyAud:on,redeposit:on?false:f.redeposit,storeWithdraw:on?false:f.storeWithdraw,actualPaid:on?false:f.actualPaid,storeAndPaid:on?false:f.storeAndPaid}));}} style={{position:"absolute",opacity:0,width:0,height:0}}/>
                        <span aria-hidden="true" style={box(form.buyAud,"#db2777")}>{form.buyAud&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:13}}/>}</span>
                        <span style={{display:"flex",flexDirection:"column",lineHeight:1.2,minWidth:0}}>
                          <span style={{fontSize:12.5,fontWeight:500,color:C.text}}>Buy AUD</span>
                          <span style={{fontSize:10,color:C.muted}}>Uses Buy/Sell AUD · leftover → unclaimed</span>
                        </span>
                      </label>
                    </div>
                    {form.storeWithdraw&&(
                      <div style={{display:"flex",flexDirection:"column",gap:6,paddingLeft:2}}>
                        <label style={{fontSize:12,fontWeight:500,color:C.text}}>Store-credit amount to use</label>
                        <input type="number" placeholder="e.g. 500" value={form.storeWithdrawAmount} onChange={e=>setForm(f=>({...f,storeWithdrawAmount:e.target.value}))} style={{maxWidth:240,boxSizing:"border-box"}}/>
                        <span style={{fontSize:11.5,color:C.muted}}>Store credit available: <strong style={{color:C.text}}>{fmt(storeCredit)}</strong>{(Number(form.storeWithdrawAmount)||0)>0 && <> · leftover <strong style={{color:swLeft<0?"#dc2626":C.text}}>{fmt(swLeft)}</strong> → unclaimed credit</>}</span>
                      </div>
                    )}
                    {form.actualPaid&&(
                      <div style={{display:"flex",flexDirection:"column",gap:6,paddingLeft:2}}>
                        <label style={{fontSize:12,fontWeight:500,color:C.text}}>Amount actually paid from the bank</label>
                        <input type="number" placeholder="e.g. 500" value={form.actualPaidAmount} onChange={e=>setForm(f=>({...f,actualPaidAmount:e.target.value}))} style={{maxWidth:240,boxSizing:"border-box"}}/>
                        <span style={{fontSize:11.5,color:C.muted}}>The selected bank is debited this amount.{(Number(form.actualPaidAmount)||0)>0 && <> Leftover <strong style={{color:apLeft<0?"#dc2626":C.text}}>{fmt(apLeft)}</strong> → unclaimed credit.</>} A bank must be selected.</span>
                      </div>
                    )}
                    {form.storeAndPaid&&(
                      <div style={{display:"flex",flexDirection:"column",gap:8,paddingLeft:2}}>
                        <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            <label style={{fontSize:12,fontWeight:500,color:C.text}}>Deduct from store</label>
                            <input type="number" placeholder="e.g. 300" value={form.storeWithdrawAmount} onChange={e=>setForm(f=>({...f,storeWithdrawAmount:e.target.value}))} style={{maxWidth:200,boxSizing:"border-box"}}/>
                          </div>
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            <label style={{fontSize:12,fontWeight:500,color:C.text}}>Deduct from bank</label>
                            <input type="number" placeholder="e.g. 200" value={form.actualPaidAmount} onChange={e=>setForm(f=>({...f,actualPaidAmount:e.target.value}))} style={{maxWidth:200,boxSizing:"border-box"}}/>
                          </div>
                        </div>
                        <span style={{fontSize:11.5,color:C.muted}}>Store available: <strong style={{color:C.text}}>{fmt(storeCredit)}</strong> · the bank is debited the bank amount{((Number(form.storeWithdrawAmount)||0)>0||(Number(form.actualPaidAmount)||0)>0) ? <> · leftover <strong style={{color:spLeft<0?"#dc2626":C.text}}>{fmt(spLeft)}</strong> → unclaimed credit</> : null}. A bank must be selected.</span>
                      </div>
                    )}
                    {form.buyAud&&(
                      <div style={{display:"flex",flexDirection:"column",gap:6,paddingLeft:2}}>
                        <label style={{fontSize:12,fontWeight:500,color:C.text}}>Buy AUD amount to use</label>
                        <input type="number" placeholder="e.g. 500" value={form.buyAudAmount} onChange={e=>setForm(f=>({...f,buyAudAmount:e.target.value}))} style={{maxWidth:240,boxSizing:"border-box"}}/>
                        <span style={{fontSize:11.5,color:C.muted}}>Buy/Sell AUD available: <strong style={{color:C.text}}>{fmt(buySellAudBalance)}</strong>{(Number(form.buyAudAmount)||0)>0 && <> · leftover <strong style={{color:baLeft<0?"#dc2626":C.text}}>{fmt(baLeft)}</strong> → unclaimed credit</>}</span>
                      </div>
                    )}
                  </div>
                  );
                })()}
                {form.type==="Mistake"&&(
                  <div style={{gridColumn:"1/-1"}}>
                    <label style={{position:"relative",display:"inline-flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:8,border:`1px solid ${form.depositExtra?"#7c3aed":C.border}`,background:C.surface2,cursor:"pointer",userSelect:"none"}}>
                      <input type="checkbox" checked={!!form.depositExtra} onChange={e=>setForm(f=>({...f,depositExtra:e.target.checked}))} style={{position:"absolute",opacity:0,width:0,height:0}}/>
                      <span aria-hidden="true" style={{width:18,height:18,borderRadius:5,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",color:"#fff",background:form.depositExtra?"#7c3aed":"#0b0f16",border:`1px solid ${form.depositExtra?"#7c3aed":C.borderStrong}`}}>{form.depositExtra&&<i className="ti ti-check" aria-hidden="true" style={{fontSize:13}}/>}</span>
                      <span style={{display:"flex",flexDirection:"column",lineHeight:1.2,minWidth:0}}>
                        <span style={{fontSize:12.5,fontWeight:500,color:C.text}}>Deposit Extra</span>
                        <span style={{fontSize:10,color:C.muted}}>Also adds this amount to Total deposits · no bank</span>
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
                      <span><i className="ti ti-calendar-event" aria-hidden="true" style={{marginRight:4}}/>This entry will be dated {fmtDate(form.date)} instead of today.</span>
                      <button type="button" onClick={()=>setForm(f=>({...f,date:""}))} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:11.5,textDecoration:"underline",padding:0}}>Reset to today</button>
                    </div>
                  )}
                </div>
              </div>
              {formError&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{formError}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6,...(isMobile?{position:"sticky",bottom:0,background:C.bg,paddingTop:12,paddingBottom:"calc(6px + env(safe-area-inset-bottom))",borderTop:`1px solid ${C.border}`,margin:"6px -20px 0",paddingLeft:20,paddingRight:20}:null)}}>
                <button onClick={closeEntryModal} style={{cursor:"pointer",padding:"11px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,flex:isMobile?1:"none",minHeight:isMobile?46:"auto"}}>Cancel</button>
                <button onClick={handleAddTx} style={{padding:"11px 22px",cursor:"pointer",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,flex:isMobile?1:"none",minHeight:isMobile?46:"auto"}}><i className="ti ti-check" aria-hidden="true"/> Add entry</button>
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
                  <div style={{width:40,height:40,borderRadius:10,background:"linear-gradient(135deg,#26241d,#100f0c)",display:"flex",alignItems:"center",justifyContent:"center",color:"#e3b341",fontWeight:700,fontSize:17,flexShrink:0,boxShadow:"0 1px 2px rgba(0,0,0,0.1)"}}>
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
              <div style={{width:32,height:32,borderRadius:"50%",background:C.accent,color:C.onAccent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>
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
            <UpdateBell />
            <button onClick={()=>window.FINTRACK_SET_THEME&&window.FINTRACK_SET_THEME(dark?"light":"dark")} title={dark?"Switch to light mode":"Switch to dark mode"} aria-label="Toggle theme"
              style={{position:"relative",width:56,height:30,flexShrink:0,borderRadius:999,border:`2px solid ${dark?"#2d2a4e":"#e8d5b7"}`,background:dark?"#1a1838":"#fef3c7",cursor:"pointer",padding:0,transition:"background 0.3s, border-color 0.3s"}}>
              <span style={{position:"absolute",top:"50%",transform:"translateY(-50%)",left:dark?"calc(100% - 24px)":2,width:22,height:22,borderRadius:"50%",display:"grid",placeItems:"center",background:dark?"#e8e6f0":"#ff9500",color:dark?"#1a1838":"#ffffff",boxShadow:"0 1px 3px rgba(0,0,0,0.3)",transition:"left 0.3s, background 0.3s"}}>
                <i className={`ti ti-${dark?"moon":"sun"}`} aria-hidden="true" style={{fontSize:13,display:"block",lineHeight:1}}/>
              </span>
            </button>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:C.muted,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:"5px 10px"}} title={`This company's time zone: ${tz}. Entries are stamped with this clock.`}>
              <i className="ti ti-clock-hour-4" aria-hidden="true" style={{fontSize:15,color:C.accent}}/>
              <LiveClock tz={tz} color={C.text}/>
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
                <div style={{width:26,height:26,borderRadius:"50%",background:C.accent,color:C.onAccent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:600,flexShrink:0}}>
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
              {banksLive.length===0&&<div style={{fontSize:13,color:"#d97706",marginBottom:14,padding:"10px 14px",background:dark?"#3a2a10":"#fdf3e0",borderRadius:8,border:`1px solid #d9770655`}}><i className="ti ti-alert-triangle" aria-hidden="true"/> Add a bank account on the Bank Accounts page before recording transactions.</div>}
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
                <button onClick={()=>{ setNewBank({name:"",holder:"",bsb:"",account:"",payid:"",otpLink:"",balance:""}); setBankError(""); setShowBankModal(true); }} style={{cursor:"pointer",padding:"9px 20px",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6,fontSize:14}}>
                  <i className="ti ti-plus" aria-hidden="true"/> Add bank
                </button>
              }>Bank accounts</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Click a card to view its full transaction history.</div>
              {banksLive.length>0&&(
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:12}}>
                  <span style={{fontSize:12.5,color:C.muted,fontWeight:500}}>Balances as of</span>
                  {toggleBtn(!bankAsOfSel,()=>setBankAsOfSel(""),"Today")}
                  {toggleBtn(bankAsOfSel===yesterday,()=>setBankAsOfSel(yesterday),"Yesterday")}
                  <input type="date" value={bankAsOfSel} max={today} onChange={e=>setBankAsOfSel(e.target.value)} style={{boxSizing:"border-box"}}/>
                  {bankIsPast&&<span style={{fontSize:12,color:C.accent,display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-history" aria-hidden="true"/> Showing closing balances as of {fmtDate(bankAsOf)}</span>}
                </div>
              )}
              {banksLive.length>0&&<div style={{marginBottom:16}}><BankTotals banksLive={banksAsOf} asOf={bankAsOf} isPast={bankIsPast}/></div>}
              {banksLive.length>0&&(
                <div style={{position:"relative",maxWidth:420,marginBottom:14}}>
                  <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
                  <input type="text" value={bankSearch} onChange={e=>setBankSearch(e.target.value)} placeholder="Search holder, bank, account or PayID…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
                  {bankSearch&&<button type="button" onClick={()=>setBankSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
                </div>
              )}
              {banksLive.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No bank accounts yet. Click "Add bank" to create one.</div>}
              {banksLive.length>0&&banksShown.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No banks match “{bankSearch}”.</div>}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(max(220px, calc((100% - 48px) / 5)), 1fr))",gap:12}}>
                {banksShown.map(b=>(
                  <GlowCard key={b.id} color={C.accent} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 16px",cursor:editingBank===b.id?"default":"pointer",...(b.blocked?frozenCardStyle:null)}}
                    onMouseEnter={e=>{if(editingBank!==b.id)e.currentTarget.style.borderColor=C.accent;}}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=b.blocked?FROST_BORDER:C.border}
                    onClick={()=>{if(editingBank!==b.id) openBankDetail(b);}}>
                    {editingBank===b.id?(
                      <div onClick={e=>e.stopPropagation()}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                          {[["name","Bank name"],["holder","Holder's name"],["bsb","BSB number"],["account","Account number"],["payid","PayID"],["otpLink","OTP link"],["balance","Opening balance"]].map(([k,lbl])=>(
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
                          {b.blocked&&<span style={{flexShrink:0,fontSize:10,fontWeight:600,color:dark?"#7dd3fc":"#0369a1",background:dark?"#0e2a3a":"#e0f2fe",border:"1px solid #38bdf8",borderRadius:4,padding:"1px 6px",display:"inline-flex",alignItems:"center",gap:3}}><i className="ti ti-snowflake" aria-hidden="true" style={{fontSize:11}}/>Frozen</span>}
                        </div>
                        <div style={{fontSize:12,color:C.muted,marginBottom:2}}>Bank: {b.name}</div>
                        <div style={{fontSize:12,color:C.muted,marginBottom:2}}>BSB: {b.bsb||"—"}</div>
                        <div style={{fontSize:12,color:C.muted,marginBottom:2}}>Account: {b.account}</div>
                        <div style={{fontSize:12,color:C.muted,marginBottom:b.otpLink?6:8}}>PayID: {b.payid||"—"}</div>
                        {b.otpLink&&(isSafeHttpUrl(b.otpLink)
                          ? <a href={b.otpLink} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,fontWeight:600,color:C.accent,background:C.accentBg,border:`1px solid ${C.accent}`,borderRadius:6,padding:"3px 9px",marginBottom:8,textDecoration:"none"}}><i className="ti ti-link" aria-hidden="true"/> OTP link</a>
                          : <div style={{fontSize:12,color:C.muted,marginBottom:8,wordBreak:"break-all"}}>OTP link: {b.otpLink}</div>)}
                        <div style={{fontSize:20,fontWeight:500,color:C.text}}>{fmt(b.balance)}</div>
                        <div style={{fontSize:11,color:C.muted,marginTop:2}}>Yesterday: {fmt(b.yBalance)}</div>
                        {bankIsPast&&<div style={{fontSize:11,fontWeight:600,color:C.accent,marginTop:1}}>Closing {fmtDate(bankAsOf)}: {fmt(b.asOfBalance)}</div>}
                        {bankTodayCounts(b)}
                        <div style={{fontSize:11,color:C.muted,marginTop:6}}>Click card to view history</div>
                        <div onClick={e=>e.stopPropagation()} style={{display:"flex",flexDirection:"column",gap:8,marginTop:10}}>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={()=>startEditBank(b)} style={{...editBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-edit" aria-hidden="true"/> Edit</button>
                            <button onClick={()=>handleDeleteBank(b.id,b.name)} style={{...deleteBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-trash" aria-hidden="true"/> Del</button>
                          </div>
                          <button onClick={()=>handleToggleBankActive(b.id)} disabled={!!b.blocked}
                            style={{...(b.active===false?bankInactiveBtnStyle:bankActiveBtnStyle),justifyContent:"center",...(b.blocked?{opacity:0.5,cursor:"not-allowed"}:null)}}
                            title={b.blocked?"Frozen — unfreeze this bank before you can activate it":(b.active===false?"Inactive — click to show this bank in the dashboard & entry dropdowns":"Active — click to hide this bank from the dashboard & entry dropdowns")}>
                            <i className={`ti ti-${b.active===false?"circle-off":"circle-check"}`} aria-hidden="true"/> {b.active===false?"Inactive":"Active"}
                          </button>
                          <button onClick={()=>handleToggleBankBlock(b.id)}
                            style={{...(b.blocked?bankBlockedBtnStyle:bankBlockBtnStyle),justifyContent:"center"}}
                            title={b.blocked?"Frozen — click to unfreeze so it can be activated again":"Click to freeze this bank — it can't be activated until you unfreeze it"}>
                            <i className={`ti ti-${b.blocked?"snowflake-off":"snowflake"}`} aria-hidden="true"/> {b.blocked?"Unfreeze":"Freeze"}
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

        {page==="bankdetails"&&canAccessBankDetails&&(
          <div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-id-badge-2" right={canEditVaults?(
                <button onClick={openBdAdd} style={{cursor:"pointer",padding:"9px 20px",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6,fontSize:14}}>
                  <i className="ti ti-plus" aria-hidden="true"/> Add bank detail
                </button>
              ):null}>Bank Details</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>{canEditVaults
                ? `Master/manager only. Recorded drop-account info — not linked to Bank Accounts unless you click "Add to bank accounts". Click a card for the full record.`
                : "Read-only for owners. Recorded drop-account info. Click a card for the full record."}</div>
              {bankDetails.length>0&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:16}}>
                  <SumTile icon="ti-id-badge-2" color={C.accent} label="Total records" value={bankDetails.length}/>
                  <SumTile icon="ti-circle-check" color="#16a34a" label="Active" value={bankDetails.filter(b=>!b.frozen).length}/>
                  <SumTile icon="ti-snowflake" color="#38bdf8" label="Frozen" value={bankDetails.filter(b=>b.frozen).length}/>
                </div>
              )}
              {bankDetails.length>0&&(
                <div style={{position:"relative",maxWidth:420,marginBottom:14}}>
                  <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
                  <input type="text" value={bdSearch} onChange={e=>setBdSearch(e.target.value)} placeholder="Search holder, bank, agent, BSB, account or PayID…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
                  {bdSearch&&<button type="button" onClick={()=>setBdSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
                </div>
              )}
              {!bdLoaded&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center"}}>Loading…</div>}
              {bdLoaded&&bdLoadError&&<div style={{fontSize:13,color:"#dc2626",padding:"20px",textAlign:"center",border:"1px solid #dc262655",borderRadius:10}}>{bdLoadError}</div>}
              {bdLoaded&&!bdLoadError&&bankDetails.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>{canEditVaults?`No bank-detail records yet. Click "Add bank detail" to create one.`:"No bank-detail records saved for this company yet."}</div>}
              {bdLoaded&&bankDetails.length>0&&bdShown.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No records match “{bdSearch}”.</div>}
              <div ref={bdGridRef} style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(max(240px, calc((100% - 36px) / 4)), 1fr))",gap:12}}>
                {bdShown.map(bd=>(
                  <BankDetailCard key={bd.id} bd={bd}
                    onOpen={()=>setBdPanel(bd)}
                    onEdit={canEditVaults?()=>openBdEdit(bd):null}
                    onDelete={()=>handleDeleteBd(bd.id,bd.holderName||bd.bankName)}
                    onToggleFrozen={()=>handleToggleBdFrozen(bd)}
                    onAddToBankAccounts={()=>handleAddBdToBankAccounts(bd)}/>
                ))}
              </div>
            </div>
          </div>
        )}

        {page==="companycredentials"&&canAccessCompanyCredentials&&(
          <div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-key" right={canEditVaults?(
                <button onClick={openCredAdd} style={{cursor:"pointer",padding:"9px 20px",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6,fontSize:14}}>
                  <i className="ti ti-plus" aria-hidden="true"/> Add record
                </button>
              ):null}>{SESSION.companyName} Details</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>{canEditVaults?"Master/manager only.":"Read-only for owners."} {credentials.length} record{credentials.length===1?"":"s"} saved. Click a card for the full record.</div>
              {credentials.length>0&&(
                <div style={{position:"relative",maxWidth:420,marginBottom:14}}>
                  <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
                  <input type="text" value={credSearch} onChange={e=>setCredSearch(e.target.value)} placeholder="Search name, category, username, email or link…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
                  {credSearch&&<button type="button" onClick={()=>setCredSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
                </div>
              )}
              {!credLoaded&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center"}}>Loading…</div>}
              {credLoaded&&credLoadError&&<div style={{fontSize:13,color:"#dc2626",padding:"20px",textAlign:"center",border:"1px solid #dc262655",borderRadius:10}}>{credLoadError}</div>}
              {credLoaded&&!credLoadError&&credentials.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>{canEditVaults?`No records yet. Click "Add record" to create one.`:"No records saved for this company yet."}</div>}
              {credLoaded&&credentials.length>0&&credShown.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No records match “{credSearch}”.</div>}
              <div ref={credGridRef} style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(max(240px, calc((100% - 36px) / 4)), 1fr))",gap:12}}>
                {credShown.map(cred=>(
                  <CredentialCard key={cred.id} cred={cred}
                    onOpen={()=>setCredPanel(cred)}
                    onEdit={canEditVaults?()=>openCredEdit(cred):null}
                    onDelete={()=>handleDeleteCred(cred.id,cred.name)}/>
                ))}
              </div>
            </div>
          </div>
        )}

        {page==="paymentgateways"&&canAccessPaymentGateways&&(
          <div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-credit-card" right={canEditVaults?(
                <button onClick={openPgAdd} style={{cursor:"pointer",padding:"9px 20px",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6,fontSize:14}}>
                  <i className="ti ti-plus" aria-hidden="true"/> Add record
                </button>
              ):null}>Payment Gateway Details</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>{canEditVaults?"Master/manager only.":"Read-only for owners."} {paymentGateways.length} record{paymentGateways.length===1?"":"s"} saved. Click a card for the full record.</div>
              {paymentGateways.length>0&&(
                <div style={{position:"relative",maxWidth:420,marginBottom:14}}>
                  <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
                  <input type="text" value={pgSearch} onChange={e=>setPgSearch(e.target.value)} placeholder="Search name, login ID, merchant code or link…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
                  {pgSearch&&<button type="button" onClick={()=>setPgSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
                </div>
              )}
              {!pgLoaded&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center"}}>Loading…</div>}
              {pgLoaded&&pgLoadError&&<div style={{fontSize:13,color:"#dc2626",padding:"20px",textAlign:"center",border:"1px solid #dc262655",borderRadius:10}}>{pgLoadError}</div>}
              {pgLoaded&&!pgLoadError&&paymentGateways.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>{canEditVaults?`No records yet. Click "Add record" to create one.`:"No records saved for this company yet."}</div>}
              {pgLoaded&&paymentGateways.length>0&&pgShown.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No records match "{pgSearch}".</div>}
              <div ref={pgGridRef} style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(max(240px, calc((100% - 36px) / 4)), 1fr))",gap:12}}>
                {pgShown.map(pg=>(
                  <PaymentGatewayCard key={pg.id} pg={pg}
                    onOpen={()=>setPgPanel(pg)}
                    onEdit={canEditVaults?()=>openPgEdit(pg):null}
                    onDelete={()=>handleDeletePg(pg.id,pg.name)}/>
                ))}
              </div>
            </div>
          </div>
        )}

        {page==="kioskdetails"&&(
          <div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-device-desktop" right={canEditKiosk?(
                <button onClick={openKioskAdd} style={{cursor:"pointer",padding:"9px 20px",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6,fontSize:14}}>
                  <i className="ti ti-plus" aria-hidden="true"/> Add record
                </button>
              ):null}>Game Kiosk Details</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>{canEditKiosk?"":"Read-only for owners. "}{kioskDetails.length} record{kioskDetails.length===1?"":"s"} saved. Click a card for the full record.</div>
              {kioskDetails.length>0&&(
                <div style={{position:"relative",maxWidth:420,marginBottom:14}}>
                  <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
                  <input type="text" value={kioskSearch} onChange={e=>setKioskSearch(e.target.value)} placeholder="Search name, login ID, merchant code or link…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
                  {kioskSearch&&<button type="button" onClick={()=>setKioskSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
                </div>
              )}
              {!kioskLoaded&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center"}}>Loading…</div>}
              {kioskLoaded&&kioskLoadError&&<div style={{fontSize:13,color:"#dc2626",padding:"20px",textAlign:"center",border:"1px solid #dc262655",borderRadius:10}}>{kioskLoadError}</div>}
              {kioskLoaded&&!kioskLoadError&&kioskDetails.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>{canEditKiosk?`No records yet. Click "Add record" to create one.`:"No records saved for this company yet."}</div>}
              {kioskLoaded&&kioskDetails.length>0&&kioskShown.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No records match "{kioskSearch}".</div>}
              <div ref={kioskGridRef} style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(max(240px, calc((100% - 36px) / 4)), 1fr))",gap:12}}>
                {kioskShown.map(kiosk=>(
                  <KioskCard key={kiosk.id} kiosk={kiosk}
                    onOpen={()=>setKioskPanel(kiosk)}
                    onEdit={canEditKiosk?()=>openKioskEdit(kiosk):null}
                    onDelete={()=>handleDeleteKiosk(kiosk.id,kiosk.name)}/>
                ))}
              </div>
            </div>
          </div>
        )}

        {page==="blacklist"&&(
          <div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-user-off" right={canAddBlacklist?(
                <button onClick={openBlAdd} style={{cursor:"pointer",padding:"9px 20px",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6,fontSize:14}}>
                  <i className="ti ti-plus" aria-hidden="true"/> Add to blacklist
                </button>
              ):null}>Blacklist Member</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14,lineHeight:1.6}}>
                Shared with every company in {SESSION.country||"your country"} — anything added here shows up on
                their list too, and theirs shows up on yours. Anyone can add. <strong style={{color:C.text}}>Entries can't be edited or
                deleted afterwards</strong>, so check the details before saving. {blacklist.length} {blacklist.length===1?"entry":"entries"}.
              </div>
              {!SESSION.country&&blLoaded&&!blLoadError&&(
                <div style={{fontSize:12.5,color:"#d97706",background:dark?"#3a2a10":"#fef3c7",border:"1px solid #d9770655",borderRadius:10,padding:"10px 12px",marginBottom:14,display:"flex",alignItems:"flex-start",gap:8}}>
                  <i className="ti ti-alert-triangle" aria-hidden="true" style={{marginTop:1}}/>
                  <span>No country is set for this company yet, so this list can't be shared or added to. Ask your provider to set the company's country.</span>
                </div>
              )}
              {blacklist.length>0&&(
                <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
                  <div style={{position:"relative",flex:"1 1 300px",maxWidth:460}}>
                    <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
                    <input type="text" value={blSearch} onChange={e=>setBlSearch(e.target.value)} placeholder="Search name, phone, PayID, account, reason…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
                    {blSearch&&<button type="button" onClick={()=>setBlSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.muted}}>
                    <span>Sort</span>
                    <FluidDropdown width={150} value={blSort} ariaLabel="Sort blacklist" options={BL_SORTS} onChange={v=>setBlSort(v)}/>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.muted}}>
                    <span>Show</span>
                    <FluidDropdown width={100} value={blPageSize} ariaLabel="Rows per page"
                      options={PAGE_SIZES.map(n=>({value:n,label:String(n)}))}
                      onChange={v=>setBlPageSize(Number(v))}/>
                    <span>per page</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12.5,color:C.muted,marginLeft:"auto"}}>
                    <span>{blTotal===0?0:blStart+1}–{Math.min(blStart+blPageSize,blTotal)} of {blTotal}</span>
                    <button onClick={()=>setBlPage(Math.max(1,blCurPage-1))} disabled={blCurPage<=1} style={pagerBtn(blCurPage<=1)} aria-label="Previous page"><i className="ti ti-chevron-left" aria-hidden="true"/></button>
                    <span>{blCurPage}/{blPages}</span>
                    <button onClick={()=>setBlPage(Math.min(blPages,blCurPage+1))} disabled={blCurPage>=blPages} style={pagerBtn(blCurPage>=blPages)} aria-label="Next page"><i className="ti ti-chevron-right" aria-hidden="true"/></button>
                  </div>
                </div>
              )}
              {!blLoaded&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center"}}>Loading…</div>}
              {blLoaded&&blLoadError&&<div style={{fontSize:13,color:"#dc2626",padding:"20px",textAlign:"center",border:"1px solid #dc262655",borderRadius:10}}>{blLoadError}</div>}
              {blLoaded&&!blLoadError&&blacklist.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>Nobody on the blacklist yet.{canAddBlacklist?` Click "Add to blacklist" to report someone.`:""}</div>}
              {blLoaded&&blacklist.length>0&&blShown.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>Nobody matches “{blSearch}”.</div>}
              {blShown.length>0&&(
                /* Eight separate columns forced a horizontal drag to read one
                   person. Related facts are stacked into four instead — who they
                   are, how they'd be paid, what they did, who said so — and the
                   fixed layout with percentage widths means the table always fits
                   its container instead of growing to fit its longest cell. */
                /* overflowX:auto, NOT hidden. The fixed layout means there's
                   nothing to scroll at desktop widths — that's the point of the
                   redesign — but on a phone the columns can't compress below
                   their content and need ~20px more than the screen has.
                   Hidden would silently clip that off with no way to reach it. */
                <div ref={blGridRef} style={{border:`1px solid ${C.border}`,borderRadius:10,overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,tableLayout:"fixed"}}>
                    <colgroup>
                      <col style={{width:canDeleteBlacklist?"24%":"26%"}}/>
                      <col style={{width:canDeleteBlacklist?"21%":"23%"}}/>
                      <col style={{width:canDeleteBlacklist?"29%":"31%"}}/>
                      <col style={{width:"20%"}}/>
                      {canDeleteBlacklist&&<col style={{width:"6%"}}/>}
                    </colgroup>
                    <thead>
                      <tr style={{background:C.header}}>
                        {["Person","Payment details","Reason","Reported by",...(canDeleteBlacklist?[""]:[])].map((h,i)=>(
                          <th key={i} style={{textAlign:"left",padding:"9px 10px",color:C.muted,fontWeight:500,fontSize:11,textTransform:"uppercase",letterSpacing:"0.04em",borderBottom:`1px solid ${C.border}`}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {blSlice.map((b,idx)=>(
                        <tr key={b.id} className="bl-row" style={{borderBottom:`1px solid ${C.border}`,background:idx%2?C.surface:"transparent",verticalAlign:"top"}}>
                          <td style={{padding:"8px 10px"}}>
                            <div style={{color:C.text,fontWeight:600,lineHeight:1.35,wordBreak:"break-word"}}>{b.name}</div>
                            {b.phone&&<div style={{fontSize:11.5,color:C.muted,fontFamily:"var(--font-mono)",wordBreak:"break-word",marginTop:1}}>{b.phone}</div>}
                          </td>
                          <td style={{padding:"8px 10px",fontSize:11.5,color:C.muted}}>
                            {b.payid&&<div style={{wordBreak:"break-word",lineHeight:1.35}}>{b.payid}</div>}
                            {(b.bsb||b.accountNo)&&(
                              <div style={{fontFamily:"var(--font-mono)",marginTop:1,wordBreak:"break-word"}}>
                                {b.bsb||"—"}{b.accountNo?` · ${b.accountNo}`:""}
                              </div>
                            )}
                            {!b.payid&&!b.bsb&&!b.accountNo&&"—"}
                          </td>
                          <td style={{padding:"8px 10px",color:C.text,lineHeight:1.4,wordBreak:"break-word"}}>{b.reason||"—"}</td>
                          <td style={{padding:"8px 10px",fontSize:11.5,color:C.muted,lineHeight:1.35}}>
                            <div style={{wordBreak:"break-word"}}>{b.addedByCompany||"—"}</div>
                            <div>{b.addedByName}{b.createdAt?` · ${fmtDate(String(b.createdAt).slice(0,10))}`:""}</div>
                          </td>
                          {canDeleteBlacklist&&(
                            <td style={{padding:"8px 8px"}}>
                              <button onClick={()=>handleDeleteBl(b)} title="Remove from the shared blacklist"
                                aria-label={`Remove ${b.name} from the blacklist`}
                                style={{cursor:"pointer",padding:"5px 8px",fontSize:11,fontWeight:600,border:"1px solid #dc262655",borderRadius:6,background:"transparent",color:"#dc2626",display:"inline-flex",alignItems:"center",gap:4}}>
                                <i className="ti ti-trash" aria-hidden="true"/>
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {page==="members"&&(
          <div style={sectionStyle}>
            <SectionTitle icon="ti-users" right={
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <button onClick={()=>{ setNewMember({name:"",phone:"",id:""}); setNewMemberError(""); setShowMemberModal(true); }} style={{cursor:"pointer",fontSize:13,fontWeight:500,padding:"7px 16px",border:"none",borderRadius:8,background:C.accent,color:C.onAccent,display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-user-plus" aria-hidden="true"/> Add member</button>
                {canExport&&<>
                <button onClick={()=>exportMembersCSV()} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid ${C.border}`,borderRadius:6,background:C.surface2,color:C.text,display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-text" aria-hidden="true"/> CSV</button>
                <button onClick={()=>exportMembersExcel()} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid #16a34a`,borderRadius:6,background:dark?"#163524":"#16a34a14",color:"#16a34a",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-spreadsheet" aria-hidden="true"/> Excel</button>
                <button onClick={()=>exportMembersPDF()} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid #dc2626`,borderRadius:6,background:dark?"#3a1515":"#dc262614",color:"#dc2626",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-type-pdf" aria-hidden="true"/> PDF</button>
                </>}
              </div>
            }>Members directory</SectionTitle>
            <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Click a row to view a member's full transaction history.</div>
            <div style={{position:"relative",maxWidth:380,marginBottom:12}}>
              <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
              <input type="text" value={memberSearch} onChange={e=>setMemberSearch(e.target.value)} placeholder="Search by name, ID or phone…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
              {memberSearch&&<button type="button" onClick={()=>setMemberSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.muted}}>
                  <i className="ti ti-arrows-sort" aria-hidden="true" style={{fontSize:15,color:C.accent}}/>
                  <span>Sort</span>
                  <FluidDropdown width={170} value={memberSort} ariaLabel="Sort members"
                    options={MEMBER_SORTS}
                    onChange={v=>setMemberSort(v)}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.muted}}>
                  <span>Show</span>
                  <FluidDropdown width={100} value={memberPageSize} ariaLabel="Rows per page"
                    options={PAGE_SIZES.map(n=>({value:n,label:String(n)}))}
                    onChange={v=>setMemberPageSize(Number(v))}/>
                  <span>per page</span>
                </div>
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
                        <td style={{padding:"9px 10px",color:C.muted}}>{fmtDate(m.joined)}</td>
                        <td style={{padding:"9px 10px",color:C.text}}>{mTx.length}</td>
                        <td style={{padding:"9px 10px",color:C.muted}}>{fmtDate(m.lastActivity)}</td>
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
                <div><label style={labelStyle}>Keyword</label><input type="text" placeholder="Name, ID, bank, amount, notes..." value={search.term} onChange={e=>setSearch(s=>({...s,term:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div><label style={labelStyle}>Member</label><FluidDropdown value={search.member} placeholder="All members" ariaLabel="Filter by member" options={[{value:"",label:"All members"},...members.map(m=>({value:String(m.id),label:`${m.name} (${m.id})`}))]} onChange={v=>setSearch(s=>({...s,member:v}))}/></div>
                <div><label style={labelStyle}>Bank</label><FluidDropdown value={search.bank} placeholder="All banks" ariaLabel="Filter by bank" options={[{value:"",label:"All banks"},...banksLive.map(b=>({value:String(b.id),label:b.holder?`${b.holder} — ${b.name}`:b.name}))]} onChange={v=>setSearch(s=>({...s,bank:v}))}/></div>
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
              <SectionTitle icon="ti-list" right={canExport?(
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button onClick={()=>exportCSV(filteredTx,"fintrack_search",members)} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid ${C.border}`,borderRadius:6,background:C.surface2,color:C.text,display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-text" aria-hidden="true"/> CSV</button>
                  <button onClick={()=>exportExcel(filteredTx,"fintrack_search",members)} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid #16a34a`,borderRadius:6,background:dark?"#163524":"#16a34a14",color:"#16a34a",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-spreadsheet" aria-hidden="true"/> Excel</button>
                  <button onClick={()=>exportPDF(filteredTx,"FinTrack — Search results",members)} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid #dc2626`,borderRadius:6,background:dark?"#3a1515":"#dc262614",color:"#dc2626",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-type-pdf" aria-hidden="true"/> PDF</button>
                </div>
              ):null}>Results</SectionTitle>
              {(search.bank||search.member)&&(
                <div style={{marginBottom:12,padding:"10px 14px",background:C.accentBg,borderRadius:8,fontSize:13,border:`1px solid ${C.accent}55`,color:C.text}}>
                  Showing all history for:
                  {search.member&&<strong style={{marginLeft:6}}>{members.find(m=>m.id===search.member)?.name}</strong>}
                  {search.member&&search.bank&&<span style={{margin:"0 6px",color:C.muted}}>+</span>}
                  {search.bank&&<strong style={{marginLeft:search.member?0:6}}>{search.bank}</strong>}
                </div>
              )}
              {(search.dateFrom||search.dateTo)&&filteredTx.length>0&&(
                <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,minmax(0,1fr))":"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:14}}>
                  <SumTile icon="ti-wallet" color={C.accent} label="Current store balance" value={fmt(searchSummary.current)}/>
                  <SumTile icon="ti-history" color={STORE_COLOR} label={searchSummary.closingLabel} value={fmt(searchSummary.closing)}/>
                  <SumTile icon="ti-arrow-down-left" color="#16a34a" label={`Credit in · ${searchSummary.credits.n} ${searchSummary.credits.n===1?"entry":"entries"}`} value={fmt(searchSummary.credits.sum)}/>
                  <SumTile icon="ti-arrow-up-right" color="#dc2626" label={`Debit out · ${searchSummary.debits.n} ${searchSummary.debits.n===1?"entry":"entries"}`} value={fmt(searchSummary.debits.sum)}/>
                  <SumTile icon="ti-sum" color={searchSummary.net>=0?"#16a34a":"#dc2626"} label="Net (in − out)" value={fmt(searchSummary.net)}/>
                </div>
              )}
              <TxLog data={filteredTx} showDelete={true} onDelete={handleDeleteTx} banks={banks}/>
            </div>
          </div>
        )}

        {page==="offdays"&&(()=>{
          const navBtn = {cursor:"pointer",width:34,height:34,borderRadius:8,border:`1px solid ${C.border}`,background:C.surface2,color:C.text,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:16};
          const shiftMonthYm = (ym,delta)=>{ const [yy,mm]=ym.split('-').map(Number); const dt=new Date(yy,mm-1+delta,1); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`; };
          const SHIFT_DEFS = [['morning','Morning','ti-sun','#d97706'],['noon','Noon','ti-sun-high','#0ea5e9'],['night','Night','ti-moon','#6366f1']];
          // One small card per team member — draggable (desktop) or tappable (touch) when canEditRoster.
          const teamCard = (member,opts={})=>{
            const { fromUid=null, removable=false } = opts;
            const dragging = fromUid ? dragFromUid===fromUid : (dragOperatorId===member.operatorId && !dragFromUid);
            const colorKey = member.operatorId || member.name;
            return (
              <div key={fromUid||member.operatorId||member.name}
                draggable={canEditRoster}
                onDragStart={canEditRoster?(e)=>{ setDragOperatorId(member.operatorId); setDragFromUid(fromUid); try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',member.operatorId||''); }catch(_){} }:undefined}
                onDragEnd={canEditRoster?()=>{ setDragOperatorId(null); setDragFromUid(null); setDragOverShift(null); }:undefined}
                onClick={canEditRoster&&isMobile?()=>setMobileAssignFor({operatorId:member.operatorId,name:member.name,fromUid}):undefined}
                style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surface2,cursor:canEditRoster?(isMobile?"pointer":"grab"):"default",opacity:dragging?0.4:1,userSelect:"none",WebkitUserSelect:"none",transition:"opacity 0.12s"}}>
                <span aria-hidden="true" style={{width:10,height:10,borderRadius:"50%",background:empColor(colorKey),flexShrink:0}}/>
                <span style={{flex:1,minWidth:0,fontSize:13,fontWeight:500,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{member.name}</span>
                {canEditRoster&&removable&&!isMobile&&(
                  <button onClick={(e)=>{e.stopPropagation(); deleteShift(fromUid);}} aria-label={`Remove ${member.name}`} style={{cursor:"pointer",border:"none",background:"transparent",color:"#dc2626",padding:3,display:"flex"}}><i className="ti ti-x" aria-hidden="true" style={{fontSize:15}}/></button>
                )}
                {canEditRoster&&!isMobile&&<i className="ti ti-grip-vertical" aria-hidden="true" style={{color:C.muted,fontSize:13,flexShrink:0}}/>}
              </div>
            );
          };
          // One drop group (Morning / Noon / Night) — accepts a card dragged from the pool or from another group.
          const shiftGroup = (shiftValue,label,icon,color,rows)=>{
            const isOver = dragOverShift===shiftValue;
            return (
              <div key={shiftValue}
                onDragOver={canEditRoster?(e)=>{ e.preventDefault(); if(dragOverShift!==shiftValue) setDragOverShift(shiftValue); }:undefined}
                onDragLeave={canEditRoster?()=>setDragOverShift(s=>s===shiftValue?null:s):undefined}
                onDrop={canEditRoster?(e)=>{ e.preventDefault(); if(dragFromUid) moveShift(dragFromUid,shiftValue); else if(dragOperatorId) assignShift(TEAM.find(t=>t.operatorId===dragOperatorId),shiftValue); setDragOperatorId(null); setDragFromUid(null); setDragOverShift(null); }:undefined}>
                <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",color,marginBottom:7,display:"flex",alignItems:"center",gap:5}}><i className={`ti ${icon}`} aria-hidden="true"/> {label} <span style={{color:C.muted,fontWeight:500}}>· {rows.length}</span></div>
                <div style={{display:"flex",flexDirection:"column",gap:6,minHeight:canEditRoster?44:0,padding:canEditRoster?6:0,borderRadius:8,border:canEditRoster?`1px ${isOver?"solid":"dashed"} ${isOver?color:C.border}`:"none",background:isOver?`${color}14`:"transparent",transition:"background 0.15s, border-color 0.15s"}}>
                  {rows.length===0
                    ? <div style={{fontSize:12,color:C.muted,padding:"8px 2px"}}>{canEditRoster?(isMobile?"Tap a card above to add.":"Drag a card here."):"No one on this shift yet."}</div>
                    : rows.map(r=>teamCard({operatorId:r.employeeId,name:r.employee},{fromUid:r.uid,removable:true}))}
                </div>
              </div>
            );
          };
          const runRow = (run)=>{
            const single = run.dates.length===1, includesToday = run.dates.includes(today), past = run.dateTo < today;
            return (
              <div key={run.uids[0]} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 13px",borderRadius:12,border:`1px solid ${C.border}`,background:C.surface2}}>
                <div style={{flexShrink:0,minWidth:48,textAlign:"center",lineHeight:1.1}}>
                  <div style={{fontSize:16,fontWeight:700,fontFamily:"var(--font-mono)",color:past?C.muted:C.accent}}>{run.dateFrom.slice(8,10)}{single?"":`–${run.dateTo.slice(8,10)}`}</div>
                  <div style={{fontSize:10,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase",color:C.muted}}>{MONTHS_SHORT[Number(run.dateFrom.slice(5,7))-1]}</div>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={{fontWeight:600,fontSize:14,color:C.text}}>{run.employee}</span>
                    <span aria-hidden="true" title={run.employee} style={{width:9,height:9,borderRadius:"50%",background:empColor(run.employee),flexShrink:0,display:"inline-block"}}/>
                    {!single&&<span style={{fontSize:10,fontWeight:600,color:C.accent,background:C.accentBg,border:`1px solid ${C.accent}55`,borderRadius:4,padding:"1px 6px"}}>{run.dates.length} days</span>}
                    {includesToday&&<span style={{fontSize:10,fontWeight:600,color:"#16a34a",background:"#16a34a22",border:"1px solid #16a34a55",borderRadius:4,padding:"1px 6px"}}>Off today</span>}
                  </div>
                  <div style={{fontSize:12,color:C.muted,marginTop:2}}>{single?"":`${fmtDate(run.dateFrom)} – ${fmtDate(run.dateTo)} · `}{run.reason||"No reason given"}{run.recordedBy?` · by ${run.recordedBy}`:""}</div>
                </div>
                <button onClick={()=>handleDeleteOffRun(run)} aria-label={`Remove ${run.employee}'s day off`} style={{...deleteBtnStyle,flexShrink:0}}><i className="ti ti-trash" aria-hidden="true"/></button>
              </div>
            );
          };
          return (
          <div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-calendar-month" right={
                <FluidDropdown width={150} value={offCalMonth} ariaLabel="Month" options={offMonths.map(ym=>({value:ym,label:monthLabel(ym)}))} onChange={gotoMonth}/>
              }>Work Shifts / Off Day</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:16}}>The calendar, shift roster and log below all follow the month shown here — pick a month to view it or plan ahead. Everyone on your team can see this page; only masters and managers can rearrange the shift roster.</div>
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"minmax(0,1fr) minmax(0,300px)",gap:18,alignItems:"start"}}>
                {/* left: calendar */}
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                    <button onClick={()=>gotoMonth(shiftMonthYm(offCalMonth,-1))} aria-label="Previous month" style={navBtn}><i className="ti ti-chevron-left" aria-hidden="true"/></button>
                    <div style={{fontWeight:600,fontSize:15,color:C.text}}>{monthLabel(offCalMonth)}</div>
                    <button onClick={()=>gotoMonth(shiftMonthYm(offCalMonth,1))} aria-label="Next month" style={navBtn}><i className="ti ti-chevron-right" aria-hidden="true"/></button>
                  </div>
                  <MonthCalendar month={offCalMonth} selected={offSelDates} onToggle={toggleOffDate} events={dayNames} today={today} isMobile={isMobile}/>
                  <div style={{display:"flex",alignItems:"center",gap:14,marginTop:12,fontSize:11,color:C.muted,flexWrap:"wrap"}}>
                    <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:13,height:13,borderRadius:4,border:`2px solid ${C.accent}`,background:C.accentBg}}/>Selected / today</span>
                    <span>Each colour is one person.</span>
                  </div>
                </div>
                {/* right: shift roster — drag (desktop) or tap (touch) a team card onto a shift */}
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:C.text,display:"flex",alignItems:"center",gap:6,marginBottom:10}}><i className="ti ti-users-group" aria-hidden="true" style={{color:C.accent,flexShrink:0}}/> <span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Shift roster · {monthLabel(offCalMonth)}</span></div>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:10.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",color:C.muted,marginBottom:7}}>Team{!canEditRoster?" · view only":""}</div>
                    {shiftPool.length===0
                      ? <div style={{fontSize:12,color:C.muted,padding:"8px 10px",border:`1px dashed ${C.border}`,borderRadius:8}}>{TEAM.length===0?"No team accounts yet.":"Everyone is on a shift this month."}</div>
                      : (
                        <div
                          onDragOver={canEditRoster&&dragFromUid?(e)=>e.preventDefault():undefined}
                          onDrop={canEditRoster&&dragFromUid?(e)=>{ e.preventDefault(); deleteShift(dragFromUid); setDragOperatorId(null); setDragFromUid(null); setDragOverShift(null); }:undefined}
                          style={{display:"flex",flexWrap:"wrap",gap:6}}>
                          {shiftPool.map(m=>teamCard(m))}
                        </div>
                      )}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {SHIFT_DEFS.map(([v,lab,ic,c])=>shiftGroup(v,lab,ic,c,v==='morning'?shiftMorning:v==='noon'?shiftNoon:shiftNight))}
                  </div>
                </div>
              </div>
            </div>

            <div style={sectionStyle}>
              <SectionTitle icon="ti-calendar-plus">Plan a day off</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Tap days on the calendar above, choose who's off, and save.</div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:12}}>
                  <div><label style={labelStyle}>Employee</label>
                    <FluidDropdown value={offForm.employeeId} placeholder="Who's off?" ariaLabel="Who's off" options={TEAM.map(t=>({value:t.operatorId,label:t.name}))} onChange={v=>setOffForm(f=>({...f,employeeId:v}))}/></div>
                  <div><label style={labelStyle}>Reason <span style={{color:C.muted,fontWeight:400}}>(optional)</span></label>
                    <input type="text" placeholder="e.g. Annual leave, sick" value={offForm.reason} onChange={e=>setOffForm(f=>({...f,reason:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                </div>
                <div><label style={labelStyle}>Selected days <span style={{color:C.muted,fontWeight:400}}>({offSelDates.length})</span></label>
                  {offSelDates.length===0
                    ? <div style={{fontSize:12,color:C.muted,padding:"10px 12px",border:`1px dashed ${C.border}`,borderRadius:10,textAlign:"center"}}>Tap days on the calendar above to add them.</div>
                    : <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{offSelDates.map(d=>(
                        <span key={d} style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,fontWeight:500,background:C.accentBg,color:C.text,border:`1px solid ${C.accent}55`,borderRadius:999,padding:"4px 6px 4px 10px"}}>{fmtDate(d)}<button onClick={()=>toggleOffDate(d)} aria-label={`Remove ${fmtDate(d)}`} style={{cursor:"pointer",border:"none",background:"transparent",color:C.muted,display:"flex",padding:0}}><i className="ti ti-x" aria-hidden="true" style={{fontSize:14}}/></button></span>
                      ))}</div>}
                </div>
                {offError&&<div style={{fontSize:12,color:"#dc2626"}}>{offError}</div>}
                <button onClick={handleAddOffDays} style={{cursor:"pointer",alignSelf:"flex-start",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:10,padding:"11px 18px",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6}}><i className="ti ti-calendar-plus" aria-hidden="true"/> Save day off{offSelDates.length>1?"s":""}</button>
              </div>
            </div>

            <div style={sectionStyle}>
              <SectionTitle icon="ti-chart-bar" right={
                <FluidDropdown width={170} value={offCountsNat} placeholder="All nationalities" ariaLabel="Filter by nationality"
                  options={[{value:"",label:"All nationalities"},...NATIONALITIES.map(n=>({value:n.value,label:n.value}))]}
                  onChange={v=>{ setOffCountsNat(v); setOffCountsAll(false); }}/>
              }>Off-day counts</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>How many days each team member has taken off — this month and this year.</div>
              {TEAM.length===0
                ? <div style={{fontSize:13,color:C.muted,padding:"16px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No team accounts yet.</div>
                : offCountsFiltered.length===0
                ? <div style={{fontSize:13,color:C.muted,padding:"16px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No team members with that nationality.</div>
                : (
                  <>
                  <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:10}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                      <thead>
                        <tr style={{background:C.header}}>
                          {["Team member","Nationality",`This month · ${monthLabel(offCalMonth)}`,`This year · ${offCalMonth.slice(0,4)}`].map((h,i)=>(
                            <th key={i} style={{textAlign:i<2?"left":"right",padding:"10px",color:C.muted,fontWeight:500,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {offCountsShown.map(({member,month,year})=>(
                          <tr key={member.operatorId} style={{borderBottom:`1px solid ${C.border}`}}>
                            <td style={{padding:"9px 10px"}}>
                              <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                                <span aria-hidden="true" style={{width:9,height:9,borderRadius:"50%",background:empColor(member.operatorId),flexShrink:0}}/>
                                <span style={{fontWeight:500,color:C.text}}>{member.name}</span>
                              </span>
                            </td>
                            <td style={{padding:"9px 10px",color:C.muted}}>{nationalityCode(member.nationality)||"—"}</td>
                            <td style={{padding:"9px 10px",textAlign:"right",fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",color:month>0?C.text:C.muted,fontWeight:month>0?600:400}}>{month}</td>
                            <td style={{padding:"9px 10px",textAlign:"right",fontFamily:"var(--font-mono)",fontVariantNumeric:"tabular-nums",color:year>0?C.text:C.muted,fontWeight:year>0?600:400}}>{year}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!offCountsAll && offCountsFiltered.length>10 && (
                    <button onClick={()=>setOffCountsAll(true)} style={{cursor:"pointer",marginTop:10,fontSize:12.5,fontWeight:500,padding:"7px 14px",border:`1px solid ${C.border}`,borderRadius:8,background:C.surface2,color:C.text,display:"inline-flex",alignItems:"center",gap:6}}>
                      <i className="ti ti-chevron-down" aria-hidden="true"/> View more ({offCountsFiltered.length-10} more)
                    </button>
                  )}
                  {offCountsAll && offCountsFiltered.length>10 && (
                    <button onClick={()=>setOffCountsAll(false)} style={{cursor:"pointer",marginTop:10,fontSize:12.5,fontWeight:500,padding:"7px 14px",border:`1px solid ${C.border}`,borderRadius:8,background:C.surface2,color:C.text,display:"inline-flex",alignItems:"center",gap:6}}>
                      <i className="ti ti-chevron-up" aria-hidden="true"/> Show fewer
                    </button>
                  )}
                  </>
                )}
            </div>

            <div style={sectionStyle}>
              <SectionTitle icon="ti-list-check" right={
                <FluidDropdown width={150} value={offCalMonth} ariaLabel="Log month" options={offMonths.map(ym=>({value:ym,label:monthLabel(ym)}))} onChange={gotoMonth}/>
              }>Days off log</SectionTitle>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
                <div style={{position:"relative",flex:"1 1 200px",minWidth:160}}>
                  <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
                  <input type="text" value={offLogSearch} onChange={e=>setOffLogSearch(e.target.value)} placeholder="Search name or reason…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
                  {offLogSearch&&<button type="button" onClick={()=>setOffLogSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.muted}}>
                  <span>Sort</span>
                  <FluidDropdown width={150} value={offLogSort} ariaLabel="Sort log" options={[{value:"date",label:"By date"},{value:"employee",label:"By employee"}]} onChange={v=>setOffLogSort(v)}/>
                </div>
              </div>
              <div style={{fontSize:12,color:C.muted,marginBottom:12}}>Showing <strong style={{color:C.text}}>{monthLabel(offCalMonth)}</strong> — {offLog.length} {offLog.length===1?"entry":"entries"}{offLogSearch?` matching “${offLogSearch}”`:""}.</div>
              {offLog.length===0
                ? <div style={{fontSize:13,color:C.muted,padding:"16px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No days off {offLogSearch?"match your search":`recorded for ${monthLabel(offCalMonth)}`}.</div>
                : <div style={{display:"flex",flexDirection:"column",gap:8}}>{offLog.map(runRow)}</div>}
            </div>

            {/* Touch devices can't drag — tapping a card opens this instead. */}
            {mobileAssignFor && (
              <div role="dialog" aria-label={`Assign ${mobileAssignFor.name}'s shift`} onClick={()=>setMobileAssignFor(null)}
                style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:1000}}>
                <div onClick={e=>e.stopPropagation()} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:"16px 16px 0 0",padding:"18px 18px calc(18px + env(safe-area-inset-bottom,0px))",width:"100%",maxWidth:420,boxShadow:"0 -12px 40px rgba(0,0,0,0.4)"}}>
                  <div style={{fontWeight:600,fontSize:15,color:C.text,marginBottom:14}}>{mobileAssignFor.name}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {SHIFT_DEFS.map(([v,lab,ic,c])=>(
                      <button key={v} onClick={()=>{ if(mobileAssignFor.fromUid) moveShift(mobileAssignFor.fromUid,v); else assignShift(TEAM.find(t=>t.operatorId===mobileAssignFor.operatorId),v); }}
                        style={{cursor:"pointer",display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,border:`1px solid ${C.border}`,background:C.surface2,color:C.text,fontSize:14,fontWeight:500}}>
                        <i className={`ti ${ic}`} aria-hidden="true" style={{color:c,fontSize:18}}/> Put on {lab}
                      </button>
                    ))}
                    {mobileAssignFor.fromUid && (
                      <button onClick={()=>deleteShift(mobileAssignFor.fromUid)}
                        style={{cursor:"pointer",display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,border:"1px solid #dc262655",background:dark?"#3a1515":"#dc262614",color:"#dc2626",fontSize:14,fontWeight:500}}>
                        <i className="ti ti-x" aria-hidden="true" style={{fontSize:18}}/> Remove from shift
                      </button>
                    )}
                  </div>
                  <button onClick={()=>setMobileAssignFor(null)} style={{marginTop:12,width:"100%",cursor:"pointer",padding:"10px",borderRadius:10,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontSize:13,fontWeight:500}}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          );
        })()}
      </main>

      {/* Mobile bottom tab bar — replaces the hover sidebar (no hover on touch).
          position:fixed so it sits at the very bottom of the phone screen. Capped
          at 6 slots: the 5 primary pages, plus a "More" tab for everything else
          (Off Days, and Bank Details for master/manager) instead of cramming a
          7th+ item into the bar. */}
      {isMobile && (()=>{
        const mobilePrimary = nav.filter(n=>MOBILE_PRIMARY_IDS.includes(n.id));
        const mobileOverflow = nav.filter(n=>!MOBILE_PRIMARY_IDS.includes(n.id));
        const moreActive = mobileOverflow.some(n=>n.id===page);
        const tabBtnStyle = active => ({flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,padding:"7px 2px",minHeight:56,border:"none",borderTop:`2px solid ${active?C.accent:"transparent"}`,background:active?C.accentBg:"transparent",cursor:"pointer",color:active?C.accent:C.muted,fontWeight:active?600:500,transition:"color 0.15s, background 0.15s"});
        return (
          <>
            <nav className="safe-bottom" aria-label="Main navigation" style={{position:"fixed",bottom:0,left:0,right:0,zIndex:50,display:"flex",background:C.surface,borderTop:`1px solid ${C.border}`,boxShadow:dark?"0 -4px 18px rgba(0,0,0,0.45)":"0 -4px 18px rgba(0,0,0,0.08)"}}>
              {mobilePrimary.map(n=>{
                const active = page===n.id;
                return (
                  <button key={n.id} onClick={()=>setPage(n.id)} aria-label={n.label} aria-current={active?"page":undefined} style={tabBtnStyle(active)}>
                    <i className={`ti ${n.icon}`} aria-hidden="true" style={{fontSize:21}}/>
                    <span style={{fontSize:10.5,lineHeight:1,whiteSpace:"nowrap"}}>{MOBILE_TAB_LABEL[n.id]||n.label}</span>
                  </button>
                );
              })}
              {mobileOverflow.length>0&&(
                <button onClick={()=>setShowMobileMore(true)} aria-label="More" aria-current={moreActive?"page":undefined} aria-haspopup="dialog" aria-expanded={showMobileMore} style={tabBtnStyle(moreActive)}>
                  <i className="ti ti-dots" aria-hidden="true" style={{fontSize:21}}/>
                  <span style={{fontSize:10.5,lineHeight:1,whiteSpace:"nowrap"}}>More</span>
                </button>
              )}
            </nav>
            {showMobileMore&&(
              <div role="dialog" aria-label="More pages" onClick={()=>setShowMobileMore(false)}
                style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:1000}}>
                <div onClick={e=>e.stopPropagation()} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:"16px 16px 0 0",padding:"18px 18px calc(18px + env(safe-area-inset-bottom,0px))",width:"100%",maxWidth:420,boxShadow:"0 -12px 40px rgba(0,0,0,0.4)"}}>
                  <div style={{fontWeight:600,fontSize:15,color:C.text,marginBottom:14}}>More</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {mobileOverflow.map(n=>(
                      <button key={n.id} onClick={()=>{ setPage(n.id); setShowMobileMore(false); }}
                        style={{cursor:"pointer",display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,border:`1px solid ${page===n.id?C.accent:C.border}`,background:page===n.id?C.accentBg:C.surface2,color:page===n.id?C.accent:C.text,fontSize:14,fontWeight:500}}>
                        <i className={`ti ${n.icon}`} aria-hidden="true" style={{fontSize:18}}/> {n.label}
                      </button>
                    ))}
                  </div>
                  <button onClick={()=>setShowMobileMore(false)} style={{marginTop:12,width:"100%",cursor:"pointer",padding:"10px",borderRadius:10,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontSize:13,fontWeight:500}}>Cancel</button>
                </div>
              </div>
            )}
          </>
        );
      })()}
      </div>
    </div>
  );
}
