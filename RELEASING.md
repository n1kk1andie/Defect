# Releasing

GitHub Actions is manual-only to keep costs near zero. The checks that used
to run on every push and pull request now run on your machine, before
every merge to `claude/build-tracker-xq65z0`:

```sh
npm ci
npm run typecheck
npm test
DEMO_MODE=1 npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Accessibility check (axe, WCAG 2.2 AA) against a local demo build:

```sh
npm install --no-save playwright@1.63.0 && npx playwright install chromium   # once
DEMO_MODE=1 npm run build
DEMO_MODE=1 npx next start -p 3652 &
A11Y_BASE=http://localhost:3652 npm run test:a11y
kill %1
```

## On GitHub

- **CI** (`.github/workflows/ci.yml`) runs only when started by hand:
  Actions → the CI workflow → Run workflow. Run it for big releases.
- **Keep the demo in step** (`.github/workflows/sync-demo.yml`) still runs on
  every push to `claude/build-tracker-xq65z0`. It only merges live into `claude/demo-environment`
  and pushes: no install, build or tests. Vercel builds the demo and keeps
  the previous deployment if that build fails. A conflict opens the issue
  "Demo is behind live — needs a hand merge".
- Nothing runs on a schedule. The app's scheduled jobs run from Vercel cron
  (`vercel.json`).
- If branch protection requires CI status checks, remove them as required
  checks (Settings → Branches): they no longer run on their own, so a pull
  request would wait for them forever.
