## What changed, and why

<!-- A line is plenty. Link the issue if there's one. -->

## Gates

- [ ] `npm test` (the unit suite, then every e2e project)
- [ ] `npm run check` (svelte-check, 0 errors)
- [ ] `npm run lint`
- [ ] fixing a bug? a test that went red before the fix, plus a miss-analysis: one line saying what should have caught this and why nothing did

Skip `npm run perf:check` unless you happen to be on the desktop the baselines were measured on. It builds the app, previews it, and times keystrokes against numbers from that one machine, so anywhere else it reads red and the red means nothing. CI runs it with a scale factor for its slower boxes, and that's the run that has to be green.

## Before you hit submit

- Target `dev`. `main` only takes release merges.
- First pull request? The CLA check asks you to sign [`CLA.md`](https://github.com/voithos-labs/aragonite/blob/main/CLA.md) with one comment, and it covers every pull request after.
