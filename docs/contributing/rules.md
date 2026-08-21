# The rules

## What this is

The rules you can't get from reading the code. Every one of them was paid for by a real bug, and
[`casebook.md`](casebook.md) holds the bug.

aragonite keeps a mutable tree that is simultaneously the undo history and the source of truth for
the DOM. That combination goes wrong in a small number of specific ways, and these are they. **Read
this file before your first edit; read the casebook before your first structural change.**

Where a mechanism is specified elsewhere, this doc carries the rule and points at the spec.

## The five rules

Five lines is what a newcomer can actually hold on the way to a first edit. Each one links to the
incident that bought it.

1. **The CST is the single source of truth.** Where the tree and the DOM disagree, the tree
   wins. ([node copies](casebook.md#node-copies-are-re-read-through-the-state-tree),
   [shared bytes](casebook.md#snapshot-shared-nodes-are-read-only-on-their-bytes),
   [the render path](casebook.md#the-render-path-computes-inline-content-locally-and-reads-no-cache))
2. **Reactive state crosses module boundaries as getters, never values.** A value read is a
   snapshot, plus a dependency you did not ask for.
   ([the re-init scar](casebook.md#reactive-state-crosses-module-boundaries-as-getters-never-values))
3. **`await tick()` is the only sequencing primitive.** No `setTimeout`, no `rAF`, no microtask
   tricks. ([the predecessor editor](casebook.md#only-await-tick-for-sequencing))
4. **Rules live at choke points, not call sites.** If a rule can move into the seam, it moves into
   the seam. ([endpoints and paths](casebook.md#rules-live-at-choke-points-not-call-sites),
   [one offset home](casebook.md#dom-to-raw-offset-translation-has-one-home),
   [registries](casebook.md#registries-are-code-not-state))
5. **A bug fix closes the class and mints the guard.** Fixing only the instance you found is half a
   fix. (the ladder below, and [§ Fixing bugs](#fixing-bugs))

## The enforcement ladder

**Unrepresentable > guarded > documented.** Every load-bearing contract climbs as high as it can:
prefer types and seams that make the violation inexpressible; where types can't reach, a dev-mode
guard that fails at the gate (`invariants/`, catalogued in `docs/design/invariants.md`); prose only
for what neither can hold. When you touch a convention, ask whether it can climb a rung. The most
durable fixes of the 2026-07 audit (a large internal review that produced most of these rules, and
"the audit" from here on) were exactly such promotions: a throwing tree-op became a nullable return,
a comment-stated path convention became factory-minted arguments plus a guard.

Corollary: **when a bug is fixed, close the class, not the instance**, and mint the guard that would
have caught it.

## The bug shape to fear: sibling-path parity

The dominant class of the audit: one rule enforced at N−1 of N sibling entry paths (endpoint
normalization, undo fallback paths, merge fallbacks, keymap dispatch). Habits that kill it:

- When you add entry path N+1 to anything (a new gesture, a new commit caller, a new paste route),
  grep for the rules its siblings carry.
- When you find one violation, **enumerate all siblings before fixing any**. The instance you found
  is rarely alone.
- Prefer moving the rule into the seam and deleting the call-site copies over adding copy N+1.
- A diff that adds an entry path gets one standing review question: **can the rule move into the
  seam instead of being carried?** Carrying is the exception and says why.
- Where the funnel can't be built yet, mint the parity rule as a source-scan guard
  (`src/lib/test/invariants/lint/`): "every entry path matching X routes through Y" fails the day
  path N+1 is born, instead of at the next audit.

## Fixing bugs

- **Root-cause first, then fix the class.** Never patch around an edge case.
- **Test-first, red quoted.** The regression test fails on the pre-fix code for the right reason
  before the fix exists. A fix without a red-first pin is a claim.
- **Diagnoses are hypotheses.** State the acceptance signal and try to falsify before implementing.
  A confident root-cause diagnosis in the audit's fix phase was empirically wrong while the code was
  right, and the verify-first rule prevented "fixing" correct behavior.
- **Coverage claims get revert-checked.** "Pinned by existing tests" is disproven by reverting the
  change and watching the suites stay green; this exact claim failed review once already.
- **Miss-analysis, a short line or three per bug fix**: what test should have caught this, and why
  didn't it. It lives in the regression test's requirement file (e2e) or as that test's own header
  line (unit). The generalized answers reshape the suite; three of them explained all ten audit bugs.

[`anatomy-of-a-change.md`](anatomy-of-a-change.md) walks one feature from design to ship, including
two tests that passed for the wrong reason and the "fix" that turned out to be for a browser
behavior that does not exist.

## Testing shape

- **Entry and dispatch layers get tests at their own level.** The audit's suite missed every bug for
  one structural reason above all: pure cores were over-tested with hand-normalized inputs while the
  layers producing those inputs had zero tests. (`keyboard-extend.ts` held two Criticals and not one
  test.)
- **Generators must be adversarial**: non-ASCII, cross-construct interleaving, boundary shapes. A
  property suite whose arbitrary can't produce the bug class proves nothing about it.
- **New feature class → new simulation gesture.** The simulation is the strongest corruption oracle;
  its coverage must track the product surface (the plugin surface went a full minor version
  unobserved by it).
- Requirements stay in lockstep with specs; e2e simulates real user actions. See
  [`testing.md`](testing.md) for the mechanics.

## Working the gates

- Gate lists derive from the **files touched**, not the task's theme. A batch "about" selection that
  edits `editor-actions/` runs the editor-actions suite too (two silently-red tests once shipped
  through that hole).
- **Never pipe a gate command.** `npm test | tail` returns the pipe's exit code, not the gate's.
  Capture to a file; check the exit explicitly.
- Long batteries run alone, never concurrently with other work on the same tree. Contention produces
  phantom failures that cost real investigation time.
- A dev warning is a gate failure, not console noise. [`warnings.md`](warnings.md) says which
  channel means what and how a test claims a deliberate fire.

## Records

- **The GitHub issue tracker is the defect ledger.** An issue's **type** says what it is (`Bug`,
  `Feature`, `Task`; the issue forms set the first two). Every issue carries one `area:` label, and
  a `Bug` additionally carries one `severity:` — severity reads blast radius, which only a defect
  has. The body holds the thing and nothing else: what is wrong, the repro, the files, the fix
  direction, and why it is deferred. No provenance, no process notes.
- **Labels come from the existing set** (`gh label list`, where the described ones are canonical). A
  label that seems missing is usually a duplicate spelling of one that exists; only mint a genuinely
  new label with a description matching the set's voice.
- **Close an issue by naming the shipping commit** in the closing comment.
- **Reconcile an issue against the commits that resolve it, never against its own prose.** A premise
  expires without a word of the issue changing, so work landed elsewhere closes issues nobody edited.
- Roadmap is forward-only; changelog is past-only; a shipping milestone moves between them in the
  same commit.
- **A moved seam moves the codebase map in the same commit** ([`codebase-map.md`](codebase-map.md)).
  `npm run lint` fails on a path or symbol it names that no longer exists, which is the reminder.
- Contributor-facing friction that is real but is not a defect lives in
  [`friction-log.md`](friction-log.md) rather than in someone's memory.
