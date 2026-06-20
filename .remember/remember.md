# Handoff

## State
Multi-company-portal (Vite/React, repo RitzEve/Dreportwin99, branch master) is LIVE at https://dreportwin99.netlify.app. Shipped through **v1.3.1** this session: theme-aware collapsible sidebar w/ Sidebar-control menu (Expanded/Collapsed/Expand-on-hover, default hover), whole-app gray/white/blue theme, animated login, Flux loader, sun/moon ThemeToggle in FinTrack + Console + Provider headers, widened tx-history DetailModal. All built green + pushed + deployed.

## Next
No active work — awaiting next user request.

## Context
- Workflow: edit `src/app/FinTrack.jsx` (or screens) → `npm run build` (gate) → bump version in package.json + Login.jsx footer → `git commit` (NO Co-Authored-By trailer) → `git push origin master` (auto-deploys ~1min). git push occasionally fails once with auth error — just retry.
- PowerShell: never put double-quotes inside `git commit -m '...'`.
- User is a coding rookie — explain plainly, do the work for them, give Ctrl+Shift+R verify steps.
- App is plain JS + inline styles + Tabler `ti-*` icons — NOT Tailwind/shadcn/TS. User keeps pasting shadcn components; recreate the LOOK in this stack, never add Tailwind/framer-motion. VERIFY Tabler icon names exist (ti-layout-sidebar-left was fake → invisible; cost a fix).
- Pending USER-run SQL (features degrade gracefully until then): migration-003 (email edit), 004 (timezone col), 005 (master tz), 006 (company logo). 
- Full detailed log: memory file multi-company-portal.md.
