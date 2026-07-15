# Engineering Culture

## What this is

The rules you can't get from reading the code. Every one of them was paid for by a real bug.

aragonite holds a mutable tree that is simultaneously the undo history and the source of truth
for the DOM. That combination goes wrong in a small number of specific ways, and this file is
the list of them. Skim it before your first edit; read it properly before your first structural
change.

Where a mechanism is specified elsewhere, this doc carries the rule and the scar, and points at
the spec.

## The enforcement ladder

**Unrepresentable > guarded > documented.** Every load-bearing contract climbs as high as it
can: prefer types and seams that make the violation inexpressible; where types can't reach, a
dev-mode guard that fails at the gate (`invariants/`, catalogued in
`docs/design/invariants.md`); prose only for what neither can hold. When you touch a
convention, ask whether it can climb a rung — the 2026-07 audit's most durable fixes were
exactly such promotions (a throwing tree-op became a nullable return; a comment-stated path
convention became factory-minted arguments plus a guard).

Corollary: **when a bug is fixed, close the class, not the instance** — and mint the guard
that would have caught it.

## Sharp edges

Each rule names its incident. These are the ways this codebase actually gets corrupted.

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
  a wrong operation flow — the predecessor editor died of them.
- **Rules live at choke points, not call sites.** Cross-block selection endpoints normalize
  INSIDE `SelectionState.enterCrossBlock`/`extendFocus` — never construct endpoints around it.
  Commit event/snapshot paths are doc-absolute, minted by the scope factories
  (`block-edit-scope.ts`), asserted by G1.16 — never compose paths in a caller. Both seams
  exist because the call-site versions missed sites: two of the three 2026-07 corruption
  Criticals were entry paths that skipped a wrap five siblings carried. Since 0.9.24 the
  factory mints carry the `DocPath` brand; G1.16 stays the runtime belt for the op families
  that still compose paths legitimately.
- **DOM ↔ raw offset translation has one home** (`cursor/widget-offset.ts`, plus the ambient
  helpers). Offset arithmetic duplicated anywhere else will disagree with it eventually —
  every offset bug in the audit traced to arithmetic done outside the shared walk.
  Type-enforced since 0.9.24: the coordinate spaces are branded (G3.7, minted only at their
  single homes, G4.15) — cross-space arithmetic no longer compiles.
- **Registries are code, not state.** Register-once, throw-on-duplicate, no unregister
  (`customElements` model). Test isolation goes through the reset affordances; dev HMR of a
  registration module needs a page reload. This reaches the public API: a plugin author's suite
  can't re-install between cases without a sanctioned seam, so `aragonite/testing` exports
  `resetPluginPlatformForTests()` — and every new registration reachable from the public plugin
  surface must wire its reset into it, or the next author hits the dup-throw on their second
  `beforeEach`.

## The bug shape to fear: sibling-path parity

The dominant class of the 2026-07 audit — one rule enforced at N−1 of N sibling entry paths
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
  (`invariants/lint/`): "every entry path matching X routes through Y" fails the day path N+1 is
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
  it — in the commit message or requirement file. The generalized answers reshape the suite;
  three of them explained all ten audit bugs.

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

- `docs/issues.md` is the defect ledger — entries carry severity, files, and either a target
  or a why-deferred; **remove entries when shipped** (the file's own rule).
- Roadmap is forward-only; changelog is past-only; a shipping milestone moves between them in
  the same commit.
