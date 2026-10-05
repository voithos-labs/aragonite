## What changed, and why

<!-- A line or two is plenty. Link the issue if there's one, and say what a user would notice. -->

## Gates

- [ ] `npm test` (the unit suite, then every e2e project)
- [ ] `npm run check` (svelte-check, 0 errors)
- [ ] `npm run lint`
- [ ] fixing a bug? a test that went red before the fix, plus a one-line miss-analysis (what should have caught this, and why nothing did), in the test's requirement file for an e2e test or as its header line for a unit test
- [ ] changed how something behaves? the docs that describe it say the new thing

Skip `npm run perf:check`. Its baselines come from one desktop, so anywhere else it reads red and the red means nothing. CI runs it scaled for its slower machines, and that's the run that has to be green.

## Before you hit submit

- Target `dev`. `main` only takes release merges.
- Commit messages follow [the commit conventions](https://github.com/voithos-labs/aragonite/blob/main/docs/contributing/commit-conventions.md): a symbol prefix, lowercase, 72 characters at most. CI reads every commit in the pull request, and the hook `npm install` sets up catches a bad one before it exists.
- Leave `docs/changelog/` alone. We write the entry when it merges, from what you said up top.
- First pull request? The CLA check asks you to sign [`CLA.md`](https://github.com/voithos-labs/aragonite/blob/main/CLA.md) with one comment, and it covers every pull request after.
