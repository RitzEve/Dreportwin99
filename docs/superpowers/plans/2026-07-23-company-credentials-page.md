# Company Credentials Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a master/manager-only "{Company name} Details" page — a general login/credential vault with user-defined record names and a flexible common-fields-plus-custom-fields model, matching the design in `docs/superpowers/specs/2026-07-23-company-credentials-page-design.md`.

**Architecture:** A new dedicated, RLS-gated Supabase table (`company_credentials`, own migration — not the shared `app_data` blob), a new `auth.js` section (list/create/update/delete, gated on the existing `canAccessConsole` helper), a `window.FINTRACK_COMPANY_CREDENTIALS_API` global injected by `AppScreen.jsx`, and a new page + card + panel + Add/Edit form inside `FinTrack.jsx`, closely mirroring the already-shipped Bank Details page's structure and conventions.

**Tech Stack:** Vite/React 18.3.1 (plain JS, inline styles, no Tailwind/TypeScript), Supabase Postgres + RLS, GSAP (`useGSAP` + `gsap.matchMedia`) for motion, Tabler icon webfont.

**No test framework exists in this project** (confirmed: `package.json` has no Jest/Vitest/RTL, and CLAUDE.md's own completion gate is `npm run build` + live browser verification, not unit tests). This plan follows that established pattern instead of inventing a new one: every task's steps show complete, real code with exact file:line anchors; verification happens via `npm run build` (Task 13) and a live browser walkthrough (Task 15), exactly like every prior feature in this codebase including the just-shipped Bank Details page.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migration-022.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================================
-- Migration 022 — Company Credentials: master/manager-only login/credential vault
-- ============================================================================
-- Run the SAME way as before: Supabase dashboard → SQL Editor → New query →
-- paste ALL of this → Run. Safe to run more than once.
--
-- WHAT THIS ADDS: a new company_credentials table for recording general login
-- credentials (Google account, VPNs, admin consoles, etc.) — visible and
-- editable ONLY by master/manager of the OWNING company. Same isolation as
-- bank_details (migration-021): RLS means the row never leaves the database
-- for a staff session, not even over the network — not just a hidden nav item.
-- ============================================================================

create table if not exists public.company_credentials (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  category      text,
  username      text,
  email         text,
  password      text,
  link          text,
  custom_fields jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_company_credentials_company_id on public.company_credentials(company_id);

alter table public.company_credentials enable row level security;

drop policy if exists company_credentials_select on public.company_credentials;
create policy company_credentials_select on public.company_credentials for select to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists company_credentials_insert on public.company_credentials;
create policy company_credentials_insert on public.company_credentials for insert to authenticated
  with check ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists company_credentials_update on public.company_credentials;
create policy company_credentials_update on public.company_credentials for update to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') )
  with check ( company_id = public.my_company() and public.my_role() in ('master','manager') );

drop policy if exists company_credentials_delete on public.company_credentials;
create policy company_credentials_delete on public.company_credentials for delete to authenticated
  using ( company_id = public.my_company() and public.my_role() in ('master','manager') );

grant select, insert, update, delete on public.company_credentials to authenticated;
```

- [ ] **Step 2: Do NOT run this against Supabase yet**

Per this project's standing workflow, migration SQL is pasted to the user in
chat for them to run by hand — never auto-applied by the assistant. This file
is created now so it's ready to hand over once the app-code tasks below are
built and verified with `npm run build`.

---

## Task 2: `auth.js` — Company Credentials CRUD functions

**Files:**
- Modify: `src/lib/auth.js` (append after the bank-details section, which currently ends at line 819)

- [ ] **Step 1: Append the new section**

Add this immediately after the `markBankDetailAdded` function (end of the
bank-details section, `src/lib/auth.js:819`):

```javascript

// ---- company credentials (master/manager: general login/credential vault) --
// Lives in its own table (migration-022) with RLS gated on company_id + role
// in ('master','manager') — same isolation as bank_details, and arguably more
// important here since this can hold root-level infrastructure credentials.
// No fixed field schema: name/category/username/email/password/link cover the
// common case, customFields (jsonb array of {label,value,sensitive}) covers
// everything else a given record needs.

const CREDENTIAL_FIELD_MAP = {
  name: 'name', category: 'category', username: 'username',
  email: 'email', password: 'password', link: 'link',
};

function credentialRowToObj(r) {
  const obj = {
    id: r.id, companyId: r.company_id, updatedAt: r.updated_at,
    customFields: Array.isArray(r.custom_fields) ? r.custom_fields : [],
  };
  for (const [key, col] of Object.entries(CREDENTIAL_FIELD_MAP)) obj[key] = r[col] ?? '';
  return obj;
}

function credentialFieldsToRow(fields) {
  const row = {};
  for (const [key, col] of Object.entries(CREDENTIAL_FIELD_MAP)) {
    if (fields[key] !== undefined) row[col] = fields[key] === '' ? null : fields[key];
  }
  if (fields.customFields !== undefined) row.custom_fields = fields.customFields;
  return row;
}

const CREDENTIALS_SETUP_ERROR = 'This needs a one-time database setup (run migration-022.sql in Supabase).';
const isCredentialsMissing = (error) => /company_credentials|does not exist|could not find|schema cache/i.test(error?.message || '');

/** Master/manager: every credential record for their own company. */
export async function listCompanyCredentials() {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.', rows: [] };
  const { data, error } = await supabase.from('company_credentials').select('*')
    .eq('company_id', me.companyId).order('created_at', { ascending: false });
  if (error) return { ok: false, error: isCredentialsMissing(error) ? CREDENTIALS_SETUP_ERROR : friendly(error), rows: [] };
  return { ok: true, rows: (data || []).map(credentialRowToObj) };
}

/** Master/manager: create a credential record for their own company. Only `name` is required. */
export async function createCompanyCredential(fields) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  if (!fields.name || !fields.name.trim()) return { ok: false, error: 'Record name is required.' };
  const row = { ...credentialFieldsToRow(fields), company_id: me.companyId };
  const { data, error } = await supabase.from('company_credentials').insert(row).select().single();
  if (error) return { ok: false, error: isCredentialsMissing(error) ? CREDENTIALS_SETUP_ERROR : friendly(error) };
  return { ok: true, row: credentialRowToObj(data) };
}

/** Master/manager: edit a credential record. Pass only the fields that changed. */
export async function updateCompanyCredential(id, fields) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  if (fields.name !== undefined && !fields.name.trim()) return { ok: false, error: 'Record name is required.' };
  const row = { ...credentialFieldsToRow(fields), updated_at: new Date().toISOString() };
  const { error } = await supabase.from('company_credentials').update(row).eq('id', id);
  if (error) return { ok: false, error: isCredentialsMissing(error) ? CREDENTIALS_SETUP_ERROR : friendly(error) };
  return { ok: true };
}

/** Master/manager: permanently delete a credential record. */
export async function deleteCompanyCredential(id) {
  const me = await getCurrentUser();
  if (!me || !canAccessConsole(me.role)) return { ok: false, error: 'Not authorised.' };
  const { error } = await supabase.from('company_credentials').delete().eq('id', id);
  if (error) return { ok: false, error: isCredentialsMissing(error) ? CREDENTIALS_SETUP_ERROR : friendly(error) };
  return { ok: true };
}
```

- [ ] **Step 2: Confirm the exports exist**

Run: `grep -n "export async function.*CompanyCredential\|export async function listCompanyCredentials" src/lib/auth.js`
Expected: 4 matches (`listCompanyCredentials`, `createCompanyCredential`, `updateCompanyCredential`, `deleteCompanyCredential`).

---

## Task 3: `AppScreen.jsx` — wire the API into `window` globals

**Files:**
- Modify: `src/app/AppScreen.jsx:2-5` (imports), `src/app/AppScreen.jsx:48-51` (injection)

- [ ] **Step 1: Extend the import**

Change (`src/app/AppScreen.jsx:2-5`):

```javascript
import {
  changeOwnPassword, listTeam, ROLES, canAccessConsole,
  listBankDetails, createBankDetail, updateBankDetail, deleteBankDetail, setBankDetailFrozen, markBankDetailAdded,
} from '../lib/auth.js';
```

To:

```javascript
import {
  changeOwnPassword, listTeam, ROLES, canAccessConsole,
  listBankDetails, createBankDetail, updateBankDetail, deleteBankDetail, setBankDetailFrozen, markBankDetailAdded,
  listCompanyCredentials, createCompanyCredential, updateCompanyCredential, deleteCompanyCredential,
} from '../lib/auth.js';
```

- [ ] **Step 2: Add the injection**

Immediately after the existing `window.FINTRACK_BANK_DETAILS_API` block
(`src/app/AppScreen.jsx:48-51`), add:

```javascript
    // Company Credentials: a separate real table (not the app_data blob), same
    // master/manager gate as Bank Details — see that block's comment above for
    // the full reasoning (client-side check here, RLS is the real gate).
    window.FINTRACK_COMPANY_CREDENTIALS_API = canAccessConsole(ctx.user.role) ? {
      list: listCompanyCredentials, create: createCompanyCredential, update: updateCompanyCredential,
      remove: deleteCompanyCredential,
    } : null;
```

- [ ] **Step 3: Sanity-check the file parses**

Run: `node --check src/app/AppScreen.jsx` is not valid for JSX — instead run
the full build gate now to catch any syntax error early:
`npm run build`
Expected: build succeeds (this step's only purpose is an early syntax check;
the full functional build gate is Task 13 once all files are done).

---

## Task 4: `FinTrack.jsx` — module-level constants + `CopyableValue` component

**Files:**
- Modify: `src/app/FinTrack.jsx` (insert after the `BankDetailPanel` function, which currently ends at line 578, before the `TxLog`/`PAGE_SIZES` section at line 580)

- [ ] **Step 1: Insert the constants and component**

```javascript

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
    navigator.clipboard.writeText(value).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),1500); });
  };
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:6,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
      {isLink ? (
        <a href={value} target="_blank" rel="noopener noreferrer" style={{color:C.accent,textDecoration:"none",display:"inline-flex",alignItems:"center",gap:4,wordBreak:"break-all"}}><i className="ti ti-link" aria-hidden="true" style={{fontSize:12,flexShrink:0}}/>{value}</a>
      ) : (
        <span style={{fontFamily:masked?"ui-monospace,Consolas,monospace":"inherit",letterSpacing:masked&&!show?2:0,wordBreak:"break-word"}}>{masked&&!show?"•".repeat(Math.min(value.length,8)):value}</span>
      )}
      {masked&&<button type="button" onClick={()=>setShow(s=>!s)} style={{cursor:"pointer",fontSize:9.5,fontWeight:700,color:C.accent,background:C.accentBg,border:`1px solid ${C.accent}`,borderRadius:4,padding:"1px 5px",lineHeight:1.6}}>{show?"HIDE":"SHOW"}</button>}
      <button type="button" onClick={doCopy} style={{cursor:"pointer",fontSize:9.5,fontWeight:700,color:copied?"#16a34a":C.accent,background:copied?(dark?"#14331f":"#16a34a14"):C.accentBg,border:`1px solid ${copied?"#16a34a":C.accent}`,borderRadius:4,padding:"1px 5px",lineHeight:1.6}}>{copied?"COPIED":"COPY"}</button>
    </span>
  );
}
```

- [ ] **Step 2: Verify placement**

Run: `grep -n "^const CRED_BLANK\|^function CopyableValue\|^const PAGE_SIZES" src/app/FinTrack.jsx`
Expected: all 3 lines found, `CRED_BLANK`/`CopyableValue` appearing before `PAGE_SIZES`.

---

## Task 5: `FinTrack.jsx` — `CredentialCard` component

**Files:**
- Modify: `src/app/FinTrack.jsx` (insert immediately after the `CopyableValue` component from Task 4)

- [ ] **Step 1: Add the component**

```javascript

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
      <div onClick={e=>e.stopPropagation()} style={{display:"flex",gap:6}}>
        <button onClick={onEdit} style={{...editBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-edit" aria-hidden="true"/> Edit</button>
        <button onClick={onDelete} style={{...deleteBtnStyle,flex:1,justifyContent:"center"}}><i className="ti ti-trash" aria-hidden="true"/> Del</button>
      </div>
    </GlowCard>
  );
}
```

- [ ] **Step 2: Verify placement**

Run: `grep -n "^function CredentialCard" src/app/FinTrack.jsx`
Expected: 1 match.

---

## Task 6: `FinTrack.jsx` — `CredentialPanel` component

**Files:**
- Modify: `src/app/FinTrack.jsx` (insert immediately after `CredentialCard` from Task 5)

- [ ] **Step 1: Add the component**

```javascript

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
```

- [ ] **Step 2: Verify placement**

Run: `grep -n "^function CredentialPanel" src/app/FinTrack.jsx`
Expected: 1 match.

---

## Task 7: `FinTrack.jsx` — state block

**Files:**
- Modify: `src/app/FinTrack.jsx:892` (new access flag), `src/app/FinTrack.jsx:975` (new state, after the existing Bank Details state block)

- [ ] **Step 1: Add the access flag**

Immediately after the `canAccessBankDetails` line (`src/app/FinTrack.jsx:892`):

```javascript
  // Company Credentials is master/manager-only too — separately named from
  // canAccessBankDetails even though the expression is currently identical,
  // matching this file's existing convention (canEditRoster is the same
  // pattern) so either gate can change independently later without coupling.
  const canAccessCompanyCredentials = SESSION.role==="master" || SESSION.role==="manager";
```

- [ ] **Step 2: Add the state**

Immediately after `const bdModalRef = useRef(null);` (`src/app/FinTrack.jsx:975`):

```javascript

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
```

- [ ] **Step 3: Verify placement**

Run: `grep -n "canAccessCompanyCredentials = SESSION\|const \[credentials,setCredentials\]" src/app/FinTrack.jsx`
Expected: 2 matches.

---

## Task 8: `FinTrack.jsx` — fetch effect, derived list, CRUD + custom-field handlers

**Files:**
- Modify: `src/app/FinTrack.jsx` (insert after the `handleAddBdToBankAccounts` function, which currently ends at line 1712, before the Bank Details `useGSAP` hooks that start at line 1714)

- [ ] **Step 1: Add the fetch effect and derived list**

```javascript

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
```

- [ ] **Step 2: Add the CRUD handlers**

```javascript

  const openCredAdd = () => { setCredEditId(null); setCredForm(CRED_BLANK); setCredFormError(""); setCredModalOpen(true); };
  const openCredEdit = cred => { setCredEditId(cred.id); setCredForm({name:cred.name,category:cred.category,username:cred.username,email:cred.email,password:cred.password,link:cred.link,customFields:cred.customFields.map(f=>({...f}))}); setCredFormError(""); setCredModalOpen(true); };
  const closeCredModal = () => setCredModalOpen(false);
  const handleSaveCred = async () => {
    if(!credForm.name.trim()){ setCredFormError("Record name is required."); return; }
    const api = window.FINTRACK_COMPANY_CREDENTIALS_API;
    if(!api){ setCredFormError("Not authorised."); return; }
    const cleanFields = credForm.customFields.filter(f=>f.label.trim()||f.value.trim());
    const payload = {...credForm, customFields:cleanFields};
    const res = credEditId ? await api.update(credEditId,payload) : await api.create(payload);
    if(!res.ok){ setCredFormError(res.error); return; }
    if(credEditId) setCredentials(prev=>prev.map(c=>c.id===credEditId?{...c,...payload}:c));
    else setCredentials(prev=>[res.row,...prev]);
    setCredModalOpen(false);
  };
  const handleDeleteCred = (id,label) => setConfirm({message:`Delete "${label||"this record"}"? This cannot be undone.`,onConfirm: async ()=>{
    setConfirm(null);
    const api = window.FINTRACK_COMPANY_CREDENTIALS_API;
    if(!api) return;
    const res = await api.remove(id);
    if(res.ok) setCredentials(prev=>prev.filter(c=>c.id!==id));
  }});

  // Custom-field row helpers for the Add/Edit form. Defaults to sensitive=true
  // (safer default — assume a hand-typed extra field is a secret unless told
  // otherwise) and drops fully-blank rows on save (Step above, handleSaveCred).
  const addCredCustomField = () => setCredForm(f=>({...f,customFields:[...f.customFields,{label:"",value:"",sensitive:true}]}));
  const updateCredCustomField = (i,patch) => setCredForm(f=>({...f,customFields:f.customFields.map((row,idx)=>idx===i?{...row,...patch}:row)}));
  const removeCredCustomField = i => setCredForm(f=>({...f,customFields:f.customFields.filter((_,idx)=>idx!==i)}));
```

- [ ] **Step 3: Verify placement**

Run: `grep -n "const handleSaveCred\|const addCredCustomField" src/app/FinTrack.jsx`
Expected: 2 matches, both before the existing Bank Details `useGSAP` hooks.

---

## Task 9: `FinTrack.jsx` — GSAP motion

**Files:**
- Modify: `src/app/FinTrack.jsx` (insert immediately after the Bank Details form-group `useGSAP` hook, which currently ends around line 1740 — search for the exact end as shown below)

- [ ] **Step 1: Find the insertion point**

Run: `grep -n "dependencies:\[bdModalOpen\],scope:bdModalRef" src/app/FinTrack.jsx`
This is the last line of the 3rd Bank Details `useGSAP` hook — insert immediately after this line's closing `});`.

- [ ] **Step 2: Add the 3 motion hooks**

```javascript

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
```

- [ ] **Step 3: Verify placement**

Run: `grep -n "cred-form-group\", scope:credModalRef\|scope:credModalRef" src/app/FinTrack.jsx`
Expected: 1 match, in a `useGSAP` call (the className string itself is written
in Task 12's modal JSX — this task only adds the hook that queries for it).

---

## Task 10: `FinTrack.jsx` — nav entry

**Files:**
- Modify: `src/app/FinTrack.jsx:1934-1944` (the `nav` array)

- [ ] **Step 1: Add the nav item**

Change:

```javascript
  const nav = [
    {id:"dashboard",icon:"ti-layout-dashboard",label:"Dashboard"},
    {id:"transactions",icon:"ti-transfer",label:"Transactions"},
    {id:"banks",icon:"ti-building-bank",label:"Bank Accounts"},
    // Master/manager only — hidden from staff here (nav), guarded again on the
    // page render below, and enforced for real by RLS (migration-021).
    ...(canAccessBankDetails ? [{id:"bankdetails",icon:"ti-id-badge-2",label:"Bank Details"}] : []),
    {id:"members",icon:"ti-users",label:"Members"},
    {id:"search",icon:"ti-search",label:"Search"},
    {id:"offdays",icon:"ti-calendar-off",label:"Work Shifts/Off Day"},
  ];
```

To:

```javascript
  const nav = [
    {id:"dashboard",icon:"ti-layout-dashboard",label:"Dashboard"},
    {id:"transactions",icon:"ti-transfer",label:"Transactions"},
    {id:"banks",icon:"ti-building-bank",label:"Bank Accounts"},
    // Master/manager only — hidden from staff here (nav), guarded again on the
    // page render below, and enforced for real by RLS (migration-021).
    ...(canAccessBankDetails ? [{id:"bankdetails",icon:"ti-id-badge-2",label:"Bank Details"}] : []),
    // Master/manager only — general credential vault, own table (migration-022).
    // Label uses the real company name, same source AccountMenu already reads.
    ...(canAccessCompanyCredentials ? [{id:"companycredentials",icon:"ti-key",label:`${SESSION.companyName} Details`}] : []),
    {id:"members",icon:"ti-users",label:"Members"},
    {id:"search",icon:"ti-search",label:"Search"},
    {id:"offdays",icon:"ti-calendar-off",label:"Work Shifts/Off Day"},
  ];
```

No changes are needed to `MOBILE_PRIMARY_IDS` or `MOBILE_TAB_LABEL`
(`src/app/FinTrack.jsx:18`) — the new `companycredentials` id is not in
`MOBILE_PRIMARY_IDS`, so it automatically falls into the mobile "More"
overflow sheet, which renders `n.label` directly
(`src/app/FinTrack.jsx:3385`, confirmed by reading that block) rather than
looking it up in `MOBILE_TAB_LABEL` — so the full dynamic company-name label
displays correctly there with no further code changes.

- [ ] **Step 2: Verify**

Run: `grep -n "companycredentials" src/app/FinTrack.jsx`
Expected: appears in the `nav` array (this task) — more matches will appear
after Tasks 11-12 add the page render and modal.

---

## Task 11: `FinTrack.jsx` — page render section

**Files:**
- Modify: `src/app/FinTrack.jsx` (insert between the Bank Details page block's closing `)}` — currently line 2967 — and `{page==="members"&&(` — currently line 2969)

- [ ] **Step 1: Add the page section**

```javascript

        {page==="companycredentials"&&canAccessCompanyCredentials&&(
          <div>
            <div style={sectionStyle}>
              <SectionTitle icon="ti-key" right={
                <button onClick={openCredAdd} style={{cursor:"pointer",padding:"9px 20px",fontWeight:500,background:C.accent,color:C.onAccent,border:"none",borderRadius:8,display:"inline-flex",alignItems:"center",gap:6,fontSize:14}}>
                  <i className="ti ti-plus" aria-hidden="true"/> Add record
                </button>
              }>{SESSION.companyName} Details</SectionTitle>
              <div style={{fontSize:12,color:C.muted,marginBottom:14}}>Master/manager only. {credentials.length} record{credentials.length===1?"":"s"} saved. Click a card for the full record.</div>
              {credentials.length>0&&(
                <div style={{position:"relative",maxWidth:420,marginBottom:14}}>
                  <i className="ti ti-search" aria-hidden="true" style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15,pointerEvents:"none"}}/>
                  <input type="text" value={credSearch} onChange={e=>setCredSearch(e.target.value)} placeholder="Search name, category, username, email or link…" style={{width:"100%",boxSizing:"border-box",padding:"8px 34px"}}/>
                  {credSearch&&<button type="button" onClick={()=>setCredSearch("")} aria-label="Clear search" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",cursor:"pointer",color:C.muted,fontSize:15,display:"flex",padding:4}}><i className="ti ti-x" aria-hidden="true"/></button>}
                </div>
              )}
              {!credLoaded&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center"}}>Loading…</div>}
              {credLoaded&&credLoadError&&<div style={{fontSize:13,color:"#dc2626",padding:"20px",textAlign:"center",border:"1px solid #dc262655",borderRadius:10}}>{credLoadError}</div>}
              {credLoaded&&!credLoadError&&credentials.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No records yet. Click "Add record" to create one.</div>}
              {credLoaded&&credentials.length>0&&credShown.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px",textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>No records match "{credSearch}".</div>}
              <div ref={credGridRef} style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(max(240px, calc((100% - 36px) / 4)), 1fr))",gap:12}}>
                {credShown.map(cred=>(
                  <CredentialCard key={cred.id} cred={cred}
                    onOpen={()=>setCredPanel(cred)}
                    onEdit={()=>openCredEdit(cred)}
                    onDelete={()=>handleDeleteCred(cred.id,cred.name)}/>
                ))}
              </div>
            </div>
          </div>
        )}
```

- [ ] **Step 2: Verify placement**

Run: `grep -n 'page==="companycredentials"&&canAccessCompanyCredentials' src/app/FinTrack.jsx`
Expected: 1 match, positioned after the Bank Details page block and before
the Members page block.

---

## Task 12: `FinTrack.jsx` — Add/Edit modal + panel mount

**Files:**
- Modify: `src/app/FinTrack.jsx` (insert immediately after `{bdPanel&&<BankDetailPanel .../>}`, currently line 2336, before the transaction-entry modal block)

- [ ] **Step 1: Add the modal and panel mount**

```javascript

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
                    <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:C.muted,whiteSpace:"nowrap",cursor:"pointer"}}>
                      <input type="checkbox" checked={cf.sensitive} onChange={e=>updateCredCustomField(i,{sensitive:e.target.checked})}/> 🔒
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
```

- [ ] **Step 2: Verify placement**

Run: `grep -n "credModalOpen&&(\|credPanel&&<CredentialPanel" src/app/FinTrack.jsx`
Expected: 2 matches, both after the Bank Details modal/panel block.

---

## Task 13: Build verification

**Files:** none (verification only)

- [ ] **Step 1: Run the build**

Run: `cd "C:\Users\BLUE I.T COMPUTER\multi-company-portal" && npm run build`
Expected: `✓ built in <time>` with no errors. Pre-existing chunk-size warnings
(Beams/index chunks) are expected and unrelated.

- [ ] **Step 2: If it fails, fix and re-run**

Common causes given the tasks above: a stray icon `<i>` referencing a
component that isn't defined yet (check task order), a mismatched
`useState`/`useGSAP` dependency name, or a JSX tag left unclosed when pasting
into the existing file. Fix the specific error shown, then re-run Step 1.
Do not proceed to Task 14 until the build is green.

---

## Task 14: Self-directed redesign-premium check

**Files:** `src/app/FinTrack.jsx` (read-only review, plus fixes if anything is found)

This applies the lesson from the Bank Details redesign-premium pass (its
Remarks textarea was unthemed because `global.css` only covered
`input, select` — already fixed globally, so this specific bug can't recur,
but the same class of "did every new element actually inherit the right
theme" check is worth repeating for genuinely new UI, like the new checkbox
and the `<a>` tag inside `CopyableValue`).

- [ ] **Step 1: Confirm no new unthemed elements**

Run: `grep -n "textarea\|<select" src/app/FinTrack.jsx` limited to the new
Company Credentials code (Tasks 4-12) — expected: no matches (this feature
uses no `<textarea>` or `<select>`, only `<input>`, which is already themed
by `global.css`'s existing `input, select, textarea` rule).

- [ ] **Step 2: Confirm icon names are real**

Run (from the project root, with the vendored Tabler CSS already fetched
during the Bank Details redesign session, or re-fetch if needed):

```bash
curl -s "https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.24.0/dist/tabler-icons.min.css" -o /tmp/tabler-check.css
for name in key list-details id-badge-2 user mail lock link plus x check edit trash; do
  grep -q -- "-${name}:before" /tmp/tabler-check.css && echo "OK ti-$name" || echo "MISSING ti-$name"
done
```

Expected: `OK` for all of them (all were pre-verified during planning — this
step re-confirms nothing drifted).

- [ ] **Step 3: Confirm focus states and tap targets**

Read `src/styles/global.css` and confirm the `input:focus, select:focus,
textarea:focus` rule (added during the Bank Details redesign pass) still
covers the new `<input>` elements — it does, since they're plain `<input
type="text">`/`<input type="checkbox">` with no custom override that would
shadow the shared rule. No code change expected from this step; it's a
confirmation, not a fix.

---

## Task 15: Live verification

**Files:** none (verification only) — requires the user to have run
`migration-022.sql` first (see the ship report at the end of this plan).

- [ ] **Step 1: Start the dev server and log in**

Use the project's preview tooling to start the `dev` server, then log in as
master via the test login ([[drw-test-credentials]]: `Claudetest` /
`thisisforCLAUDEtest`).

- [ ] **Step 2: Open the new page**

Click through to the FinTrack app, then click the nav item that shows the
company's real name + " Details" (e.g. "Test Company For Claude Details").
Confirm the page loads without a console error. If migration-022 hasn't been
run yet, confirm the friendly `CREDENTIALS_SETUP_ERROR` message shows instead
of a raw Supabase error.

- [ ] **Step 3: Create a test record with fabricated data only**

Click "Add record". Use obviously-fake values (e.g. name "Test VPN",
email "test@example.com", password "TestPass123", one custom field
"2FA code" / "000000" marked sensitive). Never use real credentials for this
check. Save, confirm the card appears with the right fields, click through to
the full panel, confirm the custom field shows under "Custom fields" with
mask/reveal/copy working.

- [ ] **Step 4: Edit, then delete**

Edit the test record (change one field), confirm it saves. Delete it via the
card's Del button, confirm the delete-confirmation dialog appears and the
record disappears after confirming. Confirm the page returns to its empty
state.

- [ ] **Step 5: Confirm RLS once migration-022 is run**

Once the user confirms they've run `migration-022.sql`, verify directly
against the database (same discipline as migration-021): query
`pg_policies` for `company_credentials` and confirm all 4 policies match
what's in the migration file, then run `get_advisors` (security) and confirm
no new findings tied to this table.

---

## Task 16: Version bump and ship

**Files:**
- Modify: `package.json` (version bump)
- Modify: `src/screens/Login.jsx` (footer version string)

- [ ] **Step 1: Bump the version**

Following this project's versioning convention (PATCH bump regardless of
feature size, MINOR/PATCH roll over at 9): read the current
`package.json` version first (do not assume it's still what it was when this
plan was written — other sessions may have shipped in between, per this
project's own established pattern of concurrent sessions in the same
folder), then bump the PATCH segment by 1. Update the `Login.jsx` footer
string (`Secure access · authorised accounts only · V…`) to match, keeping
the capital **V** prefix.

- [ ] **Step 2: No `whatsNew` entry**

Do not add a `package.json` `whatsNew` entry — Company Credentials is
master/manager-only, same reasoning as Bank Details
([[drw-whatsnew-role-visibility]]).

- [ ] **Step 3: Rebuild**

Run: `npm run build`
Expected: green, same as Task 13 but confirming the version-bump edit didn't
break anything.

- [ ] **Step 4: Commit — but do NOT push yet**

```bash
git add package.json src/screens/Login.jsx src/app/AppScreen.jsx src/app/FinTrack.jsx src/lib/auth.js supabase/migration-022.sql
git commit -m "Add Company Credentials page: master/manager login/credential vault (V<new-version>)"
```

No `Co-Authored-By` trailer, per this project's standing instruction. Do
**not** run `git push` — this project's established workflow is to wait for
an explicit "ship it" / "push it" instruction from the user before pushing,
even after a full build-and-commit cycle.

- [ ] **Step 5: Hand the migration SQL to the user**

Paste the full contents of `supabase/migration-022.sql` in chat, copy-paste
ready, for the user to run by hand in the Supabase SQL editor — per this
project's standing instruction, migration SQL is never auto-applied by the
assistant ([[show-migration-sql]]).

---

## Post-implementation: update memory

After Task 16, update `multi-company-portal.md` (topic file) and `MEMORY.md`
(index) the same way the Bank Details and redesign-premium sessions did:
a new reverse-chronological entry at the top of the narrative log covering
the architecture decision (dedicated table, same as Bank Details), the
brainstorming process (visual companion, 2 mockup rounds, field-structure and
access-level questions), the build-in-motion-and-polish-from-the-start
approach, and the verification method — plus a short `MEMORY.md` index-line
update pointing at the new version.
