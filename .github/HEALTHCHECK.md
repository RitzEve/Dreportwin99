# Cloud health-check & auto-fix routine

This runs in **GitHub's cloud**, so it works even when your PC is off.
Workflow file: `.github/workflows/health-check.yml`

## What it does each run
1. Builds the app (`npm run build`) — the compile gate.
2. Checks the live site `https://dreportwin99.netlify.app` (HTTP 200), its `/version.json`, and that Supabase responds (read-only probe).
3. Writes a report to the **run summary** (Actions tab → click the run → Summary).
4. If anything failed, opens a **GitHub issue** labelled `health-check` (deduped — no spam).
5. **If the build is broken AND an `ANTHROPIC_API_KEY` secret is set:** Claude diagnoses it, makes the smallest safe fix, re-builds (must be green), bumps the patch version, then commits and pushes to `master` → Netlify auto-deploys.

Safety: it only ships when the build is green; it never force-pushes, never touches the Supabase database/secrets, and keeps fixes minimal. If it can't fix safely, it ships nothing and leaves the alert issue for a human.

## The three ways to trigger it

### 1. On schedule (automatic)
Runs daily at the time in the `cron:` line of the workflow (currently `7 1 * * *` = **01:07 UTC**, which is 09:07 in UTC+8). GitHub cron is always UTC — edit that line to change the time.

### 2. Manually / by API (`workflow_dispatch`)
- In the browser: **Actions** tab → **Daily health check & auto-fix** → **Run workflow**.
- From a terminal: `gh workflow run health-check.yml -R RitzEve/Dreportwin99`
- Raw REST API:
  ```
  curl -X POST \
    -H "Authorization: Bearer <YOUR_GITHUB_TOKEN>" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/RitzEve/Dreportwin99/actions/workflows/health-check.yml/dispatches \
    -d '{"ref":"master"}'
  ```

### 3. By webhook (`repository_dispatch`)
Have any external service POST this to GitHub to kick off a run on demand:
```
curl -X POST \
  -H "Authorization: Bearer <YOUR_GITHUB_TOKEN>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/RitzEve/Dreportwin99/dispatches \
  -d '{"event_type":"health-check"}'
```
The `<YOUR_GITHUB_TOKEN>` is a GitHub Personal Access Token with the `repo`/`workflow` scope (create one at GitHub → Settings → Developer settings → Personal access tokens). Keep it secret.

## Turning on the auto-FIX-and-ship part
The health check + report + alert issue work immediately with no setup. To let it also **fix and ship automatically**, add your Anthropic API key as a secret:

1. Get a key at the Anthropic Console (this uses pay-as-you-go API credit).
2. In GitHub: repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. Name: `ANTHROPIC_API_KEY` — Value: your key. Save.

Until that secret exists, the auto-fix job cleanly skips and just leaves the alert issue.

## Notes
- The fix is pushed by the `github-actions[bot]`. If you ever add branch protection on `master`, allow that bot (or the action) to push, or the auto-ship step will be blocked.
- Pushes made by Actions do not re-trigger this workflow (no loops); Netlify still deploys on the push.
