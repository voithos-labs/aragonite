# Testing Your Plugin

A plugin can look perfect on screen and still be quietly eating bytes. Screenshots prove nothing here. Verify the damn bytes.

One call does most of it: `check(plugin)` holds your plugin to the checks every built-in block passes. Start there. The rest of the page is what that call can't see: your built package, a whole document, your block mounted, a paste.

Everything test-specific imports from one subpath, `@voithos-labs/aragonite/testing`. The running example is the plugin guide's `%%parrot` block. Three neighbouring docs carry what this one leans on:

- [plugin-guide.md](plugin-guide.md): building the plugin in the first place.
- [plugin-api.md](plugin-api.md): the catalog of every authoring export, if a name below reads unfamiliar.
- [consumer-guide.md](consumer-guide.md): the editor's props and instance methods, which the mounting section uses.

A map, so you can jump straight at your question:

| Section | What it covers |
| --- | --- |
| [Checking a plugin value](#checking-a-plugin-value-check) | `check`: the call, every check it runs, excuses, options, failures |
| [The check a listing runs](#the-check-a-listing-runs-aragonite-plugin-check) | The same run over your built package, from a terminal or your CI |
| [Round-trip is the contract](#round-trip-is-the-contract) | Two byte checks over a whole document: in a live editor, and with your plugin left out |
| [Mounting the editor under jsdom](#mounting-the-editor-under-jsdom) | `headless`: rendering your block in a simulated browser |
| [One tab stop in reading mode](#one-tab-stop-in-reading-mode-taborder) | `tabOrder`: your mounted block leaves reading mode's Tab to the links and the editor's one stop |
| [Proving a paste rewrite is wired](#proving-a-paste-rewrite-is-wired-rewritepaste) | `rewritePaste`: the real paste over a string, no clipboard involved |
| [Turning warnings into failures](#turning-warnings-into-failures) | Making the editor's dev warnings fail your own mounted tests |

`check` takes a plugin value, the thing `definePlugin({ name, version, editor, contributes })` returns. A plugin that registers kinds in a `setup` (`definePlugin({ name, setup })`) has kits of its own, from [the conformance kits](#the-conformance-kits) down.

## Verifying your plugin

### Checking a plugin value: `check`

**`check(plugin, options?)`**

It installs your plugin the way an editor does, then runs every check over every sample of everything the plugin lists: block types, inline constructs, commands, menus, paste rewrites, paint, a highlighter. One call is the whole test:

```ts
import { check } from '@voithos-labs/aragonite/testing';
import { parrotPlugin } from './parrot-plugin';

it('the parrot passes every check', async () => {
	const report = await check(parrotPlugin());
	report.rows.map((row) => `${row.subject} ${row.check}: ${row.status}`);
	// [
	//   'parrot install: passed',
	//   'parrot/parrot sample: passed',
	//   'parrot/parrot roundTrip: passed',
	//   'parrot/parrot focus: unchecked',    // needs a browser
	//   ...
	//   'parrot/parrot docPositions: passed',
	//   'parrot setup: not-applicable'       // the parrot lists no setup
	// ]
});
```

Three things to get right:

- **Await it.** A failed row rejects the promise, and that's what fails your test.
- **Hand it the plugin value.** If a function of yours makes it, call that first (`parrotPlugin()`).
- **Dev checks have to be on.** They are under Vitest. Anywhere else, [turn them on](#outside-vitest) first.

It needs no DOM, so it runs in plain Node. Give it one (jsdom) and your `setup` runs too.

#### What a row says

A row is one check on one subject: `{ of, subject, check, status, detail }`. `of` is the subject's kind, `subject` is the name you gave it, and `detail` says what ran, or why nothing did.

| Status | What it means | Fails the run |
| --- | --- | --- |
| `passed` | The check ran and held | no |
| `failed` | It ran and didn't hold; `detail` says why | yes |
| `excused` | It failed, and an [excuse](#excuses) of yours covers it | no |
| `advisory` | It didn't hold, and this release only reports it. It fails from the next minor ([What is stable](plugin-guide.md#what-is-stable-what-is-not)) | no |
| `not-applicable` | Your plugin has nothing for it to check, like a type with no `complete` | no |
| `unchecked` | It needs something the run lacks, a browser or a DOM; `detail` says which | no |

An `unchecked` row isn't a pass. Covering it is your own browser tests' job.

A type with several samples gets one row per check. It fails if any sample fails, and the detail names the sample.

#### The checks

You declare nothing: a subject gets the checks its shape can take. One table per kind of subject.

**Your plugin.** `of: 'plugin'`, and the subject is the plugin's name.

| Check | Runs for | What it holds you to | Excuse |
| --- | --- | --- | --- |
| `install` | every plugin | It installs with its defaults and with your `options`, with no problem reported and no dev warning | no |
| `paintRanges` | a plugin with `paint` or `paintContainer` | Each paint you answer for a block lands inside it, where the editor can draw it. It's asked over every built-in sample and yours | no |
| `codeTokens` | a plugin with `code` | Your tokens for each language you list stay inside the body. They may nest, not cross | no |
| `setup` | a plugin with `setup` | Your `setup` runs against an editor, and so does the function it returns. It needs a DOM | no |

- `install` runs first. If installing throws, it fails and nothing else runs.
- An option with no valid default is fine: hand it through `options`. Once your own `validate` refuses the defaults, what the defaults-only install reports goes in the row's detail and doesn't fail it. With no `options`, that refusal fails.
- A paint or a highlighter that answers later (a dictionary still loading) has nothing on the first ask, so its row reads `not-applicable`. Hand it a source that answers at once, through `options`.

**A block type.** `of: 'block'`, and the subject is the type's full name (`parrot/parrot`).

| Check | Runs for | What it holds you to | Excuse |
| --- | --- | --- | --- |
| `sample` | every type | It has a sample, and each sample reads as the type first. A failing `sample` stops the type's other rows | no |
| `roundTrip` | every type | Each sample serializes back to its exact bytes | no |
| `mergeBackspace` | every type | Backspace merges into your block only as its `role` says | yes |
| `undo` | every type | One edit to your block is one undo step | yes |
| `clipboard` | every type | Copying your block copies its bytes and nothing else | yes |
| `search` | a type search skips | Search finds nothing in a block it skips | no |
| `rawWrite` | every type | Any bytes written into your block leave the blocks around it alone. Cutting your closing line can't swallow the block below | no |
| `unfinishedReading` | a type whose opener waits on a closer | An opener still waiting for its closer gives the document back when it closes | no |
| `completion` | a type with `complete` | Some prefix of a sample's first line completes into lines that read as your type, the caret inside them | yes |
| `dataWriteback` | a type with a `write` for its data | The data read from a block writes back to the same bytes | no |
| `docPositions` | every type | Each block of your type sits at the bytes it reads in the `Doc`, its text inside its line, its pieces inside it | no |
| `focus`, `selectionPaint`, `searchPaint`, `reorder`, `simOracle` | every type | Browser only, so `unchecked` here: a caret enters and leaves your block, a selection and a search match paint what they cover, a move takes the bytes whole, a long random editing session leaves the document sound | no |

**A container.** A type made by `container()` gets the block rows, then these, all from the same sample.

| Check | What it holds you to | Excuse |
| --- | --- | --- |
| `localIndex` | Children are addressed by their index inside your container, not by a document-wide count | yes |
| `ancestry` | An edit deep inside rebuilds every container above it | no |
| `focusBubble` | A caret leaving your top edge reaches the document once | yes |
| `openerLine` | Typing your opener above a block keeps the caret on a line it can type in. `not-applicable` unless a prefix of your first line waits on a closer below | yes |
| `containerCopy` | A copy into or out of your container reads back inside it, your markers on every line it holds | no |
| `containerDeclared` | Your line shape reads back every marker and line it writes | no |

**An inline construct.** `of: 'inline'`, and the subject is its full name (`wikilinks/note`). A marker pair is one subject, both its sides.

| Check | Runs for | What it holds you to | Excuse |
| --- | --- | --- | --- |
| `sample` | every construct | It has a sample | no |
| `claims` | every construct | Every sample holds a claim of your construct, starting at its prefix. A failing `claims` stops the rest | no |
| `roundTrip` | every construct | Your samples, and each line holding a claim beside any neighbour, read back to their bytes | no |
| `inlineDecline` | all but a mark | A claim of yours at a bracket gives way where the editor's own link or image closes inside it | no |
| `widget` | a widget | Your widget is one unit over exactly its bytes, and they read alone | yes |
| `editingPolicy` | a widget | Your widget edits as its fields say, and deleting it whole leaves bytes that read back | yes |
| `dependsContent` | a widget with `depends` | `depends` answers from the block alone, the same wherever the block stands | no |
| `inlineWriter` | `as: 'image'` or `'link'` | Your `write` gives a claim's bytes back from what was read out of them | no |
| `inlinePlace` | an inline or a mark with `after` | `after` names a construct it can follow: an inline's names one on its own character, a mark's names a mark | no |
| `pairSides` | a marker pair | Each side reads alone in a block, and both sides of one pair read one `key` | no |

**A command.** `of: 'command'`, and the subject is `plugin/id`. Every command you list gets one, and so does one a block type places as a chord or an action. A mark's toggle doesn't: the mark's own rows cover it.

| Check | Runs for | What it holds you to | Excuse |
| --- | --- | --- | --- |
| `waitingWrite` | every command | A command that waits writes nothing once the host loads another note | yes |
| `actionTarget` | a command a block type places | A block's command writes the block it's handed, not the one at the caret | yes |

**A caret menu.** `of: 'menu'`, and the subject is its trigger (`/`). Menus that share a trigger are one subject.

| Check | Runs for | What it holds you to | Excuse |
| --- | --- | --- | --- |
| `waitingWrite` | every menu | A pick that waits writes nothing once the host loads another note | yes |

**A paste rewrite.** `of: 'rewrite'`, and the subject is the full name of the type it rewrites (`heading`, `alerts/alert`). Rewrites that share a `from` are one subject.

| Check | Runs for | What it holds you to | Excuse |
| --- | --- | --- | --- |
| `rewriteLands` | every rewrite | Its answer lands as blocks of its own, leaving the block after it and the container around it, and a paste of the answer isn't rewritten again | no |

**How commands, menus and rewrites are run.** Against one editor, with nothing on screen:

- With a DOM, your `setup` runs on that editor first, and the function it returns runs last. With no DOM, a plugin that lists `setup` gets its command and menu rows `unchecked`.
- `waitingWrite` runs your command over a sample, or picks your menu's first row for an empty query. Once the call waits, the host loads another note. Any write after that fails the row.
- A call that returns no promise has no wait to check, so its row is `not-applicable`. If your command writes later, return its promise: a write the check sees after a call that returned none fails the row.
- `actionTarget` hands your command the second of two sample blocks while the caret sits in the first. Writing the first block, or inserting at the caret, fails it. A command that only asked the screen for something (a box, a menu) reads `unchecked`.
- `rewriteLands` pastes each sample of the `from` type with a block after it, at the top level and inside a container. An answer that leaves a fence open swallows the block after it, and fails.

The `waitingWrite` failure has one fix. Open the draft before the wait: a draft refuses on its own once its note is gone, and so does a menu's `MenuPick`.

```ts
// fails: the draft is opened after the wait, over whatever note is there by then
command({
	id: 'title',
	title: 'Fetch the title',
	run: async (editor) => {
		const title = await fetchTitle();
		await editor.edit().replace({ from: 0, to: 0 }, title).commit();
	}
});

// passes: the draft was opened in the note the command ran on
command({
	id: 'title',
	title: 'Fetch the title',
	run: async (editor) => {
		const draft = editor.edit();
		const title = await fetchTitle();
		await draft.replace({ from: 0, to: 0 }, title).commit();
	}
});
```

#### Excuses

An excuse covers a check a subject of yours can't pass, with the reason:

```ts
await check(memos, {
	excuse: {
		commands: {
			'move-up': { actionTarget: 'Move up swaps the memo with the block above it, so it writes both.' }
		}
	}
});
// the row: { of: 'command', subject: 'memos/move-up', check: 'actionTarget', status: 'excused',
//   detail: 'Move up swaps the memo ... (it found: handed the second block, it wrote the first block, where the caret was)' }
```

Each group is keyed by a name you wrote:

| Group | Keyed by | Checks it takes |
| --- | --- | --- |
| `blocks` | the type's own name (`memo`, not `memos/memo`) | `mergeBackspace`, `undo`, `clipboard`, `completion`, and a container's `localIndex`, `focusBubble`, `openerLine` |
| `inlines` | the construct's own name | `widget`, `editingPolicy` |
| `commands` | the command's own id | `waitingWrite`, `actionTarget` |
| `menus` | the trigger | `waitingWrite` |

`plugin` and `rewrites` exist too, and take nothing: none of their checks can be excused.

An excuse is a claim, not a waiver, and the run checks it:

- The reason is a sentence. `'n/a'` fails the run.
- An excuse over a check that passed fails the run. So does one over a check that doesn't apply, and one for a subject you don't list. Drop it when you fix the thing.
- A misspelt check, or one the table says takes no excuse, doesn't compile. From plain JavaScript it fails the run.
- A row that timed out takes no excuse.
- An `advisory` row takes one, so you can excuse a check before the release that makes it fail.

#### Options

| Option | Default | What it does |
| --- | --- | --- |
| `options` | none | Your plugin's own options, laid over its defaults for every check. `install` also installs the plugin without them |
| `excuse` | none | The [excuses](#excuses) above |
| `timeout` | `2000` | How long each wait of your plugin's may last, in milliseconds, before its row fails |
| `warningsFail` | `true` | Whether a dev warning raised during the run fails it |

**`timeout`.** It bounds a command's or a pick's promise, a menu's `rows` and a highlighter's answer. The fix for a row that timed out is usually `options`, not a longer wait: stub the fetch, hand over a dictionary that's already loaded. If you do raise it, keep it under your test runner's own (Vitest's is five seconds), or you read "Test timed out" where the row would have been.

**`warningsFail`.** A dev warning means the editor contained a contract violation instead of crashing on it, so one fails the run even when every row passed. `warningsFail: false` lets the run pass, and `report.warnings` still lists each one. `paintRanges` fails either way on a paint the editor left out.

#### When it fails

A failed row, or a dev warning, rejects with a `CheckFailure`. Its message names each failed row and the promise it breaks, and its `report` holds every row:

```
CheckFailure: check failed for plugin 'memos':
  - block memos/memo sample: "not a memo\n" reads as a "paragraph" first, not as "memos/memo"
    breaks: each block type has a sample, and each reads as that type first (plugin-testing.md#checking-a-plugin-value-check)
```

`isCheckFailure(error)` tells one from any other error. Use it over `instanceof`, which misses a failure thrown by another copy of the editor.

#### Outside Vitest

`check` refuses to run with the editor's dev checks off, since a contract warning would pass unseen. Vitest turns them on. Under another runner, or a bundler that resolves no export conditions, `configureEditorEnv` turns them on and `resetEditorEnv()` puts the detected defaults back:

```ts
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/testing';

beforeAll(() => configureEditorEnv({ isDev: true }));
afterAll(() => resetEditorEnv());
```

It can't turn them on in a build that resolves the `production` condition, since that build doesn't carry the checks at all.

#### The same run as data: `Conformance`

Your package's `./conformance` export is the `check` call written down, for [the command a listing runs](#the-check-a-listing-runs-aragonite-plugin-check). Its default export is a `Conformance`:

```ts
// src/conformance.ts
import type { Conformance } from '@voithos-labs/aragonite/testing';
import { parrotPlugin } from './index';

const suite: Conformance = { plugin: parrotPlugin() };

export default suite;
```

`plugin` is the plugin value. Its options go in `options` and its excuses in `excuse`, never into a call of the plugin. Your own test then runs what the listing runs:

```ts
import { check } from '@voithos-labs/aragonite/testing';
import suite from '../src/conformance';

it('the parrot passes every check', async () => {
	await check(suite.plugin, suite);
});
```

The file ships in your package, so keep its imports to your plugin's own plus `import type` from `@voithos-labs/aragonite/testing`. A host never loads it, and it shouldn't drag the checks into anyone's install.

### The check a listing runs: `aragonite-plugin-check`

**`npx aragonite-plugin-check [package | directory] [--json file]`**

The same run from outside your test suite, over your built package the way a host installs it, in plain Node. It reads your package's `./conformance` export: a [`Conformance`](#the-same-run-as-data-conformance), or for a `setup` plugin a [`PluginConformanceSuite`](#the-whole-plugin-at-once-runpluginconformance). The command comes with the editor, so it runs the checks of whichever editor version you installed. Pass a directory to check the package it holds (`.` is the default), or a package name to check one installed beside the editor:

```
$ npx aragonite-plugin-check .
checking aragonite-parrot@0.1.0 against @voithos-labs/aragonite@0.12.0
  passed parrot install
  passed parrot/parrot sample
  ...
  not-applicable parrot setup: lists no setup
  18 rows: 8 passed, 5 unchecked, 5 not-applicable
aragonite-plugin-check: passed
```

Each row gets a line, with its detail where it didn't pass, then a count of each status.

| Exit code | When |
| --- | --- |
| 0 | Nothing failed. Unchecked rows are counted, not failed |
| 1 | A check failed, or a dev warning was raised. The message `check` threw is printed |
| 2 | Nothing to run: the package has no `./conformance` export, or its default export holds no plugin |

`--json` also writes the result to a file: `{ package, version, editor, result, rows, warnings }`, where `result` is `pass` or `fail`. The command takes no `timeout` and no `warningsFail`, so each wait gets `check`'s two seconds and a warning fails. It exits once it has answered, whatever timer your plugin left running.

In CI, call the editor's reusable workflow instead of wiring this up yourself. It packs your repository's package, installs it beside the editor in an empty project with your package's install scripts off, runs the check and writes the result to the job summary:

```yaml
jobs:
  conformance:
    uses: voithos-labs/aragonite/.github/workflows/plugin-check.yml@v0.11.5
```

Pin the tag to the editor release you build against. With no inputs it checks your package against the newest editor release your peer range accepts; `editor` takes an npm spec to check another one (a `next` build, say), and `working-directory` points at a package that isn't at your repository's root. The [plugin template](plugin-guide.md#the-first-fifteen-minutes) already calls it.

### Round-trip is the contract

The one promise your plugin has to keep is the one the README makes: `serialize(parse(source)) === source`. `check`'s `roundTrip` rows hold it over your samples. Two more checks want a whole document, and those are yours to write.

**Live.** Mount an editor over a document that uses your syntax (the [mounting section](#mounting-the-editor-under-jsdom) shows how), read it back with `editor.getSource()`, and compare with what you authored.

**Left out.** Author a document using your syntax, then read it with your plugin nowhere in sight, and check it comes back unchanged. `parse` and `serialize` on `@voithos-labs/aragonite/plugin` read a document with no plugin value's types, so two lines do it:

```ts
import { parse, serialize } from '@voithos-labs/aragonite/plugin';

const MY_SOURCE = '%%parrot party responsibly\n';
expect(parse(MY_SOURCE).children[0].kind).toBe('paragraph'); // no dancing
expect(serialize(parse(MY_SOURCE))).toBe(MY_SOURCE); // but no damage
```

While you iterate, keep a dev build running (`vite dev`) and watch the console. The editor's contract warnings ([misuse outcomes](plugin-guide.md#misuse-outcomes)) only fire there. A clean dev console over a green round-trip is a decent sign your plugin's sound, and a suite can hold that line for you ([turning warnings into failures](#turning-warnings-into-failures)).

### Mounting the editor under jsdom

A drawing is only really verified mounted, and a jsdom mount is a supported way to do it. Two things stand in the way. The first is the browser APIs a mounted editor calls and jsdom doesn't have (`ResizeObserver`, `scrollIntoView`, and a text range's rects, which the editor reads to keep the caret on screen). `headless()` fills those in, each only where it's missing, so the call does nothing in a real browser. It makes no DOM, so a test with none (Vitest's `node` environment) brings jsdom first. Call it once, before the first mount:

```ts
// @vitest-environment jsdom
import { mount, flushSync } from 'svelte';
import { Editor } from '@voithos-labs/aragonite/svelte';
import { headless } from '@voithos-labs/aragonite/testing';

headless();

const target = document.body.appendChild(document.createElement('div'));
const editor = mount(Editor, { target, props: { source: MY_SOURCE, plugins, scrollMode: 'host' } });
flushSync(); // the first render has to land before you can assert on it
```

The stubs leave `document.elementFromPoint` alone, since the editor copes without it. If your own code asks it what's under a press, stub it yourself before the mount (jsdom lays nothing out, so no point has an element under it anyway):

```ts
document.elementFromPoint ??= () => null;
```

`scrollMode: 'host'` is the second thing: it drops the editor's own scroll container and the chrome a jsdom box can't size anyway ([host scroll mode](consumer-guide.md#host-scroll-mode)). And keep the fixture document short. The editor stops mounting blocks past an estimated-height budget in either scroll mode, jsdom reports a zero-height viewport, and a fixture tall enough to trip that unmounts the very block you're asserting on.

From there `target.querySelector` reaches your own markup, and `editor.getSource()` hands you the bytes to compare:

```ts
expect(target.querySelector('.parrot-block')).not.toBeNull(); // your drawing, not the raw-text fallback
expect(editor.getSource()).toBe(MY_SOURCE);
```

### One tab stop in reading mode: `tabOrder`

In reading mode Tab is the page's: it walks the document's links and buttons, and the whole editor is one stop in that walk (the block the reader was last in). A block that puts its own element in the tab order makes Tab stop on it like a link. The editor already gives the text you type in and a block focused whole their stop, so this only bites when your markup adds a `tabindex` of its own somewhere that isn't a control.

**`tabOrder(root: HTMLElement): string | null`**

Mount your block with `presentationMode: 'reading'` and hand it the editor's root, not your block. `null` means only controls and the editor's one stop are in the tab order; otherwise you get the problem, naming every extra stop:

```ts
import { tabOrder } from '@voithos-labs/aragonite/testing';

const editor = mount(Editor, { target, props: { source: MY_SOURCE, plugins, presentationMode: 'reading', scrollMode: 'host' } });
flushSync();
expect(tabOrder(target.querySelector('.editor')!)).toBeNull();
// a stray tabindex="0" on your wrapper instead gives:
// "reading mode has 2 tab stops that aren't controls (div.text-editable-block at [0], div.parrot-box at [1]): ..."
```

### Proving a paste rewrite is wired: `rewritePaste`

**`rewritePaste(text, plugins)`**

The function every paste that lands as blocks runs, over a string, so a test proves your rewrite is **wired**, not merely that your `into` works. `plugins` is what you'd hand an editor's `plugins` prop.

```ts
import { builtin, definePlugin, rewrite } from '@voithos-labs/aragonite/plugin';
import { rewritePaste } from '@voithos-labs/aragonite/testing';

const shout = definePlugin({
	name: 'shout',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		rewrites: [rewrite({ from: builtin.blocks.heading, into: (block) => block.text.toUpperCase() })]
	})
});

rewritePaste('# quiet please\n', [shout]); // '# QUIET PLEASE\n'
rewritePaste('quiet please\n', [shout]); // 'quiet please\n' (a paragraph, so nothing changed)
```

It answers for a paste from outside the editor that reads as blocks, and nothing else. Plain text and the editor's own copy are never rewritten, so it's not the route for testing those.

`check` runs the same function over each type your plugin rewrites, with a block after it (`rewriteLands`, in [the checks](#the-checks)). `rewritePaste` is for the cases a sample doesn't hold.

For a `setup` plugin, `plugins` takes the unit, and `undefined` runs every installed `setup` plugin's paste transforms, as an editor with no prop does. A unit you list is installed for the process, so reset between cases ([a blank slate per test](#a-blank-slate-per-test)).

### Turning warnings into failures

`check` fails on a dev warning by itself. Your own mounted tests don't, unless you ask. The editor reports the contract violations it can contain, rather than crash on, as dev warnings under an `[aragonite:…]` console head, and a suite that wants those red registers a callback for them:

```ts
import { setDevWarnSink } from '@voithos-labs/aragonite/dev-checks';

const fires = [];
beforeEach(() => setDevWarnSink((entry) => fires.push(entry)));
afterEach(() => {
	setDevWarnSink(null);
	expect(fires.splice(0)).toEqual([]); // a guard fired and nobody claimed it
});
```

While a callback is registered it takes over reporting completely (nothing reaches the console), and every entry is a small object. A rewrite whose `into` throws, for instance, is contained as a decline and reported like this:

```ts
import { builtin, definePlugin, rewrite } from '@voithos-labs/aragonite/plugin';
import { rewritePaste } from '@voithos-labs/aragonite/testing';

const boom = definePlugin({
	name: 'boom',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		rewrites: [
			rewrite({
				from: builtin.blocks.heading,
				into: () => {
					throw new Error('boom');
				}
			})
		]
	})
});
rewritePaste('# quiet please\n', [boom]); // '# quiet please\n', untouched

fires[0];
// {
//   tag: 'plugin-error',
//   message: "plugin 'boom' failed (rewrite paste)",
//   details: Error('boom')
// }
```

`setDevWarnSink` returns the callback it replaced, so a nested harness restores rather than clears.

One prerequisite: warnings only run while the editor believes it's in a dev build, and a callback over a production build stays empty for the wrong reason. Vitest gets the dev flag by itself; another runner turns it on as [outside Vitest](#outside-vitest) shows.

### The conformance kits

Everything from here down is for a `setup` plugin: one made with `definePlugin({ name, setup })`, whose kinds register for the whole process. A plugin value needs none of it, since [`check`](#checking-a-plugin-value-check) runs these checks with nothing to declare.

Conformance here means: your kind behaves the way the built-in kinds are required to behave, under the same checks. Three kits ship on the subpath, one per tier (block kind, container, inline syntax), and they share a vocabulary:

- Each kit runs **cells**, one check per behavior, and each cell is covered one of three ways. `assert` runs the real check. `exempt` means the invariant has nothing to bite on for your kind (there's no such operation to test). `boundary` means checking it needs something headless code can't reach (a browser, a mounted component).
- You declare an excused cell rather than skipping it, and both excuse modes want a reason that's a real sentence (a bare token like `'n/a'` fails the run). An excuse the kit can falsify, it falsifies.
- Every kit resolves with a report, and all three write a cell the same way: its `cell` name, its `status` (`asserted`, `exempt` or `boundary`), and usually a `detail` saying what ran or why nothing did (`CellReport`, if you want the type). A failing run throws a plain `Error` naming every failed cell instead, so a run drops straight into a test case under any runner.

### A blank slate per test

A `setup` plugin registers once: its setup writes into process-global registries that throw on a duplicate and never unregister. A test runner reuses one process across cases, so a plugin installed in a second `beforeEach` would collide with the first. That's what the reset is for.

**`resetPluginPlatformForTests()`**

Empties every registry a plugin writes into, so each case re-installs from nothing. Call it, then re-install your plugin's **unit**, the installable package `definePlugin` returns:

```ts
import { installPlugins } from '@voithos-labs/aragonite';
import { resetPluginPlatformForTests } from '@voithos-labs/aragonite/testing';
import { conspiracyPlugin } from './conspiracy-plugin';

const conspiracy = conspiracyPlugin(); // one unit instance for the whole file

beforeEach(() => {
	resetPluginPlatformForTests(); // empty the registries
	installPlugins([conspiracy]); // the unit, exactly as the `plugins` prop installs it
});
```

Seen from outside, a reset takes the plugin's whole footprint with it:

```ts
import { isPluginInstalled } from '@voithos-labs/aragonite/plugin';

installPlugins([conspiracy]);
isPluginInstalled('conspiracy'); // true
resetPluginPlatformForTests();
isPluginInstalled('conspiracy'); // false, and declaredPluginKind('conspiracy') throws until the next install
```

What that clears, and what it deliberately leaves alone:

- Cleared: everything a plugin registered (kinds, components, openers, commands, inline syntax, paste transforms, directive names and the rest), the renderer a plugin set on a renderer slot, and the installed-plugin set.
- Built-in registrations survive, exactly as in production, the built-in paste surfaces included, so a case that pastes into a built-in block after a reset needs nothing re-registered.
- Runtime state is untouched. The undo stack, the selection, and any live document are yours to set up.
- It's test-only and throws outside a detected test environment. Detection is Vitest-specific (it reads `process.env.VITEST`), so a suite on another runner (Jest, Playwright component tests, anything else) opts in first and puts the detected defaults back after. The same switch lets a test call a register function outside a plugin's setup, which throws in a dev build otherwise:

```ts
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/testing';

beforeAll(() => configureEditorEnv({ isTest: true })); // "yes, this really is a test process"
afterAll(() => resetEditorEnv());
```

Add `isDev: true` beside it to get the dev warnings too. `isTest` keeps the test-process rules, so the reset works and a register call outside a plugin's setup doesn't throw.

**Install the unit, not your register function.** Your registrations answer to your plugin only when its setup runs them, and that's how an editor's `plugins` list turns your kind on or off. Call `registerConspiracy(view)` yourself and the kind belongs to no plugin at all, so every editor shows it and your activation tests pass against a setup no user runs. Three more identity rules keep a suite honest:

- Installing the **same unit instance** twice (the `beforeEach` above plus an editor's `plugins` prop, say) is a no-op, which is why the sample builds `conspiracy` once at module scope.
- A **different instance under the same name** is kept out by a first-wins rule, with a dev warning naming the loser.
- Calling your register function directly **beside** a unit install makes the unit's setup re-register your kind, which **throws**. The register-once throw stays live under test on purpose, so the collision fails your suite instead of silently winning.

### The kind checkup: `runKindConformance`

**`runKindConformance(kind, profile?)`**

Takes your kind (the value `declaredPluginKind` returns) and runs one cell per editor system your block takes part in (undo, copy, search and friends), each one wherever your descriptor and your first sample say it applies. There's nothing to declare per cell, and no way to opt out of one. What runs now, with no browser:

- The fixture round-trips, and a kind declaring `rebuildRaw` also has it checked twice over: it keeps the parsed bytes exactly, and it emits the same bytes on every run.
- Backspace-merge eligibility is held to your declared `mergeRole`.
- A copy is a plain byte slice, with your kind at each end of the copied range in turn. A kind with no text of its own (a container, or a block focused whole) gets copied whole there, since a range ending on it holds all of it.
- One structural operation pushes exactly one undo entry.
- A kind that isn't `editable` gets nothing found in it by the document scan, since search skips it.
- The raw-write cell. It reads your descriptor's `rawWrite` (the rule that makes any bytes written into your block legal, like a fence growing past a body line that would close it) and comes after the system cells in the report:
  - With no `rawWrite`, it cuts the fixture's closing line and checks the block after it stays its own. It fails if the cut swallows that block (an unclosed fence reads everything below as its body), and the failure asks you to declare the rule.
  - With one, it drives the rule through a handful of damaging writes: the closing line cut, everything past the first line cut, an empty write, and, for a fixture of two or more lines, the first line cut and the closing line copied into the body. Each result has to come back unchanged from a second pass of the rule and keep every byte the write left alone (a rule may add bytes, never delete ones outside what was written). Every write but the first line cut also has to leave the block after it alone; the first line cut leaves your closing line behind, and that line is allowed to read on the way a reload reads it. On a fixture of three or more lines the closing line cut also has to keep your kind.
  - Your `mapOffset` is checked against `normalize` at every offset of each write: an offset before every byte the rule changed stays put, one after them moves by what the rule added or dropped, and none goes backwards.
  - It's `boundary` for a kind with the rule and no top-level fixture (none at all, or one sitting inside a container), and `exempt` for a kind with neither the rule nor a top-level fixture.
- The unfinished-reading cell, last. If your opener declares `readingNotFinal`, because it backs out without its closer or reads on like a fence ([A reading that isn't final](plugin-guide/parser.md#a-reading-that-isnt-final)), it takes your fixture's last line off and checks `mayClose` says yes to that line, the closer that finishes it, and that `closer` hands back a line that closes the rest into your kind again. It also asks `notFinal` of your fixture a line at a time: once it says final, it has to stay final. A reading no line closes (`closer: null`) is held another way: `notFinal` has to say it waits for the first line alone and for every run of lines short of the whole fixture (a `notFinal` written for the block's own bytes fails here), then call the whole fixture final; a `crosses` you declared has to accept every line of your fixture under the first, and your opener must not read on across a blank line put above the fixture's last line, since a block that does needs a `closer`. It's `exempt` for a one-line fixture, and for a reading that names a closer when your fixture minus its last line doesn't read as waiting, which covers every kind that neither backs out nor reads on. One catch: if your fixture is a fence and your opener declares no `readingNotFinal`, the cell fails and asks for `fenceReading`.

Cells whose mechanism only exists in a browser (focus, selection and search painting, reorder, and the note-taking simulation aragonite runs over its own kinds) are recorded `boundary`; the kit won't fake them green. Covering those is your own browser tests' job. The checkup reads kinds registered with `registerBlockKind`. A block type from `lineBlock` and friends isn't one: [`check`](#checking-a-plugin-value-check) runs these checks over it.

The whole checkup is one call. It resolves with a report, one cell per editor system and then the raw-write and unfinished-reading cells. For the bundled `[[toc]]` block:

```ts
const report = await runKindConformance(declaredPluginKind('toc'));
report.cells.map((c) => `${c.cell}: ${c.status}`);
// [
//   'roundTrip: asserted',      // the fixture round-trips
//   'focus: boundary',          // browser only
//   'mergeBackspace: asserted', // eligibility matches mergeRole
//   'selectionPaint: boundary', // browser only
//   'searchPaint: boundary',    // browser only, since the toc is searchable
//   'reorder: boundary',        // browser only
//   'undo: asserted',           // one edit, one undo entry
//   'clipboard: asserted',      // copy is a raw byte slice
//   'simOracle: boundary',      // aragonite's own simulation, never this runner
//   'rawWrite: asserted',       // no rule, and cutting the closing line swallows nothing
//   'unfinishedReading: exempt' // the toc never backs out
// ]
```

When something's wrong the run throws instead of resolving; a fixture that stopped producing your kind reads like this:

```
Error: kind conformance failed for "toc": sample parses to no "toc" node
```

**The fixture contract.** The first of your `samples` has to hold your kind inside its **first** top-level block, or the run fails outright: the undo and clipboard cells drive the fixture's first block, next to a throwaway neighbour block the kit adds. A kind that only ever appears nested still enrolls, sitting inside the first block; its clipboard cell then reports `boundary`, because its bytes get copied as part of the enclosing container.

Where your kind does something the generic check can't follow (a copy that builds new bytes, like a table range copying out as a smaller table), supply the check yourself: `runKindConformance(kind, { cells: { clipboard: { check: async (ctx) => … } } })`, where `ctx` hands you the parsed fixture and your kind's node. Your check runs instead of the generic one, so make it at least as strict.

### The container checkup: `runContainerConformance`

**`runContainerConformance(kind, profile)`**

The harness the built-in containers are held to, pointed at your own container kind. The profile carries your fixtures plus a coverage declaration per cell; the kit parses its way to your kind, so register the plugin before running it. Each cell checks the node of your kind its fixture points at: the end of `containerChain` for `localIndex`, the first block of `terminatorCollisionFixture`, the first one anywhere in `focusSource` and `deepNesting`. If something else sits there, the cell fails, so a chain that drifted onto a blockquote can't pass on the blockquote's behalf. The cells:

| Cell | What it holds you to |
| --- | --- |
| `localIndex` | Children are addressed by their index inside your container at each nesting level, not by a document-wide count. A grid container declares it `boundary`, since the kit only knows how to drive a grid operation for the built-in table |
| `ancestry` | An edit deep inside rebuilds bytes innermost-first, so the outermost block's raw reflects the leaf change |
| `multiScope` | One operation spanning two nesting levels pushes exactly one undo entry. The kit only drives such an operation for the built-in list and table, so a plugin kind declares this cell `exempt` (or `boundary`, if it does own one) |
| `focusBubble` | A focus move leaving your top edge reaches the document root exactly once, with no loop and no double-escape |
| `terminatorCollision` | A body line reproducing your container's own closing line stays inside the container |
| `titleRow` | Always on, and excused for a kind with no title row or one that isn't opaque. A `:::` container's opener line counts as a title row, and so does one you declare with `reservedChrome`. It needs your kind's own sample to type in: it types into your title row the way a keystroke does, then checks your block against a fresh parse of its bytes, metadata included. The editor doesn't re-read your metadata on a title keystroke, so none of it may come from the title's bytes. On a `:::` opener line the title is the text after the name; a change to `:::name` itself does re-read the container |
| `openerLine` | Always on, and excused when no start of your fixture's first line waits on a closer below. For each start that does (`:::c`, `:::co`, and so on), it types it above your fixture, where the editor closes it at once, and checks the caret's offset still sits in a line you can type in. A `:::` container passes on its own, since its opener line is that line; it's here for an opener of your own whose first line would otherwise send the next letter into the body |
| `copyMarkers` | Always on, and excused for a grid or a kind whose `deepNesting` leaf isn't inside it. It copies from a paragraph above your container into the `deepNesting` leaf, and for a line-prefixed (`strip`) kind out of that leaf to a paragraph below, then parses the copy and checks the copied end still sits under every container it sat under. The copy takes those markers from your container's own lines as they sit in the document, not from your `rebuildRaw`, so there's nothing to add for this one. It fails when part of your container, copied out, doesn't read back as your container |
| `declarations` | The kit's own cell, always on, and it also needs your kind's sample (a top-level block of your kind; a grid container needs none). Your `unwrapRole` names strategies that exist, `rebuildRaw` keeps the parsed bytes, rewrites only the edited child's lines when one child of your `deepNesting` source changes (so spell that source the way your rebuild wouldn't), and answers its changed-child shortcut with the same bytes as a full rebuild, `bodyWrap` matches what your parse does, the child your `lastLineChild` names (or the default one) really ends on your last line (and when the answer is -1, your own last line can give its ending up without a rebuild writing it back), and a declared `contentStartSpace` writes the space it took as your marker's when an empty line gains text |

You supply the fixtures, on top of the `samples` your descriptor already carries. For the guide's `:::conspiracy` container ([the walkthrough](plugin-guide/container-walkthrough.md#walkthrough-a-conspiracy-container-end-to-end)), a full profile looks like this:

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
				'::::conspiracy Big Bird is three kids in a coat\neyewitness sketch\n:::debunked The coat theory\nwool receipts\n\nthe coat has an alibi\n:::\n::::\n',
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
//   'multiScope: exempt',   // report.cells[2].detail is your sentence
//   'focusBubble: asserted',
//   'terminatorCollision: asserted',
//   'titleRow: asserted',
//   'openerLine: asserted',
//   'copyMarkers: asserted',
//   'declarations: asserted'
// ]
```

A failing run throws instead, naming every cell that failed and why. A `localIndexFixture` the kit can see through, say:

```
Error: container conformance failed for "conspiracy":
  - localIndex: localIndexFixture must edit a non-first child or descend through a non-zero chain position (else the local-vs-global check is vacuous)
```

Two notes on those fixtures. `localIndexFixture` has to edit a non-first child **or** descend through a non-zero chain position (that's the failure above): at chain `[0, 0]`, child 0, a local path and a flat global offset are the same number and the check proves nothing (the fixture above does both, since Big Bird deserves rigor). And `terminatorCollisionFixture.bodyRaw` names the bytes a **user types**, not the bytes that reach the tree: the kit writes them through your `bodyWrite` rule, the same route a real commit uses.

**`terminatorCollision` is the cell most container authors haven't considered**, and the profile type makes you declare it. If your container wraps body bytes between an opener and a closing line, a body line that reproduces that closing line ends it early, and everything below leaves the container the next time the document is parsed. A byte round-trip can't catch it, because the bytes come back out verbatim either way; only the live tree disagrees with them. So this cell checks convergence instead: the live tree has to agree with a fresh parse of its own bytes, block by block, on the kind, the children, and every key of the metadata.

Whether you may excuse it, and how to fix a real collision, depends on your terminator's shape:

- **Fence-shaped** terminators escalate: the `:::` containers lengthen their fence past the body's runs, and the editor does that for you, so the conspiracy above asserts the cell and passes without writing a line.
- A **strip** container (one that prefixes every line it emits, the blockquote shape) is immune, and is the one shape allowed to declare the cell `exempt`. An opaque container may not: the kit fails the cell if you excuse it.
- A **fixed-token** terminator, an HTML close tag say, can neither escalate nor prefix; it repairs the collision with [`bodyWrite`](#making-body-bytes-legal-bodywrite), rewriting the offending bytes on the way **in**, so the child's own raw carries the rewrite and nothing diverges.
- A **childless** container whose body lives in metadata supplies the optional `writeBody` on the fixture, so the collision probe reaches a body no child carries. The kit then rebuilds the way a commit does, so a fence your rebuild grew is already re-read into your metadata when the compare runs.

Escaping at the rebuild is the one repair that doesn't work, and it's the tempting one: an opaque container's raw is checked against its live children, so rewriting a child on the way out reads as staleness. Rewriting on the way in, before the bytes are reparsed, leaves no such gap.

One thing finishes the profile: it has to keep at least one asserting behavioral cell, or excuse itself whole through the optional `wholeProfileExemption`, with the same real-sentence reason bar and only when no cell asserts.

#### Declaring the wrap: `bodyWrap`

A container whose opener parses its body through `parseContainerBody` declares the same wrap as `container.bodyWrap`, and the `declarations` cell probes your parse in both directions, failing a declaration that doesn't match what the parse actually does. Why the editor needs telling at all:

- The parse moves the blank line against your opener into `innerPrefix` (the node field that holds it), so that line belongs to the wrap rather than being an empty first row. The editor's blank-line bookkeeping has to know that, or a delete that frees a blank line above your body's first block eats the line the wrap owns, and that block disappears on the next load.
- A strip container whose body starts at its own first line declares nothing, and then carries no `innerPrefix` either; a dev-mode check on the node's shape fails a wrap-less container that fills that slot.
- A childless container whose body lives in metadata has no body child to take a line from, so it declares nothing too, and the kit fails a declaration there as well.

#### Making body bytes legal: `bodyWrite`

A container kind declares `bodyWrite` when its body's bytes can carry grammar the container itself owns:

```ts
container: {
	contract: 'opaque',
	rebuildRaw: rebuildMyRaw,
	bodyWrite: {
		normalize: (raw, ctx) => /* raw, made legal as a child of this container */,
		mapOffset: (raw, offset, ctx) => /* where a caret at `offset` ends up after that */
	}
}
```

`normalize` runs over every byte destined for the body, **ahead of the reparse that decides the child's kind**, so the kind a write lands on is the kind its committed bytes describe. Two rules bind it:

- **Idempotent**: re-committing already-legal bytes changes nothing.
- **Line-local**: it may read the whole raw to decide which lines to rewrite, but it never moves bytes across a line boundary.

`mapOffset` says where a caret sitting at some offset in the typed bytes ends up in the committed ones. The pair is the same `WriteRule` shape a kind's own `rawWrite` uses. `ctx.node` is the container, and a body write is always `literal`. The bundled `details` container's pair, over a body line that would close it early:

```ts
const typed = 'exhibit A\n</details>\nexhibit B\n';
normalize(typed, ctx); // 'exhibit A\n&lt;/details>\nexhibit B\n'
mapOffset(typed, 5, ctx); // 5, nothing changed before it
mapOffset(typed, 21, ctx); // 24, the escape ahead of it grew the text by three
```

Two rules of thumb from that container. Ask the **grammar**, not your own spelling: what breaks `details` is everything the Markdown spec hands to raw-HTML passthrough, indented, upper-cased and trailing-space spellings included, which is looser than the canonical form your `rebuildRaw` emits, and `htmlBlockTagLineMatcher` from `@voithos-labs/aragonite/plugin` answers that question for a tag name. And rewrite the **minimum**: `details` escapes one `<` to `&lt;`, which renders as the literal tag both in the editor and on GitHub while matching no tag line, so the author still sees what they typed.

### The inline checkup: `runInlineKindConformance`

**`runInlineKindConformance(profile)`**

This kit checks a `setup` plugin's recognizer, the `registerInlineSyntax` call. A construct made by `inline()`, `mark()` or `markerPair()` isn't one: [`check`](#checking-a-plugin-value-check) runs its rows.

The same idea one layer down: register your recognizer (one of possibly several asked in priority order at your trigger character), then point the kit at it and it drives the behaviors a recognizer can break without moving a byte. The profile's fields, before the cells:

- `trigger`: the single character you registered on.
- `prefix`: your multi-character opener. Omit it for a bare-trigger registration.
- `priority`: only when two registrations share a prefix at different priorities; it says which one is yours.
- `kind`: the inline kind you created with `declarePluginInlineKind`. Omit it for a recognizer that only builds built-in nodes over its own bytes.
- `fixtures`: single-line sources your recognizer claims; `overlapFixtures`: sources where your prefix also spells a built-in construct (the star cell below).

The cells:

| Cell | What it holds you to |
| --- | --- |
| `claims` | Every fixture you supply is actually claimed by **your** recognizer, starting at your own prefix |
| `roundTrip` | Your fixtures, and the kit's interleavings of them with other syntax, round-trip, and your claims tile the scanned range with no gap |
| `overlapDecline` | Where your prefix also opens something the built-in scanner owns, the parse holds the built-in's construct, not yours |
| `widget` | Your claimed bytes are one atomic unit, and your rendered widget spans exactly the bytes it stands for |
| `editingPolicy` | Your widget's editing declaration exists, is in the vocabulary the caret-edge dispatch actually reads, and (for one-press delete) leaves bytes behind that round-trip |
| `imageClaim` | A recognizer that builds built-in nodes comes with the `rewriteImage` hook the write paths need |
| `registration` | Your recognizer is registered the way your profile says, alone at its prefix and priority |

`claims`, `roundTrip`, and `registration` always run; the other four you declare. Here's a profile for an `![[…]]` embed recognizer that declares its own `EMBED` kind and renders it with a Svelte component:

```ts
import { runInlineKindConformance } from '@voithos-labs/aragonite/testing';

it('the embed recognizer conforms', async () => {
	await runInlineKindConformance({
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

(An embed recognizer that builds real built-in images asserts `imageClaim` instead, and excuses `widget` and `editingPolicy`, since a built-in kind renders through the built-in widget.)

Its `detail` strings say how much each cell actually chewed through. For that profile:

```ts
const report = await runInlineKindConformance(profile);
report.cells.map((c) => `${c.cell}: ${c.status} (${c.detail})`);
// [
//   'claims: asserted (2 claim(s) across 2 fixture(s))',
//   'roundTrip: asserted (20 source(s) round-trip byte-for-byte and tile their scan range)',
//   'overlapDecline: asserted (1 prefix position(s) declined across 1 overlap fixture(s))',
//   'widget: asserted (recognition and a self-delimiting claim)',
//   'editingPolicy: asserted (policy vocabulary)', // plus a whole-delete check if your policy says atomic
//   'imageClaim: exempt (this recognizer builds only its own kind, never a built-in one)',
//   'registration: asserted (prefix rung at priority 40, below the built-in boundary)'
// ]
```

Twenty sources on the round-trip cell, from two fixtures: the kit runs each one alone and in nine interleavings with other syntax (emphasis around it, a link around it, a blockquote in front, your own trigger on either edge, and so on). A profile the kit refuses throws before any cell runs, with the plain reason:

```
Error: overlapDecline asserts but the profile supplies no overlapFixtures
```

`fixtures` is required and non-empty, and a fixture your recognizer doesn't claim **fails** rather than being skipped: every cell reads the nodes a fixture produces, so an unclaimed one would enroll your syntax without testing it. `widget` and `editingPolicy` only look at the nodes of your `kind` (built-in nodes your recognizer builds are `imageClaim`'s job), so if none of your fixtures produce your kind, an asserted `widget` fails instead of passing over some images, and so does an asserted `editingPolicy` whose policy deletes the widget in one press.

**`overlapDecline` is the cell most inline authors haven't considered, and on a reserved trigger it's required.** Registering on a trigger the built-in scanner owns (`[`, `!`, `*`, `` ` ``, and friends) puts your recognizer ahead of the built-in case. `![[a]](https://x.dev)` is a plain image whose alt text is `[a]`, and on `[` and `!` the editor declines your claim there itself. Supply the sources where your grammar and a built-in one collide; the kit parses each and requires that none holds a node of yours, so a fixture that spells no built-in construct fails as an overlap that isn't one. A recognizer on a reserved trigger may not excuse this cell at all, since the overlap exists by construction.

The other three declared cells are yours to excuse, since only you know whether they have anything to bite on. But an excuse the kit can falsify, it falsifies: declaring `imageClaim` exempt while a fixture produces a stamped built-in (a built-in node the scan marked as your recognizer's) fails, as does excusing `widget` for a kind that **is** a registered live widget, or `editingPolicy` for a kind that declares one.

One thing worth knowing about `widget`: it asserts your claimed slice is **self-delimiting**. Re-scanning the slice alone must re-form the same kind over its whole length, because that slice is exactly what the widget's `data-source-*` attributes (the ones saying which bytes it stands for) hand the clipboard and a source reveal. Those attributes sit on the span the editor makes for your view, not on anything you build, so there's nothing about the span left for you to get wrong and the cell needs no DOM.

`registration` is the thinnest cell: yours is the only registration at its prefix and priority, and the scan visits your trigger. `registerInlineSyntax` already refuses most of what it checks. What you _can_ get wrong is your recognizer not being there at all (a setup step that ran under the wrong guard, say), and that one doesn't wait for the cell: the run throws before any cell starts, telling you to register the plugin first.

### The whole plugin at once: `runPluginConformance`

**`runPluginConformance(suite)`**

The three kits each take one kind. This one takes your whole `setup` plugin: it empties the registries, installs your units the way the `plugins` prop does, and runs every kit over every kind their setups declared. A plugin value fails it and goes to [`check`](#checking-a-plugin-value-check). It's also the check a plugin listing runs, so it's strict about what it gets: a container kind needs a container profile and an inline kind needs an inline profile, since without fixtures those kits have nothing to run. Any dev warning raised along the way fails the run, so it wants dev checks on (it's on under Vitest; anywhere else, `configureEditorEnv({ isDev: true })` first).

The suite is your units plus those profiles. A profile names its kind as a string, because the branded kind only exists once your setup has run:

```ts
import { runPluginConformance, type PluginConformanceSuite } from '@voithos-labs/aragonite/testing';
import { conspiracyPlugin } from './conspiracy-plugin';

const suite: PluginConformanceSuite = {
	plugins: [conspiracyPlugin()],
	containers: { conspiracy: conspiracyProfile } // the profile from the container checkup above
	// inline: [{ trigger: '!', prefix: '![[', kind: 'embed', ... }] for an inline kind
};

it('the plugin conforms', async () => {
	const report = await runPluginConformance(suite);
	report.kinds.map((k) => k.kind); // ['conspiracy']
});
```

It resolves with every kit's report (`plugins`, `kinds`, `containers`, `inline`, and in `rows` a row for the install and one per cell), and a failure throws one `Error` naming each broken cell and the contract it breaks, with the section of this page that explains it:

```
Error: plugin conformance failed for "memo":
  - kind conformance failed for "memo":
      - rawWrite: "memo" declares no rawWrite, and the closing line cut ("%%memo a\n") swallows the next block ("raw write sentinel\n"): declare rawWrite to put the closer back
        breaks: any bytes written into your block leave the blocks around it alone (plugin-testing.md#the-kind-checkup-runkindconformance)
```

A kind left without its profile fails the same way (`container kind "conspiracy" has no profile in the suite's containers`), and so does a profile naming a kind your plugins never declared.
