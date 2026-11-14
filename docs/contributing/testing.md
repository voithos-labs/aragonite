# Testing

Read this when you're writing a test, or staring at one that went red for no reason you can see. There's always a reason, and the usual ones are below.

## The two layers

Unit tests run under Vitest and live in `src/lib/test/`, apart from the e2e suite's own lints in `src/lib/e2e/lint/`. e2e specs run under Playwright, in a real browser, and live in `src/lib/e2e/`. `src/lib/testing/` is neither: it's shipped code, the test kits plugin authors import, so no tests go there.

`npm test` runs both layers. While you work, run one area: `test:editor:<area>` is one folder of `src/lib/test/` and `test:e2e:<area>` is one Playwright project or a folder in one, as in `npm run test:editor:core` or `npm run test:e2e:blocks:list`. `package.json` lists them all. Touched the parser or the serializer? Run `npx vitest run src/lib/test/round-trip.test.ts` first. Until a document comes back byte for byte, nothing else is worth reading.

## Where a unit test goes

A test's path mirrors its source's, with a leading `components/` dropped: `src/lib/components/blocks/code/` is tested in `src/lib/test/blocks/code/`. A few holdouts keep theirs in `src/lib/test/components/`, mainly the files directly in `src/lib/components/`, its `menu/` folder and its `dom-block-view/` folder. Mirror the depth too, so a test that imports a nested module directly sits at that nested path. When a module moves, its test moves with it. The exceptions:

- Tests that cut across the editor root's services sit at the root of `src/lib/test/`.
- `src/lib/test/invariants/` holds the invariant catalog's tests, the shared generators (`arbitraries/`) and the source scans (`lint/`).
- The simulation engine lives under `src/lib/e2e/simulation/`, and its unit tests in `src/lib/test/simulation/`.
- The debug panel's state test sits in `src/lib/test/debug/`, though its module lives under `src/routes/`.

Two folders hold no test files. `src/lib/test/support/` is only what Vitest loads by itself: the setup files and their data. `src/lib/test/harness/` is whatever a test imports to mount, drive or build fixtures.

| If the test file... | Then |
| --- | --- |
| writes a rune (`$state`, `$effect`) | Its first line is `// @vitest-environment jsdom`, mount or no mount. Under Node, Svelte's server build turns the rune into a plain value and runs no effects, so the test passes without testing anything. |
| has to prove a walk isn't recursive | Name it `*.deep.test.ts`. Those run in their own Vitest project, on a stack kept small on purpose. |
| is a source scan | It reads its file paths from `src/lib/test/invariants/lint/source-paths.ts`. A literal path in a scan fails a test. |
| changes `process.env` or patches a built-in | Restore it inside the same test, because files share a process. Each file also runs in its own VM context, so a value Node created fails `instanceof` against the file's own `Error` or `Array`. |

## Writing a unit test

- **Plugins.** The plugin platform resets itself before every test, so install plugins in `beforeEach` or in the test body. Installed at file load or in `beforeAll`, they're wiped before the first test runs, and the suite quietly tests plain GFM. A lint rejects that, and a reset hook of your own.
- **Dev flags.** The dev-build flags (`configureEditorEnv`) reset per test the same way. Set them in the test.
- **One gesture.** Mount the block alone with `mountBlock`, overriding only the context you assert on. The mount helpers are all in `src/lib/test/harness/`.
- **Several gestures.** Mount the whole editor with `mountEditor`. A block mounted alone never receives the re-rendered node, so its second gesture acts on a stale one.
- **Waiting.** Use `settleEditor`, or the mounted editor's `settle()`. No timers.
- **A new required context.** When blocks start requiring a context, add its stub to `src/lib/test/harness/mount-context.ts`, not to each test.

```ts
// @vitest-environment jsdom
beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

it('unwraps a sole child into a bare paragraph', async () => {
	const mounted = mountEditor({ source: '> alpha\n' });
	await pressKeyAt(mounted, [0, 0], 0, { key: 'Backspace' });
	expect(mounted.source()).toBe('alpha\n');
});
```

## A dev warning fails its test

A dev build reports trouble through the console, and every gate counts such a line as a failure. That's most of the mystery reds. There are three kinds, told apart by prefix:

| Prefix | Kind | What it means |
| --- | --- | --- |
| `[aragonite:invariant:<name>]` | Guard | A contract broke. Never benign. |
| `[aragonite:<subsystem>]` | Diagnostic | A subsystem refused something and carried on degraded. Usually a defect upstream, now and then benign. |
| `[svelte] <code>` | Svelte's runtime | Svelte's own warning. |

The Svelte code this repo actually hits is `state_proxy_equality_mismatch`. Here it means a copy of a node outlived its insertion into the reactive tree and got compared with the tree's proxy. Re-read the node from the tree. Debug it in a dev build, where the message names the operator.

### What fails on what

| Where it fires | What goes red |
| --- | --- |
| Unit suite | The test that provoked it, unless that test claims it (next section). |
| e2e spec | The spec, at teardown. Uncaught page errors and rejections count too. |
| Simulation session | The session, at the checkpoint it had reached. |
| The app server, during server rendering | The whole run, and only when Playwright launched that server. |

A fire that turns no gate red is a bug in the gate, so file it. Under Vitest a dev warning never reaches the console, because the setup sends each fire to a collector, so a `console.warn` spy sees none of them. A spy that swallows the call hides Svelte's warnings from the gate, which reads them off `console.warn`, and mocking the dev-checks module hides every fire in the file. A source scan rejects both.

### Claiming a fire in a unit test

Four ways, narrowest first. Use the first that fits. The helpers are in `src/lib/test/support/warn-gate.ts`.

1. **The fire is what the test is about.** Assert on what `takeDevWarns()` returns. If the test is about one guard only, read `takeDevWarnsOf(tag)`: it leaves every other guard's fire to fail the test, where a filtered `takeDevWarns()` throws them away (a scan rejects that).
2. **The fixture is noisy ahead of the part you assert on.** Call `drainDevWarns()` after the setup.
3. **The fixture provokes a fire the test isn't about.** Allow the tag for the file, as in `afterEach(() => allowDevWarns(['block-host']))`, with the reason on the line above.
4. **The run-wide list**, `src/lib/test/support/warn-allowlist.json`. It's empty. A first entry needs a maintainer to agree, and a guard fire never qualifies. It's that strict because an entry hides every fire of that tag at that site, the real ones included.

A fire deferred by a tick still belongs to its test: claim it there (`await tick()`, then take it), not with a file-level allowance. Two more things are red: a file-level allowance whose tag never fires, and a fire that arrives after the file's last test has its verdict.

In e2e, declare a fire you intend with `test.use`, as in `test.use({ expectInvariants: ['late-opener-registration'] })`. There's one option per kind (`expectInvariants`, `expectWarns`, `expectSvelteWarns`, `expectPageErrors`), all in `src/lib/e2e/fixtures.ts`. A declared fire that never comes is red too.

## Writing an e2e spec

```ts
import { test } from '../fixtures';
import { EditorPage } from '../editor-page';

test('typing lands at the end of the paragraph', async ({ page }) => {
	const editor = new EditorPage(page);
	await editor.goto();
	await editor.loadContent('hello\n');
	await editor.focusBlockEnd(0);
	await editor.typeText(' world');
	await editor.bridge.waitForSourceContains('hello world');
});
```

- **Imports.** `test` and `expect` come from `src/lib/e2e/fixtures.ts`, never from Playwright. That fixture is what turns a spec red for a dev warning, a Svelte warning, an uncaught error, or a request to any host but the app server. A spec that needs an outside page serves a fake host through a route of its own.
- **Who does what.** The page object (`EditorPage`) acts. Its `bridge` reads state and waits on it.
- **Act as a user would.** Type with keys, select with Shift+arrows or a drag, undo with the chord. Changing state through the bridge skips the handlers the spec exists to test, so the bridge only reads.
- **Navigation.** Only through the helpers that wait for the route to be ready: `editor.goto()`, or `gotoReady` and `reloadReady`. A lint rejects a raw `goto` or `reload`, because server-rendered markup shows up well before its handlers attach.
- **One navigation per test.** A test that needs another URL gets its own `describe` with its own `beforeEach`. Mounting in a mode and switching to it later run different code, so choose on purpose.
- **Mode switches.** Only through `setPresentationMode` or the helpers in `src/lib/e2e/mode-switch.ts`, which wait for the mode. A switch that silently failed leaves you in source mode, where most live-mode assertions still pass.
- **A new route** needs a row in `src/lib/e2e/goto-ready.ts` :: `READY_BY_ROUTE`, or `gotoReady` won't type-check.
- **The app under test** is a development build (dev checks on), built when the run starts and served as a build. Edits you make during a run don't reach it.
- **`E2E_PORT`** moves the run to another port, so two worktrees don't collide. Set variables through the env script, as in `node scripts/run-with-env.mjs E2E_PORT=1440 -- npm run test:e2e:blocks`. An inline `KEY=1 cmd` fails on Windows shells.
- **`E2E_SERVER=dev`** uses the Vite dev server, for Playwright's UI and watch modes. If it fails with "Failed to fetch dynamically imported module", a package loaded through `import()` is missing from `optimizeDeps.include` in `vite.config.js`.

## Requirements pair with specs

Every spec has a requirement file at the mirrored path under `src/lib/e2e/requirements/`. It holds the scenarios in plain English, it's written first, and it follows the plain-words rule that comments follow (`docs/contributing/code-style.md`).

| Situation | What to do |
| --- | --- |
| A spec or a requirement file has no partner | The lint is red. Repair the pairing. |
| Far more scenarios than tests in the spec | The lint is red. Filler tests are the wrong fix, since one test normally covers several scenarios. A justified exception goes, with its reason, in the allowlist inside `src/lib/e2e/lint/requirement-spec-lockstep.test.ts`. |
| A scenario is covered by a unit test | List it under a `## Pinned below the browser` heading, naming the test's path. |
| You fixed a bug with an e2e test | Its one-line miss-analysis goes in the requirement file (`docs/contributing/rules.md` § Fixing bugs). |
| A spec goes in `src/lib/e2e/tests/perf/` | The file name picks the Playwright project: `vr-*.spec.ts` runs in `npm test`, `*.perf.spec.ts` only in the perf runs. Misnamed, it quietly doesn't run where you meant. |
| A block reaches three spec files | It gets its own subfolder and its own area script. |

## Patterns and gotchas

Every row here is a past flake, or a test that couldn't fail. Nobody reads this top to bottom, so find your row.

| Topic | What to do |
| --- | --- |
| Isolation | The suite is fully parallel. Tests in one file may run at the same time, in any order, on separate workers. State belongs in `beforeEach` or in the test. |
| Typing | `typeText` inserts in one go: fast, and right for end-state assertions. `typeSlowly` sends real key events per character, for per-keystroke behavior. With the second, wait for each character to land before the next, or the re-render's caret restore can scramble the order. |
| Undo steps | Typed keys stay one undo step until the spec calls `endTypingBatch`. Don't depend on the real pause timer, which runs late under load. |
| Waiting | Wait on document state, with the bridge's `waitFor` predicates. A fixed wait is acceptable only where no state exists to watch: layout settling, a copy (it changes no editor state), or showing that a gesture with no key changed nothing. Each one carries a comment saying which. |
| Proving a key did nothing | `pressDeclined` and `typeDeclined`. A failure naming a key means the press reached no editable element. That's a bug, not a reason for a longer timeout. |
| Placing the caret | The focus helpers (`focusBlock`, `focusBlockStart`, `focusBlockEnd`, `focusBlockAtPath`). Click or arrow only when placement is the subject. |
| Pointer targets | Take the point from `src/lib/e2e/text-runs.ts`. A hand-rolled DOM walk miscounts widgets and hidden markers and aims off target, and a scan rejects one. |
| Block counts | `bridge.getBlockCount()`. A DOM count sees only the mounted blocks. |
| After a split, merge or delete | Navigate through a container. Flat paragraphs hide stale-index bugs. |
| Focus | Type a character and check where it landed. The source is correct whether or not focus is. |
| Addressing blocks | Page-object helpers and tree paths. Avoid raw selectors. |
| Block text | It includes the block's markers. |
| Image widgets | Wait for the decode (`waitForImagesDecoded`) before reading geometry. Before it the box is zero-sized, and a click computed from it later lands inside the image. This one shows up only as a full-suite flake. |
| Clipboard | `seedClipboard`, `readClipboard` and `paste`. A scan rejects a spec that presses paste itself. |
| IME | For handler behavior during composition, the unit harness in `src/lib/test/harness/editable-surface.ts`. For real event order, the e2e driver in `src/lib/e2e/simulation/ime.ts`. A key pressed mid-composition, and the key that starts one, go through the driver's `press` and `openingKey`, or the composition ends early. |
| Scroll-sensitive specs | Click with `clickInPlace`. Firefox's driver centers a target before every action. |

## Browser engines

Chromium is the default, and the only engine in `npm test`. `ENGINE` switches the browser for every project: `npm run test:e2e:webkit` and `npm run test:e2e:firefox` run everything on that engine. Run them with nothing else going, since they're slower and timing-sensitive under load. Perf rows and docs screenshots are Chromium-only by design.

CI runs all three engines on every pull request. A red there with no open issue matching it is new, and belongs to the PR's author. There is no expected-failures list: a red on one engine gets fixed or skipped, by cause.

| Cause | What to do |
| --- | --- |
| The driver can't perform the gesture there | Skip through `skipUnlessSupported` in `src/lib/e2e/browser-engine.ts`. |
| The engines rightly behave differently | Skip on that engine, with the reason. |
| A real bug | File an issue, and put a conditional `test.fixme` as the test's first statement. The other engines keep running it. |
| A flake | The same `fixme`, for as long as its issue is open (`severity: watch` until confirmed). The issue carries the command that repeats it. |

A `fixme` reads like `test.fixme(isWebKit(page), '#123: Backspace goes back in history')`. The reason starts with `#<issue>: `, and a lint holds it to that. The call has to sit inside the test and be conditional, because `scripts/release/fixme-recheck.mjs` re-runs exactly that form to spot the ones that now pass. When a test is skipped on an engine, its requirement bullet stays as written and gains an indented line saying where the skip is.

**What a green run doesn't tell you.** Playwright's WebKit approximates Safari and WKWebView. It is neither. And nothing here runs the app that embeds the editor (a desktop shell's webview, say): clipboard handling, accelerator keys and image-source policy are that app's decisions. Only a real host, or a user, finds those.

## The heavier suites

The suites that don't fit "one behavior, one test". Most run inside `npm test` already. The last column is what to know before you touch one. Two lists outside the table can only shrink too: the accessibility allowlist (`src/lib/e2e/a11y/axe-baseline.json`) and the mounted-block ceilings in the windowing specs.

| Suite | What it catches | Command | Know this |
| --- | --- | --- | --- |
| Conformance differ | The inline parser drifting from a pinned reference parser | `npm run test:editor:conformance` | The baseline can only shrink, both ways: a new divergence is red, and so is a listed one that stopped diverging. Bumping the reference is a deliberate re-bless plus a changelog note. |
| Property suites | Inputs nobody thought to write down | `npm run test:editor:property:fresh` | The gate's seed is fixed. This script draws random ones: run it when you change the inline parser, the tree or the generators. A find only lasts once its counterexample is committed as a regression case. |
| Generator floor | A shared generator going tame | `npx vitest run src/lib/test/invariants/corpus-coverage.test.ts` | Red when a shared generator stops producing non-ASCII, astral characters, combining clusters or CRLF. If one guard's check chokes on a generated shape, improve the check. Removing the shape from the generator is the last option, because every suite loses it. |
| Live-mode gesture fuzzer | Live mode writing bytes source mode wouldn't | `npm run test:editor:simulation` | Random typing and deleting near hidden markers, each gesture replayed in source mode from identical bytes. A live-only divergence is red, a shared one is capped by a ceiling, and a lone surrogate the editor wrote is always red. |
| Note-taking simulation | Document corruption | `npm run test:e2e:simulation` | Whole notes typed key by key, with typos, undo, paste and resize, checked throughout. It's the strongest corruption detector in the repo, and blind to anything it doesn't type. Predict printable typing only, and re-read the document after anything the editor does automatically. Some notes exist to type one construct mid-session, so keep those constructs. |
| Recordings | A recorded input session replaying to different bytes | `npm run test:e2e:recordings` | Record on a small invented document. A user's report gets re-recorded on a reduced one, since the file holds every character. For a bug, edit the expected steps so it's red until fixed. For an intended change, re-bless with `RECORDINGS_BLESS=1`, and the file's diff is the review. |
| Short-input exhaustion | A string of a few characters that fails to parse, round-trip or take an edit at some offset | `npm run test:editor:exhaustive` | Known failures get one entry per defect. The fix deletes the entry, and an entry matching nothing is red. If you touched the parser or the commit path, run the long form once (`npm run test:exhaustive`) and report it. |
| Range-edit laws | Copy, cut, paste, type-over and delete disagreeing over one range | `npx vitest run src/lib/test/range-laws` | Driven through the mounted editor as browser input, never by calling edit functions. Known failures get one narrow row per class, and closing the class deletes the row. |
| Behavior differential | Any key doing something it didn't do before | `npm run behavior` | Every key at every offset across a document set, compared with the branch's base commit. A refactor shows an empty diff. A behavior change shows exactly the inputs you meant. It runs on jsdom, so keys the editor leaves to the browser do nothing there. |

## What CI runs

When a job you've never heard of fails your PR, this is the table to search. The workflows are in `.github/workflows/`.

| Job | What it proves | Local command |
| --- | --- | --- |
| `unit` | Lint, types and the unit suite | `npm run lint`, `npm run check`, `npm run test:editor` |
| `e2e`, `e2e-webkit`, `e2e-firefox` | The e2e suite on each engine, in shards | `npm run test:e2e`, or the engine's script |
| `e2e-census` | Every test ran in exactly one shard per engine | None. A red means a shard was lost, doubled, or ran other than its planned tests. |
| `perf` | The keystroke ceilings, against a production build | `npm run perf:check` |
| `consumer-smoke` | The packed library installs, type-checks, builds and hydrates in `examples/consumer`, inside its size budget | `node scripts/smoke/consumer-smoke.mjs` |
| `adapter-smoke` | One browser test set passes in each framework wrapper's example app. The release PR runs every app, as `adapter-suite`. | `node scripts/smoke/adapter-smoke.mjs --per-pr`, or without the flag for every app |
| `template-smoke`, `plugin-check` | The plugin template builds and passes its own checks, and so does every bundled plugin. | `node scripts/smoke/template-smoke.mjs` |
| `emoji-table` | The committed emoji table is the generated one | `node scripts/vendor/verify-emoji-table.mjs` |
| `e2e-webkit-macos` | The e2e suite on WebKit on macOS, the nearest a runner gets to Safari. Nightly, and on pull requests to main. | `npm run test:e2e:webkit` on a Mac |
| `android`, `ios` | Typing through a phone's own keyboard | None locally. Not required checks, and a green means one keyboard on one browser build. |
| Plugin listing | A plugin added to the gallery listing passes the plugin check | `node scripts/plugins/listing.mjs` |

- `examples/consumer` is a test, not documentation. If something can only be learned from that folder, that's a docs bug to file. Its plugin folder is generated, so hands off.
- A new example app joins the adapter suite's list in `examples/adapter-suite/apps.mjs`. Outside CI the suite reuses whatever server already holds an app's port, so stop leftovers first.
- On the plugins test route (`src/routes/test/plugins/`), the callout fixture's two directive names, `callout` and `aside`, are reserved. A name two plugins want is settled by install order, which differs between the shared server and a fresh tab. A fixture whose trigger takes a common character (`#`, `:`, `[[`) installs only when the route's `?seed=` names it.

## Size budgets

The number that matters is the JavaScript a minimal app loads up front, because every consumer pays for it. It's stored in `scripts/pack/size-budget.json` as a baseline plus a tolerance, and `scripts/pack/verify-pack.mjs` checks it. Each prebuilt entry point also has a ceiling, edited by hand in `scripts/pack/verify-prebuilt.mjs`.

The check is red in both directions. Over means too much landed: trim it, or bless it if the growth is on purpose. Under means the baseline is out of date: bless it, so the saving can't be quietly spent later. To bless, run `npm run package`, then `node scripts/pack/verify-dev-strip.mjs --bless`.

`npm run measure` gates nothing, and a branch reports its deltas with `npm run measure -- --against <base>`. For the perf harness, read `docs/design/performance.md`. For dumping the editor's state from inside a test, read `docs/contributing/debugging.md`.
