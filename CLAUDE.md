# Project context for Claude Code

This file is auto-loaded when working inside this project. It tells future-you what
this is and how the owner wants to work.

## What this is

A multi-tenant portal (Vite + React) that the **owner distributes as the provider**.
It wraps the owner's **FinTrack** financial app (in `src/app/FinTrack.jsx`) in a
login + role system. Built and verified end-to-end (Playwright) in earlier sessions.

## The owner

- **A coding rookie / non-developer.** Explain in plain language. Prefer doing setup
  FOR them over telling them to do it. Avoid unexplained jargon.
- Will keep asking to **maintain / upgrade / extend** this site over time.

## Roles (final model)

- **provider** — super-admin backend (`src/screens/Provider.jsx`): create companies +
  master accounts, search companies, reset master passwords, add masters, delete a
  company (two-step + provider-password confirm; cascades accounts + app data).
- **master** — console: create/manage manager + staff; change roles; use the app.
- **manager** — console: create/manage staff; use the app.
- **staff** — straight into the app, no console.

Login is **email + password only** (no company picker, no self-registration); emails
are globally unique. Routing by role in `src/Root.jsx`.

## Architecture map

- `src/screens/Login.jsx` — sign in (+ removable "Test logins" helper).
- `src/screens/Provider.jsx` — provider backend.
- `src/screens/Console.jsx` — master/manager team management + app launcher.
- `src/app/AppScreen.jsx` — hosts FinTrack; injects `window.FINTRACK_SESSION`,
  `window.storage`, `window.FINTRACK_LOGOUT`, `window.FINTRACK_CHANGE_PASSWORD`;
  lazy-loads the artifact so the session is set before it evaluates.
- `src/app/FinTrack.jsx` — the owner's artifact, kept ~verbatim.
- `src/lib/store.js` — data layer over localStorage (DB key `mcp_db_v2`).
- `src/lib/auth.js` — roles, sessions, permissions, password hashing.
- `src/lib/storageBridge.js` — `window.storage` shim + `removeCompanyAppData`.

## Conventions / gotchas

- Keep all auth/data access behind `src/lib/*` so a real backend swap touches only
  those 3 files.
- After BIG structural edits, the Vite dev server's HMR can go stale → restart
  `npm run dev` (happened twice; a blank screen or old behavior is the tell).
- Verify changes in the browser (Playwright) before declaring done.
- `npm run build` must stay green; it's the completion gate.
- **No React error boundary anywhere.** An uncaught render error unmounts the ENTIRE
  app to a blank screen, not just the page that threw — happened in V2.0.5 (a `.sort()`
  over Supabase-sourced team data crashed on a null `name`, killing every page, not
  just the Off Days page it lived on). Any new code that reads external/DB data (not
  data your own validated forms produced) must be normalised at the point it enters
  FinTrack.jsx — don't assume it's shaped like internally-created data.

## Status / next step

Prototype is feature-complete on localStorage. The agreed next milestone is wiring a
**real backend (Supabase recommended)** so data is shared across devices and
passwords are server-verified. A readiness checklist was given to the owner.
