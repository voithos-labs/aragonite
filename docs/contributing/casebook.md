# The casebook

Eight incidents, each headed by the rule it bought. These are the ways this codebase actually gets
corrupted, so read them before your first structural change. [`rules.md`](rules.md) is the short
version and the thing to read first; this file is its evidence.

Every entry names the guard that now catches it (G-numbers are entries in
`docs/design/invariants.md`) and the spec that owns the full statement. "The audit" is the 2026-07
internal review that produced most of them.

## Node copies are re-read through the `$state` tree

Never hold a raw copy after the proxy has observed it.

**Incident.** Svelte's ownership tracking corrupted keyed `{#each}` index assignments after
`splitBlock`. A copy spliced into the live tree is not the node the tree hands back, and code that
kept the pre-splice reference wrote into an object nobody was rendering.

**Guard:** G1.9's copy-path-on-write discipline. **Spec:** `tree-operations/unshare.ts` header.
([rule 1](rules.md#the-five-rules))

## Snapshot-shared nodes are read-only on their bytes

Copy the path before any byte write. The commit ceremony owns this and hands mutations an owned
view, so never write through a node reference captured before the commit.

**Incident.** An undo entry shares its nodes with the live tree. A mutation that wrote serialized
bytes through a shared node rewrote history in place, and the corruption only surfaced at the undo
that exposed it, far from the commit that caused it. A DEV integrity oracle now catches the
violation at the offending commit instead.

**Guard:** G1.9, type-enforced since 0.9.24: readers hold bytes-readonly views (G3.8) and the
unshare seam is the only way back to mutable (G4.13). The oracle stays the runtime belt.
**Spec:** `docs/design/invariants.md` (G1.9). ([rule 1](rules.md#the-five-rules))

## Reactive state crosses module boundaries as getters, never values

**Incident.** A value read snapshots at effect-run time AND registers the state as a dependency. The
original re-init effect did both, so every mutation wiped unrelated work. The same trap lives inside
`afterTick` callbacks: read `deps.node` live, because a pre-commit capture is stale by construction.
A delete-last-item caret loss shipped that way and survived until the audit.

**Guard:** G4.1 scans every call site. **Spec:** `docs/design/editor.md` § 7.
([rule 2](rules.md#the-five-rules))

## The render path computes inline content locally and reads no cache

**Incident.** A render effect that both read and wrote a reactive cache field closed a
write-during-read loop and corrupted keyed rendering. Non-render consumers use the accessor backed
by an external, non-reactive WeakMap; no reactive inline-cache field may exist.

**Guard:** G4.2. **Spec:** `docs/design/inline-parsing.md`. ([rule 1](rules.md#the-five-rules))

## Only `await tick()` for sequencing

**Incident.** `setTimeout` / `rAF` / microtask tricks are symptoms of a wrong operation flow rather
than a timing problem. The predecessor editor, the pre-aragonite attempt at this same editor (the
README's Origin story), died of them.

**Guard:** G4.4, whose allowlist holds the few genuine wall-clock uses (the undo debounce, the
regex-scan cancellation deadline, the frame-paced autoscroll and pointermove coalescing).
**Spec:** `docs/design/editor.md` § 11.
([rule 3](rules.md#the-five-rules))

## Rules live at choke points, not call sites

**Incident.** Cross-block selection endpoints normalize INSIDE the selection state's own
`enterCrossBlock` / `extendFocus`, and commit event/snapshot paths are doc-absolute, minted by the
scope factories. Both seams exist because the call-site versions missed sites: two of the three
corruption Criticals in the audit were entry paths that skipped a wrap five siblings carried. Never
construct endpoints around the seam, and never compose a path in a caller.

**Guard:** G1.16 for commit paths. Since 0.9.24 the factory mints carry the `DocPath` brand and the
op-family composers build through the branded helpers, with G1.16 the runtime belt for the JS
callers the type cannot reach. **Spec:** `docs/design/editor.md` § 11.
([rule 4](rules.md#the-five-rules), and
[§ sibling-path parity](rules.md#the-bug-shape-to-fear-sibling-path-parity))

## DOM to raw offset translation has one home

The DOM ↔ raw translation lives in `cursor/widget-offset.ts`, plus the ambient helpers.

**Incident.** Offset arithmetic duplicated anywhere else disagrees with the shared walk eventually.
Every offset bug in the audit traced to arithmetic done outside it.

**Guard:** type-enforced since 0.9.24, the coordinate spaces being branded (G3.7) and minted only at
their home modules (G4.15), so cross-space arithmetic no longer compiles.
**Spec:** `docs/design/editor.md` § 4. ([rule 4](rules.md#the-five-rules))

## Registries are code, not state

Register-once, throw-on-duplicate, no unregister (the `customElements` model), in production and
under test.

**Incident.** Test isolation goes through the reset affordances rather than an unregister. Under a
dev server a duplicate registration replaces with a note instead of throwing, so a re-evaluated
registrar survives instead of 500-ing every route (the SSR poison class); the contract is unchanged
where it is observed, since prod and test still throw. This reaches the public API: a plugin
author's suite cannot re-install between cases without a sanctioned seam, so `aragonite/testing`
exports `resetPluginPlatformForTests()`, and every new registration reachable from the public plugin
surface must wire its reset into it, or the next author hits the dup-throw on their second
`beforeEach`.

**Guard:** the registry coherence family, G1.2, G1.10, G1.17 and G1.18, sweeps the live registry at
the mount flush. **Spec:** `src/lib/schema/register-once.ts` header and
`docs/design/plugin-contract.md`. ([rule 4](rules.md#the-five-rules))
