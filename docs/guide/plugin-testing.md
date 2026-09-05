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

A plugin can look perfect on screen and still be quietly eating bytes. Screenshots prove nothing here. Verify the damn bytes.

The proof comes in three layers, cheapest first, and this doc walks them in order:

1. **Round-trip checks you write yourself.** Parse, serialize, compare. A few lines, no editor mounted.
2. **The editor's own warnings, turned into failures.** A dev build already watches your plugin for contract violations; your suite can go red on them.
3. **The conformance kits.** The same checks every built-in block kind is held to, pointed at your kind. You supply fixtures; the kit supplies the suspicion.

Everything test-specific imports from one subpath, `@voithos-labs/aragonite/testing`, and each export gets its section below.

### Round-trip is the contract

The one promise your plugin has to keep is the one the README makes: `serialize(parse(source)) === source`. Check it three ways.

**Headless.** `parse` and `serialize` both ship on `@voithos-labs/aragonite/plugin`, so the core check needs no editor at all:

```ts
import { parse, serialize } from '@voithos-labs/aragonite/plugin';

expect(serialize(parse(MY_SOURCE))).toBe(MY_SOURCE);
```

**Live.** Mount an editor over a document that uses your syntax (the [mounting section](#mounting-the-editor-under-jsdom) shows how), read it back with `editor.getSource()`, and compare with what you authored.

**Uninstalled.** Author a document using your syntax, then load it with your plugin **not** registered. The generic fallback has to hand it back unchanged, so uninstalling a plugin never corrupts a saved document. A `%%parrot` file opened without the parrot plugin renders as plain text: no dancing, but no damage.

While you iterate, keep a dev build running (`vite dev`) and watch the console. The editor's shape checks ([misuse outcomes](plugin-guide.md#misuse-outcomes)) only fire there: a `rebuildRaw` byte mismatch, an opener that disagrees with the lines it consumed, a collapse probe (the descriptor's is-this-collapsed answer) that contradicts the rest of the descriptor. All of them warn in dev and are silent in production, so a clean dev console over a green round-trip is a decent sign your plugin's sound. A suite can hold that line automatically; [turning warnings into failures](#turning-warnings-into-failures) is the recipe.

### A blank slate per test

The plugin platform is register-once: setup writes into process-global registries that throw on a duplicate and never unregister. A test runner reuses one process across cases, so a plugin installed in a second `beforeEach` would collide with the first. That's what the reset is for.

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

Seen from outside, a reset takes the plugin's whole footprint with it:

```ts
import { isPluginInstalled } from '@voithos-labs/aragonite/plugin';

installPlugins([parrot]);
isPluginInstalled('parrot'); // true
resetPluginPlatformForTests();
isPluginInstalled('parrot'); // false, and declaredPluginKind('parrot') throws until the next install
```

What that clears, and what it deliberately leaves alone:

- Cleared: every non-built-in registration. Kinds, components, openers, completers, commands and keymaps, the inline syntax and widget registries, the paste surfaces and transform pipelines, the `:::` directive registry, and the installed-plugin set.
- Built-in registrations survive, exactly as in production. One exception: paste surfaces are wiped whole, built-ins included, so a case that pastes into a built-in block after a reset re-registers or skips the reset. Parse and round-trip cases don't care.
- Runtime state is untouched. The undo stack, the selection, and any live document are yours to set up.
- It's test-only and throws outside a detected test environment. Detection is Vitest-specific (it reads `process.env.VITEST`), so a suite on another runner opts in first and puts the detected defaults back after:

```ts
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/testing';

beforeAll(() => configureEditorEnv({ isTest: true })); // "yes, this really is a test process"
afterAll(() => resetEditorEnv());
```

**Install the unit, not your register function.** `definePluginBlock` generates a setup that runs your `register` step and then binds the component, so calling your own `registerParrotBlock()` here leaves the kind without a component: the editor falls back to a raw-text surface with a dev warning, and your tests pass against a block that isn't yours. Three more identity rules keep a suite honest:

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

While a sink is registered it takes over reporting completely (nothing reaches the console), and every entry is a small object. A paste transform that throws, for instance, is contained as a decline and reported like this:

```ts
registerPasteTransform({
	name: 'boom',
	transform: () => {
		throw new Error('boom');
	}
});
applyPasteTransforms('body\n'); // 'body\n', untouched

fires[0];
// {
//   tag: 'paste-transform',
//   message: "transform 'boom' threw in the paste pipeline; declining, so the running text is untouched",
//   details: Error('boom')
// }
```

`setDevWarnSink` returns the sink it replaced, so a nested harness restores rather than clears.

One prerequisite: warnings only emit while the editor believes it's in a dev build, and a sink over a production build stays empty for the wrong reason. A Vitest suite gets the dev flag automatically, because its build resolves it. Under another runner, or a bundler that resolves no export conditions, call `configureEditorEnv({ isDev: true })` in your setup (add `isTest: true` if the suite also uses the reset) and `resetEditorEnv()` in teardown.

### Proving a paste transform is wired

`registerPasteTransform` writes into a registry nothing else on the public surface reads, so the subpath ships the driver. `applyPasteTransforms(text)` is the very function every clipboard-to-parse route runs, so driving it proves your transform is **wired**, not merely that your pure function works:

```ts
import { applyPasteTransforms } from '@voithos-labs/aragonite/testing';

it('converts on paste', () => {
	expect(applyPasteTransforms(CLIPBOARD_TEXT)).toBe(CONVERTED_TEXT);
});
```

(The plugin is installed by the `beforeEach` from [a blank slate per test](#a-blank-slate-per-test); the transform rides along with the rest of the unit's setup.)

Concretely, with a transform that shouts pasted headings:

```ts
registerPasteTransform({
	name: 'shout',
	transform: (text) => (text.startsWith('# ') ? text.toUpperCase() : null)
});

applyPasteTransforms('# quiet please\n'); // '# QUIET PLEASE\n'
applyPasteTransforms('quiet please\n'); // 'quiet please\n' (declined, so nothing changed)
```

### Mounting the editor under jsdom

A component is only really verified mounted, and a jsdom mount is a supported way to do it. Three things stand in the way. Two are jsdom gaps, and `installEditorDomStubsForTests` closes both by stubbing the browser APIs a mounted editor calls and jsdom lacks (`ResizeObserver` and `scrollIntoView`), each only where absent, so the call is inert in a real browser:

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

`scrollMode: 'host'` is the third thing: it drops the editor's own scroll container and the chrome a jsdom box can't size anyway ([host scroll mode](consumer-guide.md#host-scroll-mode)). And keep the fixture document short. The editor stops mounting blocks past an estimated-height budget in either scroll mode, jsdom reports a zero-height viewport, and a fixture tall enough to trip that unmounts the very block you're asserting on.

From there `target.querySelector` reaches your component's own markup, and `editor.getSource()` hands you the bytes to compare:

```ts
expect(target.querySelector('.parrot-block')).not.toBeNull(); // your component, not the raw-text fallback
expect(editor.getSource()).toBe(MY_SOURCE);
```

### The conformance kits

Conformance here means: your kind behaves the way the built-in kinds are required to behave, under the same checks. Three kits ship on the subpath, one per tier (block kind, container, inline syntax), and they share a vocabulary:

- Each kit runs **cells**, one check per behavior, and each cell is covered one of three ways. `assert` runs the real check. `exempt` means the invariant has nothing to bite on for your kind (there's no such operation to test). `boundary` means checking it needs something headless code can't reach (a browser, a mounted component).
- You declare an excused cell rather than skipping it, and both excuse modes want a reason that's a real sentence (a bare token like `'n/a'` fails the run). An excuse the kit can falsify, it falsifies.
- Every kit resolves with a report of what was asserted and what was excused, and otherwise throws a plain `Error` naming every failed cell, so a run drops straight into a test case under any runner.

### The kind checkup: `runKindConformance`

**`runKindConformance(kind, profile?)`**

Takes your kind (the value `declaredPluginKind` returns) and executes the headless half of its `closure` block, the descriptor field where every kind answers the cross-cutting editor systems ([the closure block](plugin-guide.md#the-closure-block)). One cell per system, derived from your declarations and your `conformanceFixture`. What runs now, with no browser:

- The fixture round-trips, and a kind declaring `rebuildRaw` also has it checked twice over: it re-emits the parsed bytes exactly, and it emits the same bytes on every run.
- Backspace-merge eligibility is held to your declared `mergeRole`.
- A `clipboard: inherit-default` cell proves a copy is a plain byte slice, with your kind at each end of the copied range in turn.
- An `undo: inherit-default` cell proves one structural operation pushes exactly one undo entry.
- A `searchPaint: not-supported` cell proves the document scan genuinely finds nothing in your kind.

Cells whose mechanism only exists in a browser (focus, selection and search painting, reorder, and the note-taking simulation the platform runs over the kinds it enrolls) are recorded `boundary`; the kit won't fake them green. Covering those is a browser test's job (the editor's own e2e sweep does it for every registered kind that declares a `conformanceFixture`). For the parrot, the whole checkup is the test the [guide's quickstart](plugin-guide.md#the-first-fifteen-minutes) ends on:

```ts
it('parrot conforms', async () => {
	await runKindConformance(declaredPluginKind(PARROT));
});
```

It resolves with a report, one cell per closure column. For the parrot exactly as the guide declares it:

```ts
const report = await runKindConformance(declaredPluginKind(PARROT));
report.cells.map((c) => `${c.column}: ${c.status}`);
// [
//   'roundTrip: executed',      // the fixture round-trips
//   'focus: boundary',          // browser only
//   'mergeBackspace: executed', // eligibility matches mergeRole
//   'selectionPaint: boundary', // browser only
//   'searchPaint: boundary',    // you declared it implemented, so it's yours to prove
//   'reorder: boundary',        // browser only
//   'undo: boundary',           // implemented too, so the kit can't drive it generically
//   'clipboard: executed',      // copy is a raw byte slice
//   'simOracle: boundary'       // the platform sweep's, never this runner's
// ]
```

Each cell also carries the `mode` you declared and a `detail` string saying what ran, or why nothing did. When something's wrong the run throws instead of resolving; a fixture that stopped producing your kind reads like this:

```
Error: kind conformance failed for "parrot": conformanceFixture parses to no "parrot" node
```

**The fixture contract.** Your `conformanceFixture` has to hold your kind inside its **first** top-level block, or the run fails outright: the undo and clipboard cells drive the fixture's first block and ride a throwaway neighbour block the kit adds beside it (after it for the undo cell, on each side in turn for the clipboard cell). A kind that only ever appears nested still enrolls, seated inside the first block; its clipboard cell then reports `boundary`, because its bytes get copied as part of the enclosing container.

Where a cell claims a mechanism the runner can't reach generically (a kind-specific copy, say), supply the check yourself: `runKindConformance(kind, { cells: { clipboard: { check: async (ctx) => … } } })`, where `ctx` hands you the parsed fixture and your kind's node. A custom check is only accepted on a cell you declared `implemented`; anywhere else it would contradict the declaration and silence the check for the mode you did declare.

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

It resolves with a status per cell, and an excused cell carries the reason you gave:

```ts
const report = await runContainerConformance(declaredPluginKind('conspiracy'), profile);
report.cells.map((c) => `${c.cell}: ${c.status}`);
// [
//   'localIndex: asserted',
//   'ancestry: asserted',
//   'multiScope: exempt',   // report.cells[2].reason is your sentence
//   'focusBubble: asserted',
//   'terminatorCollision: asserted',
//   'declarations: asserted'
// ]
```

A failing run throws instead, naming every cell that failed and why. A `localIndexFixture` the kit can see through, say:

```
Error: container conformance failed for "conspiracy":
  - localIndex: localIndexFixture must edit a non-first child or descend through a non-zero chain position (else the local-vs-global check is vacuous)
```

Two notes on those fixtures. `localIndexFixture` has to edit a non-first child **or** descend through a non-zero chain position (that's the failure above): at chain `[0, 0]`, child 0, a local path and a flat global offset are the same number and the check proves nothing (the fixture above does both, since Big Bird deserves rigor). And `terminatorCollisionFixture.bodyRaw` names the bytes a **user types**, not the bytes that reach the tree: the kit writes them through your `bodyWrite` rule, the same route a real commit uses.

**`terminatorCollision` is the cell most container authors haven't considered**, and the profile type requires a declaration, so a profile written before the cell existed stops compiling until you answer it. If your container wraps body bytes between an opener and a closing line, a body line that reproduces that closing line ends it early, and everything below leaves the container the next time the document is parsed. A byte round-trip can't catch it, because the bytes come back out verbatim either way; only the live tree disagrees with them. So this cell's oracle is convergence instead: the live tree has to agree with a fresh parse of its own bytes.

Whether you may excuse it, and how to fix a real collision, depends on your terminator's shape:

- **Fence-shaped** terminators escalate: the `:::` containers lengthen their fence past the body's runs, and the editor does that for you, so the conspiracy above asserts the cell and passes without writing a line.
- A **strip** container (one that prefixes every line it emits, the blockquote shape) is immune, and is the one shape allowed to declare the cell `exempt`. An opaque container may not: the `declarations` cell fails a profile that tries.
- A **fixed-token** terminator, an HTML close tag say, can neither escalate nor prefix; it repairs the collision with [`bodyWrite`](#making-body-bytes-legal-bodywrite), rewriting the offending bytes on the way **in**, so the child's own raw carries the rewrite and nothing diverges.
- A **childless** container whose body lives in metadata supplies the optional `writeBody` on the fixture, so the collision probe reaches a body no child carries.

Escaping at the rebuild is the one repair that doesn't work, and it's the tempting one: an opaque container's raw is checked against its live children, so rewriting a child on the way out reads as staleness. Rewriting on the way in, before the bytes are reparsed, leaves no such gap.

Two things finish the profile. A profile has to keep at least one asserting behavioral cell, or excuse itself whole through the optional `wholeProfileExemption`, with the same real-sentence reason bar and only when no cell asserts. And one companion, `reversedAncestryLeavesRootStale(profile)`, is worth a line in the same test:

```ts
expect(reversedAncestryLeavesRootStale(profile)).toBe(true);
```

It has to be `true` for a container whose `rebuildRaw` reads only its direct children. It rebuilds outermost-first on purpose and checks the root went stale, which is what proves your `ancestry` cell tests something rather than passing by construction. A container that re-derives its whole subtree from scratch returns `false`, and excuses `ancestry` instead.

#### Declaring the wrap: `bodyWrap`

A container whose opener parses its body through `parseContainerBody` declares the same wrap as `container.bodyWrap`, and the `declarations` cell probes your parse in both directions, failing a declaration that doesn't match what the parse actually does. Why the editor needs telling at all:

- The parse peels the blank line against your opener into `innerPrefix` (the node field that holds it), so that line belongs to the wrap rather than being an empty first row. The editor's blank-line bookkeeping has to know that, or a delete that frees a blank line above your body's first block eats the line the peel owns, and that block disappears on the next load.
- A strip container whose body starts at its own first line declares nothing, and then carries no `innerPrefix` either; a dev-mode check on the node's shape fails a wrap-less container that fills that slot.
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

`normalize` runs over every byte destined for the body, at the places the editor writes body bytes into the tree, **ahead of the reparse that decides the child's kind**. That order is what makes it work where a rebuild-time rewrite can't: the kind a write lands on is the kind its committed bytes describe. Two rules bind it:

- **Idempotent**: re-committing already-legal bytes changes nothing.
- **Line-local**: it may read the whole raw to decide which lines to rewrite, but it never moves bytes across a line boundary.

`mapOffset` is the rewrite's caret image: where a caret sitting at some offset in the typed bytes ends up in the committed ones. The pair ships as one object because a rewrite without its caret image strands the caret. The bundled `details` container's pair, over a body line that would close it early:

```ts
const typed = 'exhibit A\n</details>\nexhibit B\n';
normalize(typed); // 'exhibit A\n&lt;/details>\nexhibit B\n'
mapOffset(typed, 5); // 5, nothing changed before it
mapOffset(typed, 21); // 24, the escape ahead of it grew the text by three
```

Two rules of thumb from that container. Ask the **grammar**, not your own spelling: what breaks `details` is everything the Markdown spec hands to raw-HTML passthrough, indented, upper-cased and trailing-space spellings included, which is looser than the canonical form your `rebuildRaw` emits, and `htmlBlockTagLineMatcher` from `@voithos-labs/aragonite/plugin` answers that question for a tag name. And rewrite the **minimum**: `details` escapes one `<` to `&lt;`, which renders as the literal tag both in the editor and on GitHub while matching no tag line, so the author still sees what they typed.

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

This kit answers synchronously, and its `detail` strings say how much each cell actually chewed through. For that profile, with the embed rendered by a Svelte `component`, under jsdom:

```ts
const report = runInlineKindConformance(profile);
report.cells.map((c) => `${c.cell}: ${c.status} (${c.detail})`);
// [
//   'claims: asserted (2 claim(s) across 2 fixture(s))',
//   'roundTrip: asserted (20 source(s) round-trip byte-for-byte and tile their scan range)',
//   'overlapDecline: asserted (1 prefix position(s) declined across 1 overlap fixture(s))',
//   'widget: boundary (recognition + self-delimiting claim executed; the island wrapper of a `component` kind is minted by the render layer ...)',
//   'editingPolicy: asserted (policy vocabulary)', // plus a whole-delete check if your policy says atomic
//   'imageClaim: exempt (this recognizer builds only its own kind, never a built-in one)',
//   'registration: asserted (prefix rung at priority 40, below the built-in boundary)'
// ]
```

Twenty sources on the round-trip cell, from two fixtures: the kit interleaves each one with ten neighbours (emphasis around it, a link around it, a blockquote in front, your own trigger on either edge, and so on). A profile the kit refuses throws before any cell runs, with the plain reason:

```
Error: overlapDecline asserts but the profile supplies no overlapFixtures
```

`fixtures` is required and non-empty, and a fixture your recognizer doesn't claim **fails** rather than being skipped: every cell reads the nodes a fixture produces, so an unclaimed one would enroll your syntax without testing it.

**`overlapDecline` is the cell most inline authors haven't considered, and on a reserved trigger it's required.** Registering on a trigger the built-in scanner owns (`[`, `!`, `*`, `` ` ``, and friends) puts your recognizer ahead of the built-in case, so wherever your prefix matches you're claiming those bytes whether or not they spell something the built-in owns. `![[a]](https://x.dev)` is a plain image whose alt text is `[a]`; a recognizer that claims every `![[…]]` takes it, and the document still round-trips, as a wiki embed nobody ever wrote. Supply the sources where your grammar and a built-in one collide; the kit consults your recognizer at every position the scanner would and requires a decline at each, which is exactly what leaves the built-in reading unchanged bytes. A rung on a reserved trigger may not excuse this cell at all, since the overlap exists by construction.

The other three cells you declare, because only you know whether they have anything to bite on. But an excuse the kit can falsify, it falsifies: declaring `imageClaim` exempt while a fixture produces a stamped built-in (a built-in node the scan marked as your rung's) fails, as does excusing `widget` for a kind that **is** a registered live widget, or `editingPolicy` for a kind that declares one.

Two things worth knowing about `widget`. It asserts your claimed slice is **self-delimiting**: re-scanning the slice alone must re-form the same kind over its whole length, because that slice is exactly what the widget's `data-source-*` attributes (the ones saying which bytes it stands for) hand the clipboard and a source reveal. And where your kind builds its own widget DOM (`buildWidget`), the kit renders your fixture and measures the caret walk across it, which must equal the source length: a widget counts as its source span, never as what it draws, so an emoji showing one glyph for seven bytes still walks seven. A `component` kind's wrapper is built by the editor, not by you, so that half doesn't run and the cell reports `boundary` rather than claiming a pass (that's the report above). Run the suite under a DOM (`// @vitest-environment jsdom` for Vitest); without one the rendering half can't run either, and the cell again reports `boundary` naming what you lost, while the recognition and self-delimiting checks still execute.

`registration` is the thinnest cell and the one that caught a real bug. `registerInlineSyntax` already refuses most bad registrations up front, so those are cross-checks on the editor rather than things you can get wrong. What you _can_ get wrong is your rung not being there at all: a setup step that ran under the wrong guard, or an install order that let another plugin's registration on a shared trigger stand in for yours. That's what this cell goes red on, and it's how the bundled directive text tier's own recognizer was once found missing.
