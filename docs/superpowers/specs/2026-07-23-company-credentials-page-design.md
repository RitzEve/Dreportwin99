# Company Credentials page — design

**Date:** 2026-07-23
**Status:** approved by user, ready for implementation plan

## Motivation

The owner runs infrastructure credentials for each tenant (Google account, VPNs,
admin consoles, Telegram, cloudflare, etc.) in an external spreadsheet today —
shown as a reference screenshot with real values, which this doc does not
reproduce. They want a page inside the portal, per company, where master/manager
can record and retrieve this themselves, styled and animated to match the rest
of the app (following the same pattern as the just-shipped Bank Details page).

Unlike Bank Details, records here have no fixed schema — the screenshot shows
wildly different field sets per entry (a Google account needs Email/Password/
Phone/2FA; a VPN just needs Email/Password; "Teams Live" is a single passkey;
H5 Console needs a Link/Download/Guide/Username/Password). The design has to
support that variability directly, not force everything into one rigid template.

## Data model

New table `company_credentials` (own migration, `supabase/migration-022.sql`):

```
id            uuid primary key default gen_random_uuid()
company_id    uuid not null references public.companies(id) on delete cascade
name          text not null           -- record name, user-typed (e.g. "Nord VPN")
category      text                     -- optional freeform tag (e.g. "VPN", "Console")
username      text                     -- optional
email         text                     -- optional
password      text                     -- optional, masked in the UI
link          text                     -- optional, rendered as a clickable chip
custom_fields jsonb not null default '[]'::jsonb
created_at    timestamptz not null default now()
updated_at    timestamptz not null default now()
```

`name` is **not** unique — the reference screenshot has two separate "cloudflare"
entries with different emails, so duplicate record names must be allowed; no
uniqueness constraint on `name`.

`custom_fields` shape: `[{"label": "2FA backup code", "value": "…", "sensitive": true}, …]`
— an ordered array of user-defined label/value pairs, each independently flagged
as sensitive (masked with show/reveal + copy) or plain (shown outright). This is
what makes the "different fields per record" requirement work without a rigid
schema: `name`/`category`/`username`/`email`/`password`/`link` cover the common
case with ready-made boxes, and anything else — 2FA codes, passkeys, admin tool
passwords, download/guide links — goes in `custom_fields`.

## Security

Same architecture as `bank_details`/`company_billing`: a dedicated table with its
own RLS, **not** the shared `app_data` blob. If this data rode in that blob, a
staff session's browser would receive the whole thing over the network even with
the page hidden from nav — hiding a menu item is not a security boundary. All 4
policies (select/insert/update/delete) gate on
`company_id = public.my_company() and public.my_role() in ('master','manager')`,
identical shape to `bank_details`'s policies. This is arguably *more* sensitive
data than Bank Details (root Google account, admin tool passwords, console
logins), so the same table-level isolation matters even more here.

Access is master + manager (confirmed with the user — same tier as Bank Details,
not narrowed to master-only).

## UI

**Nav**: id `companycredentials`, icon `ti-key`, label renders as
`{SESSION.companyName} Details` (company name is already available via
`window.FINTRACK_SESSION.companyName`, no new plumbing needed). Slots into the
sidebar between Bank Details and Members, and into the mobile "More" overflow
sheet automatically — `MOBILE_PRIMARY_IDS` already treats anything outside its
fixed 5-item list as overflow, so no mobile-nav code changes are needed for a
new page.

**Compact card** (grid view): category tag (if set) + record name, then a small
panel showing Username/Email if set and Password as a masked chip with a COPY
button, then a "+N more fields" indicator if `custom_fields` is non-empty.
Actions: Edit / Delete only — no freeze, no cross-page "add to X" action (those
were specific to Bank Details' drop-account lifecycle and Bank Accounts linkage;
this is a general vault with no equivalent target page).

**Full record panel** (click-through): name + category badge, then all of
Username/Email/Password (masked+reveal+copy)/Link (clickable), then a "Custom
fields" section listing every `custom_fields` entry the same way — masked with
reveal+copy if `sensitive`, plain text otherwise.

**Add/Edit form**: Name (required) + Category/Username/Email/Password/Link
(optional, always present) + a repeatable custom-field row (field name + value
+ a "🔒 sensitive" checkbox, checked by default) with an "+ Add custom field"
button. Design approved live via the brainstorming visual companion (2 mockup
rounds — field-structure options, then final card/panel/form layout) using
fabricated example data, not the user's real credentials.

**Masking**: a new `CopyableValue` component (show/hide + copy button), kept
separate from Bank Details' `Masked` component rather than extending it —
editing an already-shipped, already-verified component in a codebase with no
test suite carries real regression risk (see: the global.css `input, select`
rule that silently missed `<textarea>` and broke Bank Details' Remarks field).
Reused for Password and for any `custom_fields` entry flagged `sensitive`.

## Motion (GSAP)

Same `useGSAP` + `gsap.matchMedia` reduced-motion-gated pattern already
established on Bank Details: staggered card-grid entrance, panel scale-in on
open, and — applying the lesson from this session's Bank Details redesign pass
up front instead of bolting it on later — a staggered field-group entrance on
the Add/Edit form when it opens.

## Explicitly out of scope

- No freeze/archive/status lifecycle (not requested; no clean analogue here).
- No cross-page "copy into X" action (no equivalent target page exists).
- No per-field icon set like Bank Details — fields here are partly user-named,
  so a fixed icon map doesn't apply; common fields (Username/Email/Password/
  Link) get sensible fixed icons, custom rows don't get icons.

## Build approach

Given the user chained karpathy-guidelines → brandkit-level design →
redesign-premium → gsap-core into one request rather than separate turns, build
this with the visual polish and motion above from the start, then run a
self-directed redesign-premium-style check before calling it done (themed
inputs, focus states, spacing, consistent icon usage) — rather than shipping
first and waiting for a follow-up bug report, which is what happened last time
with Bank Details' unthemed textarea.

## Verification plan

1. `npm run build` stays green (completion gate).
2. Live check as `Claudetest` (master, [[drw-test-credentials]]): create a
   record with a couple of custom fields (one sensitive, one not), confirm
   card/panel rendering, edit, delete. Use only fabricated test data.
3. Confirm RLS directly (`pg_policies` + `get_advisors`) once migration-022 is
   confirmed run, same discipline as migration-021's verification.
4. No `whatsNew` entry — master/manager-only, per
   [[drw-whatsnew-role-visibility]].
