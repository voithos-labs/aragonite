# The casebook

Eight times this editor corrupted something, or came close enough that the difference was luck.
Each incident is headed by the rule it bought. [`rules.md`](rules.md) is the short version and the
one to read first; this file is the evidence behind it, so the rules don't read as superstition.
Read it before your first structural change. These are the ways the codebase actually breaks, not
the ways I imagined it might.

Every entry ends with what now catches the mistake (a type error, or a dev-mode guard catalogued
in `docs/design/invariants.md`) and the spec that owns the full statement. "The audit" is the
2026-07 internal review that turned up most of these, which was a humbling fortnight.

## Node copies are re-read through the `$state` tree

Never hold a raw copy after the proxy has observed it. A node written into the `$state` tree comes
back as a proxy on every later read: same node, different JavaScript object, and only the proxy is
the one Svelte watches.

**Incident.** Svelte's ownership tracking corrupted keyed `{#each}` index assignments after
`splitBlock`. A copy spliced into the live tree isn't the node the tree hands back, and code that
kept the pre-splice reference wrote into an object nobody was rendering.

**Caught by:** before a write, copy the parents from the root down to the target, splice the
copies in, then re-read them through the tree. The functions in
`src/lib/tree-operations/unshare.ts` do the copy and the re-read for you, and Svelte reports a kept
copy the moment something compares it against the proxy, as `[svelte] state_proxy_equality_mismatch`
([`warnings.md`](warnings.md) § The proxy-versus-raw one). **Spec:** the
`src/lib/tree-operations/unshare.ts` header. ([rule 1](rules.md#the-five-rules))

## Snapshot-shared nodes are read-only on their bytes

An undo entry doesn't clone the document; it references the same nodes the live tree holds. So
copy the path before any byte write. The commit steps do that copying and hand each mutation an
owned view of its scope, which means you never write through a node reference captured before the
commit.

**Incident.** A mutation wrote serialized bytes through a node an undo entry still shared, which
rewrote history in place, and the corruption surfaced only at the undo that exposed it, far from
the commit that caused it.

**Caught by:** mostly a type. Readers hold bytes-readonly views, and `unshare.ts` is the only way
back to a writable node:

```ts
declare const view: NodeView; // what a reader outside the mutation layers holds
view.raw = 'rewritten\n';
// error TS2540: Cannot assign to 'raw' because it is a read-only property.
```

Running JS bypasses types, so a dev integrity check backs it up: it fingerprints each undo entry
when pushed and re-verifies at every commit and restore, which catches the write at the offending
commit instead of at the undo. **Spec:** `docs/design/invariants.md` (G1.9).
([rule 1](rules.md#the-five-rules))

## Reactive state crosses module boundaries as getters, never values

**Incident.** A value read does two things at once: it snapshots the value at effect-run time,
and it registers the state as a dependency of that effect (an effect: Svelte's re-run-on-change
block). The original re-init effect did both, so every mutation anywhere re-ran it and wiped
unrelated work. The same trap lives inside a commit's `landing`: read `deps.node` live when it
runs, because a capture taken before the commit is stale by construction. A delete-last-item caret
loss shipped exactly that way.

**Caught by:** a source scan over every `createBlockListState` call site (the factory every block
list's state comes from), which reds on a by-value argument:

```ts
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

**Caught by:** a source scan (`src/lib/test/invariants/lint/render-inlinecontent.test.ts`) that
pulls each render effect's body out and refuses the caching accessor inside it.
**Spec:** `docs/design/inline-parsing.md`. ([rule 1](rules.md#the-five-rules))

## Only `await tick()` for sequencing

Reaching for `setTimeout`, `rAF`, or a microtask trick means the operation flow underneath is
wrong and the timer is hiding it. The predecessor editor (an earlier attempt at this same editor,
before aragonite) died of exactly that.

**Caught by:** a source scan whose allowlist holds the few timers that order nothing (an
animation cadence, an undo debounce, a deadline), each with the reason it isn't sequencing. Any
other timer call reds it ([`rules.md`](rules.md) § The bug shape to fear: sibling-path parity shows
the row).

**Spec:** `docs/design/editor.md` § 11 (the commit's tick step) and § 16 (how the predecessor
died). ([rule 3](rules.md#the-five-rules))

## Rules live at choke points, not call sites

Two choke points exist precisely because their call-site versions kept missing sites. Cross-block
selection endpoints normalize inside the selection state's own `enterCrossBlock` / `extendFocus`,
and commit event and snapshot paths are doc-absolute (resolved from the document root, not from
whatever scope the caller was in), built by the scope factories. Never construct endpoints around
those two, and never compose a path in a caller.

**Incident.** Two of the audit's three worst corruption bugs were entry paths that skipped a wrap
five of their siblings carried.

**Caught by:** a type. A commit path is a `DocPath`, a branded type (a plain number array doesn't
type-check as one) built only through its named constructors (`asDocPath`, `extendDocPath`,
`docPathFrom`), which the scope factories call:

```ts
const composed: DocPath = [0, 1];
// error TS2322: Type 'number[]' is not assignable to type 'DocPath'.
```

A dev guard before every commit's mutation catches the JS callers the type can't reach (it's the
guard [`rules.md`](rules.md) shows as its example).

**Spec:** `docs/design/editor.md` § 11. ([rule 4](rules.md#the-five-rules), and
[§ sibling-path parity](rules.md#the-bug-shape-to-fear-sibling-path-parity))

## DOM to raw offset translation has one home

The DOM ↔ raw translation (raw: a node's verbatim source bytes, markers included) lives in
`src/lib/cursor/widget-offset.ts`. It turns a DOM position back into raw with `rawOffsetAt`, and
writes the selection from raw offsets: `placeCaretAtRaw` for a caret (which has to say whether it
clamps), `selectRawRange` and friends for a range. Offset math done anywhere else agrees with it
right up until it doesn't (a second walk once counted a widget by its text instead of its bytes).

**Incident.** Every offset bug in the audit traced to arithmetic done outside it.

**Caught by:** a type. The coordinate spaces are branded (a type-level tag that stops a raw offset
and a DOM offset being interchangeable numbers), so cross-space arithmetic doesn't compile:

```ts
declare const raw: RawOffset;
declare const dom: DomTextOffset;
const moved: RawOffset = raw + 1;
// error TS2322: Type 'number' is not assignable to type 'RawOffset'.
const crossed: RawOffset = dom;
// error TS2322: Type 'DomTextOffset' is not assignable to type 'RawOffset'.
```

The allowed conversions are named functions in `src/lib/cursor/coordinate-spaces.ts`
(`toRawOffset`, `toDomTextOffset`, and friends). A source scan also fails any native selection
write outside `widget-offset.ts`, apart from a few declared files that select nodes they already
hold.

**Spec:** `docs/design/editor.md` § 6. ([rule 4](rules.md#the-five-rules))

## Registries are code, not state

Register-once, throw-on-duplicate, no unregister (the `customElements` model), in production and
under test. Test isolation goes through the supported reset helpers, never through an unregister.

```ts
registerBlockKind('paragraph', {
	/* again */
});
// throws: registerBlockKind: "paragraph" is already registered. Kinds are register-once ...
```

**Incident.** Under a dev server, a re-evaluated registrar (a module whose import re-runs its
registrations, which hot reload and SSR both do) met the duplicate throw, and the throw took every
route down with a 500 until restart. So there, and only there, a duplicate registration replaces
with a `registry` diagnostic ([`warnings.md`](warnings.md)) instead of throwing; production and
test keep the throw.

A second one: the plugin test reset (`resetPluginPlatformForTests()`, from
`@voithos-labs/aragonite/testing`) once walked a hand-kept list of registries, and two were missing
from it, so a plugin suite saw its context-menu row duplicated per case. Hence:

- Build every registry in `src/lib/schema/plugin-registry.ts`. It signs the store up for the reset
  as it builds it (no list to forget), and only lets an entry through to an editor that lists the
  plugin it belongs to.
- A copy of a registry kept outside the store (highlight.js holds its own table of grammars) checks
  itself against the store on every read; `code-renderer.ts :: tokenizeBody` does it for the
  grammars.

**Caught by:** `src/lib/test/plugins/testing-barrel.test.ts`, which fails on a new public
`register*` or `declare*` without a reset probe, and a sweep of the live registries at editor mount
that checks they agree with each other (every built-in kind has a descriptor and a component,
every opener's kind has a descriptor, and so on).

**Spec:** the `src/lib/schema/register-once.ts`, `src/lib/schema/plugin-registry.ts` and
`src/lib/schema/registry-reset.ts` headers, and `docs/design/plugin-contract.md`.
([rule 4](rules.md#the-five-rules))
