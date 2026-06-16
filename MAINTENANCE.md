# Maintenance & how to change this site (rookie-friendly)

This is your "how do I safely change things" guide. Keep it next to the code.

## The everyday change loop

```bash
cd "C:\Users\BLUE I.T COMPUTER\multi-company-portal"
npm run dev        # opens http://localhost:5173 and live-reloads as you edit
# ...make edits, watch the browser update...
npm run build      # builds the dist/ folder you deploy
```

Edit a file → save → browser updates. When happy: `npm run build`, then upload `dist/`.

> ⚠️ If the live preview starts behaving oddly after a BIG change (new page/feature),
> stop the dev server (Ctrl+C in its terminal) and run `npm run dev` again. The
> production `npm run build` is never affected by this.

## Where to edit, by type of change

| You want to… | Edit |
|---|---|
| Login screen | `src/screens/Login.jsx` |
| Provider backend (companies, masters, search, delete) | `src/screens/Provider.jsx` |
| Master/manager console (team management) | `src/screens/Console.jsx` |
| Roles / permissions / who-can-do-what | `src/lib/auth.js` |
| The financial app itself | `src/app/FinTrack.jsx` |
| Colors / fonts / global look | `src/styles/global.css` |
| Who lands where after login | `src/Root.jsx` |
| Where/how data is stored | `src/lib/store.js`, `src/lib/storageBridge.js` |

## Safety nets ("insurance")

**Git is your undo button.** Before starting a change, you're at a known-good commit.
After a change that works, save a new snapshot:

```bash
git add .
git commit -m "describe what I changed"
```

If a change breaks things and you want to go back to the last good snapshot:

```bash
git restore .        # discards un-committed edits
# or, to see history:
git log --oneline
```

**Always test before deploying:** change → `npm run dev` → click through the affected
role(s) → then `npm run build` → deploy.

## Roles (current model)

- **provider** — you. Creates companies + master accounts; search; reset master
  passwords; delete a company (password-confirmed; cascades to its data).
- **master** — creates/manages manager + staff; uses the app.
- **manager** — creates/manages staff; uses the app.
- **staff** — uses the app only (no console).

## Before vs after go-live

- **Before launch:** change freely — it's all on your machine, no real users.
- **After launch (with a real backend):** never edit the live site directly. Make a
  copy/staging site, test there, then promote. Changing the *shape* of stored data
  needs a migration, not just a code edit.

## Current limitation (prototype)

Data is stored in the browser's `localStorage` — per-browser, single-machine, and
passwords use a non-secure hash. This is fine for testing, NOT for real multi-company
use. See README's "Before you go live" and the backend checklist your assistant
provided to move to a real backend (Supabase recommended).
