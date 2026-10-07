# The rules

The rules you can't get from reading the code. Things happened which shaped this doc; go read [`casebook.md`](casebook.md).

Here's the shape of the problem. aragonite keeps one mutable tree, the CST (the parsed form of the Markdown, markers and all). The undo history points into that same tree, and the DOM renders from it. It's decent design, and it goes wrong in a small number of very specific ways, which are partly listed below.

You prob want to read this page before your first edit, and the casebook before your first structural change. The five rules are five because of [this](https://pmc.ncbi.nlm.nih.gov/articles/PMC2864034/), which means that on average you will forget one of these rules when you make your way to touching the code. You are welcome.

- [The five rules](#the-five-rules): the list, each rule linking to the incident that bought it.
- [The enforcement ladder](#the-enforcement-ladder): where a rule should live, so nobody has to remember it.
- [The bug shape to fear: sibling-path parity](#the-bug-shape-to-fear-sibling-path-parity): the pattern behind most of the corruption bugs found so far, and the habits that kill it.
- [Fixing bugs](#fixing-bugs): how a fix lands here, test first.
- [Testing shape](#testing-shape): where tests have to sit to catch anything.
- [Working the gates](#working-the-gates): the check commands, and the one way to fool yourself.
- [Before you open the PR](#before-you-open-the-pr): the six checks a PR here trips most, each with its command.
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
   already goes through (the function every commit calls, say). If a rule can move there, it
   moves there.
   ([endpoints and paths](casebook.md#rules-live-at-choke-points-not-call-sites),
   [one offset home](casebook.md#dom-to-raw-offset-translation-has-one-home),
   [registries](casebook.md#registries-are-code-not-state))
5. **A bug fix closes the class and adds the guard.** Fixing only the instance you found is half a
   fix. (guards are the next section; the habit is [§ Fixing bugs](#fixing-bugs))

## The enforcement ladder

**Unrepresentable > guarded > documented.** A contract climbs as high up that list as it can.
First choice is types and shared entry points that make the violation impossible to write down
(a commit path is a branded type with its own constructors, so a hand-composed number array
doesn't compile as one). Where types can't reach, a dev-mode guard that fails a test gate. Prose only for
what neither can hold. When you touch a convention, ask whether it can move up a step.

A guard is one call at the choke point the contract belongs to: a tag and a predicate. The
predicates live in `src/lib/invariants/`, and `docs/design/invariants.md` catalogs every guard.

```ts
// src/lib/invariants/install.ts, run before every commit's mutation
assertInvariant('commit-path-dialect', () =>
	checkCommitPathAddressable(doc, eventPath, 'eventPath')
);
```

In a dev build a violation prints `[aragonite:invariant:commit-path-dialect] ...` and reds the
test that provoked it ([`warnings.md`](warnings.md) has the channels). In production the predicate
isn't even called. That guard is what rule 5 asks a bug fix to add.

## The bug shape to fear: sibling-path parity

One rule enforced on all but one of the sibling paths into an operation. An operation grows
several routes in over time (a keyboard gesture, a paste, an undo fallback), each supposed to
apply the same rule, and exactly one of them is missing its copy. Most of the corruption found so
far had this shape. Habits that kill it:

- When you add a new entry path to anything (a gesture, a commit caller, a paste route), grep for
  the rules its siblings carry.
- When you find one violation, **enumerate all siblings before fixing any**. The instance you
  found is rarely alone.
- Move the rule into the choke point and delete the call-site copies, rather than adding one more
  copy. A diff that adds an entry path gets one standing review question: **can the rule move into
  the choke point instead?** Carrying it per path is the exception, and the diff says why.
- Where the one shared route can't be built yet, write the parity rule as a source-scan guard
  (`src/lib/test/invariants/lint/`): "every entry path matching X routes through Y", which fails
  the day the new path is born instead of at the next audit.

A source-scan guard is a unit test that reads the source tree instead of running it. Many scans
in that folder are one row in a shared rule table: the shape, the files allowed to hold it, and
the snippets the matcher must flag or spare. A red names the offending file and the rule's reason:

```ts
// src/lib/test/invariants/lint/file-rules.test.ts
{
	id: 'G4.4 no timing hacks for sequencing',
	matches: /\b(?:setTimeout|setInterval|queueMicrotask|requestAnimationFrame)\s*\(/,
	allowed: { 'src/lib/selection/autoscroll.ts': 'rAF autoscroll loop: an animation cadence, not ordering' /* ... */ },
	reason: '`await tick()` is the only sequencing primitive; ...',
	hits: ['setTimeout(() => x, 0)' /* ... */],
	misses: ['clearTimeout(id);\n...']
}
```

## Fixing bugs

- **Root-cause first, then fix the class.** Never patch around an edge case.
- **Test-first, red quoted.** The regression test fails on the pre-fix code, for the right reason,
  before the fix exists. Without that red run, nobody (you included) knows the test can fail.
- **Diagnoses are hypotheses.** Say what would confirm yours and try to falsify it before
  implementing. A confident diagnosis can be wrong while the code is right, and then the "fix"
  breaks correct behavior.
- **Coverage claims get revert-checked.** "This is already pinned by existing tests" is only true
  if reverting the change turns a suite red.
- **Every fix records a miss-analysis**, one line: what test should have caught this, and why
  none did. It lives in the regression test's requirement file (e2e) or as that test's own header
  line (unit). The generalized answers are what reshape the suite. One from the tree, so you know
  the size of the thing:

  ```ts
  // src/lib/test/blocks/code/code-language-chip-commit.test.ts
  // Miss-analysis: every commit test typed a new language on an unpadded fence, never a bare Enter.
  ```

[`anatomy-of-a-change.md`](anatomy-of-a-change.md) walks one feature from design to ship,
including two tests that passed for the wrong reason.

## Testing shape

- **Entry and dispatch layers get tests at their own level.** A pure core tested with
  hand-normalized inputs says nothing about the layer that produces those inputs, and that layer
  is where most of the bugs have been.
- **Generators must be adversarial**: non-ASCII, cross-construct interleaving, boundary shapes. A
  property suite whose generator can't produce the bug class proves nothing about it.
- **New feature class → new simulation gesture.** The simulation (long scripted sessions that type
  whole documents through real keystrokes) only catches what it types, so its coverage has to
  track the product surface ([`testing.md`](testing.md) § The note-taking simulation).
- Requirements stay in lockstep with specs, and e2e simulates real user actions.
  [`testing.md`](testing.md) has the mechanics.

## Working the gates

The commit gate is `npm test` (the unit suite, then every e2e project) plus `npm run check` (0
errors, 0 warnings) and `npm run lint`. The per-area scripts (`npm run test:editor:<area>`, listed
in `package.json`) are the inner loop. Green means every one of them exits 0.

- Gate lists derive from the **files touched**, not the task's theme. A change "about" selection
  that edits `editor-actions/` runs the editor-actions suite too.
- **Never pipe a gate command.** In bash a pipeline's exit is the last command's (unless you set
  `pipefail`, which nobody does by hand), so a red gate behind `| tail` reads green. PowerShell
  does the same when a native exe (`findstr`, say) sits on the right. A stand-in that fails, in
  both shells:

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

## Before you open the PR

Six checks a pull request here trips more often than everything else put together. The commit
gate runs them anyway; they take seconds, so you might as well hear it from the terminal instead
of from the review.

1. **Every new e2e spec has a requirement file, and vice versa**:
   `src/lib/e2e/tests/<area>/x.spec.ts` pairs with `src/lib/e2e/requirements/<area>/x.md`, and the
   requirement carries at least one scenario (a scenario list far longer than the spec's test
   count needs a reason in the scan's allowlist).
   `npx vitest run src/lib/e2e/lint/requirement-spec-lockstep.test.ts`
2. **Every comment fits the budget**: no comment block over two text lines (five for a header),
   and none of the repo's banned private words in a comment or a requirement file's body text
   ([`code-style.md`](code-style.md) § Comments has the rule, [`glossary.md`](glossary.md) what to
   write instead).
   `npx vitest run src/lib/test/invariants/lint/comment-budget.test.ts src/lib/test/invariants/lint/comment-house-words.test.ts`
3. **Every token the editor's CSS reads is declared in `src/lib/styles/editor-theme.css`**, every
   host token it reads has a fallback, and `src/app.css` holds no editor rule.
   `npx vitest run src/lib/test/invariants/lint/css-ownership.test.ts`
4. **Every icon a menu row names is a key of the glyph table** in `src/lib/menu-icons.ts`: a new
   icon is a new entry there, and a name that isn't one fails the `MenuIconName` type.
   `npm run check`
5. **Nothing sequences on `setTimeout`, `requestAnimationFrame` or a microtask trick**: the short
   list of timers that sequence nothing (a debounce, an animation) is the allowlist in the test.
   Unit tests follow it too, and wait with `settleEditor` from `src/lib/test/harness/settle.ts`.
   `npx vitest run src/lib/test/invariants/lint/file-rules.test.ts src/lib/test/invariants/lint/suite-file-rules.test.ts`
6. **A new file with a `pointerdown` or `mousedown` handler is in one of the scan's two lists**:
   the pointer handlers that place a caret, with the entry point each one goes through, or the ones
   that place none, with the reason.
   `npx vitest run src/lib/test/invariants/lint/caret-gesture-range-reset.test.ts`

`npm run test:editor:invariants` runs lines 2, 3, 5 and 6 together; the first lives beside the
e2e specs, so it keeps its own line.

## Records

**The GitHub issue tracker is the defect ledger.** An issue's type and labels carry all its
metadata, and its body holds only the defect:

- The **type** says what it is: `Bug`, `Feature`, or `Task`. The bug and feature forms set it; a
  task or a blank issue gets it afterwards with
  `node scripts/issue-type.mjs <number> bug|task|feature`.
- Every issue carries one `area:` label, and a `Bug` also carries one `severity:` (only a defect
  has a blast radius): `important` (byte corruption or a broken contract), `minor` (real, bounded
  harm), `watch` (a signal with no confirmed defect or no repro), `nit` (cosmetic).
  `node scripts/audit-issues.mjs` fails on an open issue missing a type or an area.
- Labels come from the existing set (`gh label list`). A label that seems missing is usually a
  different spelling of one that exists; a genuinely new one gets a description in the same voice.
- The body is what's wrong, the repro, the files, the fix direction, and why it's deferred. No
  provenance, no process notes.
- **A `good first issue` body names one edit site and one acceptance signal**, with the
  architectural shape as background. A newcomer reading only a shape can't tell which file to open
  or when they're done.

Close an issue by naming the shipping commit in the closing comment. Reconcile an issue against
the commits that resolve it rather than against its own text; work that landed elsewhere can
close an issue nobody edited.

`scripts/finn-todo.mjs` renders the open issues assigned to one co-founder into a gitignored
checklist and pushes back two edits (a ticked line closes its issue, a line with no number files
one). It's a view of the ledger, not a second copy.

Three more places a record lives, or pointedly doesn't:

- **The changelog is past-only**, and a shipped milestone lands in it in the same commit that
  ships the feature. A decision lives with the contract it binds, not in a plan document;
  forward-looking plans aren't in this repository at all.
- **A moved entry point moves the codebase map in the same commit** ([`codebase-map.md`](codebase-map.md)).
  `npm run lint` fails when a backticked `src/`, `docs/` or `scripts/` path in a design or
  contributing doc no longer exists, when a `path :: Symbol` span's symbol is gone, or when a
  `§ Section name` pointer names a heading its target doc dropped.
- Contributor friction that's real but isn't a defect goes to
  [Discussions](https://github.com/voithos-labs/aragonite/discussions). Once it can name an edit
  site, it becomes a Task.

**A behavior change sweeps its prose claim by claim.** Grep misses the sentences that describe the
old behavior in plain words, with no symbol to search for. So every sentence about the changed
behavior gets a verdict, across `docs/guide/`, `docs/design/`, `src/lib/editor-props.ts` and the
shipped-source manifests (the section notes in `src/lib/plugin.ts` and `src/lib/index.ts`, the
tables in `docs/README.md`).
