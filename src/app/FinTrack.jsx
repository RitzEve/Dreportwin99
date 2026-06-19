import { useState, useMemo, useRef, useEffect } from "react";

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
  "Rental":"#0891b2","Store":"#db2777","Transfer":"#6366f1","Adjust":"#0d9488",
  "Transfer Out":"#dc2626","Transfer In":"#16a34a","Other":"#64748b"
};
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
const TX_COLS = ["date","time","type","amount","memberId","memberName","bank","operator","notes","deleted"];
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
  const head = "<tr>"+["Date","Time","Type","Amount","ID","Member/Ref","Bank","Operator","Notes"].map(c=>`<th>${c}</th>`).join("")+"</tr>";
  const body = rows.map(r=>"<tr>"+[r.date,r.time,r.type,amtDisplay(r).sign+amtDisplay(r).val,r.memberId||"",r.memberName,r.bank,r.operator||"",r.notes||""].map(c=>`<td>${String(c).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</td>`).join("")+"</tr>").join("");
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
    return {sign:pos?"+":"-",val:fmt(Math.abs(t.amount)),color:pos?posColor:"#dc2626"};
  }
  const credit=isCreditType(t); return {sign:credit?"+":"-",val:fmt(t.amount),color:credit?"#16a34a":"#dc2626"};
};

function TxBadge({type}) {
  const c = TYPE_COLORS[type]||"#888";
  return <span style={{background:c+"26",color:c,fontSize:11,padding:"2px 8px",borderRadius:4,fontWeight:500,whiteSpace:"nowrap",border:`1px solid ${c}55`}}>{type}</span>;
}

function TxTable({data, showDelete, onDelete, banks}) {
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
            {["Date / Time","Type","Member / Ref","ID","Amount","Bank","Operator","Notes",...(showDelete?["Action"]:[])]
              .map((h,i)=><th key={i} style={{textAlign:"left",padding:"10px",color:C.muted,fontWeight:500,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`}}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.length===0&&<tr><td colSpan={9} style={{padding:"24px 10px",textAlign:"center",color:C.muted}}>No entries found.</td></tr>}
          {data.map((t,idx)=>(
            <tr key={t.id} style={{borderBottom:`1px solid ${C.border}`,background:t.deleted?"rgba(220,38,38,0.10)":(idx%2?C.surface:"transparent"),opacity:t.deleted?0.7:1}}>
              <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.muted}}>{t.date} {t.time}</td>
              <td style={{padding:"9px 10px"}}>
                <TxBadge type={t.type}/>
                {t.isNew&&<span style={{marginLeft:4,background:"#16a34a26",color:"#16a34a",fontSize:10,padding:"1px 6px",borderRadius:4,border:"1px solid #16a34a55"}}>New</span>}
                {t.deleted&&<span style={{marginLeft:4,background:"#dc262630",color:"#ef5350",fontSize:10,padding:"1px 6px",borderRadius:4}}>Deleted</span>}
              </td>
              <td style={{padding:"9px 10px",color:C.text,textDecoration:t.deleted?"line-through":"none"}}>{t.memberName}</td>
              <td style={{padding:"9px 10px",color:C.muted,textDecoration:t.deleted?"line-through":"none"}}>{t.memberId||"—"}</td>
              <td style={{padding:"9px 10px",fontWeight:500,textDecoration:t.deleted?"line-through":"none",color:amtDisplay(t).color}}>
                {amtDisplay(t).sign}{amtDisplay(t).val}
              </td>
              <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.text}}>{(()=>{
                const b = bankOfTx(t, banks);
                const holder = (b&&b.holder) || t.bankHolder || "";
                return (<span>
                  <span style={{display:"block"}}>{holder || t.bank}</span>
                  <span style={{fontSize:11,color:C.muted}}>{t.bank}{t.counterparty?(t.type==="Transfer In"?` ← ${t.counterparty}`:` → ${t.counterparty}`):""}</span>
                </span>);
              })()}</td>
              <td style={{padding:"9px 10px",color:C.muted,whiteSpace:"nowrap"}}>{t.operator?<span style={{display:"inline-flex",alignItems:"center",gap:4}}><i className="ti ti-user-cog" aria-hidden="true" style={{fontSize:13}}/>{t.operator}</span>:"—"}</td>
              <td style={{padding:"9px 10px",color:C.muted}}>{t.notes||"—"}</td>
              {showDelete&&<td style={{padding:"9px 8px"}}>
                {!t.deleted&&<button onClick={()=>onDelete(t.id)} style={deleteBtnStyle}><i className="ti ti-trash" aria-hidden="true"/> Delete</button>}
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({label,count,amount,color}) {
  return (
    <div style={{background:C.surface,borderRadius:10,padding:"10px 12px",border:`1px solid ${C.border}`,borderLeft:`3px solid ${color||C.borderStrong}`,boxShadow:dark?"none":"0 1px 2px rgba(0,0,0,0.05)"}}>
      <div style={{fontSize:11.5,color:C.muted,marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={label}>{label}</div>
      <div style={{fontSize:17,fontWeight:600,color:color||C.text}}>{fmt(amount)}</div>
      {count!==undefined&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>{count} {count===1?"entry":"entries"}</div>}
    </div>
  );
}

// Totals across all bank accounts: all / active-only / inactive-only.
function BankTotals({banksLive}) {
  const sum = arr => arr.reduce((s,b)=>s+(b.balance||0),0);
  const active = banksLive.filter(b=>b.active!==false);
  const inactive = banksLive.filter(b=>b.active===false);
  const Card = ({label,amount,count,color,icon}) => (
    <div style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`,borderLeft:`3px solid ${color}`}}>
      <div style={{fontSize:12,color:C.muted,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><i className={`ti ${icon}`} aria-hidden="true" style={{color}}/>{label}</div>
      <div style={{fontSize:20,fontWeight:500,color:C.text}}>{fmt(amount)}</div>
      <div style={{fontSize:12,color:C.muted,marginTop:2}}>{count} {count===1?"bank":"banks"}</div>
    </div>
  );
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
      <Card label="All banks total" amount={sum(banksLive)} count={banksLive.length} color={C.accent} icon="ti-building-bank"/>
      <Card label="Active banks total" amount={sum(active)} count={active.length} color="#16a34a" icon="ti-circle-check"/>
      <Card label="Inactive banks total" amount={sum(inactive)} count={inactive.length} color="#64748b" icon="ti-circle-off"/>
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
          <select value={pageSize} onChange={e=>setPageSize(Number(e.target.value))} style={{padding:"4px 8px",width:"auto"}}>
            {PAGE_SIZES.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
          <span>per page</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12.5,color:C.muted}}>
          <span>{total===0?0:start+1}–{Math.min(start+pageSize,total)} of {total}</span>
          <button onClick={()=>setPage(Math.max(1,curPage-1))} disabled={curPage<=1} style={pagerBtn(curPage<=1)} aria-label="Previous page"><i className="ti ti-chevron-left" aria-hidden="true"/></button>
          <span>{curPage}/{pages}</span>
          <button onClick={()=>setPage(Math.min(pages,curPage+1))} disabled={curPage>=pages} style={pagerBtn(curPage>=pages)} aria-label="Next page"><i className="ti ti-chevron-right" aria-hidden="true"/></button>
        </div>
      </div>
      <TxTable data={slice} showDelete={showDelete} onDelete={onDelete} banks={banks}/>
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

function DetailModal({title,subtitle,transactions,onClose,banks}) {
  const isCredit = t => ["Regular Deposit","Unclaimed Credit","Adjust"].includes(t.type);
  const bankCell = name => {
    const b = (banks||[]).find(x=>x.name===name);
    return b ? <span><span style={{display:"block"}}>{b.holder}</span><span style={{fontSize:11,color:C.muted}}>{name}</span></span> : name;
  };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:998,padding:"24px 16px"}} onClick={onClose}>
      <div style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:820,maxHeight:"82vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
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
          {transactions.length===0
            ?<div style={{padding:"30px",textAlign:"center",color:C.muted,fontSize:13}}>No transactions found.</div>
            :<div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:10}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:C.header}}>
                    {["Date / Time","Type","Member / Ref","ID","Amount","Bank","Operator","Notes"].map((h,i)=>(
                      <th key={i} style={{textAlign:"left",padding:"10px",color:C.muted,fontWeight:500,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t,idx)=>(
                    <tr key={t.id} style={{borderBottom:`1px solid ${C.border}`,background:t.deleted?"rgba(220,38,38,0.10)":(idx%2?C.surface:"transparent"),opacity:t.deleted?0.7:1}}>
                      <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.muted}}>{t.date} {t.time}</td>
                      <td style={{padding:"9px 10px"}}><TxBadge type={t.type}/>{t.deleted&&<span style={{marginLeft:4,background:"#dc262630",color:"#ef5350",fontSize:10,padding:"1px 6px",borderRadius:4}}>Deleted</span>}</td>
                      <td style={{padding:"9px 10px",color:C.text,textDecoration:t.deleted?"line-through":"none"}}>{t.memberName}</td>
                      <td style={{padding:"9px 10px",color:C.muted,textDecoration:t.deleted?"line-through":"none"}}>{t.memberId||"—"}</td>
                      <td style={{padding:"9px 10px",fontWeight:500,textDecoration:t.deleted?"line-through":"none",color:amtDisplay(t).color}}>{amtDisplay(t).sign}{amtDisplay(t).val}</td>
                      <td style={{padding:"9px 10px",whiteSpace:"nowrap",color:C.text}}>{(()=>{
                        const b = bankOfTx(t, banks);
                        const holder = (b&&b.holder) || t.bankHolder || "";
                        return (<span>
                          <span style={{display:"block"}}>{holder || t.bank}</span>
                          <span style={{fontSize:11,color:C.muted}}>{t.bank}{t.counterparty?(t.type==="Transfer In"?` ← ${t.counterparty}`:` → ${t.counterparty}`):""}</span>
                        </span>);
                      })()}</td>
                      <td style={{padding:"9px 10px",color:C.muted,whiteSpace:"nowrap"}}>{t.operator||"—"}</td>
                      <td style={{padding:"9px 10px",color:C.muted}}>{t.notes||"—"}</td>
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
  useEffect(()=>{ setMemberPage(1); },[memberPageSize]);
  // Sidebar behaviour: "expanded" | "collapsed" | "hover" (expand-on-hover) — default hover.
  const [sidebarMode,setSidebarMode] = useState(()=>{ try{ return localStorage.getItem("fintrack-sidebar-mode")||"hover"; }catch(e){ return "hover"; } });
  useEffect(()=>{ try{ localStorage.setItem("fintrack-sidebar-mode",sidebarMode); }catch(e){} },[sidebarMode]);
  const [sidebarHovered,setSidebarHovered] = useState(false);
  const [showSidebarMenu,setShowSidebarMenu] = useState(false);
  const sidebarHoverExpanding = sidebarMode==="hover" && sidebarHovered;
  const sidebarExpanded = sidebarMode==="expanded" || sidebarHoverExpanding;
  // Wide enough for the 2:1 dashboard split + 5 stat cards per row.
  const [isWideView,setIsWideView] = useState(()=>typeof window!=="undefined" && window.matchMedia("(min-width: 1000px)").matches);
  useEffect(()=>{ const mq=window.matchMedia("(min-width: 1000px)"); const h=e=>setIsWideView(e.matches); mq.addEventListener("change",h); return ()=>mq.removeEventListener("change",h); },[]);
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

  const [form,setForm] = useState({type:"Regular Deposit",amount:"",memberId:"",memberName:"",memberPhone:"",bankId:null,notes:"",toBankId:null});
  const [formError,setFormError] = useState("");
  const [nameSuggestions,setNameSuggestions] = useState([]);
  const [idSuggestions,setIdSuggestions] = useState([]);
  const [phoneSuggestions,setPhoneSuggestions] = useState([]);
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
  const [showPasswordModal,setShowPasswordModal] = useState(false);
  const [pwForm,setPwForm] = useState({current:"",next:"",confirm:""});
  const [pwError,setPwError] = useState("");
  const [pwSuccess,setPwSuccess] = useState("");
  const opMenuRef = useRef(null);
  const sidebarMenuRef = useRef(null);
  const lastSyncRef = useRef(""); // last data we loaded/saved — lets us sync across devices without save/load loops

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

  useEffect(()=>{
    if(!loaded) return;
    const serialized = JSON.stringify({transactions,banks,members,nextId});
    if(serialized === lastSyncRef.current) return; // nothing new to persist (incl. data we just pulled in)
    (async()=>{
      try{ await window.storage.set(`fintrack-${SESSION.companyId}-v2`,serialized); lastSyncRef.current = serialized; }
      catch(e){ /* save failed */ }
    })();
  },[transactions,banks,members,nextId,loaded]);

  // Auto-refresh: every 10s pull the latest saved data so changes made on other
  // devices/operators appear here. We only adopt it when it differs from what we
  // last loaded/saved, so it never clobbers our own just-saved changes.
  useEffect(()=>{
    if(!loaded) return;
    const key = `fintrack-${SESSION.companyId}-v2`;
    const id = setInterval(async()=>{
      try{
        const r = await window.storage.get(key);
        if(r&&r.value && r.value !== lastSyncRef.current){ applyData(JSON.parse(r.value)); lastSyncRef.current = r.value; }
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
  const banksLive = useMemo(()=>orderBanks(banks.map(b=>({...b,balance:ftBankBalance(b,transactions)}))),[banks,transactions]);
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

  const closeEntryModal = () => { setForm({type:"Regular Deposit",amount:"",memberId:"",memberName:"",memberPhone:"",bankId:activeBanks[0]?.id??null,notes:"",toBankId:null}); setFormError(""); setNameSuggestions([]); setIdSuggestions([]); setPhoneSuggestions([]); setShowEntryModal(false); };
  const closeBankModal = () => { setNewBank({name:"",holder:"",bsb:"",account:"",payid:"",balance:""}); setBankError(""); setShowBankModal(false); };
  const closePasswordModal = () => { setPwForm({current:"",next:"",confirm:""}); setPwError(""); setPwSuccess(""); setShowPasswordModal(false); };

  const handleNameInput = val => {
    setForm(f=>({...f,memberName:val}));
    setNameSuggestions(val.length>0 ? members.filter(m=>m.name.toLowerCase().includes(val.toLowerCase())) : []);
  };
  const handleIdInput = val => {
    setForm(f=>({...f,memberId:val}));
    setIdSuggestions(val.length>0 ? members.filter(m=>(m.id||"").toLowerCase().includes(val.toLowerCase())) : []);
  };
  const handlePhoneInput = val => {
    setForm(f=>({...f,memberPhone:val}));
    setPhoneSuggestions(val.length>0 ? members.filter(m=>(m.phone||"").toLowerCase().includes(val.toLowerCase())) : []);
  };
  // Picking any suggestion fills the member's name + ID + phone, and closes all lists.
  const selectMember = m => { setForm(f=>({...f,memberName:m.name,memberId:m.id,memberPhone:m.phone||""})); setNameSuggestions([]); setIdSuggestions([]); setPhoneSuggestions([]); };

  const handleDeleteTx = id => {
    const target = transactions.find(t=>t.id===id);
    const isPair = target && target.pairId;
    setConfirm({message: isPair
        ? "Delete this transfer? Both the OUT and IN sides will be marked deleted together."
        : "Mark this entry as deleted? It will remain visible in the log for audit purposes.",
      onConfirm:()=>{
        setTransactions(prev=>prev.map(t=>{
          if(t.id===id) return {...t,deleted:true};
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
    if(form.amount===""||isNaN(form.amount)||(!isSigned&&Number(form.amount)<=0)||(isSigned&&Number(form.amount)===0)){setFormError(isSigned?"Enter a non-zero amount (use a minus sign for negative).":"Enter a valid amount.");return;}
    if(needsName && !form.memberName.trim()){setFormError("Enter a name/reference.");return;}
    const srcBank = banks.find(b=>b.id===form.bankId);
    setFormError("");
    const destBank = banks.find(b=>b.id===form.toBankId);
    const amt = Number(form.amount);
    const op = SESSION.operatorId;
    const time = timeInTz(tz);
    const ref = form.memberName.trim();
    const blank = {type:"Regular Deposit",amount:"",memberId:"",memberName:"",memberPhone:"",bankId:activeBanks[0]?.id??null,notes:"",toBankId:null};

    // ---- Transfer: make a leg for whichever bank(s) are chosen ----
    if(form.type==="Transfer"){
      if(!srcBank && !destBank){setFormError("Pick a source and/or destination bank.");return;}
      const pairId = `TR-${nextId}`;
      const rows = []; let idc = nextId;
      if(srcBank) rows.push({id:idc++,date:today,time,type:"Transfer Out",amount:amt,memberId:"",memberName:ref||(destBank?`Transfer to ${destBank.name}`:"Transfer out"),bank:srcBank.name,bankId:srcBank.id,bankHolder:srcBank.holder||"",counterparty:destBank?destBank.name:"",pairId,notes:form.notes||(destBank?`To ${destBank.name}`:""),operator:op,isNew:false,deleted:false});
      if(destBank) rows.push({id:idc++,date:today,time,type:"Transfer In",amount:amt,memberId:"",memberName:ref||(srcBank?`Transfer from ${srcBank.name}`:"Transfer in"),bank:destBank.name,bankId:destBank.id,bankHolder:destBank.holder||"",counterparty:srcBank?srcBank.name:"",pairId,notes:form.notes||(srcBank?`From ${srcBank.name}`:""),operator:op,isNew:false,deleted:false});
      setTransactions(prev=>[...rows.reverse(),...prev]);
      setNextId(idc);
      setForm(blank); setShowEntryModal(false);
      return;
    }

    // ---- Store / Mistake: money moves OUT of the chosen bank and INTO the
    // Store/Mistake "bucket". With a bank => two linked legs (bank leg, tagged
    // fundLeg, + bucket leg). With no bank => one bucket leg that just adds the
    // amount to the Store/Mistake total. ----
    if(form.type==="Store" || form.type==="Mistake"){
      if(srcBank){
        const pairId = `${form.type==="Store"?"ST":"MK"}-${nextId}`;
        const bankLeg = {id:nextId,date:today,time,type:form.type,amount:amt,memberId:"",memberName:ref||form.type,bank:srcBank.name,bankId:srcBank.id,bankHolder:srcBank.holder||"",counterparty:form.type,pairId,notes:form.notes,operator:op,isNew:false,deleted:false,fundLeg:true};
        const bucketLeg = {id:nextId+1,date:today,time,type:form.type,amount:-amt,memberId:"",memberName:ref||form.type,bank:form.type,pairId,notes:form.notes,operator:op,isNew:false,deleted:false,bucketLeg:true};
        setTransactions(prev=>[bucketLeg,bankLeg,...prev]);
        setNextId(n=>n+2);
      } else {
        const bucketLeg = {id:nextId,date:today,time,type:form.type,amount:amt,memberId:"",memberName:ref||form.type,bank:form.type,notes:form.notes,operator:op,isNew:false,deleted:false,bucketLeg:true};
        setTransactions(prev=>[bucketLeg,...prev]);
        setNextId(n=>n+1);
      }
      setForm(blank); setShowEntryModal(false);
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
    const newTx = {id:nextId,date:today,time,type:form.type,amount:amt,memberId:assignedId,memberName:ref,bank:srcBank?srcBank.name:"",bankId:srcBank?srcBank.id:null,bankHolder:srcBank?srcBank.holder||"":"",notes:form.notes,operator:op,isNew,deleted:false};
    setTransactions(prev=>[newTx,...prev]); setNextId(n=>n+1);
    if(isNew){
      setMembers(prev=>[...prev,{id:assignedId,name:ref,phone:form.memberPhone||"",joined:today,lastActivity:today}]);
    } else if(existingMember){
      setMembers(prev=>prev.map(m=>m.id===existingMember.id?{...m,lastActivity:today}:m));
    }
    setForm(blank); setShowEntryModal(false);
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
    setDetailModal({title:b.name,subtitle:`Holder: ${b.holder} · BSB: ${b.bsb||"—"} · Acc: ${b.account} · ${tx.length} transactions · Balance: ${fmt(b.balance)}`,transactions:tx});
  };

  const nav = [
    {id:"dashboard",icon:"ti-layout-dashboard",label:"Dashboard"},
    {id:"transactions",icon:"ti-transfer",label:"Transactions"},
    {id:"banks",icon:"ti-building-bank",label:"Bank Accounts"},
    {id:"members",icon:"ti-users",label:"Members"},
    {id:"search",icon:"ti-search",label:"Search"},
  ];

  // Members list pagination (same controls as the transaction log).
  const memberTotal = members.length;
  const memberPages = Math.max(1, Math.ceil(memberTotal/memberPageSize));
  const memberCurPage = Math.min(memberPage, memberPages);
  const memberStart = (memberCurPage-1)*memberPageSize;
  const memberSlice = members.slice(memberStart, memberStart+memberPageSize);

  const labelStyle = {fontSize:12,color:C.muted,display:"block",marginBottom:4};  const SectionTitle = ({icon,children,right}) => (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",margin:"0 0 12px"}}>
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

  return (
    <div style={{display:"flex",minHeight:620,fontFamily:"var(--font-sans)",position:"relative",overflow:"hidden",borderRadius:12,border:`1px solid ${C.border}`}}>
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
      {detailModal&&<DetailModal title={detailModal.title} subtitle={detailModal.subtitle} transactions={detailModal.transactions} banks={banks} onClose={()=>setDetailModal(null)}/>}

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
                  <select value={newBank.name} onChange={e=>setNewBank(b=>({...b,name:e.target.value}))} style={{width:"100%"}}>
                    <option value="">— Select bank —</option>
                    {BANK_CHOICES.map(b=><option key={b} value={b}>{b}</option>)}
                  </select></div>
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
        <div className="ft-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:"24px 16px"}} onClick={closeEntryModal}>
          <div style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:14,width:"100%",maxWidth:640,maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 50px rgba(0,0,0,0.5)",overflow:"hidden",color:C.text}} onClick={e=>e.stopPropagation()}>
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
                  return <button key={t} onClick={()=>setForm(f=>({...f,type:t}))} style={{cursor:"pointer",padding:"8px 14px",fontSize:13,fontWeight:500,borderRadius:8,border:`1.5px solid ${c}`,background:active?c:(dark?c+"22":c+"14"),color:active?"#fff":c}}>{t}</button>;
                })}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                <div><label style={labelStyle}>Bank account affected (optional)</label>
                  <select value={form.bankId??""} onChange={e=>setForm(f=>({...f,bankId:e.target.value?Number(e.target.value):null}))} style={{width:"100%"}}><option value="">— None —</option>{activeBanks.map((b,i)=><option key={b.id} value={b.id}>{i+1}. {b.holder} — {b.name}</option>)}</select></div>
                {form.type==="Transfer"&&<div><label style={labelStyle}>Destination bank (optional)</label>
                  <select value={form.toBankId??""} onChange={e=>setForm(f=>({...f,toBankId:e.target.value?Number(e.target.value):null}))} style={{width:"100%"}}><option value="">— None —</option>{activeBanks.filter(b=>b.id!==form.bankId).map((b,i)=><option key={b.id} value={b.id}>{i+1}. {b.holder} — {b.name}</option>)}</select></div>}
                <div><label style={labelStyle}>Amount ($){SIGNED_TYPES.includes(form.type)?" — use minus for negative":""}</label>
                  <input type="number" placeholder={SIGNED_TYPES.includes(form.type)?"e.g. 100 or -100":"0.00"} value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div style={{position:"relative"}} ref={idSuggestRef}><label style={labelStyle}>Member ID <span style={{color:C.muted,fontWeight:400}}>(optional — auto-assigned if blank)</span></label>
                  <input type="text" placeholder="Type to search by ID…" value={form.memberId} onChange={e=>handleIdInput(e.target.value)} style={{width:"100%",boxSizing:"border-box"}}/>
                  {idSuggestions.length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,background:C.bg,border:`2px solid ${C.accent}`,borderRadius:8,zIndex:50,boxShadow:"0 6px 24px rgba(0,0,0,0.25)",marginTop:2,overflow:"hidden",maxHeight:220,overflowY:"auto"}}>
                      {idSuggestions.map(m=>(
                        <div key={m.id} onMouseDown={()=>selectMember(m)} style={{padding:"10px 12px",cursor:"pointer",fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.border}`,background:C.bg,color:C.text}}
                          onMouseEnter={e=>e.currentTarget.style.background=C.surface2}
                          onMouseLeave={e=>e.currentTarget.style.background=C.bg}>
                          <span style={{fontWeight:500}}><i className="ti ti-id" aria-hidden="true" style={{fontSize:14,marginRight:6,color:C.accent}}/>{m.id}</span>
                          <span style={{color:C.muted,fontSize:11}}>{m.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{position:"relative"}} ref={phoneSuggestRef}><label style={labelStyle}>Phone number <span style={{color:C.muted,fontWeight:400}}>(optional)</span></label>
                  <input type="text" placeholder="Type to search by phone…" value={form.memberPhone} onChange={e=>handlePhoneInput(e.target.value)} style={{width:"100%",boxSizing:"border-box"}}/>
                  {phoneSuggestions.length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,background:C.bg,border:`2px solid ${C.accent}`,borderRadius:8,zIndex:50,boxShadow:"0 6px 24px rgba(0,0,0,0.25)",marginTop:2,overflow:"hidden",maxHeight:220,overflowY:"auto"}}>
                      {phoneSuggestions.map(m=>(
                        <div key={m.id} onMouseDown={()=>selectMember(m)} style={{padding:"10px 12px",cursor:"pointer",fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.border}`,background:C.bg,color:C.text}}
                          onMouseEnter={e=>e.currentTarget.style.background=C.surface2}
                          onMouseLeave={e=>e.currentTarget.style.background=C.bg}>
                          <span style={{fontWeight:500}}><i className="ti ti-phone" aria-hidden="true" style={{fontSize:14,marginRight:6,color:C.accent}}/>{m.phone||"—"}</span>
                          <span style={{color:C.muted,fontSize:11}}>{m.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{position:"relative",gridColumn:"1/-1"}} ref={suggestRef}>
                  <label style={labelStyle}>Member name / reference{(form.type!=="Regular Deposit"&&form.type!=="Regular Withdrawal")?" (optional)":""}</label>
                  <input type="text" placeholder="Type to search members..." value={form.memberName} onChange={e=>handleNameInput(e.target.value)} style={{width:"100%",boxSizing:"border-box"}}/>
                  {nameSuggestions.length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,background:C.bg,border:`2px solid ${C.accent}`,borderRadius:8,zIndex:50,boxShadow:"0 6px 24px rgba(0,0,0,0.25)",marginTop:2,overflow:"hidden"}}>
                      {nameSuggestions.map(m=>(
                        <div key={m.id} onMouseDown={()=>selectMember(m)} style={{padding:"10px 12px",cursor:"pointer",fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.border}`,background:C.bg,color:C.text}}
                          onMouseEnter={e=>e.currentTarget.style.background=C.surface2}
                          onMouseLeave={e=>e.currentTarget.style.background=C.bg}>
                          <span style={{fontWeight:500}}><i className="ti ti-user" aria-hidden="true" style={{fontSize:14,marginRight:6,color:C.accent}}/>{m.name}</span>
                          <span style={{color:C.muted,fontSize:11,background:C.surface2,padding:"2px 8px",borderRadius:4,fontWeight:500}}>{m.id}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{gridColumn:"1/-1"}}><label style={labelStyle}>Notes</label>
                  <input type="text" placeholder="Optional notes" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div style={{gridColumn:"1/-1",display:"flex",alignItems:"center",gap:8,padding:"10px 12px",background:C.surface2,borderRadius:8,border:`1px solid ${C.border}`}}>
                  <i className="ti ti-user-cog" aria-hidden="true" style={{fontSize:16,color:C.accent}}/>
                  <span style={{fontSize:12,color:C.muted}}>Recording as operator</span>
                  <span style={{fontSize:13,fontWeight:500,color:C.text}}>{SESSION.operatorId}</span>
                  <span style={{fontSize:12,color:C.muted}}>· auto-stamped on this entry</span>
                </div>
              </div>
              {formError&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{formError}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:6}}>
                <button onClick={closeEntryModal} style={{cursor:"pointer",padding:"9px 18px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8}}>Cancel</button>
                <button onClick={handleAddTx} style={{padding:"9px 22px",cursor:"pointer",fontWeight:500,background:C.accent,color:"#fff",border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-check" aria-hidden="true"/> Add entry</button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                    <i className="ti ti-layout-sidebar-left" aria-hidden="true"/>
                  </button>
                  {showSidebarMenu&&(
                    <div style={{position:"absolute",...(sidebarExpanded?{top:"calc(100% + 8px)",right:0}:{top:0,left:"calc(100% + 10px)"}),minWidth:192,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:dark?"0 10px 30px rgba(0,0,0,0.5)":"0 10px 30px rgba(0,0,0,0.15)",zIndex:80,overflow:"hidden",padding:6}}>
                      <div style={{fontSize:11,color:C.muted,fontWeight:600,letterSpacing:"0.03em",padding:"6px 10px 8px"}}>Sidebar control</div>
                      {[["expanded","Expanded"],["collapsed","Collapsed"],["hover","Expand on hover"]].map(([val,label])=>{
                        const sel = sidebarMode===val;
                        return (
                          <button key={val} onClick={()=>{ setSidebarMode(val); setShowSidebarMenu(false); }}
                            style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 10px",borderRadius:7,border:"none",cursor:"pointer",background:"transparent",color:C.text,fontSize:13,fontWeight:sel?600:400,textAlign:"left"}}
                            onMouseEnter={e=>e.currentTarget.style.background=C.surface2}
                            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <span style={{width:8,height:8,borderRadius:"50%",flexShrink:0,background:sel?C.accent:"transparent"}}/>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
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

      <main style={{flex:1,padding:"16px 24px 24px",overflowY:"auto",minWidth:0,background:C.bg}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:500,color:C.text}}>{nav.find(n=>n.id===page)?.label}</h2>

          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",justifyContent:"flex-end"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:C.muted,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:"5px 10px"}} title={`This company's time zone: ${tz}. Entries are stamped with this clock.`}>
              <i className="ti ti-clock-hour-4" aria-hidden="true" style={{fontSize:15,color:C.accent}}/>
              <span style={{fontWeight:600,color:C.text}}>{clockNow}</span>
              <span style={{whiteSpace:"nowrap"}}>{tzCity(tz)} time</span>
            </div>
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
                  <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Theme</div>
                    <div style={{display:"flex",gap:4,background:C.surface2,borderRadius:8,padding:3}}>
                      <button onClick={()=>window.FINTRACK_SET_THEME&&window.FINTRACK_SET_THEME("light")} style={{flex:1,cursor:"pointer",border:"none",borderRadius:6,padding:"6px 8px",fontSize:12.5,fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:5,background:!dark?C.bg:"transparent",color:!dark?C.text:C.muted,fontWeight:!dark?600:400}}>
                        <i className="ti ti-sun" aria-hidden="true"/> Light
                      </button>
                      <button onClick={()=>window.FINTRACK_SET_THEME&&window.FINTRACK_SET_THEME("dark")} style={{flex:1,cursor:"pointer",border:"none",borderRadius:6,padding:"6px 8px",fontSize:12.5,fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:5,background:dark?C.bg:"transparent",color:dark?C.text:C.muted,fontWeight:dark?600:400}}>
                        <i className="ti ti-moon" aria-hidden="true"/> Dark
                      </button>
                    </div>
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
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
              {toggleBtn(dashView==="today",()=>setDashView("today"),"Today")}
              {toggleBtn(dashView==="yesterday",()=>setDashView("yesterday"),"Yesterday")}
              {toggleBtn(dashView==="week",()=>setDashView("week"),"This week")}
              {toggleBtn(dashView==="month",()=>setDashView("month"),"Monthly")}
              {toggleBtn(dashView==="range",()=>setDashView("range"),"Date range")}
              {dashView==="month"&&(
                <select value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={{marginLeft:4}}>
                  {availableMonths.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
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

            <div style={{display:"grid",gridTemplateColumns:isWideView?"repeat(5, minmax(0,1fr))":"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:18}}>
              <StatCard label="Total deposits" count={stats.deposits.length} amount={stats.sum(stats.deposits)} color="#16a34a"/>
              <StatCard label="Total withdrawals" count={stats.withdrawals.length} amount={stats.sum(stats.withdrawals)} color="#dc2626"/>
              <StatCard label="Win / Loss" amount={stats.sum(stats.deposits)-stats.sum(stats.withdrawals)} color={(stats.sum(stats.deposits)-stats.sum(stats.withdrawals))>=0?"#16a34a":"#dc2626"}/>
              <StatCard label="New members" count={stats.newMembers.length} amount={stats.sum(stats.newMembers)} color="#2563eb"/>
              <StatCard label="Unclaimed credits" count={stats.unclaimed.length} amount={stats.sum(stats.unclaimed)} color="#d97706"/>
              <StatCard label="Mistakes" count={stats.mistakes.length} amount={stats.sum(stats.mistakes)} color="#7c3aed"/>
              <StatCard label="Rentals" count={stats.rentals.length} amount={stats.sum(stats.rentals)} color="#0891b2"/>
              <StatCard label="Store entries" count={stats.store.length} amount={stats.sum(stats.store)} color="#db2777"/>
              <StatCard label="Transfers" count={stats.transfers.length} amount={stats.sum(stats.transfers)} color="#6366f1"/>
              <StatCard label="Adjustments" count={stats.adjustments.length} amount={stats.sum(stats.adjustments)} color="#0d9488"/>
            </div>

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
                      <div key={row.label} style={{background:C.bg,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`,borderLeft:`3px solid ${row.color}`}}>
                        <div style={{fontSize:12,color:C.muted,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><i className={`ti ${row.icon}`} aria-hidden="true" style={{color:row.color}}/>{row.label}</div>
                        <div style={{fontSize:19,fontWeight:600,color:C.text}}>{fmt(row.arr.reduce((s,b)=>s+(b.balance||0),0))}</div>
                        <div style={{fontSize:11.5,color:C.muted,marginTop:2}}>{row.arr.length} {row.arr.length===1?"bank":"banks"}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={cardStyle}>
                  <h3 style={{fontSize:16,fontWeight:600,margin:"0 0 14px",color:C.text,display:"flex",alignItems:"center",gap:8}}><i className="ti ti-building-bank" aria-hidden="true" style={{color:C.accent}}/> Current active bank</h3>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {activeBanks.length===0&&<div style={{fontSize:13,color:C.muted,padding:"14px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No active banks.</div>}
                    {activeBanks.map(b=>(
                      <div key={b.id} onClick={()=>openBankDetail(b)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:C.bg,borderRadius:10,padding:"11px 14px",cursor:"pointer",border:`1px solid ${C.border}`}}
                        onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
                        onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:13,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={b.holder||b.name}>{b.holder||b.name}</div>
                          <div style={{fontSize:11.5,color:C.muted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name}</div>
                        </div>
                        <div style={{fontSize:14,fontWeight:600,color:C.text,whiteSpace:"nowrap",flexShrink:0}}>{fmt(b.balance)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {page==="transactions"&&(
          <div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-plus">Record a transaction</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Choose an entry type to open the entry form.</div>
              {banks.length===0&&<div style={{fontSize:13,color:"#d97706",marginBottom:14,padding:"10px 14px",background:dark?"#3a2a10":"#fdf3e0",borderRadius:8,border:`1px solid #d9770655`}}><i className="ti ti-alert-triangle" aria-hidden="true"/> Add a bank account on the Bank Accounts page before recording transactions.</div>}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
                {ENTRY_TYPES.map(t=>{
                  const c = TYPE_COLORS[t]||C.accent;
                  return <button key={t} type="button" onClick={()=>{ setForm({type:t,amount:"",memberId:"",memberName:"",memberPhone:"",bankId:activeBanks[0]?.id??null,notes:"",toBankId:null}); setFormError(""); setNameSuggestions([]); setIdSuggestions([]); setPhoneSuggestions([]); setShowEntryModal(true); }}
                    style={{cursor:"pointer",padding:"16px 14px",fontSize:14,fontWeight:500,borderRadius:10,border:`1.5px solid ${c}`,background:dark?c+"22":c+"12",color:c,display:"flex",flexDirection:"column",alignItems:"center",gap:8,transition:"transform 0.1s"}}
                    onMouseEnter={e=>{e.currentTarget.style.background=c;e.currentTarget.style.color="#fff";}}
                    onMouseLeave={e=>{e.currentTarget.style.background=dark?c+"22":c+"12";e.currentTarget.style.color=c;}}>
                    <i className="ti ti-plus" aria-hidden="true" style={{fontSize:18}}/>{t}
                  </button>;
                })}
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
                  <div key={b.id} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 16px",cursor:editingBank===b.id?"default":"pointer"}}
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
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {page==="members"&&(
          <div style={sectionStyle}>
            <SectionTitle icon="ti-users" right={
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={()=>{ setNewMember({name:"",phone:"",id:""}); setNewMemberError(""); setShowMemberModal(true); }} style={{cursor:"pointer",fontSize:13,fontWeight:500,padding:"7px 16px",border:"none",borderRadius:8,background:C.accent,color:"#fff",display:"inline-flex",alignItems:"center",gap:6}}><i className="ti ti-user-plus" aria-hidden="true"/> Add member</button>
                <button onClick={()=>exportMembersCSV()} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid ${C.border}`,borderRadius:6,background:C.surface2,color:C.text,display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-text" aria-hidden="true"/> CSV</button>
                <button onClick={()=>exportMembersExcel()} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid #16a34a`,borderRadius:6,background:dark?"#163524":"#16a34a14",color:"#16a34a",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-spreadsheet" aria-hidden="true"/> Excel</button>
                <button onClick={()=>exportMembersPDF()} style={{cursor:"pointer",fontSize:12,fontWeight:500,padding:"5px 11px",border:`1px solid #dc2626`,borderRadius:6,background:dark?"#3a1515":"#dc262614",color:"#dc2626",display:"inline-flex",alignItems:"center",gap:5}}><i className="ti ti-file-type-pdf" aria-hidden="true"/> PDF</button>
              </div>
            }>Members directory</SectionTitle>
            <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Click a row to view a member's full transaction history.</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,color:C.muted}}>
                <span>Show</span>
                <select value={memberPageSize} onChange={e=>setMemberPageSize(Number(e.target.value))} style={{padding:"4px 8px",width:"auto"}}>
                  {PAGE_SIZES.map(n=><option key={n} value={n}>{n}</option>)}
                </select>
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
                <div><label style={labelStyle}>Member</label><select value={search.member} onChange={e=>setSearch(s=>({...s,member:e.target.value}))} style={{width:"100%"}}><option value="">All members</option>{members.map(m=><option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}</select></div>
                <div><label style={labelStyle}>Bank</label><select value={search.bank} onChange={e=>setSearch(s=>({...s,bank:e.target.value}))} style={{width:"100%"}}><option value="">All banks</option>{banks.map(b=><option key={b.id} value={b.id}>{b.holder?`${b.holder} — ${b.name}`:b.name}</option>)}</select></div>
                <div><label style={labelStyle}>From date</label><input type="date" value={search.dateFrom} onChange={e=>setSearch(s=>({...s,dateFrom:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div><label style={labelStyle}>To date</label><input type="date" value={search.dateTo} onChange={e=>setSearch(s=>({...s,dateTo:e.target.value}))} style={{width:"100%",boxSizing:"border-box"}}/></div>
                <div><label style={labelStyle}>Entry type</label><select value={search.type} onChange={e=>setSearch(s=>({...s,type:e.target.value}))} style={{width:"100%"}}><option value="">All types</option>{ENTRY_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              </div>
              <div style={{marginTop:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontSize:12,color:C.muted}}>{filteredTx.length} result{filteredTx.length!==1?"s":""} found</div>
                <button onClick={()=>setSearch({term:"",dateFrom:"",dateTo:"",type:"",bank:"",member:""})} style={{fontSize:12,cursor:"pointer",padding:"6px 14px",fontWeight:500,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:6}}><i className="ti ti-refresh" aria-hidden="true"/> Clear filters</button>
              </div>
            </div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-list" right={
                <div style={{display:"flex",gap:8}}>
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
      </div>
    </div>
  );
}
