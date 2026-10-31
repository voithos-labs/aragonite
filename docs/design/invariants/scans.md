# Group 4: source scans

The words this catalog leans on, and what the enforcement levels mean, are in [the index](../invariants.md).

These are tests that read the source text itself. They catch what a type can't express and a runtime
check can't see: a pattern anywhere in the tree, or a published table drifting from the code that
backs it.

Scans over the library live in `test/invariants/lint/` and ride `npm run test:editor:invariants`.
Scans over the e2e tree live in `e2e/lint/` (G4.17, G4.22, G4.23, G4.49, G4.133, G4.211,
G4.212, G4.213, G4.226, G4.228, G4.232, G4.237, G4.255) and **don't** ride that script; run them with `npx vitest run src/lib/e2e/lint/` (same in
bash and PowerShell), and `npm test` runs both.

This is the catalogued set, not the whole of `test/invariants/lint/`: a scan holding one module's
local rule gets a file without a G-number, so read the directory too before assuming a rule is
unguarded.

| ID     | What stays true                                                                                  | Codes   |
| ------ | ------------------------------------------------------------------------------------------------ | ------- |
| G4.1   | `createBlockListState` takes getters, never values                                               | L       |
| G4.2   | The render path computes inline content, never reads the cache                                   | L       |
| G4.3   | Every container passes the conformance kit, and its declarations resolve                         | harness |
| G4.4   | No timing hacks for sequencing                                                                   | L       |
| G4.5   | No synthetic `KeyboardEvent` in editor runtime source                                            | L       |
| G4.6   | Editor CSS and tokens live where the ownership rules say                                         | L       |
| G4.7   | A render memo keys on every input its built DOM embeds                                           | D·N     |
| G4.8   | Every documented chord resolves in the surface that dispatches it                                | L       |
| G4.9   | Every published theme token is declared, with light and dark values                              | L       |
| G4.10  | _Retired upward_: each plugin is its own package, held to that package's shape (G4.277)          | L       |
| G4.11  | Exactly the allowed paste routes apply paste transforms                                          | L       |
| G4.12  | Caret-edge destructive keys route through the one edge-policy dispatch                           | L       |
| G4.13  | No view-stripping cast outside `tree-operations/` and the undo controller                        | T·L     |
| G4.14  | Every component prop reading the CST is typed as a readonly view                                 | L       |
| G4.15  | Coordinate brands are created only at their home modules                                         | L       |
| G4.16  | _Retired upward_: a plugin package can't spell a `#lib` import; G4.277 holds the rest            | L       |
| G4.17  | No spec is collected by two Playwright projects                                                  | L       |
| G4.18  | _Retired_: the inline handler-order and registration rows hold what the trigger table did        | L       |
| G4.19  | _Retired upward_: reading mode is refused where bytes are written, not per dispatch site (G4.52) | L       |
| G4.20  | A new line takes the document's ending; per-line work reads no `\r`                              | L·N     |
| G4.21  | Image bytes are written only through the one image byte module                                   | L       |
| G4.22  | An e2e wait predicate must describe the post-operation shape                                     | L       |
| G4.23  | Every e2e spec pairs with a requirement file, and vice versa                                     | L       |
| G4.24  | A block's write rule runs in the content write, which maps the caret                             | T       |
| G4.25  | No `import.meta` env read anywhere under `src/lib`                                               | L       |
| G4.26  | Comment budget: two lines a block, five a header, no house words                                 | L       |
| G4.27  | Every `parse` call outside the parser declares its scope                                         | L       |
| G4.28  | A leaf raw write outside the content write names the kind's rule                                 | L       |
| G4.29  | Every file claiming a hardcoded chord is manifested with its chords and keys                     | L       |
| G4.30  | Hidden-marker classification has one rule, applied in both spaces                                | L       |
| G4.31  | _Retired upward_: pending marks are a record only the block's write spends                       | T       |
| G4.32  | Every non-render inline read goes through `resolvedInlineContent`                                | L       |
| G4.33  | Live-mode byte candidates verify against what actually paints                                    | L       |
| G4.34  | Link bytes are written only through the one link byte module                                     | L       |
| G4.35  | A construct stamps its markers exactly when its policy row says revealable                       | L       |
| G4.36  | A DOM position from walk offsets, a raw range and a public focus are built only in listed files  | L       |
| G4.37  | Every surface rendering into a caret-walk container stamps content-empty                         | L       |
| G4.38  | Every editable surface publishes each of `EDITABLE_SURFACE_MEMBERS`                              | L       |
| G4.39  | Every text-surface component publishes `runCommand`                                              | L       |
| G4.40  | The three rewrite-claim lists are one set                                                        | N       |
| G4.41  | No test file mocks `dev-checks` or spies `console.warn`                                          | L       |
| G4.42  | No module writes a sibling's `leadingTrivia` by hand                                             | L       |
| G4.43  | Every `splitNode` call reads the index the split returned                                        | L       |
| G4.44  | Every prose surface resolves native ranged edits through the one resolver                        | L       |
| G4.45  | Every bare tree-op caller is declared with the commit that settles its writes                    | L       |
| G4.46  | _Retired upward_: the chain rebuild is the commit’s own step (G4.258)                            | L       |
| G4.47  | Every contenteditable read routes through the host-aware predicate                               | L       |
| G4.48  | Wall-clock budgets outside the perf projects use the growth harness                              | L       |
| G4.49  | E2E composition rides the shared IME driver                                                      | L       |
| G4.50  | Every block command id is classified for cross-block ranges                                      | L       |
| G4.51  | _Retired upward_: the typing push and its pause are one controller call, `typingKeystroke`       | T       |
| G4.52  | The content version is announced at every place that writes document bytes                       | L       |
| G4.53  | The descriptor type and the published field table are one set                                    | L       |
| G4.54  | A published entry barrel is never imported by its own import closure                             | L       |
| G4.55  | Docs name the package `@voithos-labs/aragonite`, never bare `aragonite`                          | L       |
| G4.56  | Inline-tree and rendered-DOM walks are iterative, never recursive                                | L       |
| G4.57  | The source-scan lexer agrees with TypeScript's                                                   | L       |
| G4.58  | One commit-message rule, enforced at the hook and in CI                                          | L       |
| G4.59  | The VR tag catalog and the tags cited in source are one set                                      | L       |
| G4.60  | Every spread into a call's argument list declares what bounds its count                          | L       |
| G4.61  | The commit scope is set in production, not behind a build flag                                   | L       |
| G4.62  | Code, grey, marker and faded-block text clear AA on the backgrounds under it                     | L       |
| G4.63  | The bundled plugins' own suites import only the published entry points                           | L       |
| G4.64  | The tree-ops layers import only downward                                                         | L       |
| G4.65  | Every prose surface hands typed delimiters to the one auto-pair arm                              | L       |
| G4.66  | A relative scroll is written through `scrollBy`, never read-plus-delta                           | L       |
| G4.67  | Every editor menu counts itself on `menuChange` and hands the registry its close                 | T·L     |
| G4.68  | Every plugin registry read outside its module passes the editor's grammar                        | L       |
| G4.69  | Only entry points, kits and editor-free code read with the default grammar                       | L       |
| G4.70  | A decoration can't set a data attribute the editor uses on a block's own element                 | L       |
| G4.71  | An emptiness test on text reads GFM's blank, not `String.trim()`                                 | L       |
| G4.72  | The Markdown grammar reads GFM's whitespace, not JS `\s` or `trim()`                             | L       |
| G4.73  | A component built on the editable leaf exports `blockApi` and no block method of its own         | L       |
| G4.74  | _Retired upward_: the last-line walk is the commit’s own step (G4.258)                           | L       |
| G4.75  | A leaf's new text goes through one commit or one in-place write, at every depth                  | L       |
| G4.76  | Every join into a leaf, and every other text built from two sources, is declared                 | L       |
| G4.77  | Only three routes register on behalf of no plugin                                                | L       |
| G4.78  | The editor's built-in bootstraps run only through `registerEditorBuiltIns`                       | L       |
| G4.79  | Whether a kind is a grid is asked through `isGridKind`, nowhere else                             | L       |
| G4.80  | In `selection/`, only the range coverage and the caret walks ask if a container is closed        | L       |
| G4.81  | The cross-block table row snap runs in the range coverage and the stored pair only               | L       |
| G4.82  | The task-marker rule runs in one wrapper, and its callers are declared                           | L       |
| G4.83  | Every plain read of bytes into blocks outside the parser and test kits names its kind            | L       |
| G4.84  | Where a leaf's bytes are stored is made in one place, from the tree                              | L       |
| G4.85  | A live rewrite that removes bytes reads its candidate where it will be stored                    | L       |
| G4.86  | A list item's marker is read only where the list is built, drawn or dumped                       | L       |
| G4.87  | Only the scroll owner writes the editor's scroll position                                        | L       |
| G4.89  | One in-leaf range replace, and a short list of places that snap an offset                        | L       |
| G4.90  | A paste inside one block cuts its selection through the range replace, with its text             | L       |
| G4.91  | A focus call that may scroll the editor says why                                                 | L       |
| G4.93  | A measure round keeps only the block `heldBlock` picks, level by level                           | L       |
| G4.94  | A gap caret or a widget is selected only in `place-caret.ts`, and held in one store              | L       |
| G4.95  | What a range covers is decided in the range coverage only                                        | L       |
| G4.96  | A commit rebuilds each container once, and a mutation leaves that rebuild to it                  | L       |
| G4.97  | A child's height reaches its list's table only through `useMeasuredChild`                        | L       |
| G4.98  | Only layout state drops the measured heights or moves the width version                          | L       |
| G4.99  | A windowed list's box is never shorter than its table while blocks mount                         | L       |
| G4.100 | A block's own trailing line ending is added by the surface write and a few listed routes         | L       |
| G4.101 | Only the surface write names a typed kind change or completes a typed line                       | L       |
| G4.106 | _Retired upward_: every test page load is a fresh document, and a load that isn't throws         | A       |
| G4.107 | Only a write emits `edit`, and only the in-place keystroke write declares `input`                | L       |
| G4.108 | Only the range replace removes a range; only it and the range indent open its undo step          | L       |
| G4.109 | A container built around another's children starts from that container's bytes                   | L       |
| G4.111 | A block's editable element writes its own text only through the surface write                    | L       |
| G4.112 | An indent key over a range reaches list items through one route, never removing the range        | L       |
| G4.113 | _Retired_: the `$$` shape is G4.131's `$$` row                                                   | L       |
| G4.114 | How a block paints under a range is decided in the selection model only                          | L       |
| G4.115 | A clipboard payload is written only by a copy                                                    | L       |
| G4.116 | The pending break answers a text block's key before the shared keymap                            | L       |
| G4.122 | Import edges between `src/lib`'s top-level directories match their baseline both ways            | L       |
| G4.123 | A dissolving list item's children are split only inside the list order check                     | L       |
| G4.125 | A component asks which inlines are widgets only in `widget-adjacency.ts`                         | L       |
| G4.126 | The dev server bundles every package the app imports before a page asks for it                   | L       |
| G4.127 | Every branch on whether a DOM exists says what runs without one                                  | L       |
| G4.128 | Every registered block kind shows the empty-block hint, or says why it's never asked             | harness |
| G4.130 | A code block edit over a range takes its span from `editSpan` only                               | L       |
| G4.131 | A block syntax's bytes are read and written in its own module only                               | L       |
| G4.133 | An e2e spec switches the presentation mode only through a helper that waits for it               | L       |
| G4.141 | Only the drawn caret writes its element and the mark hiding the browser's caret                  | L       |
| G4.142 | `caret-color` is declared only for the known surfaces                                            | L       |
| G4.143 | Every caret write asks the drawn caret to repaint, and its frame paint only paints               | T·L     |
| G4.144 | The old widget and gap caret painters and the edge ring stay gone                                | L       |
| G4.145 | A click decides whether it follows a link or widget through the shared rule only                 | L       |
| G4.146 | A release tells a click from a drag only through the editor's press tracker                      | L       |
| G4.147 | Every change to the caret memory repaints the drawn caret, and a no-op asks nothing              | harness |
| G4.148 | The caret's look adds no inline-tree walk, parse or paint to a key outside brackets              | harness |
| G4.149 | A preview of the next insertion runs a write's own spend, and changes no record                  | harness |
| G4.150 | One placer for a hidden edge: no other file reads the caret's side or how it arrived             | L       |
| G4.151 | One click-side check, called from the click entry both prose blocks share                        | L       |
| G4.152 | Every rendered link has an Edit link target, and only the root click follows one                 | T·L     |
| G4.155 | A composition event goes to one of the two composition hosts, which keep it in the one tracker   | L       |
| G4.157 | Every block kind a bundled plugin installs has an insert entry, or says why it has none          | harness |
| G4.159 | An emptied quote, list item or bundled strip container keeps bytes that reload as it             | harness |
| G4.163 | A mark's own handlers are called only by the hover lifecycle, activation and the click           | L       |
| G4.165 | A write that moves text without resizing its block reports it, so its overlays measure           | L       |
| G4.166 | Every length the drawn caret's rules set is rounded to whole device pixels                       | L       |
| G4.170 | Only the parser and the table rebuild write a row's header flag                                  | L       |
| G4.174 | Every published entry point has a source build and a prebuilt one                                | L       |
| G4.175 | Every library component compiles in runes mode                                                   | L       |
| G4.178 | Every route that mounts a plugin view falls back and reports when it throws                      | L       |
| G4.180 | Every top-right hover control on a block moves below the open find bar                           | L       |
| G4.181 | Every wrapper package, and the library's version constant, carries the core's version            | L       |
| G4.183 | An app that doesn't compile Svelte installs no Svelte                                            | harness |
| G4.184 | The editor's own reset sets everything the demo app's global reset does                          | L       |
| G4.185 | Only the `/svelte` entry's published types reach a `svelte` import; none reach a stylesheet      | harness |
| G4.186 | A plugin's widget, decoration or row view is drawn only through `mountPluginView`                | L       |
| G4.187 | Every framework app under `examples/` runs in the adapter suite                                  | L       |
| G4.188 | Every wrapper entry imports in Node with no DOM, as a server render does                         | harness |
| G4.189 | A host color read inside the editor carries no fallback, and the root reads the resolved one     | L       |
| G4.194 | A block reaches the clipboard steps and its inline paste only through its editable surface       | L       |
| G4.195 | _Retired upward_: every write declares its undo grouping (`history`), a command's as `entry`     | T       |
| G4.197 | A parse finds every built-in kind whichever module a host imports first                          | harness |
| G4.200 | Whether a block hides markers at the caret, with the screen it reads, is asked in one place      | L       |
| G4.201 | One painter puts the selection tint on an inline widget                                          | L       |
| G4.207 | Shipped CSS keeps `color-mix` and container queries behind `@supports`                           | L       |
| G4.208 | An op whose fix-up runs a step of its own is called where its kind is reported                   | L       |
| G4.209 | A list item draws its marker in its own cell, never through a child's prefix                     | L       |
| G4.211 | Every widget kind that shows its source has a row in the typed-opener e2e spec                   | L       |
| G4.212 | E2E clipboard access and pastes ride the shared clipboard helper                                 | L       |
| G4.213 | Every checked-in input recording is replayed by the e2e spec or marked diagnostic-only           | L       |
| G4.214 | A caret's box is measured in one place, `caretRectAt`                                            | L       |
| G4.215 | A list's marker column reads no item of its own at load or on a key                              | harness |
| G4.216 | Every built-in kind that binds Enter binds Shift+Enter too                                       | L       |
| G4.218 | A catalog entry holds at most six lines                                                          | L       |
| G4.219 | No popover closes on focus leaving; every focus-loss listener serves a listed need               | L       |
| G4.220 | A clipboard read or write outside a clipboard event goes through `system-clipboard.ts`           | L       |
| G4.221 | No constructed `ClipboardEvent`; a selection's shown text is read in one place                   | L       |
| G4.222 | _Retired upward_: the selection is read only under `browser/` (G4.270)                           | L       |
| G4.223 | The library names no browser engine in code                                                      | L       |
| G4.224 | A press on editor chrome takes no focus, unless its file is listed as owning focus               | L       |
| G4.225 | The drag session is the first listener to hear a release                                         | L       |
| G4.226 | An e2e spec presses the platform's own chord for an edge key or a modifier                       | L       |
| G4.227 | A caret-edge or page key is read in one place, `caretEdgeKey` or `pageKey`                       | L       |
| G4.228 | An e2e locator action that must leave the scroll alone rides the in-place helper                 | L       |
| G4.229 | A key moves a selection end through `keyboard-extend.ts`, which shows it                         | L       |
| G4.230 | Editor chrome runs no undo or redo of its own; the root answers them there                       | L       |
| G4.231 | A right-click menu listens for `contextmenu` only where it is declared                           | L       |
| G4.232 | An e2e spec splits undo steps with `endTypingBatch`, never a fixed wait                          | L       |
| G4.234 | Delete input types live in `browser/input.ts`; blocks hear `beforeinput` via their surface       | L       |
| G4.235 | In reading mode the page owns Tab: no block reads the key by hand or sets its own tab stop       | L       |
| G4.237 | A test never navigates a page its `beforeEach` already navigated                                 | L       |
| G4.239 | No block runs a merge by its id; a delete at an edge runs the plain key's binding                | L       |
| G4.240 | Every `ResizeObserver` is made in `windowing/observe-resize.ts`                                  | L       |
| G4.241 | _Retired upward_: the run layout and the joins are the commit’s own steps (G4.258)               | L       |
| G4.243 | A caret's line is read through one step; `Selection.modify` is the caret writer's (G4.270)       | L       |
| G4.245 | A kind's write rule is run through `kindWriteRule`                                               | L       |
| G4.247 | A production build of the published package carries no dev check                                 | harness |
| G4.248 | Dev-only code reads one switch, in `dev-checks.ts`, imported by its package name                 | L       |
| G4.249 | A measured height enters the height table only through `applyMeasured`                           | L       |
| G4.251 | The bundled blocks that build a render-primary leaf in Svelte are listed                         | L       |
| G4.252 | A press's point is read at the press, in `readPress`                                             | L       |
| G4.255 | Every `test.fixme` reason names its issue as `#<n>: `                                            | L       |
| G4.258 | The fix-up, the chain rebuild and the open tail are imported only by the commit                  | L       |
| G4.259 | On the fix-up’s path a list of blocks is written only through `spliceList`                       | L       |
| G4.260 | A step before the render and its step after are paired through `aroundRender`                    | L       |
| G4.262 | The fix-up package loads nothing that parses or writes the tree                                  | L       |
| G4.265 | A production build carries no invariant module and no tree dump                                  | harness |
| G4.268 | Every file under `scripts/` has a caller, or sits in the hand-run list with a reason             | L       |
| G4.269 | An e2e page requests no host but the app server, and an e2e route never calls `continue`         | L       |
| G4.270 | The selection, the point lookups, `inputType` and `isComposing` are read only under `browser/`   | L       |
| G4.271 | A windowed list hands each child the index and id from its own slice entry                       | L       |
| G4.272 | Every child process a file under `src/lib` spawns carries a timeout of its own                   | L       |
| G4.273 | A keydown handler that runs a command asks `imeOwnsKey` first                                    | L       |
| G4.274 | A typed insert or a typed key is read only where the editor decides where it lands               | L       |
| G4.275 | Words are cut by one rule, read only through `wordSegments`                                      | L       |
| G4.276 | A widget's raw span is read only through `widgetSourceRange`                                     | L       |
| G4.277 | Every bundled plugin is a package an outside author could have written                           | L       |

### The entries

**G4.1 · Getter-fed block-list state.** No by-value `createBlockListState`: it takes getters only.
`lint/call-site-rules.test.ts`.

**G4.2 · Render path skips the inline cache.** The render path computes inline content via
`computeInlineContent`, never the caching `getInlineContent` accessor. Perf hygiene, since the cache
is a non-reactive WeakMap. Held by G4.32's row in `lint/file-rules.test.ts`, which bans the raw
accessor everywhere but its own module.

**G4.3 · Container conformance kit.** The kit plus declaration sanity: `unwrapRole` strategies
resolve, `containerPaste` has the right shape, `rebuildRaw` runs. Built-ins are swept
registry-derived; a plugin container opts in with its own profile through `runContainerConformance`
(`@voithos-labs/aragonite/testing`). Kit: `src/lib/testing/container-conformance.ts` · tests
`container-conformance.test.ts` (built-ins), `test/plugins/container-conformance.test.ts` (plugin
containers).

**G4.4 · No timing hacks.** No timing primitive is used for sequencing; `await tick()` is the one
wait. `lint/file-rules.test.ts` holds a short, closed allowlist, each entry with its reason: the rAF
throttles and placements (autoscroll, the pointer session, the drag handle, a size watch's start,
the drawn caret's paint, G4.143), the undo debounce, the occurrence plugin's typing pause and the
regex scan deadline. Unit tests follow the same rule (`lint/suite-file-rules.test.ts`): wait with
`settleEditor`, fake timers or `vi.waitFor`, never by flushing a macrotask.

**G4.5 · No synthetic keyboard events.** No synthetic `KeyboardEvent` in editor runtime source.
`lint/file-rules.test.ts`.

**G4.6 · CSS ownership.** `app.css` holds no editor rules or tokens. Every editor-owned token read
is declared in `editor-theme.css`, except the resolved host colors (`--md-color-*`,
`--md-page-text`) and the `@property` lengths (the list marker's column), which only `editor.css`
declares. Every radius read carries a fallback; host-chrome defaults sit behind the opt-in theme
class alone (G4.6d). Bundled and reference plugins follow the same rule and may also read tokens
they declare. `lint/css-ownership.test.ts`, `lint/plugin-css-ownership.test.ts`.

**G4.7 · Render-memo completeness.** A block's render memo key includes every input its built DOM
embeds; a live value (tree path, index, load policy, checkbox state) is resolved at event time or
keyed on, or a shifted block acts on a stale node. A prose block's `renderKey` is
`ambientPrefixText` + `raw` + the link-reference-definition epoch + the image-load policy. G4.2 is
the one automated proxy; the rest is documented (`D`) with regression tests (`N`):
`widget-path-restability.spec.ts`, `render-image-policy.test.ts`, `task-checkbox.test.ts`.

**G4.8 · Documented-chord dispatch.** Every chord the consumer guide's keyboard table lists resolves
in the surface that dispatches it (the keymap registry, the search components, or the clipboard
paths). The reverse sweep covers what this repo ships (built-in and bundled keymaps, the global
keymap, bundled global chords, the hardcoded-chord files) and keys each claim by chord and owner, so
`Mod+Enter` on a task item and in a table cell each need a row or a recorded reason; a stale
exemption fails. `lint/consumer-guide-chords.test.ts`.

**G4.9 · Theme-token manifest.** Every token the consumer and plugin guides publish is declared in
`editor-theme.css`, and a themed token carries both a light and a dark value.
`lint/theme-token-manifest.test.ts`.

**G4.10 · Retired upward.** Each bundled plugin is a package of its own now, whose manifest and
pack G4.277 and `scripts/pack/verify-plugin-package.mjs` check.

**G4.11 · Paste-transform site parity.** Exactly the allowed clipboard-to-parse routes call
`applyPasteTransforms`, since a new route without it drops plugin transforms. A route that never
names the symbol is caught too: every clipboard or drop read must reach an allowed route.
`lint/manifest-rules.test.ts`.

**G4.12 · Caret-edge destructive keys.** Every plain Backspace or Delete intercepted at a caret edge
in a prose block routes through the one edge-policy dispatch, which resolves what sits at the edge
against declarative policies and commits through `surface-write.ts :: writeText` or
`updateBlockContent`. The only other interceptors are the selected-widget second-press delete and
the pending break's Backspace (`pending-break-keys.ts`). `lint/manifest-rules.test.ts`.

**G4.13 · The view-to-mutable boundary.** No `as CstNode` or `as Document` view-stripping cast
outside `tree-operations/` and the undo controller. Readers hold bytes-readonly views
(`core/node-views.ts`) and get a mutable node only by copying its path or through a commit scope's
owned view. `lint/file-rules.test.ts`; type pins in `test/core/node-views.test.ts`.

**G4.14 · Readonly-view prop parity.** Every `.svelte` component prop reading the CST is typed
`NodeView` or `DocumentView`; registration erases prop types, so a `node: CstNode` would compile.
Only `Editor.svelte` holds a mutable `Document`. `lint/file-rules.test.ts`.

**G4.15 · Coordinate-brand creation.** `as <Brand>` casts and the `as*` boundary constructors appear
only in `core/coordinate-spaces.ts` and the allowlisted public-entry files; everything else gets a
brand through those or a named conversion. G3.7's runtime-source complement.
`lint/file-rules.test.ts`.

**G4.16 · Retired upward.** A plugin's source sits in its own package, where a `#lib` import
doesn't resolve at all; G4.277 holds the imports it can still write. Every import-boundary scan
(G4.63, G4.64, G4.122, G4.277) reads specifiers through
`src/lib/test/invariants/lint/scan-source.ts :: importSpecifiers`, so an import quoted in a string
or comment is no edge.

**G4.17 · One Playwright project per spec.** No spec file is collected by two Playwright projects. The scan reads what `playwright test --list` reports, so the glob
depth rules are Playwright's own; a spec no project collects is G4.23's.
`e2e/lint/project-partition.test.ts`.

**G4.20 · One document line ending.** New lines take `documentLineEnding` (the document's first
break), and per-line work reads lines without endings (`displayLines`, both `core/lines.ts`).
`trailingLineEnding(raw, fallback)` requires the fallback: the document's ending if in reach (a
commit's scope, a paste's context, `ctx.lineEnding`), else the block's first break, else LF; a
block's own text keeps its ending (G4.100). The scan fails a hand `split('\n')` of block bytes and a
written newline literal. `lint/trailing-line-ending-parity.test.ts`, the CRLF mirror tests.

**G4.21 · Image byte-write module.** The GFM image serializer is named in code only inside the
image byte module, and only the documented write paths name `buildImageEditBytes` (the popover takes
the answer as a prop and names neither), so no route re-emits GFM over an image an inline plugin
kind claimed. A path that hand-rolls the bytes from a template gets past it. `lint/manifest-rules.test.ts`.

**G4.22 · E2E wait predicates describe the outcome.** Inside one `test()` body, a `waitForSource*`
predicate must describe the POST-operation shape; one already true on the loaded document returns
at once, and a gesture that silently no-ops passes. `e2e/lint/settle-predicate-vacuity.test.ts`.

**G4.23 · Requirement and spec lockstep.** Every spec under `e2e/tests/` pairs with a requirement
file under `e2e/requirements/` and vice versa (`.perf` stripped from the stem, no two specs claiming
one file); each requirement carries a title, a section and a scenario, and Playwright lists at least
one test for each spec. A requirement list three times longer than the spec's
`playwright test --list` count needs a reason in the scan's allowlist; the counts needn't match.
`e2e/lint/requirement-spec-lockstep.test.ts`.

**G4.24 · A block's write rule runs in the content write.** Every content write goes through
`tree-operations/content-write.ts :: legalizeWrite`, which runs the kind's `rawWrite`, then its
container's `bodyWrite`, and hands back the caret moved to where the rule left it, so a code fence
is grown or closed whichever gesture wrote it. It's a type: `updateNodeContent` only takes bytes that
went through `legalizeWrite`, or plain text it runs through it.
`test/editor-actions/content-write-caret.test.ts`.

**G4.25 · No `import.meta` env reads.** Nowhere under `src/lib`, test tree included: it's
Vite-only, so the library wouldn't load under another bundler (and `svelte-package` warns on it
wherever it sits). Toolchain flags come from `esm-env`, imported only by `src/lib/dev-checks.ts`
(G4.248), and every dev-only check reads `devChecksOn` from there, so
`configureEditorEnv({ isDev: true })` turns the checks and the dev warnings on together. The
reference plugins and the consumer example are Vite apps and exempt. `lint/suite-file-rules.test.ts`.

**G4.26 · Comment budget.** A comment block gets two text lines, a header five (dividers and
directives aside). A header is a file's first comment, a docblock above an `export interface` or
`export type`, or on an export (or member) of `index.ts`, `plugin.ts`, `testing.ts`,
`editor-props.ts` or `block-component.ts`. No house word (`docs/contributing/glossary.md`) in a
comment or requirement file, backticks aside; each design and contributing doc keeps a baseline that
only goes down. `lint/comment-budget.test.ts`, `lint/comment-house-words.test.ts`.

**G4.27 · Parse-scope declaration.** Every call of the core `parse` entry outside `core/parser.ts`
passes an explicit `scope`. The default is `'document'`, so a fragment caller that forgets hands one
block's bytes to the openers as a whole document, and only the caller knows which it is. The
consumer example and the published kits are excluded (they parse whole documents).
`lint/call-site-rules.test.ts`.

**G4.28 · Leaf raw writes outside the content write.** Every `<node>.raw =` statement outside
`tree-operations/node-primitives.ts` (home of `writeOwnRaw` and `installOwnRaw`) is on a counted
allowlist with the reason it can't reach a kind that declares a write rule, and an `installOwnRaw`
call counts too outside that file and the content write. Whether a listed route runs its bytes
through `normalizeOwnRaw` or `legalizeWrite` first is left to review. `lint/leaf-raw-write-rule.test.ts`.

**G4.29 · Hardcoded-chord manifest.** Every library file that reads a `KeyboardEvent` modifier flag
is named in `lint/hardcoded-chord-sites.ts` with the key literals it compares (negated guards
included) and the chords it takes, each naming one of its keys and each one `reservedChords()`
lists from a keymap or the text keys, so no branch takes a chord the published set misses. A listed file keeps literal key
comparisons, since the scan is structural: a shared helper fails it until the scan learns that
helper. `lint/reserved-chord-manifest.test.ts`.

**G4.30 · Hidden-run classification.** `core/inline/visibility.ts` states the marker families and
the hiding rule, and `browser/painted.ts` applies it where there's a caret; a third copy would
disagree the day a mode moves, and a caret placed in unpainted text corrupts silently. A property
test holds the two answers together. The scans allowlist resolving hiding state to those homes and
readers asking another question, and manifest every file naming a marker class. Dev backstop:
`invariants/marker-css-parity.ts`, per mode change. `lint/manifest-rules.test.ts`.

**G4.32 · Inline-cache one spelling.** Every non-render consumer reads the inline tree through
`resolvedInlineContent`, so the resolver and the signature travel together; dropping the signature
reads an entry the render path didn't fill (brackets where the screen shows a link). The raw
`getInlineContent` stays in its own module, plus the vertical-skip decision, which wants the
resolver-less answer. `lint/file-rules.test.ts`.

**G4.33 · Live-rewrite verification.** Live-mode byte candidates are verified through the render
path's own `renderedText`, never a private walk, and every file naming an inline marker family is
manifested with its use. A verification takes the block's own screen where it decides what a press
may touch, or the content behind every marker for a before/after diff, which declines a side whose
chrome paints (live-mode.md § 4.1). Every destructive join goes through `cleanJoinedRaw`, and the
files naming `preDelete` are a closed allowlist. `lint/manifest-rules.test.ts`.

**G4.34 · Link byte-write module.** The image rule's twin (G4.21): the GFM link serializer is named in
code only inside `link-source-bytes.ts` (`lint/file-rules.test.ts`), and only the documented write
paths name `buildLinkEditBytes` and `buildLinkUnwrapBytes`. Every candidate is verified through the
render path (G4.33), and a link an inline plugin kind claimed is declined, since there's no
`rewriteLink` hook. `lint/manifest-rules.test.ts`.

**G4.35 · Stamp and revealable parity.** A construct whose marker spans carry a `data-construct-*`
stamp declares `revealable: true` in the inline-construct policy table, and every revealable kind
stamps; the stamp list is derived from `core/inline-render.ts`. A stamp without a row reveals
nothing, and a row without a stamp addresses nothing. An absent row reads as `revealable: false`.
`lint/stamp-revealable-parity.test.ts`.

**G4.36 · Caret-write sites.** Every native selection write goes through the editor's caret writer,
`browser/caret-writer.ts :: createCaretWriter` (`EditorServices.caretWriter`), which asks the drawn
caret to repaint after it (G4.143), and G4.270 fails a write anywhere else. A caret goes through
`placeCaretAtRaw`, which skips the marker prefix, never lands behind a hidden marker run, and takes
a required `clamp` (`reachable` or `exact`); a range through `selectRawRange`,
`extendSelectionToRaw`, `selectSurfaceContent`, or `selectDomRange` for nodes in hand. The scan
pins three file lists, each with per-file reasons:

- the files building a DOM position from a DOM-walk offset (`browser/offsets.ts` and the readers
  that measure with it), so no hand-built range reaches `selectDomRange`;
- the files naming `rawRangeToDomRange` (measuring and decorating only);
- the surfaces building `focus` from `placeCaret` (`selection/place-caret.ts`).

`lint/manifest-rules.test.ts`.

**G4.37 · Content-empty stamp parity.** The files rendering a fragment into a contenteditable the
caret walk reads (`renderInlineNodes`, `renderCodeBlock`) are exactly the files stamping
`data-content-empty`; a surface without the stamp paints a marker-only block as an empty line nobody
can reach. A file naming a renderer that mounts nothing carries a reason.
`lint/manifest-rules.test.ts`.

**G4.38 · Editable surface parity.** Every component mounting the text surface
(`createEditableSurface`) publishes each member of `src/lib/block-component.ts` ::
`EDITABLE_SURFACE_MEMBERS`, as an instance export or in the surface literal it hands
`publishRefSlot`. `BlockComponent` declares them optional, so a missing one compiles and silently
declines (every `editor.insertMarkdown()`, say). A `createEditableLeaf` leaf is G4.73's. Add a member
to the tuple and both rules take it. `lint/insert-door-surface-parity.test.ts`.

**G4.39 · Command surface parity.** Every component mounting the text surface
(`createEditableSurface`) publishes `runCommand` as an instance export, since that's where the
built-in text commands live; it's optional on `BlockComponent`, so a missing one compiles and
declines every built-in `editor.runCommand()`. The two reorder ids resolve in the dispatch and don't
count. `lint/file-rules.test.ts`.

**G4.40 · Rewrite-claim set parity.** Three lists name one set of rewrites: the ids built-in keymaps
bind to a rewrite over one block's selection, the ids the dispatch answers specially over a
cross-block range (`RANGE_DECLINED_COMMAND_IDS` declines, `CROSS_BLOCK_RANGE_COMMAND_IDS` routes),
and the chords `selection/cross-block/keydown.ts` claims; each rewrite id sits on exactly one of the
two dispatch lists. Membership is listed by hand, not by prefix (`link.openCard` isn't `format.`).
`test/selection/cross-block/rewrite-claim-parity.test.ts`.

**G4.41 · Warn-gate bypasses.** No file under `src/lib` mocks `dev-checks` or spies `console.warn`:
a mocked `devWarn` never reaches the sink, a console spy reads a channel the sink silences, and a
spy that swallows the call hides Svelte's runtime warnings too, so the gate goes blind for that file.
The one file whose subject is `devWarn`'s console output is allowlisted.
`lint/suite-file-rules.test.ts`.

**G4.42 · Separator-write sites.** No module writes a sibling's `leadingTrivia` by hand; a splice
gets its separators from the commit's fix-up (G4.258), and the allowlist gives each exemption a
reason. The fix-up hands its separators back in the blocks it returns, which its writer splices
in; the hand writes left go through `tree-operations/separator-writes.ts :: writeSeparator`, which
drops the owner's child spans first.
`lint/separator-write-doors.test.ts`.

**G4.43 · Split-landing parity.** Every file naming `splitNode` reads `secondHalfIndex` at least
once per split CALL, so a caller growing a second split whose caret it puts at `i + 1` fails too,
and marks that landing `fresh`, so Enter starts the new block plain. `lint/split-landing-parity.test.ts`.

**G4.44 · Live ranged-edit parity.** Every editable prose surface resolves native ranged edits
through `live-selection-edit.ts :: resolveLiveRangeEdit`, by building the shared typed-input step
(`typed-input.ts :: createTypedInput`), the one other caller. A destructive input carries its range
on the event (`getTargetRanges()`), so a surface reading only its selection lets word, line and drag
deletes cut through delimiter runs. Fenced code is outside the set (no inline constructs).
`lint/file-rules.test.ts`.

**G4.45 · Settle coverage for bare tree ops.** `splitNode`, `deleteNode` and the two merge entries
splice a body without fixing its separators, so every file importing one is declared with the commit
that does, and must reach a commit or a settle entry (keyed on the import, so an alias still counts).
A caller outside the commit leaves the document one folded line short of its own reload, silently.
`lint/manifest-rules.test.ts`.

**G4.47 · Editing-host readers.** Every `[contenteditable]` selector read and every
`document.activeElement` identity read goes through the host-aware predicate or declares its own
answer with the reason. The hidden host is a real contenteditable that paints nothing, so a read
that forgets it answers for the wrong element. `lint/file-rules.test.ts`.

**G4.48 · Wall-clock budgets.** An absolute `performance.now` or `Date.now` budget reds on a loaded
host, so outside the perf projects every wall-clock budget goes through the growth harness, whose
N-vs-4N ratio (`measureScanGrowth`) cancels the machine. The allowlist carries a reason per file.
`lint/suite-file-rules.test.ts`.

**G4.49 · The shared IME driver.** A spec that builds a `CompositionEvent`, an
`insertCompositionText` input event or a key event saying `isComposing: true` by hand tests a
browser no user has, so it fails the scan. The
driver file is the one exemption (only Chromium has a CDP session), pinned exactly, so a widened
exemption and a deleted hand-fired branch each fail. `e2e/lint/e2e-drivers.test.ts`.

**G4.50 · Cross-block-range classification.** Every block command id is range-declined, has a
cross-block branch, or is recorded range-safe with its reason; the decline is what stops a command
spending one block's offsets against a multi-block range. `lint/range-command-census.test.ts`.

**G4.52 · Content-version announcements.** Each place that writes document bytes announces the
content version (never derived from a walk), so the writers are a declared set: the commit frame
covers every commit and every keystroke written in place; the history swap and the `source` swap
answer for themselves. A silent writer serves every whole-document memo a stale answer. Every writer but the
`source` swap also asks the reading-mode check (`reading-write-gate.ts`) in each function that
writes. `lint/content-version-doors.test.ts`.

**G4.53 · Descriptor-field roster.** `BlockKindDescriptor` and the field reference table in
`docs/design/plugin-contract.md` are one set, both ways, keyed on the field-name column. The scan
reads `schema/block-kind-descriptor.ts :: DESCRIPTOR_FIELDS`, which is complete by compile error.
`lint/descriptor-field-census.test.ts`.

**G4.54 · Entry barrels are import sinks.** No module in a published entry's own import closure
imports that entry back: a consumer's bundler could split the cycle and run the entry before its
imports, and in-repo `#lib` never shows it. The entry list derives from package.json `exports`, and
the consumer example's build fails on such a cycle too (`examples/consumer/vite.config.js`).
`lint/entry-barrel-sink.test.ts`.

**G4.55 · The package name.** Docs name the package `@voithos-labs/aragonite`, never the bare
`aragonite`, which belongs to an unrelated npm package. `docs/changelog/` is exempt, since it
records what shipped under the name of the day. `lint/doc-package-name.test.ts`.

**G4.56 · Iterative walks.** No function under `core/inline/`, `caret/`, `windowing/`, the marker prefix builder or
`components/blocks/text/` that reads a node's `children` or `childNodes` sits on a call cycle, even
through helpers. Nesting depth is up to the input, so recursion overflows the stack and strands the
block in the failed-block fallback; write the walk with an explicit stack. A call counts against
every declaration of its name, so a repeated spelling fails outright, and the exception map stays
empty. `lint/inline-walk-iterative.test.ts`.

**G4.57 · The lexer differential.** The source-scan lexer (`spanAt`) classifies every character of
each scanned `.ts` file and `.svelte` script block as comment, string, template, regex or code, and
must agree with TypeScript's own scanner; a literal it misreads would silently shrink every scan
that reads code through it. `.svelte` markup and `.css` files, which TypeScript can't lex, are pinned
against a corpus instead. `lint/scan-source.differential.test.ts`.

**G4.58 · Commit-message shape.** `scripts/lint-commit-message.mjs` holds the only definition of
the subject shape, and both the `commit-msg` hook (`.githooks/`, wired by the `prepare` script) and
a step in CI's `unit` job call it. Line 1 carries the whole summary within 72 characters, since
`git log --oneline` joins a multi-line first paragraph; per-change lines go below a blank line. The
scan reads the `prepare` wiring, the hook and the CI step. `lint/commit-message-shape.test.ts`.

**G4.59 · The VR tag roster.** The windowing-hazard catalog in `docs/design/virtual-rendering.md`
and the tags cited under `src/` are one set, both ways, keyed on the tag column. The corpus (library,
styles, e2e requirement files) is read as raw text, since a citation is almost always a comment.
`lint/vr-tag-census.test.ts`.

**G4.60 · Spread-into-call declarations.** Every spread into a call's arguments in shipped source is
declared, by file and function, with what bounds its count, since a list past the engine's limit
throws "Maximum call stack size exceeded". A `bounded` row names its ceiling (`MAX_UNDO`, the
parser's nesting cap, the `spliceMany` chunk); a `gap` row, where the count follows the document,
names a defect. A splice a paste can scale goes through `spliceMany`. Array-literal spread and rest
parameters are out of scope. `lint/spread-call-census.test.ts`.

**G4.61 · The production commit scope.** `src/lib/commit-scope.ts` imports no build flag and
writes its depth counter at plain statement position. The scope defers the decoration engine's
in-commit `invalidate()`, so a `DEV` guard on it would break production alone, and `esm-env` reads
DEV as true under vitest, where no behavior test could see it. `lint/commit-scope-production.test.ts`.

**G4.62 · Text contrast.** Every `--code-tok-*` color, the grey text and done-or-inert tokens, each
marker colour at `--syntax-marker-dim` and faded raw-block text clear WCAG AA (4.5:1) in both themes
against `--color-surface`, the fence background and, for UI greys, `--color-bg`. It's computed from
`editor-theme.css`, since the editor paints no background and axe would measure the host's. Code
tokens are found by prefix and an unparseable value fails; the other families are named lists, so a
new text token in one needs its own row in `lint/code-token-contrast.test.ts`.

**G4.63 · Bundled-plugin test boundary.** Every file under `src/lib/test/plugins/<plugin>/` imports
only a published entry point (any the exports map lists, `#lib/svelte.js` included), its own plugin's
source, another plugin's published subpath, the copyable test support, a relative path outside
library code, or an npm package. A deep `#lib` import names something the testing entry point is
missing; each allowlist entry names it, and a dead entry fails. `lint/bundled-plugin-test-boundary.test.ts`.

**G4.64 · The tree-ops layering.** `node-primitives.ts`, `unshare.ts`, `separator-writes.ts`,
`content-write.ts`, `stored-as.ts`, `leaf-range.ts`, `node-ops.ts` and `chain-rebuild.ts` import
only downward, in that order. An import cycle passes every behavior test and `svelte-check`, so only a
source scan holds it. `lint/tree-op-ladder.test.ts`.

**G4.65 · Delimiter auto-pair parity.** Every editable prose surface (G4.44's set) routes its
`beforeinput` through
`src/lib/components/blocks/text/delimiter-autopair.ts :: applyDelimiterAutoPair`, by way of the same
typed-input step, so what a typed delimiter writes and where the caret ends up has one answer.
`lint/file-rules.test.ts`.

**G4.66 · Relative scroll through `scrollBy`.** A correction that moves the scroll position by a
delta calls `Scrollport.scrollBy`, never `setScrollTop(scrollTop() + delta)`: the browser snaps a
fractional write to a device pixel, and only `scrollBy` carries the lost fraction into the next call.
`lint/file-rules.test.ts`.

**G4.67 · Menu presence census.** Every open menu attaches `menuPresence.track(close)` to its root,
so `menuChange` reads it open, and a press outside it, Escape (newest menu first), a document swap or
a mode change closes it. Every menu element (the shared menu class, a menu, listbox or dialog role)
carries that attach or a listed reason. A menu whose rows write passes `{ edits: true }`, and one
mounting in reading mode closes and warns `menu-opened-in-reading`.
`lint/menu-presence-census.test.ts`, `menu-presence.test.ts`.

**G4.68 · Registry reads take the editor's grammar.** The inline syntax, widget kind, directive and
completer registries are process-wide, and the editor's grammar leaves out a plugin its `plugins`
prop didn't list. Every internal reader takes the grammar, or the whole `Reading`
(`src/lib/schema/reading.ts`: grammar, link resolver, mode), as a required parameter. A fallback to
every installed plugin is spelled only in the listed places, and a write that reparses a block the
editor drew reads with the link resolver it was drawn with. `lint/registry-view-reads.test.ts`.

**G4.69 · The defaulted readers stay at the edge.** The published `parse` and `parseInline`, and the
plugin barrel's `computeInlineContent`, read every installed plugin when no grammar is given. Code
inside the library calls `readBlocks` and `readInline`, which require one; only the public entry
points, the test kits and listed editor-free code may import the defaulted readers.
`lint/registry-view-reads.test.ts`.

**G4.70 · Decorations keep off the editor's attributes.** A block decoration can set attributes on a
block's own element (a block host, a list item's box, a table row or cell), and a `data-` name the
editor uses there would answer its lookups or paint a state it never set. `RESERVED_BLOCK_ATTRS`
(`reserved-attrs.ts`) must match exactly the names the scan finds on those tags, in `closest()`
lookups and in stylesheets (`attr()` included), so a name used only inside a block stays free.
`lint/reserved-block-attrs.test.ts`.

**G4.71 · Blank means spaces and tabs.** GFM (§ 2.1) calls a line blank when it holds only spaces
and tabs, but `String.trim()` drops every Unicode space, so an emptiness rule built on it deletes a
typed non-breaking space. Test document text with `src/lib/core/lines.ts :: isBlankText`; the scan
fails `trim()` as an emptiness test elsewhere, except for strings no document holds and the math and
mermaid blocks' "does the render draw anything". `lint/file-rules.test.ts`.

**G4.72 · The grammar's whitespace is GFM's.** Where a rule wants spaces or tabs, it says `[ \t]`;
where the spec says whitespace, it means the ASCII set of § 2.1
(`src/lib/core/lines.ts :: isWhitespaceChar`). JS `\s` and `trim()` admit a non-breaking space, so
the scan fails both in `core/parsers/`, `core/directive/`, the other grammar files and the bundled
plugins (which read the helpers through `src/lib/plugin.ts`). Emphasis is outside it (its flanking
rule is Unicode), and the allowlist carries a reason per file. `lint/file-rules.test.ts`.

**G4.73 · A leaf component exports `blockApi`.** Every component calling `createEditableLeaf`, test
fixtures included, exports `blockApi` and no `BlockComponent` member of its own. A flat copy out of
the factory's object still compiles while dropping what it skipped (no `insertMarkdown` means every
`editor.insertMarkdown()` declines). The scan reads the member names off `BlockComponent`'s
declaration, so a new member joins it. `lint/leaf-block-api-export.test.ts`.

**G4.75 · One leaf write.** New text for a leaf is written one way at every depth: a commit through
`src/lib/editor-actions/block-edit-core.ts` :: `commitLeafText`, or the keystroke's in-place write,
`src/lib/editor-actions/commit/leaf-commit.ts` :: `createLeafCommit`. Each step of the write has a short list
of files allowed to name it (an aliased import counts):

- the content write with its fix-up (`updateNodeContent`): the in-place write, the keystroke's
  trial reparse, the container-matching paste and the format toggle over several blocks; the
  commit uses the write alone and fixes it up itself (G4.208)
- a write in place that skips the reparse (`writeOwnRaw`, `installOwnRaw`): table cells and find
  and replace's private copy
- the document as an owner-less body (`documentBody`), plus the trial reparse's throwaway copy
- the task-marker reconcile: the content write, the join and `replaceBlock`
- a replacement's escape for its container: `replaceBlock` alone
- the chain-depth check (G1.20): the in-place write alone

A route copying any step fails with that step's reason. The content version and the join have their
own scans (G4.52, G4.76). `lint/leaf-write-doors.test.ts`.

**G4.76 · Joins into a leaf.** Two texts joined into one leaf go through `joinIntoLeaf` (the join
cleanup, the kind's and container's rules, a reparse). The scan declares each file calling it or
naming `cleanJoinedRaw`, and follows the text a file hands a leaf (a `.raw =`, a leaf write's
argument) to its value: text from more than one source is a join, so its file names the cleanup or
says why not (a paste between one leaf's own halves). `lint/cross-node-join-doors.test.ts`.

**G4.77 · One way to belong to no plugin.** `registerAsCore` (`schema/plugin-install.ts`) runs
registrations as if no plugin were installing. Its callers are the editor's bootstrap
(`registerEditorBuiltIns`) and a registry's `registerCore` for a key it can't recognize itself, both
kept by the test reset; `activateDirectives`, which the reset drops; and
`registerBuiltInDescriptors` with the modules that register at load. The scan matches the bare name,
so an aliased import is caught at its import line. `lint/file-rules.test.ts`.

**G4.78 · The editor's built-ins come in one way.** `registerBuiltInBlocks`,
`bootstrapCodeLanguages` and `registerDefaultContextActions` are called only from
`src/lib/components/editor-built-ins.ts` :: `registerEditorBuiltIns`, which runs them as no plugin
(G4.77). Called anywhere else, whichever plugin's setup gets there first owns the paragraph component
or the code languages. Shipped source only; unit tests may call the bootstraps directly.
`lint/file-rules.test.ts`.

**G4.79 · One way to ask whether it's a grid.** Ask through
`src/lib/schema/block-kind-descriptor.ts` :: `isGridKind` (or `isGridDescriptor` with a descriptor in
hand). Any other file with a `'grid'` string in its code fails, a list check like
`['strip', 'grid'].includes(contract)` included; declaring the contract, naming it in the type,
`role="grid"`, and the insert menu's search keyword are left alone. `lint/file-rules.test.ts`.

**G4.80 · One answer to what a range covers.** The delete, the copy, the format toggle and the
overlay read a `RangeCoverage` off a `CoveredRange`, both classes with a private field built only by
`selection/range-coverage.ts :: coverRange` and `rangeCoverage`, so a hand-built one doesn't compile.
The scan covers the other way to grow a second answer: in `selection/`, only `range-coverage.ts` and
the caret walks in `path-lookup.ts` and `caret-target.ts` call `isCollapsedContainer` or
`collapsedContainerHiding`. `lint/file-rules.test.ts`, `eslint.config.js`.

**G4.81 · One table row snap.** A cross-block range with a table endpoint takes that table's rows
whole. `snapCrossBlockTableEndpoints` runs in `coverRange` for the delete, the copy and the
overlay, and in the selection state's stored `start` and `end`, which the collapse keys, the undo
seed and the extension paths read.
`lint/file-rules.test.ts`.

**G4.82 · The task-marker rule has one home.** Only `tree-operations/list/reconcile-task.ts` names
`reconcileTaskMetadata`, through `writeKeepingTaskMarker`. Every file writing into a child slot
(through that wrapper, or in place with `writeOwnRaw`, `installOwnRaw`) is listed with its role: the
content write, the leaf join, the block replace and a range delete's survivor must call the wrapper,
and the rest say why they need none (a table cell holds no list item).
`lint/leaf-write-doors.test.ts` (G4.82 and G4.82b rows); G1.42 is the runtime half.

**G4.83 · Every plain read says why.** Bytes reach the tree the way a reload builds them:
`readAsOpened` gives each container that must hold a child an empty paragraph, and a child slot
reads through `fragmentReaderAt` (past a list item's marker line), `slotReaderAt` or `childSlotAt`.
Those read plain, so the installer fills in. A plain reader (`readBlocks`, `parse`,
`parseTaskItemBody`, a slot reader) outside `core/` and `testing/` is manifested as a probe, a read
its file fills in, the opened reading, or one filled at the splice. `lint/manifest-rules.test.ts`.

**G4.84 · One place says where a leaf's bytes are stored.** A `StoredAs`
(`src/lib/schema/stored-as.ts`) answers four things about a position: block or plain text (a table
cell), the bytes its write rules would keep, how a reload reads them there, and what a write
installs. It's a branded type built only by `tree-operations/stored-as.ts :: storedAsAt` and
`storedAsIn`, from the tree, so nothing reads a candidate behind a hand-written copy of a
container's marker. `lint/file-rules.test.ts` holds the `as StoredAs` cast to that file.

**G4.85 · A removing rewrite reads through the store.** The join cleanup and the edge delete read
each candidate through `readBack` with G4.84's store (a required field), never a parse of their own,
since a top-level read forgets the container the bytes land in. `lint/file-rules.test.ts` keeps
`readBlocks` and `parse` out of `components/blocks/text/` and `core/inline/live-edit/` modules, and
`store-routes.test.ts` runs every place a store is made, failing one no row runs.

**G4.86 · The list marker has a short list of readers.** Reading a list item's marker off its
metadata (or off a parse cast to carry one) is for the code that builds, renumbers, draws or
dumps a list. A rewrite that wants to know how its bytes read under the marker asks the store
instead. `lint/file-rules.test.ts`, with each reader and its reason.

**G4.87 · One writer of the scroll position.** Every scroll write lives in
`windowing/scroll-owner.ts`, which decides who owns the position (the browser's anchoring, a held
scroll into view, the height correction); `rects.scrollTo(path)` goes through it. Other modules get
a `ScrollportReader`, which can't write. The scan fails any other write (`scrollTop =`, a positioned
`scroll`/`scrollTo`, `scrollBy`, `setScrollTop`, `scrollIntoView`, a writable port) and lists the
`scrollToMount(` callers; a drag's autoscroll and two listboxes say why. `lint/file-rules.test.ts`.

**G4.89 · One in-leaf range replace.** Replacing a range of one leaf is
`leaf-range.ts :: replaceRangeInLeaf`: it cuts back to the painted text, moves both ends off any
surrogate pair and cleans the join; joining two leaves is `joinLeaves` beside it. The scan holds
`snapToScalarBoundary(` and `joinLeaves(` to short lists, and fails a hand-written one-leaf splice
(`raw.slice(0, a) + … + raw.slice(b)`) in the live editing paths unless the file says why (the range
delete and typing after a cross-block delete are known gaps). `lint/file-rules.test.ts`.

**G4.90 · A paste cuts like typing.** Pasting over a selection inside one block writes what typing
the same text over it writes: every file naming the paste's range (`preDelete`) cuts it through
`replaceRangeInLeaf` with the pasted text, or says why not (the code block's paste stays a literal
splice). `lint/file-rules.test.ts`.

**G4.91 · A focus call scrolls nothing unless it says why.** `focus()` scrolls an off-screen element
into view by itself, a scroll G4.87 can't see, so a caret's focus passes `preventScroll` and asks the
scroll owner instead. The scan flags `focus()` with no arguments or without `preventScroll` (a block
component's `focus(offset)` passes), and every flagged file is declared with its reason; the manifest
is per file. `lint/file-rules.test.ts`, with G1.45 as the runtime half.

**G4.93 · One pick of the block a round keeps still.** The block that stays still across a measure
round is picked once, level by level (`createListTree`, via `steady-block.ts :: heldBlock`), and the
scroll owner corrects only by the branded distance `heldDelta` makes, so a hand-made distance or
block doesn't compile (`steady-block.test.ts`). The scan holds the brand casts to `steady-block.ts`
and every `compensate`, `heldBlock` or `heldDelta` call to its declared file, function and count.
`lint/file-rules.test.ts`.

**G4.94 · The editor's own selections have one store and one set of writers.** A gap caret and a
widget selected whole are written only through `placeGapCaret` and `selectWidgetWhole`
(`selection/place-caret.ts`), which clear the browser's range in the same batch, and a selected
widget lives only in `selection-state.svelte.ts`. A `.setGapCaret(` or `.selectWidget(` call
elsewhere fails, as does a `$state` cell typed `WidgetTarget` outside the store; readers ask it
(`widget`, `widgetIn`, `widgetRange`). `lint/file-rules.test.ts`; G1.46 is the runtime half.

**G4.95 · What a range covers is decided once.** `selection/range-coverage.ts :: rangeCoverage`
says which edges a range keeps, which subtrees it holds whole and which table cells, and the delete,
copy, format toggle, overlay and table cell painting read that. The helpers that work it out (the
in-between walk, rectangle bounds, closed-unit checks, table-endpoint cell math) are called only in
`range-coverage.ts`, their defining files, and a short list of cell edits with reasons.
`lint/file-rules.test.ts`.

**G4.96 · A commit rebuilds each container once.** `commitMultiScope` rebuilds each child list it
was handed and every container above, once each, lowest first (`sharedChainLevels`), so a mutation
rebuilding its own scope doubles it; a path it owned below the scope is the commit's too (G4.258).
One-node rebuilds live in `schema/` and `unshare.ts`; others say why. Early bytes come from
`ContainerScope.rebuild`, which warns on the scope, above it, or an undo-shared node.
`lint/container-rebuild-homes.test.ts`, `commit-rebuild-once.test.ts`, `chain-rebuild-shared.test.ts`.

**G4.97 · One way a child's height reaches its list.** A block, a list item and a table row each
measure through `useMeasuredChild` (at mount, after an edit, on a resize), and the list writes the
height only in its private `applyMeasured`, by child id; no list reports its own height upward. The
scan counts every table write, cache write and registration by file and function, and keeps the
channel's key to its file, provider and hook. `lint/file-rules.test.ts`;
`measured-child-routes.svelte.test.ts` runs every child kind and trigger; G1.47 is the runtime half.

**G4.98 · One place throws measured heights away.** Only `createLayoutState` drops measured heights:
a new document or mode flip calls `forgetMeasuredHeights` (keeping the width version, or every list
rebuilds and loses its held block), and a width or font-size change calls `rebuildForNewGeometry`,
which bumps it. Its estimator has no `dropMeasured`; `lint/file-rules.test.ts` fails a second one
(or a cast back) and a width-version write elsewhere. `height-lifetime-routes.svelte.test.ts` runs
every route.

**G4.99 · A windowed list keeps its table height while blocks mount.** Svelte mounts newly windowed
blocks one at a time, and a layout read in between sees a short list (at the document's end the
browser pulls the scroll up for good). So every component rendering spacers calls
`windowing/use-window-floor.svelte.ts :: useWindowFloor` on the box around them, holding it at the
table's whole height until the render ends. `lint/file-rules.test.ts` fails a spacer component
without it; `e2e/tests/plugins/view-swap-end-scroll.spec.ts` drives the swaps (VR-16).

**G4.100 · A block's own line ending.** A block writing its own text hands the list the new text
plus the ending it had, so a document saved without a final break keeps none (`surface-write.ts`:
`writeText`, `withOwnEnding`). New text takes the block's own ending, else the document's, picked
only at a typed or completed break (`editable-surface.ts :: lineEnding`) and the code block's
dissolve. `lint/call-site-rules.test.ts` fails a `trailingLineEnding` or `ownTrailingLineEnding`
call elsewhere in `components/blocks/`, and a `lineEnding` read off a break or a write-free check.

**G4.101 · A typed write asks for itself.** The kind cue and the on-type completer answer typing,
never a command, a paste or a repair. Only `surface-write.ts :: writeText` asks them, for a write with
the `typed` intent. `lint/file-rules.test.ts` fails an `afterTypedWrite` or `completeLineOnType` call
under `components/` or `selection/` anywhere else, and `blocks/editable/surface-write-intent.test.ts` checks
which intents ask.

**G4.107 · An `edit` fires at its write.** The commit frame (every commit and every keystroke
written in place), undo and redo, and a replace-all each emit `edit` as their bytes land; a held one
would fire against whatever document is there by then. `input` also promises the block kept its
kind (`components/link-reference-map.ts` relies on it), so only the in-place write
(`editor-actions/commit/leaf-commit.ts`) declares it. `lint/edit-emitters.test.ts` keys each emit on
its function.

**G4.108 · One replace for every destructive gesture over a range.** Backspace, Delete, cut, typing,
an IME composition, paste and a command key over a cross-block range all go through
`range-replace.ts :: replaceRange`, which picks the removal from the coverage and keeps the gesture
one undo entry with one landing. Under `selection/cross-block/`, `rangeDelete`, `removeHeldWhole`,
`commitGridLineDelete` and opening an `undoStep` are allowed there only; the range indent opens its
own step, since it removes nothing. `lint/file-rules.test.ts`.

**G4.109 · A rebuilt container starts from its source's bytes.** A strip rebuild keeps a line by
pairing it with the container's previous bytes, so a container built around another's children (the
quote an alert leaves after a lift) starts with that container's `raw`; with an empty `raw` its first
rebuild respells every line. `lint/fresh-container-bytes.test.ts` fails an object literal with both
`raw: ''` and `children` under `tree-operations/`, `editor-actions/` or `selection/`, outside a short
list of builders of genuinely new containers.

**G4.111 · One write for a block's own text.** A block's editable element changes its own text
through `components/blocks/editable/surface-write.ts :: writeText`, which gives undo the caret from before the
key, keeps the line ending, and puts the caret back. `lint/call-site-rules.test.ts` fails an
`updateBlockContent` call under `components/`, `selection/` or a plugin's code (`packages/`,
`src/routes/test/plugins/`) elsewhere, except the few listed by function that are still to move,
and the block's own edit actions in `editable-surface.ts`, which `writeText` writes through.

**G4.112 · An indent key over a range has one route.** Over a range, Tab, Shift+Tab and any key
bound to an indent command nest or lift every list item it reaches once, through
`range-indent.ts :: indentRange`. Three rows: the item moves (`nestListItem`, `liftNestedItem`) are
called only from a caret's Tab in `list-context.ts` and the range indent; the container step
(`editor-actions/container-chords.ts`) leaves a key a live range owns to the range; and a range replace's command insertion is built only
in `cross-block/keydown.ts`, which leaves Tab out. `lint/file-rules.test.ts`.

**G4.114 · One paint decision under a range.** Whether a block under a cross-block range paints one
box, its selected text, or nothing is `selection/primitives.ts :: classifyBlockForSelection` (and
`blockPaintsWholeBox`), and whether the range spans blocks is `rangeSpansBlocks` beside it.
`lint/file-rules.test.ts` fails a read of the coverage's roots, edges or an end table's cell run
outside `selection/` (its fields, dotted or destructured), and a `pathsEqual` of a range's two
paths. A bracket read gets past it.

**G4.115 · A cut writes its copy's payload.** Each kind of selection a block can copy has one
`ClipboardArm`, where that selection lives (shared parts in `clipboard-step.ts`). `runClipboardCut`
runs the arm's own copy before anything waits, then its removal, so a cut can't write other bytes
than a copy; there's no cut payload type, and an `async` copy doesn't type-check.
`lint/call-site-rules.test.ts` fails a `.setData(` outside those copies and `writeShownSelection`
(the browser's own string: reading mode, an unclaimed copy, code blocks).

**G4.116 · The pending break hears a key first.** Shift+Enter at the end of a text block opens a
line and writes nothing; Backspace and ArrowLeft take it back (`pending-break-keys.ts`). The shared
keymap's ArrowLeft would leave an empty paragraph with the line still open, so the pending break
asks first. `pending-break-keys.spec.ts` is the guard, and `lint/pending-break-key-order.test.ts`
fails when `TextEditableBlock.svelte`'s keydown calls the shared keymap first.

**G4.122 · The directory import graph.** Every production import under `src/lib` goes into a graph
of top-level directories (root files as their own nodes), runtime and type-only edges apart, that
must match `lint/directory-layering-baseline.ts`: a new edge fails naming its imports, a gone one
until its line is deleted. The scan can't refuse an added line, so a new one gets a reviewer's eye.
One runtime cycle is still listed. Always: nothing in `tree-operations/` imports `editor-actions/`
or `components/`, and an unresolvable import fails. `lint/directory-layering.test.ts`.

**G4.123 · An item's children leave it under the order check.** Backspace's unwrap of a first list
item and Enter in an empty outermost item dissolve the item through
`item-partition.ts :: dissolveItem`, which splits its children inside G1.61's check. Three rows in
`lint/file-rules.test.ts`: the splitter `itemPiecesInOrder` is called in that module only, each call
sits inside `keepingListOrder(…)`, and `assembleListHalf` is called only there and in the paste
break-out.

**G4.125 · One reading of a block's widgets.** A prose block draws widgets a link or emphasis wraps,
which the top-level inline list doesn't show. `widget-adjacency.ts :: widgetsIn` lists them all, and
the widget-edge click, the caret painted there, the arrow keys at an edge and every selected-widget
reader ask it (`findFirstEdgeWidget`, `findLastEdgeWidget` beside it give the ends).
`lint/file-rules.test.ts` fails an `isInlineWidget(` or `flattenInlineWidgets(` call under
`components/` or `plugins/` outside that file.

**G4.126 · Every package is bundled before a page asks for it.** Vite's dev server pre-bundles the
packages its scan finds from the route files; one it misses is bundled when a page first imports it,
reloading every open page and failing any e2e spec mid-load. `vite.config.js` :: `posixScanEntries`
fixes SvelteKit's backslashed globs on Windows, and a package loaded with `import()` is listed in
`optimizeDeps.include`. `lint/dev-prebundle.test.ts` fails a scan glob matching no route file, or a
bare-package `import()` under `src/lib` or `src/routes` missing from the list.

**G4.127 · A check that skips without a DOM says so.** Most unit tests run in plain Node with no
`document`, so code asking whether one exists picks what they run. A dev check that would do more
with a DOM asks `documentForCheck` (`src/lib/dev-checks.ts`), which warns `needs-dom` and fails the test
(add the jsdom docblock). Any other DOM branch gets a row in this id's table in
`lint/file-rules.test.ts`, by file and function, saying what runs without one; it fails when a
function's count of DOM tests (`typeof document` and the like) moves off its row.

**G4.128 · Every kind is asked about its empty state.** The `placeholder` hint is decided in
`components/blocks/placeholder-hint.svelte.ts`, which every `createEditableSurface` block reads
through the attributes its element spreads. `test/components/placeholder-every-kind.svelte.test.ts`
mounts every registered kind, bundled plugins included: each shows the hint in an empty fixture or
carries a reason it's never asked.

**G4.130 · One span for every write over a code block range.** Where the mode shows a code block's
fences, an edit over a range rewrites the range; where it hides them, only the part in the body, and
a range on fences alone writes nothing. `code-fence-boundary.ts :: editSpan` answers for every route
(delete, type-over, IME, a bracket wrap, cut, paste, a command's removal). `lint/file-rules.test.ts`
holds `clampRangeToBody(` to there and `code-indent.ts`, and `fenceLinesShown` to its derivation and
`editSpan`. `code-fence-edit-span.test.ts` runs each route in both modes.

**G4.131 · A block syntax's bytes are read and written in its own module.** Two routes that each read
a block's syntax drift apart, so each syntax gets one module, and `lint/file-rules.test.ts` keeps a
row per syntax (`SYNTAX_MODULES`) that fails a copy elsewhere:

- **`$$` math.** `packages/latex/src/math-shape.ts` (`readMathSource`, `mathCloserLine`,
  `mathBlockLines`); `math-source.ts` :: `sliceMathSource` picks between it and the ` ```math ` fence
  form. The row fails `$$` spellings (strings, regexes, the fence constant, line splits) under
  `packages/latex/src/` outside that module. `test/plugins/latex/math-shape-parity.test.ts`,
  `math-block-writers.test.ts`.
- **Table rows.** `src/lib/core/parsers/table-line.ts` reads rows (`rowCellSpans`, `opensOnPipe`,
  `wrappedInPipes`, `boundaryPipeAt`) and writes them (`tableRowLine`, `tableDelimiterLine`,
  `newTableLines`, `spliceCells`). The row fails a row's edge pipe or a delimiter cell spelled by hand
  anywhere else in `src/lib/`. `test/core/parsers/table-row-writers.test.ts` pins the bytes, LF and
  CRLF.
- **Table opening.** `src/lib/core/parsers/table.ts` :: `matchTableOpening`, asked by the parser and
  the grid paste; a header's cell count compared with a delimiter's `columnCount` elsewhere fails.

**G4.133 · An e2e mode switch waits for the mode.** A mode the editor never applied leaves it in
source mode, where most live-mode assertions pass anyway. `EditorPage.goto` checks the mode its query
names, `EditorPage.setPresentationMode` waits for the one it sets, and `src/lib/e2e/mode-switch.ts`
holds the clicks (`clickModeToggle`, `clickModeButton`), each waiting on `data-presentation`.
`e2e/lint/e2e-drivers.test.ts` fails a bridge `setPresentationMode` call outside `editor-page.ts`,
and a mode toggle or button mentioned outside `mode-switch.ts` and its two allowed specs.

**G4.141 · One writer for the drawn caret.** `data-caret-drawn` (the attribute that hides the
browser's caret) and `md-drawn-caret` (the bar) are named in `caret/drawn-caret.svelte.ts` alone
(the bar also in `caret/block-content-selector.ts`, so a block-content lookup skips it), so the
attribute and the bar change in one paint and there's one bar per editor.
`lint/drawn-caret-guards.test.ts`.

**G4.142 · `caret-color` on the known surfaces only.** The production CSS and Svelte styles declare
`caret-color` for `[data-caret-drawn]`, the cross-block rule, `.whole-block-input` and the gap
caret's proxy, each with its reason, and nothing else: another rule would hide or recolor the
browser's caret behind the drawn caret's back. `lint/drawn-caret-guards.test.ts`.

**G4.143 · Every caret write asks for a paint.** `browser/caret-writer.ts` writes the native selection
only inside `createCaretWriter`, whose writes and clears call `drawnCaret.request`;
`test/caret/caret-writer-request.test.ts` calls every writer method and counts one request each (its
table typed over the writer's keys). The frame callback in `caret/drawn-caret.svelte.ts` calls
`paint` and nothing else, keeping G4.4's allowlisted frame paint read-only.
`lint/drawn-caret-guards.test.ts`.

**G4.144 · The old widget and gap caret painters and the edge ring stay gone.** Nothing under
`src/lib`, tests included, names the classes the old widget and gap carets painted with
(`md-snap-after`, `md-snap-before`, `md-snap-caret-active`, `gap-caret-line`), the edge ring's names
(`md-edge-held`, its token, `EDGE_HELD_CLASS`, `heldElements`), or a caret blink `@keyframes` other
than `md-caret-blink-a`/`-b`. A second element painting a caret cue is a second caret; draw it as a
state or a look of the drawn caret. `lint/drawn-caret-guards.test.ts`.

**G4.145 · One rule for whether a click follows.** A file that handles a click doesn't test
`ctrlKey || metaKey` (or `!ctrlKey && !metaKey`) itself; it asks `src/lib/activation-click.ts` (through
`EditorPolicies.activationClick`, `EditorContext.isActivationClick` or a widget's
`isActivationClick` prop), which reads the mode and the host's `linkClick` at the click. The
allowlist holds the reads that decline a modified key or press, and the diagram's zoom and
commit shortcuts. `lint/file-rules.test.ts`.

**G4.146 · One answer to "did this press travel".** Nothing measures a release against its own
press record by hand: the editor root's press tracker (`createPressTracker` in
`src/lib/activation-click.ts`, fed in the capture phase) answers for the follow rule, the margin
drag, a widget's press and a rendered block's click. A second record would let one route call a
release a click while another calls it a drag. `lint/file-rules.test.ts`.

**G4.147 · A memory change repaints the caret.** The caret memory's `onChange` (wired to
`drawnCaret.request` in `components/Editor.svelte`) hears every call that changes the side, the
pending marks or a record, and none that changes nothing, since a typed letter sets the side on
every key. `test/caret/caret-memory-repaint.test.ts` reads the methods off the object, so a new one
joins its table of changes or its exemptions (reads, the column, a write's own hold), each with a
reason.

**G4.148 · The look costs a key outside brackets nothing.** A letter typed mid-word with no `[…]` or
`<…>` around it, live and source, in a block of one construct and of two hundred: one look answer
however often the key paints, no trial insertion, parse or screen read, the same nodes visited in
both blocks, and the same paints as before the look. `test/caret/caret-look-cost.svelte.test.ts` on
the `caretLook*` counters; `test/blocks/text/next-byte.test.ts` pins the shortcut's condition from
both sides.

**G4.149 · The preview is the spend, dry.** `caret/next-insertion.ts :: createInsertionRecords` runs
one loop for a write's hold and for the preview the caret's look reads, and a record's `apply`
changes nothing: one that waits on returns `kept`, which the hold runs when the write lets go.
`test/caret/next-insertion.test.ts` applies each record twice and compares every preview with its
spend.

**G4.150 · One placer for a hidden edge.** Which side of a hidden edge a letter takes is decided
in `components/blocks/text/edge-seat.ts :: hiddenEdges` alone, from the caret memory's record, and no
other file reads that record or how the caret arrived. `lint/edge-rule-guards.test.ts`.

**G4.151 · One click-side check.** `components/blocks/text/click-side.ts :: clickSide` (a fresh
start past a line's end, or the side of a code chip's border) is called only from
`widget-interaction.ts :: snapClickToWidgetEdge`, the click entry both prose blocks' `onClick` go
through, and neither `onClick` measures the press against its text itself.
`lint/edge-rule-guards.test.ts`.

**G4.152 · Everything a click follows can be edited.** Following and Edit link read one answer,
`link-at-point.ts :: clickFollowsAt`: a construct whose policy row declares `followEdit`, or a
widget whose kind claims the activation click. `follow-edit-parity.test.ts` renders every built-in
inline kind and the other link shapes, and each `a[href]` must resolve to such a construct with a
live edit target. `lint/file-rules.test.ts` keeps following a link (`window.open`, `activateLink`,
`closest('a[href]')`) to the root click in `gestures.ts`, after `clickFollowsAt`.

**G4.155 · One composition tracker.** `browser/composition.ts :: createCompositionTracker` holds
the composition in progress and ends one the browser dropped at any key or input in the editor. A
file wiring `compositionstart` or `compositionend` hands it to a host (the editable surface, the
caret host), both open, adopt and end through the tracker (a range claims a start, so the block its
removal leaves the caret in adopts the runs), and no file keeps a composing flag of its own.
`lint/composition-holders.test.ts`.

**G4.157 · Every bundled block kind can be inserted.** `test/plugins/insertable-kinds.test.ts`
installs every plugin package under `packages/` from its zero-argument factory and reads the kinds
they register: each one is in the tree some insert entry's Markdown parses to (a title row comes
with its container), or is listed with why no entry makes it. A listed kind that's gone or has
gained an entry fails too.

**G4.159 · An emptied container keeps its opening line.** Each container kind (bullet, ordered and
task item, quote, nested pairs of them, footnote definition, alert, admonition) has its last text
deleted at the very end of the document, through the text write and through the ancestry rebuild,
and the bytes must reload as the empty container the editor still shows: `- `, `>`, `[^1]: `.
`test/schema/emptied-body-bytes.test.ts`.

**G4.163 · One caller per mark gesture.** A call into a mark's `interactive.onClick`, `onHover` or
`onActivate` sits only in `decorations/mark-hover.ts` (the hover lifecycle, keyed by the decoration),
`decorations/mark-activation.ts` (the activate command) and `components/overlays/DecorationOverlay.svelte`
(the click), each inside the engine's `runMarkHandler`. A new route that called a handler itself
would skip the one-end rule or the `error` event. `test/invariants/lint/file-rules.test.ts`.

**G4.165 · Text that moves inside an unresized block is reported.** An overlay is measured against
the text under it, and a resize observer misses text sliding in a box that keeps its size, as when
markers show or hide. Every marker-hook write (`data-focused`, the reveal class, the root's mode and
theme) reports to `createTextMoves`, as do a widget swapping to its source, focus crossing a
markers-only block, and image and font loads. `lint/file-rules.test.ts` lists the hook writers;
`mark-overlay-follows-text.spec.ts` holds the swap and the focus.

**G4.166 · The drawn caret stays on the device grid.** The paint puts the bar's edges on whole
device pixels (`caret/drawn-caret-target.ts`) and hands the stylesheet the device pixel ratio, so
each width rounds to the nearest whole device pixel, like the browser's caret, and each offset down
to one. A shape whose length skips that rounding blurs across two pixel columns at a fractional
display scale. `lint/drawn-caret-guards.test.ts` fails a length set in a `.md-drawn-caret` rule
with no twin in `editor.css`'s device-rounding block, and a width there not rounded to the nearest.

**G4.170 · The header is the first row.** A table's rebuild makes row 0 its header and every other
row a body row, so an insert, move, delete or split never leaves the flag on the row that used to
be first. `lint/table-header-flag.test.ts` fails a file other than the table parser and
`schema/container-rebuilders.ts` that writes the flag.

**G4.174 · Both builds for every entry point.** Each JavaScript entry in package.json `exports`
names its source build under `svelte` and the prebuilt one under `default`, at the same path below
`dist/prebuilt/`; `publishedEntryPoints` throws on a broken pair, so all its readers stop together.
`sideEffects` covers the whole prebuilt, since a bundler dropping a chunk it thinks pure loses its
registrations. `lint/published-entry-builds.test.ts`; `scripts/pack/verify-prebuilt.mjs` checks the output's
imports, Node load, a `/plugin` kind's parse and the size budget.

**G4.175 · Runes mode only.** A component with no rune compiles in legacy mode, which turns on the
legacy flag in the Svelte runtime of the app compiling it. The prebuilt build forces runes mode
itself, so this guards Svelte hosts: every `.svelte` file under `src/lib` uses a rune or says
`<svelte:options runes />`. `lint/file-rules.test.ts`.

**G4.178 · A plugin view that throws costs only itself.** A file under `src/lib` that mounts a
Svelte component a plugin handed it (a `mount`, or a component picked at render time) also calls
`warnIfForeignRuntime`, the sign it catches the throw, paints its fallback and reports on `error`
(G1.90). Exempt: the editor's own mount in `create-editor.ts`, and `svelteView`, whose views only
`mountPluginView` calls. `lint/file-rules.test.ts`; `mount-plugin-view.test.ts` holds a view
throwing while unmounting to the same report.

**G4.180 · Corner controls clear the find bar.** A hover control pinned to a block's top-right
corner (absolute, placed by `top` and `right` or by `inset`, hidden at rest by opacity or visibility)
carries `data-corner-control`, so the open find bar moves it below itself when it covers it.
`lint/corner-control-marker.test.ts`.

**G4.181 · Wrappers release in lockstep.** Each package under `packages/` (the framework wrappers)
has the root's version and peers `@voithos-labs/aragonite` at exactly that version, so an app can
only ever install one core next to them; `src/lib/version.ts`, which an input recording names,
carries that version too. `scripts/release/check-lockstep.mjs` holds the rule;
`npm run release:publish` runs it before publishing every package together, and
`lint/lockstep-versions.test.ts` runs it on the tree.

**G4.183 · No Svelte in a non-Svelte app.** The prebuilt build carries its own Svelte, so the core
declares `svelte` an optional peer. `scripts/smoke/adapter-smoke.mjs` installs the packed tarballs into
each framework example and fails if `node_modules/svelte` shows up there.

**G4.184 · The editor brings its reset.** `editor.css` opens with a margin, padding and box-sizing
reset scoped to what the editor renders, so a host page with no reset lays it out the same. Every e2e
route but `/test/no-reset` loads `src/app.css`, whose global reset would hide a declaration only it
carries, so the scan holds the editor's reset to every declaration of that one. DOM a host builds sits
under a `data-host-content` element and keeps the page's styles. `lint/editor-reset-parity.test.ts`;
`e2e/tests/host-reset.spec.ts` checks both halves on `/test/no-reset`.

**G4.185 · Published types name no Svelte outside `/svelte`.** A React or Vue app type-checks the
package's declarations with no Svelte installed, so only `@voithos-labs/aragonite/svelte` may reach
a `svelte` import, and no entry a stylesheet import (`scripts/pack/prune-dist.mjs` strips them).
`scripts/pack/verify-types.mjs`, run by verify-pack, walks each entry's declarations and names the chain
to any it finds, and fails when `/svelte` reaches no `svelte` (a blind walk).
`lint/published-types.test.ts` holds the walk to every import shape.

**G4.186 · One wrapper draws every plugin view.** No file calls a plugin's `view` or `row` field
itself: it hands the view to `plugin-view.ts :: mountPluginView`, the one place that contains a
throw, reports it once and destroys the view once (G1.96). `lint/file-rules.test.ts` fails a call on
either field, or on a local named `view` or `row`, anywhere under `src/lib`; a local under any other
name gets past it.

**G4.187 · Every framework app is tested.** `examples/adapter-suite/apps.mjs` lists the suite's
projects, and `scripts/smoke/adapter-smoke.mjs` builds and installs whatever it lists. An app under
`examples/` with no entry there is never installed from the tarballs or tested, and a spec no
project names never runs. `lint/adapter-apps.test.ts` fails on either.

**G4.188 · Wrappers import on a server.** A server render imports a wrapper before any browser
exists, so each JS entry a wrapper's `exports` names must load in plain Node without touching the
DOM or reading a value declared further down the file. `scripts/pack/node-import.mjs ::
nodeImportFailures` imports each one in a child Node process, and `scripts/pack/verify-pack.mjs` runs it
on every wrapper after the build. `lint/wrapper-node-import.test.ts` feeds it a clean entry and two
broken ones.

**G4.189 · Host colors come from one place.** `editor.css` resolves each host color on the editor
root (the page's value, or the built-in palette for the editor's mode) and hands it to the root's
children under the host's own name. A read inside the editor carries no fallback, since a literal
would hold one mode whatever `theme` says; a rule on the root (or its scrollbar) reads the resolved
`--md-color-*` name. The rules live in `editor.css` so a replaced theme file keeps them.
`lint/host-color-reads.test.ts` covers the library and plugins; route pages are the host.

**G4.194 · A block's clipboard comes from its surface.** A block gets its copy, cut and paste
handlers from `editable-surface.ts :: clipboard`, which adds the editor's half (the reading-mode
check, caret memory, the image hook, a cross-block copy and cut), and pastes into its own text
through `pasteInline`, which puts the caret where the paste left it. A block's own copies would
drift. `lint/file-rules.test.ts` fails a `createClipboardHandlers` or `pasteDispatch` call outside
the surface, `surface-clipboard.ts` and the cross-block range replace.

**G4.197 · Built-ins register on the first grammar read.** The block parser's modules import each
other in a loop, so a built-in registered at a module's top level runs before that module finishes
loading, and a host importing it first crashes or gets none. `schema/block-openers.ts` instead
registers them on the first grammar read, through `registerBuiltInDescriptors` under
`registerAsCore`: they belong to no plugin whoever arrives first, and survive the test reset.
`built-in-load-order.test.ts` imports each loop module first and parses every built-in kind.

**G4.200 · One read of a block's hidden screen.** The rules for a construct's hidden edge only
apply where the block hides markers at the caret, and they need the screen it hides them on.
`browser/painted.ts :: hidingScreenOf` answers both at once. `lint/edge-rule-guards.test.ts`
fails any other file that calls `screenVisibilityOf`, except the dev check that compares it with
the stylesheet.

**G4.201 · One painter tints a selected widget.** A widget selected whole, or one a browser range runs
across, wears the selection tint, so a key never replaces something the user couldn't see was
selected. `selection/widget-selection-paint.ts` decides which widgets wear it for every shape at
once (the image, a live `<br>`, a plugin widget). `lint/file-rules.test.ts` fails the
`md-widget-selected` class written anywhere else.

**G4.207 · Newer CSS stays behind `@supports`.** Safari 15 can't parse `color-mix`, container
queries or container units, and a rule it can't parse loses its whole declaration. Each use sits in
an `@supports` block after a plain fallback, as the selection tints in `editor-theme.css` do.
`lint/safari-floor-css.test.ts` reads every shipped stylesheet and component `<style>` block and
names the `path:line` of any use outside one.

**G4.208 · Ops whose fix-up is reported.** The ops whose fix-up runs a step of its own
(`writeNodeContent`, `deleteNode`, the join and the move) are named only by the mutations that report
that kind through `describeEdit`, since the commit skips a step nobody reported. A new caller is a
fix-up dropped in the making. `lint/separator-write-doors.test.ts`.

**G4.209 · The list item's marker stays in its cell.** A prefix handed to a child block paints only
on text, so an item that opened with a code block, a table or another list once drew no marker and
hid its bytes. `ambientPrefixForFirst` is named only where a plugin container offers its prefix
and where `BlockList` hands it on. `lint/file-rules.test.ts`.

**G4.211 · Every source-showing kind gets the caret rows.** `widget-reveal-caret.spec.ts` types each
kind's opening byte before a body that completes it, in source and live mode, and expects the caret
one past the byte with the source shown (G1.115 is the runtime half). The scan fails a file
registering `revealSource: true` with no row there, or, for a kind with a content span (inline
math), a row whose spec is gone. `e2e/lint/reveal-kinds-covered.test.ts`.

**G4.212 · The shared clipboard helper.** A spec that calls `navigator.clipboard` or presses the
paste chord itself only works where the real clipboard answers the page, which WebKit's doesn't,
so both fail the scan outside `e2e/clipboard-arm.ts`. The helper is where each engine's clipboard
lives: the system clipboard in Chromium, an in-page store the `page` fixture installs in WebKit.
`e2e/lint/e2e-drivers.test.ts`.

**G4.213 · Every recording runs or says it can't.** A file in `src/lib/e2e/recordings/` that isn't
`diagnosticOnly` has a test in `e2e-recordings`, holds its text, chains step to step, and has a real
input for every step in each browser it names (`recording-fixtures.ts :: replayProblems`). Every
recording's `expected` covers every step. A text-free recording can't be replayed, so it's
diagnostic-only. `e2e/lint/recordings.test.ts`.

**G4.214 · One measure of a caret.** WebKit and Firefox measure a collapsed range right after a `\n`
on the line it ends, putting each line start on the line above. `caretRectAt`
(`browser/visual-lines.ts`) measures the next character instead, and every caret box goes through it
(the column search, sticky x, drawn caret, drop caret, `rects.caretRect()` and the rest); the scan
fails a Range measured elsewhere, bar a few never-collapsed spans. A caret written at a line start
lands in the next line's text likewise (`findDomTextLanding`). `lint/file-rules.test.ts`.

**G4.215 · The marker column costs what changed.** The column is sized from the list node's
marker-width counts, which the parse fills and the list's rebuild keeps (G1.118). In a list of four
hundred items, mounting reads no item for the column, each key (first, paused, in a burst, a marker
typed in place, Enter) reads at most the item it rewrote past those its rebuild joined, and an undo
reads none. `marker-column-scans.test.ts`, on the `listMarkerReads` and `joinedChildReads` counters.

**G4.216 · Shift+Enter is a binding wherever Enter is.** Engines send different inputs for
Shift+Enter, so a built-in kind that binds Enter binds Shift+Enter and the keydown decides it; a
soft keyboard's keydown-less `insertLineBreak` runs the same command, and one arriving during the
Enter keydown's handler writes nothing (`components/blocks/editable/editable-surface.ts`). Plugin
kinds aren't held to it: a plugin surface without the binding gets what its own handlers do (for
the editable leaf, what Enter does). `lint/shift-enter-bindings.test.ts`.

**G4.218 · Catalog entries stay short.** An entry in the four group files (from its `**G<n>.<m> ·`
paragraph to the next entry or heading, lists included) holds at most six text lines and 600
characters: the rule, why it holds, what to do when it fires, and its files. Mechanism buries the
rule, so it goes in the guard's failure message or a code comment. An entry with several cases a
reader must know goes in the scan's baseline with its reason, and the baseline only shrinks.
`lint/catalog-entry-budget.test.ts`.

**G4.219 · Popovers don't close on blur.** Safari never focuses a clicked button, so a popover
waiting on its opener's `focusout` just stays open. Popovers close through `menuPresence.track`
(G4.67) instead, and every `focusout` or `blur` listener left in the library is listed with the
focus need it serves (a shown source committing, say). A new one joins the list with its reason, or
moves its close onto `track`. `lint/focus-loss-listeners.test.ts`.

**G4.220 · One system clipboard module.** A read or write of the clipboard outside a clipboard event
(menu Copy and Paste, whole-block Mod+C, the code block's Copy button) goes through
`editor-actions/system-clipboard.ts`, where a refused call resolves to nothing instead of an
unhandled rejection. A read waits for a closing menu to leave the page (Safari draws its Paste
prompt over it), and a whole block copies through `copyBlockToClipboard`, so every route writes the
same text. `lint/system-clipboard-calls.test.ts`.

**G4.221 · Clipboard text the engines agree on.** A paste with no paste event of its own (the
menus' Paste rows) hands its text to the focused block's `insertMarkdown` or `insertPlainText`,
since Firefox empties `clipboardData` on a `new ClipboardEvent(...)`. The selection's shown text is read only through
`shownSelectionText` (`browser/selection-read.ts`), which reads LF where Firefox on Windows writes CRLF,
and nothing for an empty block's placeholder `<br>` selected alone. `lint/file-rules.test.ts`.

**G4.223 · No engine sniffing.** `src/lib` outside `debug/` names no engine in script (`isFirefox`,
a user-agent read, `Edg/`): an engine bug is fixed where the editor reads or decides, the same way
on all three, and a CSS vendor prefix or a platform read (Mac's Cmd) is fine. Zero is the baseline
(`editor.md` § Browser engines). `lint/engine-sniffing.test.ts`.

**G4.224 · A press on chrome keeps focus where it was.** Engines disagree on where a pressed button
puts focus (the button, an ancestor, nowhere), and focus off the caret's block leaves Mod+Z and
Escape with no handler. So every button (a `<button>` or a `role="button"` element) in a component
or a bundled plugin's view sits under a mousedown or pointerdown handler that calls
`preventDefault()`, or its file is listed with where it gives focus back, and the list only shrinks.
`lint/chrome-press-focus.test.ts`.

**G4.225 · A drag hears its release first.** Only `selection/pointer-session.ts` listens for
`pointerup` or `pointercancel` on the window, so every drag resolves its last point before anything
else reacts to the release. Either phase counts, since a scan can't read a capture flag held in a
variable. A popover that shows on release (the selection toolbar) would otherwise cover the point
the drag hit-tests. `lint/file-rules.test.ts`.

**G4.226 · Platform chords in e2e.** On macOS Home and End scroll the page, Ctrl+click is a
right-click and Ctrl+A goes to the line's start, so a spec presses `edgeKey`, `extendKey`,
`ControlOrMeta`, `WORD_MODIFIER` or `COPY_DRAG_MODIFIERS` (`e2e/platform-keys.ts`), never a raw
Home, End, Cmd+Arrow or bare Ctrl. `keyboard-navigation/edge-chords.spec.ts` is the one spec that
sends both spellings literally. `e2e/lint/e2e-drivers.test.ts`.

**G4.227 · One caret-edge reader.** Home and End, with their modifiers, and macOS's Cmd+Arrow mean
the same moves, so every site that steps in on one asks `caretEdgeKey` (`schema/keybindings.ts`)
and none compares Home or End itself. It reads the raw Meta flag: Ctrl+Arrow is word motion on
Windows and Linux. PageUp and PageDown go the same way, through `pageKey`, which leaves them to the
browser with Ctrl, Cmd or Alt held. `lint/caret-edge-key-reader.test.ts`.

**G4.228 · A click that leaves the scroll alone.** Over WebDriver BiDi (Firefox), every locator
action first scrolls its target to the middle of the screen, even one already showing. So in a
spec that reads or sets the scroll (every VR spec does) and in every shared e2e helper, a locator
`click`, `hover`, `tap`, `dragTo` or `scrollIntoViewIfNeeded` fails the scan; `e2e/click-in-place.ts`
scrolls only a target that's off screen. `e2e/lint/e2e-drivers.test.ts`.

**G4.229 · A moved selection end shows.** Every end a key moves (Shift+Arrow, Shift+Home and End,
Shift+PageUp and PageDown, the document edges, a fold back into one block) is written in `selection/keyboard-extend.ts`, by
the functions the scan lists there, which mount that end and show it. Elsewhere a write of an end
(`extendFocus`, `enterCrossBlock`, `extendSelectionToRaw`) fails the scan unless its file is listed
with why it shows nothing: a drag's end is under the pointer, a restore shows its own caret.
`lint/file-rules.test.ts`.

**G4.230 · Chrome undoes through the root** (`history-chord-sites`). Engines disagree on Mod+Z
with a toolbar button focused (Chromium and WebKit undo the block last edited, Firefox nothing), so
the editor root answers the history chords anywhere inside it, and in its find bar wherever the host
mounts it, but where a block took the key or a text field owns it (`chromeHoldsFocus`). A file
under `components/` or `plugins/` that reads the chord or calls the history itself fails.
`lint/history-chord-sites.test.ts`; every engine in `keyboard-navigation/chrome-focus-undo.spec.ts`.

**G4.231 · Right-click menus are declared** (`context-menu-sites`). Safari selects the word or the
widget under a right-click before `contextmenu` fires. The root's capture-phase listener runs first
and decides what's left: a word stays for the clipboard rows, and a press on a widget gets the caret
every other engine puts beside it. A file in `src/lib` or a reference plugin that listens for
`contextmenu` and isn't in the scan's list fails, so a new menu route is checked the day it lands.
`lint/context-menu-sites.test.ts`; the target rows in `context-menu-press-selection.spec.ts`.

**G4.232 · Undo steps split on the spec's word.** The page's 250 ms typing pause fires late on a loaded
runner, and Firefox's driver can leave longer than that between two keys, so every e2e navigation
holds it (`e2e/goto-ready.ts`, through `e2e/typing-batch.ts`), and a spec ends a batch with `endTypingBatch`.
A `waitForTimeout` within three lines of an undo, or on a line naming undo grouping, fails, and so
does a reach for the real pause or the page handle outside `e2e/typing-batch.ts` and `tests/undo-typing-pause.spec.ts`.
`e2e/lint/e2e-drivers.test.ts`.

**G4.234 · One list of which deletes the editor writes.** `browser/input.ts` names every
delete input type and what each takes, so one spelled out anywhere else (a string, a
`startsWith('delete')`, a regex) fails: ask `decidedDelete`, `isDeleteInput` or `isMoveDelete`. A
`beforeinput` binding other than `editableSurface.onBeforeInput`, whose last step writes the delete,
fails too unless it's listed with why it writes no block's text. `lint/file-rules.test.ts`.

**G4.235 · Reading mode leaves Tab to the page** (`reading-keyboard-sites`). The keymaps' Tab chords
are declined at the command dispatcher in reading mode, so a keydown that compares the Tab key by
hand fails unless it's chrome that never opens there or the range keydown, which hands Tab back
first. And an element that writes itself a tabindex of 0 fails unless it's a control or the
reading-mode stop, so a new block can't add a stop of its own.
`lint/reading-keyboard-sites.test.ts`; every engine in `plugins/reading-keyboard.spec.ts`.

**G4.237 · One navigation per test.** A test gets its page from its describe's `beforeEach`, and
every navigation's readiness rules live in `e2e/goto-ready.ts` (the page it leaves has finished
loading, the route it reaches has hydrated), so a fix to how specs navigate lands in one place. The
scan walks each describe chain, outer hooks included, and fails a test reaching `gotoReady` or
`reloadReady` (through any e2e helper) at its `path:line`.
`e2e/lint/one-navigation-per-test.test.ts`.

**G4.239 · A delete at a block's edge runs the plain key.** A Backspace or Delete of any unit
(a character, a word, a line, by key or soft keyboard) at a block's edge runs what plain Backspace
or Delete binds there, through `collapsed-delete.ts` and the keymap, so the host's `keybindings`
decide it. A `'block.mergePrev'` or `'block.mergeNext'` anywhere but a keymap row, a handler's
`case` or the command id list fails. `lint/file-rules.test.ts`.

**G4.240 · One home for size observation.** The browser has two size-report quirks: an element
first observed while it delivers reports is skipped, and a size changed inside a delivery is
reported as a loop error. So every observer is made in `windowing/observe-resize.ts`, whose entry
points say when observing starts. `file-rules.test.ts`.

**G4.243 · One read of the caret's line.** At a soft wrap a caret's one DOM position is on two
lines, and `caretRectAt` reads one of them whatever the browser shows. So at a wrap the line
checks in `browser/visual-lines.ts` ask the browser through the caret writer, the one file G4.270 lets
call `Selection.modify`. Every other `caretRectAt` caller is listed with why getting the line
wrong at a wrap is harmless or a known gap. `lint/file-rules.test.ts`.

**G4.245 · One way to run a write rule.** A kind's `rawWrite` is read only by
`tree-operations/node-primitives.ts :: kindWriteRule`, which checks every run against G1.143. The
leaf-text reader (it reads the rule's `text`) and the conformance kit are the listed exceptions.
`lint/file-rules.test.ts`.

**G4.247 · A production build carries no dev check.** Under the `production` condition the editor's
dev-checks import gets `dev-checks-stripped.ts`: a constant-`false` switch and empty reporters.
`scripts/pack/verify-dev-strip.mjs` (run by verify-pack) builds a page through both builds with Vite and
fails on any check tag the production build keeps; the page imports `configureEditorEnv`, so only
the swap can prove the switch off. `test/dev-checks-stripped.test.ts` holds the copy to the real
module's names and to the side-effect annotations esbuild needs.

**G4.248 · One dev-check switch, imported by name.** Nothing reads `NODE_ENV`, `esm-env` is
imported only by `src/lib/dev-checks.ts`, and every module reaches that as
`@voithos-labs/aragonite/dev-checks`: `svelte-package` turns a relative or `#lib` spelling into a
path the production swap never sees. The repo's tools resolve the name to source through the
`aragonite-source` condition, the entry's first key (`scripts/lib-alias.mjs` refuses to load
otherwise). `lint/file-rules.test.ts`.

**G4.249 · One way into the height table.** A block's measured height is written to the list's
height table and the estimator only by `windowing/list-windowing.svelte.ts :: applyMeasured`, which
holds a height within a pixel of its record as that record, so a block remounting a fraction of a
pixel off moves no scroll. `lint/file-rules.test.ts`.

**G4.251 · The bundled Svelte reveal blocks are listed.** Every bundled plugin file that builds a
render-primary leaf in Svelte (`mode: 'render-primary'`) is on a declared list: block math, the
outline and the parrot. It's there so moving them onto `defineBlockView` starts from a list, not
a grep, and it guards nothing inside a listed file. `lint/file-rules.test.ts`.

**G4.252 · A press is read at the press.** The prose blocks' point readers (the widget hit, the source offset it names, the click side, the nearest widget edge, the shown-source test) are called only in `widget-interaction.ts` :: `readPress` and `islandDragAnchor`, which a press runs at pointer-down (`readPress` also serves `placeCaretAtPoint` and the keyboard menu, where no press moves anything). By the click, the press may have closed a shown source and moved the line under the point. `lint/call-site-rules.test.ts`.

**G4.255 · A fixme names its issue.** Every `test.fixme` and `test.describe.fixme` in an e2e spec
carries a reason starting `#<issue>: `, so when `npm run release:fixme-recheck` lists a row that
passes again, it also says which issue to look at. `e2e/lint/fixme-names-issue.test.ts`.

**G4.258 · The commit's own steps.** The fix-up (`tree-operations/fix-up/`, entered through
`fix-up/apply.ts`), the chain rebuild, the open last line, keep-a-block and the fold publish are imported at runtime only by
`editor-actions/commit/` and `invariants/`. A mutation writes below its scope through `own`,
`writeLeaf` and `splice`, and the commit rebuilds what it owned once. The few files that still call a
step say why, and what has to land before they stop. `lint/commit-private-steps.test.ts`.

**G4.259 · One write to a list of blocks.** The fix-up's writer (`fix-up/apply.ts`), the content
write and the copy before a write change a list of blocks only through
`tree-operations/node-primitives.ts :: spliceList`,
which calls the list's `beforeWrite` first. A keystroke saves its leaf's list there, so its rollback
puts back what the fix-up merged; a direct write would survive a rolled-back key.
`lint/one-list-writer.test.ts`, `keystroke-commit-frame.test.ts`.

**G4.260 · A render step and its partner run as a pair.** A step that runs before the DOM updates
for a new value, with a partner that runs once it has, goes through
`around-render.svelte.ts :: aroundRender`. Two effects over one value lose the partner when another
effect moves the value again inside the flush. A window floor left held that way shrinks its list
inside a later size report, which the browser reports as a loop. `lint/file-rules.test.ts`.

**G4.262 · The fix-up package is pure.** Every file in `tree-operations/fix-up/` but its writer
(`apply.ts`) and the host over the editor's grammar (`editor-host.ts`) loads at runtime only its
own files, `core/lines.ts` and `tree-operations/splice-many.ts`. The package reads Markdown only
through the host it's handed and returns a patch, so it can't parse on its own or write a list
it was handed; the writer is the one place a patch lands. `lint/fix-up-package-pure.test.ts`.

**G4.265 · A production build carries no dev-only module.** `scripts/pack/verify-dev-strip.mjs` builds
the Svelte page for production with source maps and fails on any byte owned by a file under
`invariants/` or by `debug/dump-tree.ts`. A predicate is reached only inside `assertInvariant` or
behind `devChecksOn`; code production runs (the commit scope, a list move's wrapper) lives elsewhere.
The prebuilt page's maps name its chunks, not the modules, so only the Svelte page is read.

**G4.268 · Every script has a caller.** A file under `scripts/` is run by an npm script, a workflow step,
a git hook, or another script (an import, or a spawned path), or it is imported by a root config or by
`src/`. A doc mention, a test that only reads the file and an error message naming it don't count: a
script reached only that way is hand-run, and is listed with its reason in the test. A listed script
that gains a caller, or goes away, fails too, so the list can't rot. `lint/script-callers.test.ts`.

**G4.269 · An e2e page reaches only the app server.** The shared fixture (`e2e/fixtures.ts`) blocks
every request a test's pages make to another host and fails the spec at teardown, naming each URL,
so the suites run without a network. A spec's own route for a made-up host runs before the block.
`route.continue()` would send a request straight past it, so a route passes requests on with
`route.fallback()`. `e2e/lint/e2e-drivers.test.ts`.

**G4.270 · The browser is touched in one module.** Only `browser/selection-read.ts` and the caret
writer read the native selection, only `caret-writer.ts` writes it (`Selection.modify` included),
`point.ts` asks for a caret or element at a point, `input.ts` reads `inputType` and
`getTargetRanges`, and `composition.ts` reads `isComposing`. `debug/`'s recorder may read what it
records; a directory that can't import `browser/` takes the read as a parameter. The write shapes
are in `lint/native-selection-write.ts` (G4.143 reads it too). `lint/browser-module.test.ts`.

**G4.271 · A windowed list indexes its children from its slice entries.** A list renders `windowSlicer`'s
entries and passes each child `entry.index` and `entry.id`. An index added up from the live window start
runs ahead of the loop's own index as soon as a height write moves the window, so a size report read
before the next render lands on the wrong block. `lint/window-slice-entries.test.ts`.

**G4.272 · A spawned child process has a timeout.** Every `spawn`, `exec`, `execFile`, `fork` and
their sync forms under `src/lib`, tests included, passes a `timeout` in its options, so a hung child
fails its own test instead of holding the whole run. `lint/spawn-timeouts.test.ts`.

**G4.273 · An IME key is never a command.** A keydown handler that runs a command starts with
`imeOwnsKey(e)`, which also catches the key opening a composition (code 229, `isComposing: false`
in Chromium and WebKit). The scan counts each file's keydown wirings against its `imeOwnsKey`
calls, and lists a forward to a handler that asks, or a listener that runs no command, with why.
The bundled plugins ask too, through the `imeOwnsKey` the plugin entry point exports.
`lint/ime-key-fence.test.ts`.

**G4.274 · One home for where a typed letter lands.** The `insert` intent (off `readInput`) and
`isPlainTypingKey` are read only in `components/blocks/editable/typed-insert.ts` and a short list,
each with its reason: the delimiter auto-pair, the range edits (live, across blocks, over a widget),
the caret hosts, the composition tracker, a code body and a painted source, the selected widget's
splice, the open line and the image dialog's own fields. `lint/typed-insert-home.test.ts`.

**G4.275 · One word rule.** Engines' word segmenters disagree whether a full stop or a colon between
two letters joins them (Chromium cuts `foo.bar`, Firefox and WebKit join it) and which segments are
words (Firefox calls some Japanese ones none), so `Intl.Segmenter` is read only in
`core/text-units.ts`, whose `wordSegments` always cuts there and calls a segment a word when it holds
a letter or a digit. The word delete, the word keys and the double-click read words through it.
`lint/file-rules.test.ts`.

**G4.276 · One reader for a widget's raw span.** A widget or a decoration says which raw bytes it
stands for in `data-source-start` and `data-source-end`, and only
`core/inline/widget-shell.ts :: widgetSourceRange` parses them back. It answers null unless both
parse, so no reader trusts half a span. Writing them is fine anywhere. `lint/file-rules.test.ts`.

**G4.277 · A bundled plugin is an outside author's package.** Each non-wrapper under `packages/` imports
only the core's `/plugin` and `/svelte`, `svelte`, its own files and its declared peers, an engine
only from `renderer.ts`. Its manifest carries the core's version, peers on exactly it, keeps other
peers optional, lists stylesheet importers in `sideEffects` and publishes `./conformance`, which
names `/testing`'s types and loads none of it. `lint/plugin-packages.test.ts`.
