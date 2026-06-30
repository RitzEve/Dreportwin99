# Handoff

## State
Shipped **v1.6.40** (live). v1.6.39 added a credit/debit + balance summary strip (`SumTile`) to stat-card popups (`DetailModal`) and the Search page; v1.6.40 fixed the popup not showing it (the `<DetailModal/>` render site ~FinTrack.jsx:1757 wasn't forwarding the `summary` prop). Build green, pushed `05e2122`, Netlify auto-deploys. Memory + MEMORY.md updated to v1.6.40.

## Next
1. No active work — await next user request.
2. Standing: **supabase-health-recheck** scheduled ~1 Jul (egress already confirmed dropped to ~0.5–1 GB/day on 29–30 Jun, fix held); **weekly-drw-backup-email** Mondays.

## Context
- Workflow: edit → `npm run build` (gate) → commit (**NO Co-Authored-By trailer**) → push → Netlify. Use `git -C "<path>"` (repo is the subdir; cwd is its parent). NO double-quotes inside PowerShell `git commit -m '...'`.
- Lesson from v1.6.40: when adding a prop to a component, add it at EVERY render site.
- User is a coding rookie — explain plainly, do setup for them. service_role key never in frontend; user runs Supabase migrations themselves in the SQL editor.
- Feature design (approved): credit=money-in / debit=money-out by `ftTxDelta` sign, skip deleted+fundLeg; balance lines on Store card only; period = selected scope (not cumulative).
