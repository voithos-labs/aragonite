# Engineering Culture

## What this is

The rules you can't get from reading the code. Every one of them was paid for by a real bug.

aragonite holds a mutable tree that is simultaneously the undo history and the source of truth
for the DOM. That combination goes wrong in a small number of specific ways, and this file is
the list of them. The five rules below are the short version, and they are enough to carry into
your first edit; read the casebook properly before your first structural change.

Where a mechanism is specified elsewhere, this doc carries the rule and the scar, and points at
the spec.

## The five rules

Five lines is what a newcomer can actually hold on the way to their first edit. Everything
below this section is the evidence.

1. **The CST is the single source of truth.** Where the tree and the DOM disagree, the tree
   wins.
2. **Reactive state crosses module boundaries as getters, never values.** A value read is a
   snapshot, plus a dependency you did not ask for.
3. **`await tick()` is the only sequencing primitive.** No `setTimeout`, no `rAF`, no
   microtask tricks.
4. **Rules live at choke points, not call sites.** If a rule can move into the seam, it moves
   into the seam.
5. **A bug fix closes the class and mints the guard.** Fixing only the instance you found is
   half a fix.

## The enforcement ladder

**Unrepresentable > guarded > documented.** Every load-bearing contract climbs as high as it
can: prefer types and seams that make the violation inexpressible; where types can't reach, a
dev-mode guard that fails at the gate (`invariants/`, catalogued in
`docs/design/invariants.md`); prose only for what neither can hold. When you touch a
convention, ask whether it can climb a rung — the most durable fixes of the 2026-07 audit (a
large internal review that produced most of the rules in this file, and "the audit" from here
on) were exactly such promotions: a throwing tree-op became a nullable return, a comment-stated
path convention became factory-minted arguments plus a guard.

Corollary: **when a bug is fixed, close the class, not the instance** — and mint the guard
that would have caught it.

## The casebook: why each rule exists

Each rule names its incident. These are the ways this codebase actually gets corrupted. The
G-numbers name entries in the invariant catalog, `docs/design/invariants.md`.

- **Node copies re-read through the `$state` tree before use; never hold a raw copy after the
  proxy has observed it.** Incident: Svelte's ownership tracking corrupted keyed `{#each}`
  index assignments after `splitBlock`. Spec: `tree-operations/unshare.ts` header.
- **Snapshot-shared nodes are read-only on their serialized bytes (G1.9)** — copy-path-on-write
  before any byte write; the commit ceremony owns this and hands mutations an owned view.
  Never write through a node reference captured before the commit. A DEV integrity oracle
  catches violations at the offending commit, not at the undo that exposes them. Type-enforced
  since 0.9.24: readers hold bytes-readonly views (`core/node-views.ts`, G3.8) and the unshare
  seam is the only way back to mutable (G4.13); the oracle stays the runtime belt.
- **Reactive state crosses module boundaries as getters, never values.** A value read
  snapshots at effect-run time AND registers the state as a dependency — the original re-init
  effect wiped unrelated work on every mutation. Same trap inside `afterTick` callbacks: read
  `deps.node` live; a pre-commit capture is stale by construction (a delete-last-item caret
  loss shipped this way and survived until the audit).
- **The render path computes inline content locally and reads no cache.** A render effect that
  both read and wrote a reactive cache field closed a write-during-read loop and corrupted
  keyed rendering. Non-render consumers use the `getInlineContent` accessor (external,
  non-reactive WeakMap). No reactive inline-cache field may exist.
- **Only `await tick()` for sequencing.** `setTimeout`/`rAF`/microtask tricks are symptoms of
  a wrong operation flow — the predecessor editor, the pre-aragonite attempt at this same
  editor (the README's Origin story), died of them.
- **Rules live at choke points, not call sites.** Cross-block selection endpoints normalize
  INSIDE `SelectionState.enterCrossBlock`/`extendFocus` — never construct endpoints around it.
  Commit event/snapshot paths are doc-absolute, minted by the scope factories
  (`block-edit-scope.ts`), asserted by G1.16 — never compose paths in a caller. Both seams
  exist because the call-site versions missed sites: two of the three corruption Criticals in
  the audit were entry paths that skipped a wrap five siblings carried. Since 0.9.24 the
  factory mints carry the `DocPath` brand, and the op-family composers now build their
  doc-absolute paths through the branded helpers too; G1.16 stays the runtime belt for the
  JS callers the type can't reach.
- **DOM ↔ raw offset translation has one home** (`cursor/widget-offset.ts`, plus the ambient
  helpers). Offset arithmetic duplicated anywhere else will disagree with it eventually —
  every offset bug in the audit traced to arithmetic done outside the shared walk.
  Type-enforced since 0.9.24: the coordinate spaces are branded (G3.7, minted only at their
  home modules, G4.15) — cross-space arithmetic no longer compiles.
- **Registries are code, not state.** Register-once, throw-on-duplicate, no unregister
  (`customElements` model) — in production and under test. Test isolation goes through the reset
  affordances; under a dev server a duplicate registration replaces with a note instead of throwing
  (`schema/register-once.ts`), so a re-evaluated registrar survives instead of 500-ing every route
  (the SSR poison class). The contract is unchanged where it is observed — prod and test still
  throw. This reaches the public API: a plugin author's suite
  can't re-install between cases without a sanctioned seam, so `aragonite/testing` exports
  `resetPluginPlatformForTests()` — and every new registration reachable from the public plugin
  surface must wire its reset into it, or the next author hits the dup-throw on their second
  `beforeEach`.

## The bug shape to fear: sibling-path parity

The dominant class of the audit — one rule enforced at N−1 of N sibling entry paths
(endpoint normalization, undo fallback paths, merge fallbacks, keymap dispatch). Habits that
kill it:

- When you add entry path N+1 to anything (a new gesture, a new commit caller, a new paste
  route), grep for the rules its siblings carry.
- When you find one violation, **enumerate all siblings before fixing any** — the instance you
  found is rarely alone.
- Prefer moving the rule into the seam and deleting the call-site copies over adding copy N+1.
- A diff that adds an entry path gets one standing review question: **can the rule move into the
  seam instead of being carried?** Carrying is the exception and says why.
- Where the funnel can't be built yet, mint the parity rule as a source-scan guard
  (`src/lib/test/invariants/lint/`): "every entry path matching X routes through Y" fails the day path N+1 is
  born, instead of at the next audit.

## Fixing bugs

- **Root-cause first, then fix the class.** Never patch around an edge case.
- **Test-first, red quoted.** The regression test fails on the pre-fix code for the right
  reason before the fix exists. A fix without a red-first pin is a claim.
- **Diagnoses are hypotheses.** State the acceptance signal and try to falsify before
  implementing — a confident root-cause diagnosis in the audit's fix phase was empirically
  wrong while the code was right; the verify-first rule prevented "fixing" correct behavior.
- **Coverage claims get revert-checked.** "Pinned by existing tests" is disproven by reverting
  the change and watching the suites stay green — this exact claim failed review once already.
- **Miss-analysis, one line per bug fix**: what test should have caught this, and why didn't
  it. It lives in the regression test's requirement file (e2e) or as that test's own header
  line (unit). The generalized answers reshape the suite; three of them explained all ten
  audit bugs.

## Testing shape

- **Entry and dispatch layers get tests at their own level.** The audit's suite missed every
  bug for one structural reason above all: pure cores were over-tested with hand-normalized
  inputs while the layers producing those inputs had zero tests. (`keyboard-extend.ts` held
  two Criticals and not one test.)
- **Generators must be adversarial**: non-ASCII, cross-construct interleaving, boundary
  shapes. A property suite whose arbitrary can't produce the bug class proves nothing about it.
- **New feature class → new simulation gesture.** The simulation is the strongest corruption
  oracle; its coverage must track the product surface (the plugin surface went a full minor
  version unobserved by it).
- Requirements stay in lockstep with specs; e2e simulates real user actions — see
  `docs/contributing/testing.md` for the mechanics.

## Working the gates

- Gate lists derive from the **files touched**, not the task's theme — a batch "about"
  selection that edits `editor-actions/` runs the editor-actions suite too (two silently-red
  tests once shipped through that hole).
- **Never pipe a gate command** (`npm test | tail` returns the pipe's exit code, not the
  gate's). Capture to a file; check the exit explicitly.
- Long batteries run alone — never concurrently with other work on the same tree; contention
  produces phantom failures that cost real investigation time.

## Records

- **The GitHub issue tracker is the defect ledger.** An issue carries one `severity:` label and
  one `area:` label, and a body holding the defect and nothing else — what is wrong, the repro,
  the files, the fix direction, and why it is deferred. No provenance, no process notes.
- **Close an issue by naming the shipping commit** in the closing comment.
- **Reconcile an issue against the commits that resolve it, never against its own prose.** A
  premise expires without a word of the issue changing, so work landed elsewhere closes issues
  nobody edited.
- Roadmap is forward-only; changelog is past-only; a shipping milestone moves between them in
  the same commit.
- **A moved seam moves the codebase map in the same commit** (`docs/contributing/codebase-map.md`);
  `npm run lint` fails on a path or symbol it names that no longer exists, which is the reminder.
