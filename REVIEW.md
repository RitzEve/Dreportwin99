# Artifact review — style & config/embed code

This covers what was reviewed, what was changed, and what's recommended but **not**
changed (to avoid regressions in your working app). Your FinTrack logic was kept
intact — see `src/app/FinTrack.jsx`.

## 1. Config / embed code — fixes applied ✅

The artifact was written to be embedded: it reads a session from
`window.FINTRACK_SESSION`, persists through `window.storage`, and logs out via
`window.FINTRACK_LOGOUT`. None of those existed on their own, so the app couldn't
actually run or save anything. The host now provides all of them:

| Dependency the artifact expects        | Now provided by                          |
| -------------------------------------- | ---------------------------------------- |
| `window.FINTRACK_SESSION` (which company + operator) | `src/app/AppScreen.jsx` — injected from the logged-in account **before** the artifact loads |
| `window.storage.get/set/delete`        | `src/lib/storageBridge.js` — localStorage-backed async store |
| `window.FINTRACK_LOGOUT`               | `src/app/AppScreen.jsx` — clears the session, returns to login |
| `var(--font-sans)`, Tabler `ti` icons  | `index.html` + `src/styles/global.css`   |

**Timing fix that matters:** the artifact captures `SESSION` once at module load
(`const SESSION = window.FINTRACK_SESSION || {…}`). If it were imported statically
it would capture the *default* demo session. So `AppScreen` sets the session first,
then **dynamically imports** FinTrack — guaranteeing the real company/operator is
read. (You can see this worked: FinTrack builds as its own `FinTrack-*.js` chunk.)

**Embed upgrade:** the in-app *Change password* was a stub that only showed a
success message. It's now wired to the real account system through a new
`window.FINTRACK_CHANGE_PASSWORD` hook (it still falls back to the stub if the
artifact is ever run standalone). Two lines in the artifact, the rest in the host.

### Edits made inside `FinTrack.jsx` (minimal, on purpose)

1. `handleChangePassword` now calls `window.FINTRACK_CHANGE_PASSWORD` when present.

That's the **only** change to your code. Everything else is the artifact verbatim.

## 2. Style — review & upgrades

**What's already strong in the artifact:** consistent blue-on-warm-neutral palette,
automatic dark mode, good use of color-coded transaction types, accessible icon
labelling (`aria-hidden`, `role="img"` on the chart), responsive grids.

**Upgraded at the shell level** (so the login/console match the app and it feels
like one product):

- Shared design tokens in `src/styles/global.css` mirror the artifact's exact
  colors (`--accent: #2563eb`, warm neutrals) and respect OS dark mode.
- **Inter** font loaded for the whole portal; `--font-sans` (which the artifact
  already references) now resolves to it.
- Login, console, and the app-host bar use the same buttons, badges, and surfaces.
- Added an SVG favicon (also removes a console 404).

**Optional in-artifact polish (not applied — your call):**

- The artifact uses inline styles throughout. That's fine and works, but extracting
  the repeated button styles into the shared CSS classes would cut ~30% of the file.
- A few dead bits can be removed safely: `ComparisonChart` + `monthlyComparison`
  (computed but never rendered), `INIT_BANKS`, `ftHelpersDefined`, `_removedDupA`,
  and the unused `isCredit`/`bankCell` locals in `TxTable`/`DetailModal`.
- Role-aware UI: `SESSION.role` is now injected, so you could hide destructive
  actions (delete bank/member) from **staff** if you want. Say the word and I'll add it.

## 3. Notes

- `npm audit` reports 2 "high" issues — these come from Vite's dev-only toolchain
  (esbuild), not your shipped code. They don't affect the built site. Leave them, or
  run `npm audit fix` later; avoid `--force` (it pulls a breaking Vite major).
- The artifact's older-data migration branch (the `t.type === "Transfer"` path in
  the load effect) is legacy — new transfers are stored as `Transfer In/Out`. It's
  harmless and only runs on pre-existing records, so it was left as-is.
