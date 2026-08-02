# Releasing

The maintainer's runbook: version cut, npm publish, and (once) the flip to public. Contributors never need this file.

## Every release

1. **Ship gate, on the release tree.** `npm test`, `npm run check`, `npm run lint`, then `npm run perf:check` on the calibration machine (any other host reads red by design; CI's scaled perf job is the cross-check). Capture output to files, check exit codes, never pipe.
2. **Version + changelog.** Bump `package.json`. Move the `(unreleased)` changelog entry to its released heading. At a major close, roll the era's entries into `docs/changelog/<era>.md` per the changelog's own style rule, leaving one tight entry behind. Note: the demo's `/changelog` route renders `docs/changelog.md` verbatim and its pitch copy cites the document's size, so a collapse updates that copy in the same commit.
3. **dev → main.** PR from `dev`, wait for green CI (all eight checks), merge. `main` is the released history; nothing lands on it directly.
4. **Tag + GitHub release.** `git tag vX.Y.Z` on the merge commit, push the tag, write the release notes from the changelog entry.
5. **Publish.** `npm publish` (add `--access public` if the package is scoped). `prepack` builds and verifies the tarball (`verify-pack.mjs`); a red verify aborts the publish, which is the point. Sanity-check the npm page after: the README's footnotes, math, mermaid, and `<picture>` blocks do not render on npmjs.com, and its images resolve only if npm's relative-path rewrite cooperates, so eyeball the page once and decide whether a short npm-specific README should ride the next publish.

Publishing from CI with `--provenance` (an `id-token: write` job keyed to release tags) is the intended end state; set it up before habit makes the manual path permanent.

## The flip to public (once)

Pre-flip, in order:

1. **Name decision.** `aragonite` on npm is squatted by a dormant unrelated package. Either the dispute has resolved in our favor or the package publishes as `@voithos-labs/aragonite`; a scope rename touches the exports subpaths in every doc and example, and requires `"publishConfig": { "access": "public" }`, so it lands as its own reviewed commit before the release cut.
2. **History secrets scan.** The whole history goes public at once. Run a real scanner (e.g. `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --log-opts=--all`) and clear or triage every hit. The tracked tree was pattern-clean at the 2026-08 audit; the scanner is the belt.
3. **Freeze paperwork** (if the flip is the 1.0 freeze): pre-freeze labels resolved (`grep -c pre-freeze src/lib/plugin.ts` returns 0), the freeze litmuses in `docs/roadmap.md` checked off, the external-author gate run.

The flip itself:

4. Make the repository public (Settings → General → Danger Zone).
5. **Immediately** run `node scripts/apply-branch-protection.mjs` (protection is API-blocked on private free-plan repos, which is why this waits). Confirm the required contexts match ci.yml's job names.
6. Enable secret scanning + push protection (Settings → Code security). Free on public repos, off by default on the flip.
7. Enable GitHub Pages (the deploy workflow is in `.github/workflows/pages.yml`; first run via workflow_dispatch), then set the repo homepage URL to the Pages address. On that first deploy, spot-check three things: `_app/` assets load (the artifact-based Pages flow serves underscore directories as-is, but confirm), the `og:image` URL in `src/app.html` resolves, and a shared link's preview card looks acceptable (og.png is a 3.76:1 copy of the README header; most cards crop toward 1.91:1, so a purpose-cut 1200x630 derivative is the upgrade if the crop reads badly). Local base-path builds on Windows Git Bash need `MSYS_NO_PATHCONV=1` in front of `BASE_PATH=/aragonite npm run build`, or MSYS rewrites the path.
8. Verify the community-health page (repo → Insights → Community Standards) reads complete: license, CoC, contributing, security policy, templates.

Post-flip week: watch the first issues against the forms, confirm Discussions categories fit the question traffic, and treat any stranger's friction report as a defect in this runbook.
