# Company Portal — multi-tenant login + FinTrack app

A portal you (the **provider**) distribute to multiple companies. You create each
company and its master account from a provider backend. Each company then manages
its own staff and runs the **FinTrack** financial app on its own isolated data.

## Roles

| Role         | Where they land after login | Can do                                                            |
| ------------ | --------------------------- | ----------------------------------------------------------------- |
| **provider** | Provider Admin backend      | Create companies + their master account; reset any master's password |
| **master**   | Company Console             | Create/manage **manager + staff**; change roles; use the app       |
| **manager**  | Company Console             | Create/manage **staff** only; use the app                          |
| **staff**    | Straight into the app       | Use the FinTrack app only (no console)                             |

Login is **email + password only** — no company picker and no self-registration, so
tenants never see other companies. Emails are globally unique; the account (and its
company) is resolved from the email.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/ for hosting
npm run preview  # preview the production build
```

## Demo logins (seeded on first run)

| Role     | Email                 | Password     |
| -------- | --------------------- | ------------ |
| Provider | `provider@portal.com` | `provider123`|
| Master   | `demo@demo.com`       | `demo1234`   |
| Manager  | `manager@demo.com`    | `manager123` |
| Staff    | `staff@demo.com`      | `staff123`   |

There's a **Test logins** disclosure on the sign-in screen that fills these for you.
**Remove that block from `src/screens/Login.jsx` before distributing.**

## How it works

- **`src/screens/Login.jsx`** — email + password sign-in.
- **`src/screens/Provider.jsx`** — provider backend: create companies + master
  accounts, **search companies**, reset master passwords, add extra masters,
  **delete a company** (two-step confirm that requires re-entering your provider
  password — cascades to all its accounts and app data), change own password.
- **`src/screens/Console.jsx`** — master/manager hub: launch the app, change own
  password, and the Team panel (create/manage accounts, scoped by role).
- **`src/app/AppScreen.jsx`** — hosts the FinTrack artifact; injects the session and
  the hooks it expects, then lazy-loads it. Staff get a "Log out" button here
  instead of a "Console" button.
- **`src/app/FinTrack.jsx`** — your artifact, essentially unchanged (see
  [REVIEW.md](REVIEW.md)).
- **`src/lib/store.js`** — data layer (companies + accounts) over `localStorage`.
- **`src/lib/auth.js`** — roles, sessions, permissions, password handling.
- **`src/Root.jsx`** — routes by role (provider / master+manager / staff).

### Multi-tenant data isolation

- **Accounts** live in one `localStorage` record (`mcp_db_v2`); every query is
  scoped by `companyId`. Login is global-by-email but each account carries its
  company.
- **App data** (banks / members / transactions) is saved by the artifact under
  `fintrack-<companyId>-v2`, so each company's books are completely separate.

## ⚠️ Before you go live (important)

This is a **frontend prototype**. It works fully on a single machine, but:

- **`localStorage` is per-browser.** A company created in one browser does **not**
  exist in another, and users on different computers do **not** share data yet.
- **Passwords use a fast, non-cryptographic hash in the browser** — not secure.

For a real multi-tenant, multi-device product, replace the three files below with a
backend (e.g. **Supabase**: Postgres + Auth + Row-Level Security, which maps cleanly
onto the company/role model). Nothing else changes:

| File                        | Replace with                                   |
| --------------------------- | ---------------------------------------------- |
| `src/lib/store.js`          | API/DB queries for companies + users           |
| `src/lib/auth.js`           | Server-verified login + role checks (JWT/session) |
| `src/lib/storageBridge.js`  | API calls for each company's app data          |

The **provider** role then becomes your super-admin (a row that owns no company);
keep it out of the public sign-up path. See [REVIEW.md](REVIEW.md) for the artifact
review and the config/embed-code changes.
