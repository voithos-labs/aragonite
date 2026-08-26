# Releasing

The maintainer's runbook: version cut, npm publish, and (once) the flip to public. Contributors never need this file, so if you landed here by accident you are free to go.

Everything below is written for the version of me who is running it at 2am with one shot at it. The steps stay flat and literal on purpose; a sentence you have to parse twice at that hour costs more than a sentence that reads like a manual.

## Every release

In this order, every time.

1. **Ship gate, on the release tree.** `npm test`, `npm run check`, `npm run lint`, then `npm run test:e2e:webkit` on its own (the second-engine lane sits outside `npm test` and fails rather than reports; `docs/contributing/testing.md` § The WebKit lane), then `npm run perf:check` on the calibration machine (any other host reads red by design; CI's scaled perf job is the cross-check). Capture output to files, check exit codes, never pipe.
2. **Version + changelog.** Run `npm version <x.y.z>` rather than hand-editing `package.json`: the version lives in `package.json` **and** `package-lock.json`, and only the command writes both. In the same commit, add the version's entry under its own released heading in the family file (`docs/changelog/<minor>.md`) and its line to the index in `docs/changelog.md`; there is no `(unreleased)` staging heading. A new family means a new file and a new index section, and nothing else: the demo route globs `docs/changelog/*.md` and orders the picker numerically, so it picks the file up on its own.
3. **dev → main.** PR from `dev`, wait for green CI (all eight checks), merge. `main` is the released history; nothing lands on it directly.
4. **Tag + GitHub release.** `git tag vX.Y.Z` on the merge commit, push the tag, write the release notes from the changelog entry.
5. **Publish.** `npm publish` (add `--access public` if the package is scoped). `prepack` builds and verifies the tarball (`verify-pack.mjs`); a red verify aborts the publish, which is the point. Sanity-check the npm page after: the README's footnotes, math, mermaid, and `<picture>` blocks do not render on npmjs.com, and its images resolve only if npm's relative-path rewrite cooperates, so eyeball the page once and decide whether a short npm-specific README should ride the next publish.

Publishing from CI with `--provenance` (an `id-token: write` job keyed to release tags) is the intended end state. Set it up before habit makes the manual path permanent, because habit is undefeated.

## Deploying the site

Not flip-gated: Cloudflare deploys from the private repo, so the site can be live and spot-checked long before anyone can see the source. Do it early. It also keeps the flip's own sequence short, and the flip is the part you want short.

The build is `adapter-static`, and `wrangler.toml` binds `./build` as an assets-only Worker with no script, so Cloudflare serves it from the edge and bills no invocation. `.github/workflows/deploy.yml` runs it; it needs `CLOUDFLARE_API_TOKEN` (scoped to Workers-edit on that account alone) and `CLOUDFLARE_ACCOUNT_ID` as repo secrets. It is `workflow_dispatch`-only until the first deploy is verified; add a `push` trigger on `main` after.

On the first deploy, spot-check four things: `_app/` assets load, a deep link into an unprerendered route (`/test/editor`) boots through the 404.html fallback rather than dead-ending, the `og:image` URL in `src/app.html` resolves, and a shared link's preview card looks acceptable (og.jpg is a purpose-cut 1200x630 derivative of the README header). Confirm `www` redirects to the apex, since the README links the apex and the domain answers both.

## The flip to public (once)

You get one of these. No dry run, no undo worth having, and whatever this leaves behind is the internet's first look at the project. Read the whole section before starting any of it.

Pre-flip, in order:

1. **Name (decided).** The bare `aragonite` on npm is a dormant unrelated package, so we publish as `@voithos-labs/aragonite`. The rename has landed across the barrel, every doc, and the example consumer, and `publishConfig.access` is `public` because a scoped package is private by default. Nothing here blocks; the first publish is the owner's to run.
2. **History secrets scan.** The whole history goes public at once, and that includes more than the branches. Run a real scanner (e.g. `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --log-opts=--all`) and clear or triage every hit. Fetch `refs/pull/*/head` into the clone first: those refs survive a history rewrite and stay fetchable by SHA once public, so a scan of branches alone misses them. If a pre-rewrite object is genuinely sensitive, a GitHub-support GC request takes time you want to spend while still private.
3. **Prune the remote.** Delete stale branches (the integration branch and any dependabot leftovers) before the flip. After it, assume anyone may have fetched them.
4. **Freeze paperwork** (if the flip is the 1.0 freeze): pre-freeze labels resolved in **both** published barrels (`grep -rc pre-freeze src/lib/plugin.ts src/lib/index.ts` returns 0 for each; the consumer barrel carries the markers too, so clearing only the plugin one reads green while the API still says unstable), the freeze litmuses in `docs/roadmap.md` checked off, the external-author gate run.

The flip itself:

5. Make the repository public (Settings → General → Danger Zone).
6. **Immediately** run `node scripts/apply-branch-protection.mjs` (protection is API-blocked on private free-plan repos, which is why this waits). Confirm the required contexts match ci.yml's job names.
7. Enable secret scanning + push protection, and private vulnerability reporting (Settings → Code security). All three are free on public repos and off by default; private reporting cannot be enabled while the repo is private, which is why it waits until here rather than shipping as a file.
8. Confirm Actions' fork policy requires approval for first-time contributors. Note the inversion the flip brings: public repos get unlimited Actions minutes, so CI stops being a budget concern the moment this lands.
9. Set the repo homepage URL to the site, and verify the community-health page (repo → Insights → Community Standards) reads complete: license, CoC, contributing, templates. It only tests that files exist, so it will read green on a CoC with no reporting contact. Check the contents, not the checkmarks.

Post-flip week: watch the first issues against the forms, confirm Discussions categories fit the question traffic, and treat any stranger's friction report as a defect in this runbook rather than as a misunderstanding on their end. Nothing else belongs in that week. Not a scope rename, not taxonomy changes, not a host change. The urge to fix one more thing while people are finally looking is the exact urge that breaks the thing people are finally looking at.
