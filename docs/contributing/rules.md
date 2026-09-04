# The rules

The rules you can't get from reading the code. Things happened which shaped this doc; go read [`casebook.md`](casebook.md).

Here's the shape of the problem. aragonite keeps one mutable tree, the CST (the parsed form of the Markdown, markers and all). The undo history points into that same tree, and the DOM renders from it. It's decent design, and it goes wrong in a small number of very specific ways, which are partly listed below.

You prob want to read this page before your first edit, and the casebook before your first structural change. The five rules are five because of [this](https://pmc.ncbi.nlm.nih.gov/articles/PMC2864034/), which means that on average you will forget one of these rules when you make your way to touching the code. You are welcome.

- [The five rules](#the-five-rules): the list, each rule linking to the incident that bought it.
- [The enforcement ladder](#the-enforcement-ladder): where a rule should live, so nobody has to remember it.
- [The bug shape to fear: sibling-path parity](#the-bug-shape-to-fear-sibling-path-parity): the pattern behind most of the audit's findings, and the habits that kill it.
- [Fixing bugs](#fixing-bugs): how a fix lands here, test first.
- [Testing shape](#testing-shape): where tests have to sit to catch anything.
- [Working the gates](#working-the-gates): the check commands, what green looks like, and the one way to fool yourself.
- [Records](#records): where defects, decisions, and stale prose go.

## The five rules

1. **The CST is the single source of truth.** Where the tree and the DOM disagree, the tree
   wins. ([node copies](casebook.md#node-copies-are-re-read-through-the-state-tree),
   [shared bytes](casebook.md#snapshot-shared-nodes-are-read-only-on-their-bytes),
   [the render path](casebook.md#the-render-path-computes-inline-content-locally-and-reads-no-cache))
2. **Reactive state crosses module boundaries as getters, never values.** A value read is a
   snapshot, plus a dependency you didn't ask for.
   ([the re-init incident](casebook.md#reactive-state-crosses-module-boundaries-as-getters-never-values))
3. **`await tick()` is the only sequencing primitive.** No `setTimeout`, no `rAF`, no microtask
   tricks. ([the predecessor editor](casebook.md#only-await-tick-for-sequencing))
4. **Rules live at choke points, not call sites.** A choke point is the one place every path
   already crosses, a seam (a boundary where responsibility changes hands from one piece of code
   to another). If a rule can move into the seam, it moves into the seam.
   ([endpoints and paths](casebook.md#rules-live-at-choke-points-not-call-sites),
   [one offset home](casebook.md#dom-to-raw-offset-translation-has-one-home),
   [registries](casebook.md#registries-are-code-not-state))
5. **A bug fix closes the class and adds the guard.** Fixing only the instance you found is half a
   fix. (the ladder below, and [§ Fixing bugs](#fixing-bugs))

## The enforcement ladder

**Unrepresentable > guarded > documented.** A contract climbs as high up that ladder as it can.
First choice is types and seams that make the violation impossible to write down. Where types
can't reach, a dev-mode guard that fails a test gate. Prose only for what neither can hold. When
you touch a convention, ask whether it can climb a rung (one level up the ladder). The audit's
most durable fixes were exactly such promotions: a tree operation that threw became a nullable
return, and a path convention that lived in a comment became factory-built arguments plus a guard.

A guard, concretely, is one call at the seam the contract belongs to: a tag and a predicate. The
predicates live in `src/lib/invariants/`, and `docs/design/invariants.md` catalogs every guard by
its G-number.

```ts
// src/lib/invariants/install.ts, run before every commit's mutation
assertInvariant('commit-path-dialect', () =>
	checkCommitPathAddressable(doc, eventPath, 'eventPath')
);
```

In a dev build a violation prints `[aragonite:invariant:commit-path-dialect] ...` and reds the
test that provoked it ([`warnings.md`](warnings.md) has the channels). In production the predicate
isn't even called. Rule 5 is this ladder read from the far end: when you fix a bug, close the
class rather than the instance, and add the guard that would've caught it.

## The bug shape to fear: sibling-path parity

The audit's dominant class: one rule enforced at N−1 of N sibling entry paths. An operation grows
several routes in over time (a keyboard gesture, a paste, an undo fallback), each supposed to
apply the same rule, and the copy of the rule is missing from exactly one of them. That's where
the audit found its corruption: endpoint normalization, undo fallback paths, merge fallbacks,
keymap dispatch. Habits that kill it:

- When you add entry path N+1 to anything (a new gesture, a new commit caller, a new paste route),
  grep for the rules its siblings carry.
- When you find one violation, **enumerate all siblings before fixing any**. The instance you
  found is rarely alone.
- Prefer moving the rule into the seam and deleting the call-site copies over adding copy N+1.
- A diff that adds an entry path gets one standing review question: **can the rule move into the
  seam instead of being carried?** Carrying is the exception, and the diff says why.
- Where the one shared route can't be built yet, write the parity rule as a source-scan guard
  (`src/lib/test/invariants/lint/`): "every entry path matching X routes through Y", which fails
  the day path N+1 is born instead of at the next audit.

A source-scan guard is a unit test that reads the source tree instead of running it. Every scan
in that folder has the same last line, and its red names the offending file and token:

```ts
// src/lib/test/invariants/lint/timing-hacks.test.ts
it('every timing primitive lives in an allowlisted file', () => {
	const violations = sources
		.flatMap((f) => findTimingHits(f.relPath, f.code))
		.filter((hit) => !(hit.relPath in ALLOWLIST));
	expect(violations).toEqual([]);
});
```

## Fixing bugs

- **Root-cause first, then fix the class.** Never patch around an edge case.
- **Test-first, red quoted.** The regression test fails on the pre-fix code, for the right reason,
  before the fix exists. Without that red run, nobody (you included) knows the test can fail.
- **Diagnoses are hypotheses.** Say what would confirm yours and try to falsify it before
  implementing. During the audit's fix phase one confident root-cause diagnosis turned out to be
  empirically wrong while the code was right, and verifying first is the only thing that stopped
  us "fixing" correct behavior.
- **Coverage claims get revert-checked.** "This is already pinned by existing tests" is disproven
  by reverting the change and watching the suites stay green; this exact claim has failed review
  once already.
- **Every fix records a miss-analysis**, a line or three: what test should have caught this, and
  why none did. It lives in the regression test's requirement file (e2e) or as that test's own
  header line (unit). The generalized answers are what reshape the suite; three of them explained
  all ten audit bugs. One from the tree, so you know the size of the thing:

  ```ts
  // src/lib/test/blocks/code/code-language-chip-commit.test.ts
  // Miss-analysis: every commit test typed a new language, so no test ever pressed Enter on
  // an untouched field, and the byte comparison passed for the unpadded fence they all used.
  ```

[`anatomy-of-a-change.md`](anatomy-of-a-change.md) walks one feature from design to ship,
including two tests that passed for the wrong reason and a "fix" for a browser behavior that
doesn't exist.

## Testing shape

- **Entry and dispatch layers get tests at their own level.** The audit's suite missed every bug
  for one structural reason above all: the pure cores were over-tested with hand-normalized inputs
  while the layers producing those inputs had zero tests. `keyboard-extend.ts` held two Criticals
  (the audit's top severity) and not one test.
- **Generators must be adversarial**: non-ASCII, cross-construct interleaving, boundary shapes. A
  property suite whose generator can't produce the bug class proves nothing about it.
- **New feature class → new simulation gesture.** The simulation (long scripted sessions that type
  whole documents through real keystrokes) only catches what it types, so its coverage has to
  track the product surface; [`testing.md`](testing.md) § The note-taking simulation says what it
  is and why it's worth that upkeep.
- Requirements stay in lockstep with specs, and e2e simulates real user actions.
  [`testing.md`](testing.md) has the mechanics.

## Working the gates

The commit gate is `npm test` (the unit suite, then every e2e project) plus `npm run check` and
`npm run lint`. The per-area scripts (`npm run test:editor:<area>`, listed in `package.json`) are
the inner loop. Green looks like this, first lines only, with the counts elided (they move every
week, and the zeros are what you're checking):

```
$ npm run check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json
... COMPLETED … FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ npm run lint
> prettier --check . && npm run docs:pack:check && npm run docs:map:check && npm run lint:eslint
Checking formatting...
All matched files use Prettier code style!
docs-pack: … docs link-closed (consumer-guide.md, directives.md, plugin-api.md, ...)
docs-links: … corpus docs, every relative link resolves
codebase-map: … references resolve (… naming a symbol) across … files in docs/design, docs/contributing
> eslint .
(nothing: eslint prints no output when it's happy)

$ npm run test:editor:invariants
> vitest run src/lib/test/invariants
 RUN  v… ...
 Test Files  … passed (…)
      Tests  … passed (…)
```

- Gate lists derive from the **files touched**, not the task's theme. A batch "about" selection
  that edits `editor-actions/` runs the editor-actions suite too; two silently-red tests once
  shipped through exactly that hole.
- **Never pipe a gate command.** In bash a pipeline's exit is the last command's (unless you set
  `pipefail`, which nobody does by hand), so a red gate behind `| tail` reads green. PowerShell
  keeps `$LASTEXITCODE` across a cmdlet like `Select-Object`, but a native exe on the right
  (`findstr`, say) overwrites it the same way. A stand-in that fails, in both shells:

  ```bash
  $ node -e "console.log('Tests  1 failed'); process.exit(1)" | tail -n 1; echo "exit $?"
  Tests  1 failed
  exit 0
  ```

  ```powershell
  PS> node -e "console.log('Tests  1 failed'); process.exit(1)" | findstr failed; Write-Output "exit $LASTEXITCODE"
  Tests  1 failed
  exit 0
  ```

  Capture to a file and read the exit yourself: `npm test > gate.log 2>&1; echo "exit $?"` in
  bash, `npm test *> gate.log; Write-Output "exit $LASTEXITCODE"` in PowerShell.

- The long suites (the full e2e run, the simulation) run alone, never next to other work on the
  same tree. Contention produces phantom failures that cost real investigation time.
- A dev warning reds a gate. [`warnings.md`](warnings.md) says which channel means what, and how a
  test claims a fire it lit on purpose.

## Records

**The GitHub issue tracker is the defect ledger.** Three conventions carry all the metadata, and
the body carries none of it:

- An issue's **type** says what it is: `Bug`, `Feature`, or `Task`, one issue form each. The form
  sets the type at creation, and [`scripts/issue-type.mjs`](../../scripts/issue-type.mjs) sets it
  afterwards, for an issue the forms didn't type:

  ```
  $ node scripts/issue-type.mjs
  usage: node scripts/issue-type.mjs <number> bug|task|feature
  ```

- Every issue carries one `area:` label, and a `Bug` also carries one `severity:`; severity reads
  blast radius, which only a defect has. [`scripts/audit-issues.mjs`](../../scripts/audit-issues.mjs)
  is the check, and it fails on an open issue missing either a type or an area:

  ```
  $ node scripts/audit-issues.mjs
  ledger: … issues (… open, … closed)
    open        Bug …, Task …
    closed      Bug …, Feature …, Task …, untyped …
    open milestones  (none) …, 1.0 …, post-1.0 …
    good first issue … open

  severity: without type Bug   0  none
  closed, untyped              …
  closed, no area:             …

  OPEN, untyped                0  none
  OPEN, no area:               0  none
  ```

- The body holds the thing and nothing else: what's wrong, the repro, the files, the fix
  direction, and why it's deferred. No provenance, no process notes.
- **A `good first issue` body names one edit site and one acceptance signal**, and keeps the
  architectural shape as background. The rest of the ledger wants the shape first, which is why
  this one needs saying: a newcomer reading a shape can't tell which file to open or when
  they're done.

Labels come from the existing set, and the ones with a description are the canonical ones:

```
$ gh label list --limit 8
good first issue      Good for newcomers                                  #7057ff
help wanted           Extra attention is needed                           #008672
dependencies          Pull requests that update a dependency file         #0366d6
javascript            Pull requests that update javascript code           #168700
github_actions        Pull requests that update GitHub Actions code       #000000
severity: important   byte corruption or contract-breaking defect         #d73a4a
severity: minor       real defect, bounded harm                           #fbca04
severity: watch       observed signal, no confirmed defect or no repro    #0969da
```

A label that seems missing is usually a duplicate spelling of one that exists; only create a
genuinely new label, with a description in the same voice as the rest.

Close an issue by naming the shipping commit in the closing comment. Reconcile an issue against
the commits that resolve it rather than against its own text. A premise can expire without a word
of the issue changing, so work that landed elsewhere closes issues nobody edited.

Three more places a record lives, or pointedly doesn't:

- **The changelog is past-only**, and a shipped milestone lands in it in the same commit that
  ships the feature. A decision lives with the contract it binds, not in a plan document;
  forward-looking plans aren't in this repository at all.
- **A moved seam moves the codebase map in the same commit** ([`codebase-map.md`](codebase-map.md)).
  `npm run lint` fails on a path or symbol the map names that no longer exists, which is the
  reminder. The check (`scripts/check-codebase-map.mjs`) reads every backticked `src/`, `docs/`
  and `scripts/` path in `docs/design/` and `docs/contributing/`, so it covers more than the map,
  and a `path :: Symbol` span has to find the symbol in that file too. Its passing line is in the
  lint output above.
- Contributor-facing friction that's real but isn't a defect goes to
  [Discussions](https://github.com/voithos-labs/aragonite/discussions) rather than into someone's
  memory. It lands there and not in the ledger because a Task has to name an edit site, which is
  the one thing a person who has just tripped doesn't have yet; once it does, it becomes a Task.

**A behavior change sweeps its prose claim by claim.** Grep alone doesn't cut it: three stale
sentences once survived a grep sweep in one session, each describing the old behavior in words
that held no symbol to search for. So every sentence about the changed behavior gets a verdict,
across `docs/guide/`, `docs/design/`, `src/lib/editor-props.ts` and the shipped-source manifests
(the section notes in `src/lib/plugin.ts` and `src/lib/index.ts`, the tables in `docs/README.md`).
