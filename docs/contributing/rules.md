# The rules

The rules you cannot get from reading the code. Every one of them was paid for with a real bug,
and [`casebook.md`](casebook.md) still has the receipt.

Here is the shape of the problem. aragonite keeps one mutable tree, the CST (the parsed form of
the Markdown, markers and all), and that tree is simultaneously the undo history and the source of
truth for the DOM. That is a good design, and it goes wrong in a small number of very specific
ways, which are the ways below. Nobody guessed them in advance; we found them the expensive way,
mostly in one event: the 2026-07 audit, a large internal review that produced most of this page
("the audit" from here on).

Read this page before your first edit, and read the casebook before your first structural change.
The five rules are five on purpose, because five is about what anyone actually retains on the way
to touching something. The sections after them are how the five get applied, so budget for the
whole page rather than the list:

- [The five rules](#the-five-rules): the list, each rule linking to the incident that bought it.
- [The enforcement ladder](#the-enforcement-ladder): where a rule should live, so nobody has to remember it.
- [The bug shape to fear: sibling-path parity](#the-bug-shape-to-fear-sibling-path-parity): the pattern behind most of the audit's findings, and the habits that kill it.
- [Fixing bugs](#fixing-bugs): how a fix lands here, test first.
- [Testing shape](#testing-shape): where tests have to sit to catch anything.
- [Working the gates](#working-the-gates): running the check suites without fooling yourself.
- [Records](#records): where defects, decisions, and stale prose go.

Where a mechanism is specified elsewhere, this doc carries the rule and points at the spec.

## The five rules

1. **The CST is the single source of truth.** Where the tree and the DOM disagree, the tree
   wins. ([node copies](casebook.md#node-copies-are-re-read-through-the-state-tree),
   [shared bytes](casebook.md#snapshot-shared-nodes-are-read-only-on-their-bytes),
   [the render path](casebook.md#the-render-path-computes-inline-content-locally-and-reads-no-cache))
2. **Reactive state crosses module boundaries as getters, never values.** A value read is a
   snapshot, plus a dependency you did not ask for.
   ([the re-init incident](casebook.md#reactive-state-crosses-module-boundaries-as-getters-never-values))
3. **`await tick()` is the only sequencing primitive.** No `setTimeout`, no `rAF`, no microtask
   tricks. ([the predecessor editor](casebook.md#only-await-tick-for-sequencing))
4. **Rules live at choke points, not call sites.** A choke point is the one place every path
   already crosses, a seam (a boundary where responsibility changes hands from one piece of code
   to another). If a rule can move into the seam, it moves into
   the seam. ([endpoints and paths](casebook.md#rules-live-at-choke-points-not-call-sites),
   [one offset home](casebook.md#dom-to-raw-offset-translation-has-one-home),
   [registries](casebook.md#registries-are-code-not-state))
5. **A bug fix closes the class and adds the guard.** Fixing only the instance you found is half a
   fix. (the ladder below, and [§ Fixing bugs](#fixing-bugs))

## The enforcement ladder

**Unrepresentable > guarded > documented.** Every contract climbs as high as it can: first choice
is types and seams that make the violation inexpressible; where types can't reach, a dev-mode
guard that fails a test gate (the predicates live in `invariants/`, and `docs/design/invariants.md`
catalogs every guard); prose only for what neither can hold. When you touch a convention, ask
whether it can climb a rung. The audit's most durable fixes were exactly such promotions: a tree
operation that threw became a nullable return, and a path convention that lived in a comment
became factory-built arguments plus a guard.

The corollary is rule 5 seen from the other side: when a bug is fixed, close the class, not the
instance, and add the guard that would have caught it.

## The bug shape to fear: sibling-path parity

The audit's dominant class: one rule enforced at N−1 of N sibling entry paths. An operation tends
to grow several routes in over time (a keyboard gesture, a paste, an undo fallback), each supposed
to apply the same rule, and the copy of the rule is missing from exactly one of them. That is
where the audit found its corruption: endpoint normalization, undo fallback paths, merge
fallbacks, keymap dispatch. Habits that kill it:

- When you add entry path N+1 to anything (a new gesture, a new commit caller, a new paste route),
  grep for the rules its siblings carry.
- When you find one violation, **enumerate all siblings before fixing any**. The instance you
  found is rarely alone.
- Prefer moving the rule into the seam and deleting the call-site copies over adding copy N+1.
- A diff that adds an entry path gets one standing review question: **can the rule move into the
  seam instead of being carried?** Carrying is the exception and says why.
- Where the one shared route can't be built yet, write the parity rule as a source-scan guard
  (`src/lib/test/invariants/lint/`): "every entry path matching X routes through Y" fails the day
  path N+1 is born, instead of at the next audit.

## Fixing bugs

- **Root-cause first, then fix the class.** Never patch around an edge case.
- **Test-first, red quoted.** The regression test fails on the pre-fix code, for the right reason,
  before the fix exists. A fix without that red-first pin is a claim, not a fix.
- **Diagnoses are hypotheses.** State what would confirm yours and try to falsify it before
  implementing. During the audit's fix phase, one confident root-cause diagnosis turned out to be
  empirically wrong while the code was right, and verifying first is the only thing that prevented
  "fixing" correct behavior.
- **Coverage claims get revert-checked.** "This is already pinned by existing tests" is disproven
  by reverting the change and watching the suites stay green; this exact claim has failed review
  once already.
- **Every fix records a miss-analysis**, a line or three: what test should have caught this, and
  why none did. It lives in the regression test's requirement file (e2e) or as that test's own
  header line (unit). The generalized answers are what reshape the suite; three of them explained
  all ten audit bugs.

[`anatomy-of-a-change.md`](anatomy-of-a-change.md) walks one feature from design to ship,
including two tests that passed for the wrong reason and a "fix" that turned out to be for a
browser behavior that does not exist.

## Testing shape

- **Entry and dispatch layers get tests at their own level.** The audit's suite missed every bug
  for one structural reason above all: the pure cores were over-tested with hand-normalized inputs
  while the layers producing those inputs had zero tests. `keyboard-extend.ts` held two Criticals
  (the audit's top severity) and not one test.
- **Generators must be adversarial**: non-ASCII, cross-construct interleaving, boundary shapes. A
  property suite whose generator can't produce the bug class proves nothing about it.
- **New feature class → new simulation gesture.** The simulation (long scripted sessions that type
  whole documents through real keystrokes) is the strongest corruption oracle in the repo (an
  oracle: an independent source of the right answer a test compares against), so its coverage must
  track the product surface; the plugin surface once went a full minor version unobserved by it.
- Requirements stay in lockstep with specs, and e2e simulates real user actions.
  [`testing.md`](testing.md) has the mechanics.

## Working the gates

- Gate lists derive from the **files touched**, not the task's theme. A batch "about" selection
  that edits `editor-actions/` runs the editor-actions suite too; two silently-red tests once
  shipped through exactly that hole.
- **Never pipe a gate command.** `npm test | tail` returns the pipe's exit code, not the gate's.
  Capture to a file; check the exit explicitly.
- The long suites (the full e2e run, the simulation) run alone, never concurrently with other work
  on the same tree. Contention produces phantom failures that cost real investigation time.
- A dev warning is a gate failure, not console noise. [`warnings.md`](warnings.md) says which
  channel means what and how a test claims a deliberate fire.

## Records

**The GitHub issue tracker is the defect ledger.** Three conventions carry all the metadata, and
the body carries none of it:

- An issue's **type** says what it is: `Bug`, `Feature`, or `Task`, one issue form each. The form
  sets the type at creation, and [`scripts/issue-type.mjs`](../../scripts/issue-type.mjs) sets it
  afterwards.
- Every issue carries one `area:` label, and a `Bug` additionally carries one `severity:`;
  severity reads blast radius, which only a defect has.
  [`scripts/audit-issues.mjs`](../../scripts/audit-issues.mjs) is the check, and it fails on an
  open issue missing either a type or an area.
- The body holds the thing and nothing else: what is wrong, the repro, the files, the fix
  direction, and why it is deferred. No provenance, no process notes.

Labels come from the existing set (`gh label list`, where the described ones are canonical). A
label that seems missing is usually a duplicate spelling of one that exists; only create a
genuinely new label, with a description matching the set's voice.

Close an issue by naming the shipping commit in the closing comment. And reconcile an issue
against the commits that resolve it, never against its own prose: a premise expires without a word
of the issue changing, so work landed elsewhere closes issues nobody edited.

Three more places a record lives, or pointedly does not:

- **The changelog is past-only**, and a shipped milestone lands in it in the same commit that
  ships the feature. A decision lives with the contract it binds, not in a plan document;
  forward-looking plans are not in this repository at all.
- **A moved seam moves the codebase map in the same commit** ([`codebase-map.md`](codebase-map.md)).
  `npm run lint` fails on a path or symbol the map names that no longer exists, which is the
  reminder.
- Contributor-facing friction that is real but is not a defect goes in
  [`friction-log.md`](friction-log.md) rather than in someone's memory.

**A behavior change sweeps its prose by claim, not by grep.** Every sentence about the changed
behavior gets a verdict, across `docs/guide/`, `docs/design/`, `src/lib/editor-props.ts` and the
shipped-source manifests (the section notes in `src/lib/plugin.ts` and `src/lib/index.ts`, the
tables in `docs/README.md`). Three stale sentences once survived a grep sweep in one session, each
describing the old behavior in words that held no symbol to search for.
