# The casebook

Eight times this editor corrupted something, or came close enough that the difference was luck.
Each incident is headed by the rule it bought. Nobody would've believed the rule without the
incident, which is the whole reason this file exists.

[`rules.md`](rules.md) is the short version and the one to read first; this file is the evidence
behind it, so the rules don't read as superstition. Read it before your first structural change,
because these are the ways the codebase actually breaks, not the ways I imagined it might.

Every entry ends the same way: the guard that now catches the mistake (guards carry G-numbers,
catalogued in `docs/design/invariants.md`), shown as the line that fires or the type error it
became wherever the code has one, and the spec that owns the full statement. "The audit" is the
2026-07 internal review that turned up most of these, which was a humbling fortnight.

## Node copies are re-read through the `$state` tree

Never hold a raw copy after the proxy has observed it. A node written into the `$state` tree comes
back as a proxy on every later read: same node, different JavaScript object, and only the proxy is
the one Svelte watches.

**Incident.** Svelte's ownership tracking corrupted keyed `{#each}` index assignments after
`splitBlock`. A copy spliced into the live tree isn't the node the tree hands back, and code that
kept the pre-splice reference wrote into an object nobody was rendering.

**Guard:** G1.9's copy-path-on-write discipline (before a write, copy the parents from the root
down to the target, splice the copies in, then re-read them through the tree). The unshare seam (a
seam: a boundary where responsibility changes hands from one piece of code to another; this one is
where a shared node gets copied before a write) does the copy and the re-read for you, and Svelte
reports a kept copy the moment something compares it against the proxy, as
`[svelte] state_proxy_equality_mismatch` ([`warnings.md`](warnings.md) § The proxy-versus-raw
one). **Spec:** the `src/lib/tree-operations/unshare.ts` header. ([rule 1](rules.md#the-five-rules))

## Snapshot-shared nodes are read-only on their bytes

An undo entry doesn't clone the document; it references the same nodes the live tree holds. So
copy the path before any byte write. The commit ceremony (the fixed steps every commit runs) owns
that copying and hands each mutation an owned view of its scope, so never write through a node
reference captured before the commit.

**Incident.** A mutation wrote serialized bytes through a node an undo entry still shared, which
rewrote history in place, and the corruption surfaced only at the undo that exposed it, far from
the commit that caused it. A DEV integrity oracle (it fingerprints each snapshot when pushed and
re-verifies at every commit and restore) now catches the violation at the offending commit
instead.

**Guard:** G1.9, and since 0.9.24 mostly a type: readers hold bytes-readonly views (G3.8), and
the unshare seam is the only way back to mutable (G4.13). The oracle stays as the runtime
backstop, because running JS bypasses types. The type half, as `tsc` reports it:

```ts
declare const view: NodeView; // what a reader outside the mutation layers holds
view.raw = 'rewritten\n';
// error TS2540: Cannot assign to 'raw' because it is a read-only property.
```

And the runtime half, at every commit (on the freshest undo entry, the one this commit could have
corrupted) and again at every restore:

```ts
// src/lib/invariants/install.ts
assertInvariant('snapshot-integrity', () => checkSnapshotIntegrity(entry));
```

**Spec:** `docs/design/invariants.md` (G1.9). ([rule 1](rules.md#the-five-rules))

## Reactive state crosses module boundaries as getters, never values

**Incident.** A value read does two things at once: it snapshots the value at effect-run time,
and it registers the state as a dependency of that effect (an effect: Svelte's re-run-on-change
block). The original re-init effect did both, so every mutation anywhere re-ran it and wiped
unrelated work. The same trap lives inside `afterTick` callbacks: read `deps.node` live when the
callback runs, because a capture taken before the commit is stale by construction. A
delete-last-item caret loss shipped exactly that way and survived until the audit.

**Guard:** G4.1 scans every `createBlockListState` call site (the factory every block list's
state comes from) and reds on a by-value argument. From the scan's own self-test:

```ts
// src/lib/test/invariants/lint/createblockliststate-getters.test.ts
createBlockListState(node); // flagged: a snapshot taken at factory-call time
createBlockListState(() => node); // accepted: re-read on every use
```

**Spec:** `docs/design/editor.md` § 7. ([rule 2](rules.md#the-five-rules))

## The render path computes inline content locally and reads no cache

**Incident.** A render effect both read and wrote a reactive cache field, which closed a
write-during-read loop and corrupted keyed rendering.

The fix's shape is the rule: the render path computes its inline content fresh, consumers outside
rendering use the accessor backed by an external, non-reactive WeakMap, and no reactive
inline-cache field may exist on any node.

**Guard:** G4.2, a source scan over the two render files and the two render effects, which pulls
each effect's body out and refuses the caching accessor inside it:

```ts
// src/lib/test/invariants/lint/render-inlinecontent.test.ts
it('TextEditableBlock render $effect does not call getInlineContent', () => {
	const file = readEditorFile(TEXT_BLOCK_FILE);
	const effect = extractRenderEffect(file.text);
	// Fail loud if the anchor vanished: a silent pass leaves the render path unguarded.
	expect(effect, 'render $effect anchor "textRender.render" not found').not.toBeNull();
	expect(callsCachingAccessor(effect!)).toBe(false);
});
```

**Spec:** `docs/design/inline-parsing.md`. ([rule 1](rules.md#the-five-rules))

## Only `await tick()` for sequencing

Reaching for `setTimeout`, `rAF`, or a microtask trick means the operation flow underneath is
wrong and the timer is hiding it. The predecessor editor, the pre-aragonite attempt at this same
editor (the README's Origin section), died of exactly that.

**Guard:** G4.4, a source scan whose allowlist holds the five genuine wall-clock uses, each with
the reason it isn't sequencing. Any other timer call reds the scan.

```ts
// src/lib/test/invariants/lint/timing-hacks.test.ts
const ALLOWLIST: Record<string, string> = {
	'src/lib/selection/autoscroll.ts': 'rAF autoscroll loop (frame cadence)',
	'src/lib/selection/pointer-session.ts': 'rAF pointermove coalescing (shared drag session)',
	'src/lib/editor-actions/commit/text-batch.ts': 'setTimeout wall-clock undo debounce',
	'src/lib/search/regex-executor.ts': 'setTimeout regex-scan cancellation deadline',
	'src/lib/plugins/parrot/ParrotBlock.svelte': 'setInterval parrot frame cadence'
};
```

**Spec:** `docs/design/editor.md` § 11 (the ceremony's tick step) and § 16 (how the predecessor
died). ([rule 3](rules.md#the-five-rules))

## Rules live at choke points, not call sites

Two seams exist precisely because their call-site versions kept missing sites. Cross-block
selection endpoints normalize INSIDE the selection state's own `enterCrossBlock` / `extendFocus`,
and commit event/snapshot paths are doc-absolute (resolved from the document root, not from
whatever scope the caller was in), built by the scope factories. Never construct endpoints around
the seam, and never compose a path in a caller.

**Incident.** Two of the three corruption Criticals in the audit (Critical: the audit's top
severity) were entry paths that skipped a wrap five of their siblings carried.

**Guard:** G1.16 for commit paths. Since 0.9.24 the factories mint the `DocPath` brand (minted:
created only by the one authorized place) and the op-family composers build through the branded
helpers, with G1.16 as the runtime backstop for the JS callers the type can't reach. The two
halves:

```ts
const composed: DocPath = [0, 1];
// error TS2322: Type 'number[]' is not assignable to type 'DocPath'.
```

```ts
// src/lib/invariants/install.ts, before every commit's mutation
assertInvariant('commit-path-dialect', () =>
	checkCommitPathAddressable(doc, eventPath, 'eventPath')
);
```

**Spec:** `docs/design/editor.md` § 11. ([rule 4](rules.md#the-five-rules), and
[§ sibling-path parity](rules.md#the-bug-shape-to-fear-sibling-path-parity))

## DOM to raw offset translation has one home

The DOM ↔ raw translation (raw: a node's verbatim source bytes, markers included) lives in
`src/lib/cursor/widget-offset.ts`, plus the ambient helpers that wrap it for the marker a container
lends its first child. Offset arithmetic duplicated anywhere else agrees with the shared walk right
up until it doesn't.

**Incident.** Every offset bug in the audit traced to arithmetic done outside it.

**Guard:** type-enforced since 0.9.24: the coordinate spaces are branded (G3.7), a type-level tag
that stops a raw offset and a DOM offset being interchangeable numbers, and the brands are created
only at their home modules (G4.15), so cross-space arithmetic no longer compiles:

```ts
declare const raw: RawOffset;
declare const dom: DomTextOffset;
const moved: RawOffset = raw + 1;
// error TS2322: Type 'number' is not assignable to type 'RawOffset'.
const crossed: RawOffset = dom;
// error TS2322: Type 'DomTextOffset' is not assignable to type 'RawOffset'.
```

The conversions that are allowed are named functions in `src/lib/cursor/coordinate-spaces.ts`
(`toRawOffset`, `toDomTextOffset`, and friends), one per direction. **Spec:**
`docs/design/editor.md` § 6. ([rule 4](rules.md#the-five-rules))

## Registries are code, not state

Register-once, throw-on-duplicate, no unregister (the `customElements` model), in production and
under test. Test isolation goes through the sanctioned reset helpers, never through an unregister.

```ts
registerBlockKind('paragraph', {
	/* again */
});
// throws: registerBlockKind: "paragraph" is already registered. Kinds are register-once ...
```

**Incident.** Under a dev server, a re-evaluated registrar (a module whose import re-runs its
registrations, which hot reload and SSR both do) met the duplicate throw, and the throw poisoned
every route with a 500 until restart: the SSR poison class. So there, and only there, a duplicate
registration replaces with a console note instead of throwing (a `registry` diagnostic, in
[`warnings.md`](warnings.md)'s terms); production and test keep the throw, so the contract is
unchanged everywhere it's observed.

The same no-unregister rule reaches the public API. A plugin author's suite can't re-install
between cases without a sanctioned seam, so `@voithos-labs/aragonite/testing` exports
`resetPluginPlatformForTests()`, and every new registration reachable from the public plugin
surface must wire its reset into it, or the next author hits the duplicate throw on their second
`beforeEach`.

**Guard:** the registry coherence family (G1.2, G1.10, G1.17, G1.18) sweeps the live registry in
the registration-check flush at editor mount, one guard call per check (trimmed):

```ts
// src/lib/schema/registration-checks.ts :: flushPendingRegistrationChecks
report('registry-completeness', () =>
	checkRegistryCompleteness(ALL_BLOCK_KINDS, hasDescriptor, hasComponent)
);
report('opener-registry', () => checkOpenerRegistry(listRegisteredOpeners(), hasDescriptor));
```

**Spec:** the `src/lib/schema/register-once.ts` header and `docs/design/plugin-contract.md`.
([rule 4](rules.md#the-five-rules))
