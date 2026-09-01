# Testing Your Plugin

The testing half of the plugin story: what to check once your block works, and the tools your suite imports from `@voithos-labs/aragonite/testing` to check it. Three neighbouring docs carry what this one leans on:

- [plugin-guide.md](plugin-guide.md): building the plugin in the first place. The `%%parrot` block and the `:::conspiracy` container below are its running examples.
- [plugin-api.md](plugin-api.md): the catalog of every authoring export, if a name below reads unfamiliar.
- [consumer-guide.md](consumer-guide.md): the editor's props and instance methods; the mounting section below uses both.

And a map, so you can jump straight at your question:

| Section                                                                   | What it covers                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Round-trip is the contract](#round-trip-is-the-contract)                 | The three byte checks to write first: without an editor, in a live one, and with your plugin uninstalled |
| [A blank slate per test](#a-blank-slate-per-test)                         | Why a plugin registers only once per process, and the reset that lets a test suite live with that        |
| [Turning warnings into failures](#turning-warnings-into-failures)         | Making the editor's dev-mode warnings fail your suite instead of scrolling by                            |
| [Proving a paste transform is wired](#proving-a-paste-transform-is-wired) | Driving the real paste pipeline over a string, no clipboard involved                                     |
| [Mounting the editor under jsdom](#mounting-the-editor-under-jsdom)       | Rendering your component in a simulated browser, and the helper that fills the gaps                      |
| [The conformance kits](#the-conformance-kits)                             | The checks the built-in blocks are held to, pointed at yours, and the vocabulary the three kits share    |
| [The kind checkup](#the-kind-checkup-runkindconformance)                  | The checks every block kind owes: bytes survive, one edit is one undo step, copying invents nothing      |
| [The container checkup](#the-container-checkup-runcontainerconformance)   | Extra checks for a block that holds other blocks, starring the body line that ends the container early   |
| [The inline checkup](#the-inline-checkup-runinlinekindconformance)        | Checks for syntax recognized mid-sentence: claiming your own bytes, declining everyone else's            |

## Verifying your plugin

A plugin can look perfect on screen and still be quietly eating bytes, and in a lossless editor that is the only class of bug that really matters. Screenshots prove nothing here. Verify the damn bytes.

The proof comes in three layers, cheapest first, and this doc walks them in order:

1. **Round-trip checks you write yourself.** Parse, serialize, compare. A few lines, no editor mounted.
2. **The editor's own warnings, turned into failures.** A dev build already watches your plugin for contract violations; a suite can fail on them.
3. **The conformance kits.** The same checks every built-in block kind is held to, pointed at your kind. You supply fixtures; the kit supplies the suspicion.

Everything test-specific imports from one subpath, `@voithos-labs/aragonite/testing`, and each export gets its section below.

### Round-trip is the contract

The editor saves a document by concatenating each block's exact source bytes, so the one promise your plugin must keep is `serialize(parse(source)) === source`. Check it three ways:

**Headless.** `parse` and `serialize` both ship on `@voithos-labs/aragonite/plugin`, so the core check needs no editor at all:

```ts
import { parse, serialize } from '@voithos-labs/aragonite/plugin';

expect(serialize(parse(MY_SOURCE))).toBe(MY_SOURCE);
```

**Live.** Mount an editor over a document that uses your syntax (the [mounting section](#mounting-the-editor-under-jsdom) shows how), read it back with `editor.getSource()`, and compare bytes with what you authored.

**Uninstalled.** Author a document using your syntax, then load it with your plugin **not** registered. The generic fallback must return it byte for byte, so uninstalling a plugin never corrupts a saved document. A `%%parrot` file opened without the parrot plugin renders as plain text: no dancing, but no damage.

While you iterate, keep a dev build running (`vite dev`) and watch the console. The editor's shape checks ([misuse outcomes](plugin-guide.md#misuse-outcomes)) fire only there: a `rebuildRaw` byte mismatch, an opener that disagrees with the lines it consumed, a collapse probe that contradicts the descriptor. All of them warn in dev and are silent in production, so a clean dev console over a green round-trip is the signal your plugin is sound. A suite can hold that line automatically; [turning warnings into failures](#turning-warnings-into-failures) is the recipe.

### A blank slate per test

The plugin platform is register-once: setup writes into process-global registries that throw on a duplicate and never unregister. A test runner reuses one process across cases, so a plugin installed in a second `beforeEach` would collide with the first. One export exists for exactly this.

**`resetPluginPlatformForTests()`**

Empties every registry a plugin writes into, so each case re-installs from nothing. Call it, then re-install your plugin's **unit**, the installable package `definePlugin` or `definePluginBlock` returns:

```ts
import { installPlugins } from '@voithos-labs/aragonite';
import { resetPluginPlatformForTests } from '@voithos-labs/aragonite/testing';
import { parrotPlugin } from './parrot-plugin';

const parrot = parrotPlugin(); // one unit instance for the whole file

beforeEach(() => {
	resetPluginPlatformForTests(); // empty the registries
	installPlugins([parrot]); // the unit, exactly as the `plugins` prop installs it
});
```

What that clears, and what it deliberately does not:

- Cleared: every non-built-in registration. Kinds, components, openers, completers, commands and keymaps, the inline syntax and widget registries, the paste surfaces and transform pipelines, the `:::` directive registry, and the installed-plugin set.
- Built-in registrations survive, exactly as in production. One exception: paste surfaces are wiped whole, built-ins included, so a case that pastes into a built-in block after a reset must re-register or skip the reset. Parse and round-trip cases are unaffected.
- Runtime state is untouched: the undo stack, the selection, and any live document are yours to set up.
- It is test-only and throws outside a detected test environment. Detection is Vitest-specific, so a suite on another runner opts in first with `configureEditorEnv({ isTest: true })` and restores the detected defaults with `resetEditorEnv()`.

**Install the unit, not your register function.** `definePluginBlock` generates a setup that runs your `register` step and then binds the component, so calling your own `registerParrotBlock()` here leaves the kind without a component: the editor falls back to a raw-text surface with a dev warning, and your tests pass against a block that is not yours. Three more identity rules keep a suite honest:

- Installing the **same unit instance** twice (the `beforeEach` above plus an editor's `plugins` prop, say) is a no-op, which is why the sample builds `parrot` once at module scope.
- A **different instance under the same name** is kept out by a first-wins rule, with a dev warning naming the loser.
- Calling your register function directly **beside** a unit install makes the unit's setup re-register your kind, which **throws**. The register-once throw stays live under test on purpose, so the collision fails your suite instead of silently winning.

### Turning warnings into failures

The editor reports contract violations it can contain, rather than crash on, as dev warnings under an `[aragonite:…]` console head. A suite that wants those red rather than scrolling past registers a sink:

```ts
import { setDevWarnSink } from '@voithos-labs/aragonite/testing';

const fires = [];
beforeEach(() => setDevWarnSink((entry) => fires.push(entry)));
afterEach(() => {
	setDevWarnSink(null);
	expect(fires.splice(0)).toEqual([]); // a guard fired and nobody claimed it
});
```

`setDevWarnSink` returns the sink it replaced, so a nested harness can restore rather than clear. While a sink is registered it takes reporting over completely: nothing reaches the console, and each entry carries the guard's `tag`, its `message`, and any `details`.

One prerequisite, or the gate is green because it is blind: warnings emit only while the editor believes it is in a dev build. A Vitest suite gets that automatically, because its build resolves the dev flag. Under another runner, or a bundler that resolves no export conditions, call `configureEditorEnv({ isDev: true })` in your setup (add `isTest: true` if the suite also uses the reset) and `resetEditorEnv()` in teardown.

### Proving a paste transform is wired

`registerPasteTransform` writes into a registry nothing else on the public surface reads, so the subpath ships the driver: `applyPasteTransforms(text)` is the very function every clipboard-to-parse route runs. Driving it proves your transform is **wired**, not merely that your pure function works:

```ts
import { applyPasteTransforms } from '@voithos-labs/aragonite/testing';

it('converts on paste', () => {
	expect(applyPasteTransforms(CLIPBOARD_TEXT)).toBe(CONVERTED_TEXT);
});
```

(The plugin is installed by the `beforeEach` from [a blank slate per test](#a-blank-slate-per-test); the transform rides along with the rest of the unit's setup.)

### Mounting the editor under jsdom

A component is only really verified mounted, and a jsdom mount is a supported way to do it. Three things stand in the way; two are jsdom gaps, and `installEditorDomStubsForTests` closes both by stubbing the browser APIs a mounted editor calls and jsdom lacks (`ResizeObserver` and `scrollIntoView`), each only where absent, so the call is inert in a real browser:

```ts
// @vitest-environment jsdom
import { mount, flushSync } from 'svelte';
import { Editor } from '@voithos-labs/aragonite';
import { installEditorDomStubsForTests } from '@voithos-labs/aragonite/testing';

installEditorDomStubsForTests();

const target = document.body.appendChild(document.createElement('div'));
const editor = mount(Editor, { target, props: { source: MY_SOURCE, plugins, scrollMode: 'host' } });
flushSync(); // the first render has to land before you can assert on it
```

`scrollMode: 'host'` is the third thing: it drops the editor's own scroll container and the chrome a jsdom box cannot size anyway ([host scroll mode](consumer-guide.md#host-scroll-mode)). And keep the fixture document short. The editor stops mounting blocks past an estimated-height budget in either scroll mode, jsdom reports a zero-height viewport, and a fixture tall enough to trip that unmounts the very block you are asserting on. From there `target.querySelector` reaches your component's own markup and `editor.getSource()` is a byte-exact assertion surface.

### The conformance kits

Conformance here means: your kind behaves the way the built-in kinds are required to behave, under the same checks. Three kits ship on the subpath, one per tier (block kind, container, inline syntax), and they share a vocabulary:

- Each kit runs **cells**, one check per behavior, and each cell is covered one of three ways. `assert` runs the real check. `exempt` means the invariant has nothing to bite on for your kind (there is no such operation to test). `boundary` means checking it needs something headless code cannot reach (a browser, a mounted component).
- An excused cell is **declared, never skipped**, and both excuse modes demand a reason that is a real sentence; a bare token fails the run. An excuse the kit can falsify, it falsifies.
- Every kit resolves with a report of what was asserted and what was excused, and throws a plain `Error` naming every failed cell otherwise, so a run drops straight into a test case under any runner.

### The kind checkup: `runKindConformance`

**`runKindConformance(kind, profile?)`**

Takes your kind (the value `declaredPluginKind` returns) and executes the headless half of its `closure` block, the descriptor field where every kind answers the cross-cutting editor systems ([the closure block](plugin-guide.md#the-closure-block)). One cell per system, derived from your declarations and your `conformanceFixture`. What runs now, with no browser:

- The fixture round-trips, and a kind declaring `rebuildRaw` also has it checked twice over: it re-emits the parsed bytes exactly, and it emits the same bytes on every run.
- Backspace-merge eligibility is held to your declared `mergeRole`.
- A `clipboard: inherit-default` cell proves a copy is a plain byte slice, with your kind exercised at both ends of the selection sweep.
- An `undo: inherit-default` cell proves one structural operation pushes exactly one undo entry.
- A `searchPaint: not-supported` cell proves the document scan genuinely finds nothing in your kind.

Cells whose mechanism only exists in a browser (focus, selection and search painting, reorder, the simulation oracle) are recorded `boundary`, never stubbed green; a browser conformance sweep enrolls every registered kind that declares a `conformanceFixture` and drives those in a real browser. For the parrot, the whole checkup is the test the [guide's quickstart](plugin-guide.md#the-first-fifteen-minutes) ends on:

```ts
it('parrot conforms', async () => {
	await runKindConformance(declaredPluginKind(PARROT));
});
```

**The fixture contract.** Your `conformanceFixture` must hold your kind inside its **first** top-level block, or the run fails outright: the undo and clipboard cells drive the fixture's first block and ride a throwaway neighbour block the kit adds beside it (after it for the undo cell, on each side in turn for the clipboard cell). A kind that only ever appears nested still enrolls, seated inside the first block; its clipboard cell then reports `boundary`, because its bytes are copied as part of the enclosing container.

Where a cell claims a mechanism the runner cannot reach generically (a kind-specific copy, say), supply the check yourself: `runKindConformance(kind, { cells: { clipboard: { check: async (ctx) => … } } })`, where `ctx` hands you the parsed fixture and your kind's node. A custom check is accepted only on a cell declared `implemented`; anywhere else it would contradict the declaration and silence the executor for the mode you declared.

The clipboard executor is also exported on its own as `checkCopyIsRawByteSlice(kind, fixture)`, for driving that one check directly in a regression test.

### The container checkup: `runContainerConformance`

**`runContainerConformance(kind, profile)`**

The harness the built-in containers are held to, pointed at your own container kind. The profile carries your fixtures plus a coverage declaration per cell; the kit parses its way to your kind, so register the plugin before running it. The cells:

| Cell                  | What it holds you to                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localIndex`          | Children are addressed by their index inside your container at each nesting level, not by a document-wide count                                                                                                                                                                                                                                                |
| `ancestry`            | An edit deep inside rebuilds bytes innermost-first, so the outermost block's raw reflects the leaf change                                                                                                                                                                                                                                                      |
| `multiScope`          | One operation spanning two nesting levels pushes exactly one undo entry. The kit only owns such an operation for the built-in list and table, so a plugin kind declares this cell `exempt`                                                                                                                                                                     |
| `focusBubble`         | A focus move leaving your top edge reaches the document root exactly once, with no loop and no double-escape                                                                                                                                                                                                                                                   |
| `terminatorCollision` | A body line reproducing your container's own closing line stays inside the container                                                                                                                                                                                                                                                                           |
| `declarations`        | The kit's own cell, always on. Your `unwrapRole` names strategies that exist, `containerPaste` is shaped right, `rebuildRaw` re-emits the parsed bytes and answers its changed-child shortcut with the same bytes as a full rebuild, `bodyWrap` matches what your parse does, and a declared `contentStartSpace` gives the user's space back on a content line |

You supply the fixtures. For the guide's `:::conspiracy` container ([the walkthrough](plugin-guide.md#walkthrough-a-conspiracy-container-end-to-end)), a full profile looks like this:

```ts
import { declaredPluginKind } from '@voithos-labs/aragonite/plugin';
import { runContainerConformance } from '@voithos-labs/aragonite/testing';

it('the conspiracy container conforms', async () => {
	await runContainerConformance(declaredPluginKind('conspiracy'), {
		// A nesting where your kind is an ancestor of a deep editable leaf.
		deepNesting: {
			source: ':::conspiracy The moon is a hologram\n> projected from a warehouse in Nevada\n:::\n',
			leafPath: [0, 1, 0]
		},
		// The chain of container indices down to your kind, and which child to edit.
		// Nested fences need the outer one longer, hence the four colons.
		localIndexFixture: {
			source:
				'::::conspiracy Big Bird is three kids in a coat\neyewitness sketch\n:::debunked The coat theory\nwool receipts\nthe coat has an alibi\n:::\n::::\n',
			containerChain: [0, 2],
			targetChild: 2
		},
		focusSource: ':::conspiracy Elvis works at the DMV\nhe renews his own license\n:::\n',
		// Body bytes carrying a line that reproduces the terminator. Evidence that
		// ends the conspiracy: very on brand.
		terminatorCollisionFixture: {
			source: ':::conspiracy Birds are drones\nthey never land near me\n:::\n',
			bodyRaw: 'exhibit A\n:::\nexhibit B never made it out\n'
		},
		localIndex: { mode: 'assert' },
		ancestry: { mode: 'assert' },
		multiScope: { mode: 'exempt', reason: 'no conspiracy op edits two nesting levels at once; every edit lands in one child' },
		focusBubble: { mode: 'assert' },
		terminatorCollision: { mode: 'assert' }
	});
});
```

Two notes on those fixtures. `localIndexFixture` must edit a non-first child **or** descend through a non-zero chain position; at chain `[0, 0]`, child 0, a local path and a flat global offset are the same number and the check proves nothing (the fixture above does both, since Big Bird deserves rigor). And `terminatorCollisionFixture.bodyRaw` names the bytes a **user types**, not the bytes that reach the tree: the kit writes them through your `bodyWrite` rule, the same route a real commit uses.

**`terminatorCollision` is the cell most container authors have not considered**, and the profile type requires a declaration, so a profile written before the cell existed stops compiling until you answer it. If your container wraps body bytes between an opener and a closing line, a body line that reproduces that closing line ends it early, and everything below leaves the container the next time the document is parsed. Byte round-trip cannot catch it: the bytes are re-emitted verbatim either way, and only the live tree disagrees with them, which is why this cell's oracle is convergence (the live tree must agree with a fresh parse of its own bytes) rather than a byte comparison.

Whether you may excuse it, and how to fix a real collision, depends on your terminator's shape:

- **Fence-shaped** terminators escalate: the `:::` containers lengthen their fence past the body's runs, and the editor does that for you, so the conspiracy above asserts the cell and passes without writing a line.
- A **strip** container (one that prefixes every line it emits, the blockquote shape) is immune, and is the one shape allowed to declare the cell `exempt`. An opaque container may not: the `declarations` cell fails a profile that tries.
- A **fixed-token** terminator, an HTML close tag say, can neither escalate nor prefix; it repairs the collision with [`bodyWrite`](#making-body-bytes-legal-bodywrite), rewriting the offending bytes on the way **in**, so the child's own raw carries the rewrite and nothing diverges.
- A **childless** container whose body lives in metadata supplies the optional `writeBody` on the fixture, so the collision probe reaches a body no child carries.

Escaping at the rebuild is the one repair that does not work, and it is the tempting one: an opaque container's raw is checked against its live children, so rewriting a child on the way out reads as staleness. The write sink is early enough that no such gap exists.

Two things finish the profile. A profile must keep at least one asserting behavioral cell, or excuse itself whole through the optional `wholeProfileExemption`, with the same real-sentence reason bar and only when no cell asserts. And one companion is worth a line in the same test: `reversedAncestryLeavesRootStale(profile)` must be `true` for a container whose `rebuildRaw` reads only its direct children. It rebuilds outermost-first on purpose and checks the root went stale, which is what proves your `ancestry` cell tests something rather than passing by construction; a container that re-derives its whole subtree from scratch returns `false`, and excuses `ancestry` instead.

#### Declaring the wrap: `bodyWrap`

A container whose opener parses its body through `parseContainerBody` declares the same wrap as `container.bodyWrap`, and the `declarations` cell probes your parse in both directions, failing a declaration that does not match what the parse actually does. Why the editor needs to be told at all:

- The parse peels the blank line against your opener into `innerPrefix`, so that line belongs to the wrap rather than being an empty first row. The editor's blank-line bookkeeping has to know that, or a delete that frees a blank line above your body's first block eats the line the peel owns, and that block disappears on the next load.
- A strip container whose body starts at its own first line declares nothing, and must then carry no `innerPrefix` either: the node-shape guard fails a wrap-less container that fills that slot.
- A childless container whose body lives in metadata has no body child to peel a line from, so it declares nothing too, and the kit fails a declaration there as well.

#### Making body bytes legal: `bodyWrite`

A container kind declares `bodyWrite` when its body's bytes can carry grammar the container itself owns:

```ts
container: {
	contract: 'opaque',
	rebuildRaw: rebuildMyRaw,
	bodyWrite: {
		normalize: (raw) => /* raw, made legal as a child of this container */,
		mapOffset: (raw, offset) => /* where a caret at `offset` ends up after that */
	}
}
```

`normalize` runs over every byte destined for the body, at the tree-operation write sinks, **ahead of the reparse that decides the child's kind**. That order is what makes it work where a rebuild-time rewrite cannot: the kind a write lands on is the kind its committed bytes describe. Two rules bind it:

- **Idempotent**: re-committing already-legal bytes changes nothing.
- **Line-local**: it may read the whole raw to decide which lines to rewrite, but it never moves bytes across a line boundary.

`mapOffset` is the rewrite's caret image: where a caret sitting at some offset in the typed bytes ends up in the committed ones. The pair ships as one object because a rewrite without its caret image strands the caret.

Two rules of thumb from the bundled `details` container. Ask the **grammar**, not your own spelling: what breaks that container is everything the Markdown spec hands to raw-HTML passthrough, indented, upper-cased and trailing-space spellings included, which is looser than the canonical form your `rebuildRaw` emits, and `htmlBlockTagLineMatcher` from `@voithos-labs/aragonite/plugin` answers that question for a tag name. And rewrite the **minimum**: `details` escapes one `<` to `&lt;`, which renders as the literal tag both in the editor and on GitHub while matching no tag line, so the author still sees what they typed.

### The inline checkup: `runInlineKindConformance`

**`runInlineKindConformance(profile)`**

The same idea one layer down: register your rung (one level in the ordered ladder of recognizers consulted for your trigger), then point the kit at it and it drives the behaviors a rung can break without moving a byte. The profile's fields, before the cells:

- `trigger`: the single character you registered on.
- `prefix`: your multi-character opener. Omit it for a bare-trigger registration.
- `priority`: only when two rungs share a prefix at different priorities; it says which one is yours.
- `kind`: the inline kind you mint (minted: created by the one authorized place; a duplicate throws). Omit it for a recognizer that only builds built-in nodes over its own bytes.
- `fixtures`: single-line sources your recognizer claims; `overlapFixtures`: sources it must decline (the star cell below).

The cells:

| Cell             | What it holds you to                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claims`         | Every fixture you supply is actually claimed by **your** recognizer, starting at your own prefix                                                                      |
| `roundTrip`      | Your fixtures, and the kit's interleavings of them with other syntax, round-trip, and your claims tile the scanned range with no gap                                  |
| `overlapDecline` | Where your prefix also opens something the built-in scanner owns, you decline it                                                                                      |
| `widget`         | Your claimed bytes are one atomic unit, and your rendered widget spans exactly the bytes it stands for                                                                |
| `editingPolicy`  | Your widget's editing declaration exists, is in the vocabulary the caret-edge dispatch actually reads, and (for one-press delete) leaves bytes behind that round-trip |
| `imageClaim`     | A rung whose recognizer builds built-in nodes carries the `rewriteImage` hook the write paths need                                                                    |
| `registration`   | Your rung is actually registered where your profile says it is                                                                                                        |

`claims`, `roundTrip`, and `registration` always run; the other four you declare. For the [guide's](plugin-guide.md#inline-kinds) `![[…]]` embed, in the variant that mints its own kind:

```ts
import { runInlineKindConformance } from '@voithos-labs/aragonite/testing';

it('the embed recognizer conforms', () => {
	runInlineKindConformance({
		trigger: '!',
		prefix: '![[',
		kind: declaredPluginInlineKind(EMBED),
		fixtures: ['![[cat.png]]', 'see ![[cat.png|300]] here'],
		overlapFixtures: ['![[a]](https://x.dev)'],
		overlapDecline: { mode: 'assert' },
		widget: { mode: 'assert' },
		editingPolicy: { mode: 'assert' },
		imageClaim: { mode: 'exempt', reason: 'this recognizer builds only its own kind, never a built-in one' }
	});
});
```

(The guide's other embed variant builds real built-in images; that one asserts `imageClaim` instead, and excuses `widget` and `editingPolicy`, since a built-in kind renders through the built-in widget.)

`fixtures` is required and non-empty, and a fixture your recognizer does not claim **fails** rather than being skipped: every cell reads the nodes a fixture produces, so an unclaimed one would enroll your syntax without testing it.

**`overlapDecline` is the cell most inline authors have not considered, and on a reserved trigger it is required.** Registering on a trigger the built-in scanner owns (`[`, `!`, `*`, `` ` ``, and friends) puts your recognizer ahead of the built-in case, so wherever your prefix matches you are claiming those bytes whether or not they spell something the built-in owns. `![[a]](https://x.dev)` is a plain image whose alt text is `[a]`; a recognizer that claims every `![[…]]` takes it, and the document still round-trips, as a wiki embed nobody ever wrote. Supply the sources where your grammar and a built-in one collide; the kit consults your recognizer at every position the scanner would and requires a decline at each, which is exactly what leaves the built-in reading byte-identical bytes. A rung on a reserved trigger may not excuse this cell at all: the overlap exists by construction.

The other three cells you declare, because only you know whether they have anything to bite on. But an excuse the kit can falsify, it falsifies: declaring `imageClaim` exempt while a fixture produces a stamped built-in fails, as does excusing `widget` for a kind that **is** a registered live widget, or `editingPolicy` for a kind that declares one.

Two things worth knowing about `widget`. It asserts your claimed slice is **self-delimiting**: re-scanning the slice alone must re-form the same kind over its whole length, because that slice is exactly what the `data-source-*` attributes hand the clipboard and a source reveal. And where your kind builds its own widget DOM (`buildWidget`), the kit renders your fixture and measures the caret walk across it, which must equal the source length: a widget counts as its source span, never as what it draws, so an emoji showing one glyph for seven bytes still walks seven. A `component` kind's wrapper is built by the editor, not by you, so that half does not run and the cell reports `boundary` rather than claiming a pass. Run the suite under a DOM (`// @vitest-environment jsdom` for Vitest); without one the rendering half cannot run either, and the cell again reports `boundary` naming what you lost, while the recognition and self-delimiting checks still execute.

`registration` is the thinnest cell and the one that caught a real bug. `registerInlineSyntax` already refuses most bad registrations up front, so those are cross-checks on the editor rather than things you can get wrong. What you _can_ get wrong is your rung not being there at all: a setup step that ran under the wrong guard, or an install order that let another plugin's registration on a shared trigger stand in for yours. That is what this cell goes red on, and it is how the bundled directive text tier's own recognizer was once found missing.
