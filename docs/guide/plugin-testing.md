# Testing Your Plugin

How to prove your plugin's bytes survive: round-trip checks, the `@voithos-labs/aragonite/testing` seam, and the conformance kits every registered kind is enrolled in. Authoring itself is [`plugin-guide.md`](plugin-guide.md).

## Verifying your plugin

A plugin can look perfect on screen and still be quietly eating bytes, and in a lossless editor that is the only class of bug that actually matters. Screenshots prove nothing here. Verify the damn bytes.

**Round-trip is the contract.** The headless form needs no editor at all, because `parse` and `serialize` both ship on `@voithos-labs/aragonite/plugin`:

```
import { parse, serialize } from '@voithos-labs/aragonite/plugin';

expect(serialize(parse(MY_SOURCE))).toBe(MY_SOURCE);
```

Then read the live document back with `editor.getSource()` and confirm it equals what you authored. Then test the case that matters most for a plugin platform: author a document using your directive **with your plugin not registered**. The generic fallback must return it byte-for-byte, so uninstalling a plugin never corrupts a saved document.

**Dev-mode warnings are your guard channel.** The shape checks in [misuse outcomes](plugin-guide.md#misuse-outcomes) only fire in a dev build. Run `vite dev` while developing and watch the console: a `rebuildRaw` byte mismatch, an opener that disagrees with the lines it consumed, or a collapse probe that contradicts the descriptor all warn there and are silent in production. A clean dev-console round-trip is the signal your plugin is sound.

### Testing your plugin

The platform is register-once: a plugin's setup writes into process-global registries that throw on a duplicate and never unregister. A test runner reuses one process across cases, so a plugin installed in a second `beforeEach` would collide with the first. The `@voithos-labs/aragonite/testing` subpath exists for exactly this:

```
import { installPlugins } from '@voithos-labs/aragonite';
import { resetPluginPlatformForTests } from '@voithos-labs/aragonite/testing';
import { notePlugin } from './note-kind';

beforeEach(() => {
	resetPluginPlatformForTests(); // empty the registries
	installPlugins([notePlugin()]); // the unit, exactly as the `plugins` prop installs it
});
```

**Install the unit, not the registrar.** `definePluginBlock` generates a setup that does two things, your `register` step and then the component registration, so calling your own `registerNote()` here leaves the kind without a component and `BlockHost` falls back to the raw-editable surface with a dev warning. Your kind's tests then pass against a block that is not yours. Do not do both either: install the unit here and pass a `plugins` array to the mount, and the second install throws, because the register-once throw stays live under test.

Reset **then** re-install, because the reset only empties the registries. It clears every non-built-in schema registration (kinds, components, openers, commands, installed plugins), the inline syntax and widget registries, the paste surface and transform pipelines, and the `:::` directive registry. Built-in registrations survive, exactly as in production.

Two things it does not restore. It wipes **all** paste surfaces, built-ins included, so a case that pastes into a built-in block after a reset must re-register or skip the reset (parse and round-trip cases are unaffected). And it touches no runtime state: the undo stack, the selection, and the live document are yours to set up. `resetPluginPlatformForTests` is test-only and throws if called outside a detected test environment; detection is Vitest-specific, so a suite on another runner opts in first with `configureEditorEnv({ isTest: true })`.

The rest of the subpath, at a glance:

| Export                                                       | Role                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `installEditorDomStubsForTests`                              | Install the browser APIs a mounted editor calls and jsdom lacks               |
| `applyPasteTransforms`                                       | Run the registered paste pipeline over a string, exactly as a real paste does |
| `runKindConformance`                                         | The per-kind closure battery                                                  |
| `checkCopyIsRawByteSlice`                                    | That battery's clipboard executor, drivable directly against a kind           |
| `runContainerConformance`, `reversedAncestryLeavesRootStale` | The container harness, and the companion that proves its ancestry cell bites  |
| `runInlineKindConformance`                                   | The inline-rung battery                                                       |
| `configureEditorEnv`, `resetEditorEnv`                       | Declare a non-Vitest runner a test environment, and restore the defaults      |
| `setDevWarnSink`                                             | Route every editor dev warning to a callback of yours instead of the console  |

**Testing a paste transform.** `registerPasteTransform` writes into a registry nothing else on the public surface reads, so `applyPasteTransforms(text)` ships beside the reset. It is the very function every clipboard→parse route runs, which is what makes driving it proof that your transform is _wired_ rather than proof that your pure function works:

```
import { applyPasteTransforms, resetPluginPlatformForTests } from '@voithos-labs/aragonite/testing';

it('converts on paste', () => {
	registerMyPlugin();
	expect(applyPasteTransforms(CLIPBOARD_TEXT)).toBe(CONVERTED_TEXT);
});
```

**Mounting your component.** A component tier is only really verified mounted, and a jsdom mount is a supported way to do it. Two of the three things standing in the way are jsdom gaps rather than editor requirements, and the helper closes both:

```
// @vitest-environment jsdom
import { mount, flushSync } from 'svelte';
import { Editor } from '@voithos-labs/aragonite';
import { installEditorDomStubsForTests } from '@voithos-labs/aragonite/testing';

installEditorDomStubsForTests(); // ResizeObserver + scrollIntoView, installed only where absent

const target = document.body.appendChild(document.createElement('div'));
const editor = mount(Editor, { target, props: { source: MY_SOURCE, plugins, scrollMode: 'host' } });
flushSync(); // the first render has to land before you can assert on it
```

`scrollMode="host"` is the third: it drops the editor's own scrollport and the standalone chrome a jsdom box cannot size anyway. Windowing is gated on the height budget alone in either scroll mode, so keep the fixture short. A document tall enough to clear the budget windows here too, and unmounts the very block you are asserting on. From there `target.querySelector` reaches your component's own chrome and `editor.getSource()` is a byte-exact assertion surface.

**Failing on a dev warning.** The editor reports contract violations it can contain rather than throw through dev warnings, which reach the console under an `[aragonite:…]` head. A suite that wants those to fail rather than scroll past registers a sink:

```
import { setDevWarnSink } from '@voithos-labs/aragonite/testing';

const fires = [];
beforeEach(() => setDevWarnSink((entry) => fires.push(entry)));
afterEach(() => {
	setDevWarnSink(null);
	expect(fires.splice(0)).toEqual([]); // a guard fired and nobody claimed it
});
```

`setDevWarnSink` returns the sink it replaced, so a nested harness can restore rather than clear. A registered sink takes reporting over: nothing reaches the console while yours is installed, and each entry carries the guard's `tag`, its `message`, and any `details`.

One prerequisite, or the gate is green because it is blind: warnings emit only while the editor env reads as a dev build outside a test runner it recognizes. Vitest is detected automatically; under any other runner, or a bundler that resolves no export conditions, call `configureEditorEnv({ isDev: true, isTest: false })` (same table, above) in your setup first and `resetEditorEnv()` in teardown.

### The conformance battery — registering a kind enrolls it

`runKindConformance(kind)` executes the headless half of your kind's `closure` block. It derives one cell per cross-cutting system from the block and your `conformanceFixture`, and runs the part that needs no browser now: it round-trips the fixture (and, for a container, checks `rebuildRaw` is deterministic), holds Backspace-merge eligibility to your `mergeRole`, confirms an `inherit-default` clipboard copies as a plain byte slice, checks one structural op is one undo entry, and asserts a `not-supported` search cell genuinely finds nothing. Cells whose mechanism only exists in the browser (focus, selection and search paint, reorder, the simulation oracle) are recorded `boundary`, run by the e2e sweep rather than stubbed green.

```
import { runKindConformance } from '@voithos-labs/aragonite/testing';

it('my kind conforms', async () => {
	await runKindConformance(declaredPluginKind(MY_KIND));
});
```

**The fixture contract**, because two executors depend on it and only a thrown assertion would otherwise teach it: your `conformanceFixture` must parse to your kind at **`children[0]`**, and the undo and clipboard cells build their document by **appending** a sentinel block after it. A fixture that puts your kind anywhere but first fails the clipboard cell, and a kind that can only appear somewhere other than the document top is not enrollable in those two cells as they stand.

It resolves with a per-cell report and throws naming every failed cell, so a `conformanceFixture` that stops parsing to your kind, or a closure cell that lies about a mechanism the runner can observe, fails the moment you register it. Where a cell claims a mechanism the runner cannot reach generically (a kind-specific copy, say), supply a check for it: `runKindConformance(kind, { cells: { clipboard: { check: async (ctx) => … } } })`, where `ctx` hands you the parsed fixture and the kind's node.

The mounted-DOM cells (focus, selection paint, search paint) are executed for you: a browser conformance sweep enrolls every registered kind that declares a `conformanceFixture`, so the moment your kind registers with one it is driven headfully for caret walk-through, cross-block selection painting, and search-match painting.

### Conformance-testing a container

If your plugin registers a **container** kind, `@voithos-labs/aragonite/testing` also publishes the harness the built-in containers are held to, which is the same checks pointed at your own kind. It is the fastest way to find out whether your container behaves like a first-class one:

| Cell                  | What it holds you to                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localIndex`          | Children are addressed by their **local** index at each nesting level, not a global offset                                                                                                                                                                                                                    |
| `ancestry`            | An edit deep inside rebuilds raw inner→outer, so the root's `raw` reflects the leaf change                                                                                                                                                                                                                    |
| `multiScope`          | One logical multi-scope op pushes exactly **one** undo entry                                                                                                                                                                                                                                                  |
| `focusBubble`         | A boundary focus event bubbles to the root and terminates — no loop, no double-escape                                                                                                                                                                                                                         |
| `terminatorCollision` | A body line reproducing your container's own terminator stays inside it                                                                                                                                                                                                                                       |
| `declarations`        | Your `unwrapRole` names strategies that exist, `containerPaste` is shaped right, `rebuildRaw` runs — and, if you declare `contentStartSpace`, that it re-emits the marker's trailing space on a content line (the declaration consumes the user's space, so a rebuild that does not give it back eats a byte) |

`terminatorCollision` is new, and **required**: a profile written before it stops compiling until the cell is declared. Assert it and supply a `terminatorCollisionFixture` (body bytes carrying a line that reproduces your terminator), or declare it `exempt` with a reason if nothing a body can hold could ever reproduce your terminator; the paragraph below the example says which of those you are. The fixture's `bodyRaw` names the bytes a **user types**, not the bytes that reach the tree: the kit writes them through your `bodyWrite` rule, the same door a real commit uses.

You supply the fixtures, because the kit parses its way to your kind. So register the plugin first, then hand it Markdown that produces your container:

```
import { runContainerConformance } from '@voithos-labs/aragonite/testing';

it('my container conforms', async () => {
	await runContainerConformance(declaredPluginKind(MY_KIND), {
		// A nesting where your kind is an ancestor of a deep editable leaf.
		deepNesting: { source: OUTER_WRAPPING_INNER, leafPath: [0, 1, 1] },
		// The chain of container indices down to your kind, and which child to edit.
		localIndexFixture: { source: OUTER_WRAPPING_INNER, containerChain: [0, 1], targetChild: 2 },
		focusSource: ONE_OF_MY_CONTAINERS,
		// Body bytes carrying a line that reproduces your terminator.
		terminatorCollisionFixture: { source: ONE_OF_MY_CONTAINERS, bodyRaw: 'before\nMY_TERMINATOR\nafter\n' },
		localIndex: { mode: 'assert' },
		ancestry: { mode: 'assert' },
		multiScope: { mode: 'exempt', reason: 'my container owns no ≥2-scope op — its inner ops are single-scope' },
		focusBubble: { mode: 'assert' },
		terminatorCollision: { mode: 'assert' }
	});
});
```

Pick a **non-first** child at a **non-zero** chain position for `localIndexFixture`. At chain `[0, 0]` / child 0 a local path and a flat global offset are the same number, and the check proves nothing.

`terminatorCollision` is the one most container authors have not considered. If your container wraps body bytes between an opener and a terminator, a body line that reproduces that terminator closes it early, and everything below leaves the container the next time the document is parsed. Byte round-trip does not catch it: the bytes are re-emitted verbatim either way, and only the live tree disagrees with them.

Three repairs, by terminator shape. A **fence-shaped** terminator escalates: the `:::` containers lengthen their fence past the body's runs, which the editor does for you. A **strip** container is immune, because it prefixes every line it emits. A **fixed-token** terminator such as an HTML close tag can do neither, and repairs the collision with [`bodyWrite`](#making-body-bytes-legal-bodywrite) instead: it rewrites the offending bytes on the way IN, so the child's own `raw` carries the rewrite and nothing diverges. Declare the cell `exempt` only when nothing a body can hold could reproduce your terminator at all. A **childless** container whose body lives in metadata drives the same cell through the optional `TerminatorCollisionFixture.writeBody` instead of a last-child write, so the collision probe reaches a body no child carries.

Escaping at the **rebuild** is the one thing that does not work, and it is the tempting one: an opaque container's `raw` is checked against its live children, so rewriting a child on the way out reads as staleness. The write sink is early enough that no such gap exists.

Every cell is `assert`, `exempt`, or `boundary`. A cell you cannot assert is declared, not skipped: `exempt` means the invariant has nothing to bite on (no multi-scope op exists), `boundary` means asserting it would need something the harness cannot reach (a mounted component, a DOM). Both demand a substantive `reason`, and a thin one fails the run, so an exemption stays visible instead of quietly hollowing the harness out. A profile must keep at least one asserting behavioral cell, or excuse itself whole through the optional `wholeProfileExemption` with the same documented-reason bar. The call resolves with a report of what was asserted and what was excused; it throws an `Error` naming every failed cell otherwise, so it drops straight into a test case under any runner.

One companion worth asserting alongside it: `reversedAncestryLeavesRootStale(profile)` must be `true` for a container whose `rebuildRaw` reads only its direct children. It rebuilds outer-first on purpose and checks the root went **stale**, which is what proves your `ancestry` cell is testing something rather than passing by construction.

#### Declaring the wrap: `bodyWrap`

A container whose opener parses its body through `parseContainerBody` declares the same wrap as `container.bodyWrap`. The parse peels the blank line against your opener into `innerPrefix`, so that line is the wrap's rather than an empty first row, and the editor's separator settle has to know it, or a delete that frees a blank line above your body head drops the line the peel eats and the head block disappears on the next load. Declare it and the two agree; the container conformance kit probes the parse and fails a declaration that does not match. A strip container whose body starts at its own first line (a blockquote shape) declares nothing, and must therefore carry no `innerPrefix`, since the node-shape guard fails a wrap-less container that fills that slot.

#### Making body bytes legal: `bodyWrite`

A container kind declares `bodyWrite` when its body's bytes carry grammatical meaning it owns:

```
container: {
	contract: 'opaque',
	rebuildRaw: rebuildMyRaw,
	bodyWrite: {
		normalize: (raw) => /* raw, made legal as a child of this container */,
		mapOffset: (raw, offset) => /* where a caret at `offset` ends up after that */
	}
}
```

`normalize` is applied to every byte destined for the body, at the tree-op write sinks, **ahead of the reparse that decides the child's kind**, which is what makes it work where a rebuild-time rewrite cannot: the kind a write lands on is the kind its committed bytes describe. It must be **idempotent** (a re-commit of already-legal bytes changes nothing) and **line-local** (it may read the whole raw to decide _which_ lines to rewrite, but never moves bytes across a line boundary). `mapOffset` is its caret image, so a surface whose committed bytes differ from what the user typed still seats the caret on the bytes; the pair ships as one object because a rewrite without its caret image strands the caret.

Two rules of thumb from the bundled `details` container. Ask the **grammar**, not your own spelling: what breaks the container is everything the Markdown spec hands to raw-HTML passthrough (indented, upper-cased and trailing-space spellings included), which is looser than the canonical form your `rebuildRaw` emits, and `htmlBlockTagLineMatcher` from `@voithos-labs/aragonite/plugin` answers that question for a tag name. And rewrite the **minimum**: `details` escapes one `<` to `&lt;`, which renders as the literal tag both in the editor and on GitHub while matching no tag line, so the author sees what they typed.

### Conformance-testing an inline rung

If your plugin registers inline syntax, `runInlineKindConformance` is the same idea one layer down: register the rung, then point the kit at its trigger and prefix and it drives the behaviors a rung can break without moving a byte.

| Cell             | What it holds you to                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `claims`         | Every fixture you supply is actually claimed by **your** rung                                     |
| `roundTrip`      | Your fixtures and the kit's interleavings of them round-trip, and your claims tile the scan range |
| `overlapDecline` | Where your prefix also opens something the built-in scanner owns, you decline it                  |
| `widget`         | Your claimed bytes are one atomic unit, and your island carries the span the caret walk reads     |
| `editingPolicy`  | Your widget's editing declaration is in the vocabulary the caret-edge dispatch actually reads     |
| `imageClaim`     | A rung minting a built-in kind carries the `rewriteImage` hook the write paths need               |
| `registration`   | Your rung is actually registered where your profile says it is                                    |

```
import { runInlineKindConformance } from '@voithos-labs/aragonite/testing';

it('my rung conforms', () => {
	runInlineKindConformance({
		trigger: '!',
		prefix: '![[',
		kind: declaredPluginInlineKind(MY_KIND),
		fixtures: ['![[cat.png]]', 'see ![[cat.png|300]] here'],
		overlapFixtures: ['![[a]](https://x.dev)'],
		overlapDecline: { mode: 'assert' },
		widget: { mode: 'assert' },
		editingPolicy: { mode: 'assert' },
		imageClaim: { mode: 'exempt', reason: 'the rung mints only its own kind, which the scan leaves unstamped' }
	});
});
```

`fixtures` is required and non-empty, and a fixture your rung does not claim **fails** rather than being skipped: every cell below reads the node a fixture produces, so an unclaimed one would enroll your rung without testing it.

**`overlapDecline` is the cell most rung authors have not considered, and it is required.** Registering on a reserved trigger (`[`, `!`, `*`, `` ` ``, …) puts your recognizer _ahead_ of the built-in case, so wherever your prefix matches you are claiming those bytes whether or not they spell something the built-in owns. `![[a]](https://x.dev)` is a plain image whose alt text is `[a]`; a rung that claims every `![[…]]` takes it, and the document still round-trips, as a wiki embed nobody ever wrote. Supply the sources where your grammar and a built-in one collide; the kit consults your recognizer at every position the scanner would and requires a decline at each, which is exactly what leaves the built-in reading byte-identical bytes. A rung on a reserved trigger may not excuse this cell at all: the overlap exists by construction.

The other three cells you declare, because only you know whether they have anything to bite on. But an excuse the kit can falsify, it falsifies. Declaring `imageClaim` exempt while a fixture mints a stamped built-in fails, as does excusing `widget` for a kind that _is_ a registered live widget. A reason is a claim about your rung, not a waiver.

Two things worth knowing about `widget`. It asserts your claimed slice is **self-delimiting**: re-scanning it alone must re-form the same kind over the whole slice, because that slice is what `data-source-*` hands the clipboard and a source reveal. And where your kind builds its own island (`buildWidget`), it renders your fixture and measures the caret walk, which must equal the source length: a widget counts as its source span, never as what it draws, so an emoji showing one glyph for seven bytes still walks seven. A `component` kind's island is minted by the editor, not by you, so that half does not run and the cell reports `boundary` rather than claiming a pass.

Run it under a DOM (`// @vitest-environment jsdom` for Vitest). Without one the island half cannot run either, and the cell again reports `boundary` naming what you lost; the recognition and self-delimiting halves still execute.

`registration` is the thinnest cell and the one that caught a real bug. `registerInlineSyntax` already refuses most of what it checks at registration: one rung per rung, a prefix long enough for a reserved trigger, a priority under the built-in boundary, a trigger the fast bail visits. So those are cross-checks on the editor rather than things you can get wrong. What you _can_ get wrong is your rung not being there at all: a setup step that ran under the wrong guard, or an install order that let another plugin's registration on a shared trigger look like your own. That is what this cell reds on, and it is how the bundled directive tier's own recognizer was found missing.
