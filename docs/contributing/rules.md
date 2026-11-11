# Rules

Read this before your first edit, whoever or whatever you are. It holds the rules the code can't tell you, and what each one cost to learn. The tuition was paid in corrupted documents, so you get the lessons free.

## The five rules

### 1. The tree is the truth

The syntax tree is the document. When the tree and the DOM disagree, the tree is right.

- **A copy nobody rendered.** After a block split, keyed rendering got the wrong indices. The code had spliced its own copy of a node into the reactive tree, then kept using it. The tree answers with a proxy (the same node, a different JS object), so the copy was an object no component drew. Today the helpers in `src/lib/tree-operations/unshare.ts` copy and re-read for you, and Svelte's `state_proxy_equality_mismatch` warning fails the gates.
- **A write through an undo entry.** Undo entries point at live nodes instead of cloning them. A mutation changed bytes on a node an entry also pointed at, and a wrong document turned up after an undo, long after the faulty edit. Today readers get read-only node views (`src/lib/core/node-views.ts`), so TypeScript refuses the write. A dev check also verifies the newest undo entry at each commit (one change to the tree, not a git commit) and any entry an undo or redo restores, so the failure lands on the guilty change.
- **A render that fed itself.** A render effect wrote to the reactive cache it was reading, kept re-running itself, and corrupted keyed rendering. Now the render path builds inline content every time, code outside it uses a cache kept out of reactive state (`src/lib/core/inline/inline-cache.ts`), and nodes hold no reactive cache field. A source scan holds that.

### 2. Reactive state crosses modules as a getter

Hand a module a function that reads the value, never the value. Hand it everything else it needs the same explicit way (context, props, parameters), with no runtime patching.

An init effect once read a plain value, which froze the value and subscribed the effect to it. After that, any mutation anywhere wiped unrelated work. A commit's `landing` callback, which says where the caret goes, has the same hazard. It must look its node up when it's called, because a node captured before the commit is out of date. That one shipped, as a caret lost after deleting a list's last item. Today a scan rejects a `createBlockListState` call whose argument isn't a getter.

### 3. Sequencing is `await tick()` and nothing else

No timer (`setTimeout`, `requestAnimationFrame`, a microtask) makes one thing happen after another. The editor before aragonite used timers to cover a wrong order of operations, and that's what killed it. Today a source scan keeps a short list of allowed timers, and each one states why it orders nothing, such as an animation loop, the typing pause that closes an undo entry, a deadline, the drawn caret's paint on the next frame.

### 4. One rule, one shared place

A rule that several paths must follow lives in the one place they all go through, not in a copy per call site.

- **Endpoints and paths.** Of the three worst corruption bugs an internal audit found, two were one entry path missing a wrapping step that five sibling paths had. Today the selection state normalizes cross-block endpoints itself, so no caller wraps them by hand. A commit's path is a branded, document-absolute type (`src/lib/core/coordinate-spaces.ts` :: `DocPath`), so a plain array of indices isn't accepted as one. A dev guard checks the paths before each commit mutates anything, for callers the type can't reach.
- **Offsets.** Every offset bug in that audit was offset math done outside the one module that turns DOM positions into raw offsets and back (`src/lib/browser/offsets.ts`). Today each coordinate space has its own branded type, so mixing two is a compile error, and a scan rejects native selection writes outside the caret writer.
- **Registries.** They behave like `customElements`: register once, a duplicate throws, nothing unregisters, in production and tests alike. Tests isolate with the reset helpers. A dev server once re-evaluated a registering module, hit the throw, and every route answered 500 until restart, so under a dev server (and nowhere else) a duplicate of the editor's own entry replaces and warns. Separately, the test reset looped over a hand-kept list that lacked two registries, and state leaked between tests. Today one factory builds every registry and enrols it for reset (`src/lib/schema/plugin-registry.ts` :: `createPluginRegistry`), and a test demands a reset probe for each public `register*` or `declare*`.

### 5. A fix covers the class and leaves a guard

Fix the kind of bug, not the one report, and leave behind the check that would have caught it. The rest of this page is how.

## The enforcement ladder

Where a contract is held, best first:

1. **Impossible to write.** A type or a single entry point leaves the violation nowhere to go.
2. **Guarded.** A dev-time check fails a test.
3. **Written down.** Prose, for whatever is left.

Whenever you touch a convention, check whether it can move up a level.

A guard is a tagged call to a predicate, made at the shared place. The predicates live in `src/lib/invariants/` and the catalog is `docs/design/invariants.md`. A violation warns and fails the test that provoked it. It doesn't throw, because a false positive must not take down someone's editor. Production builds skip it.

## The bug shape to fear: sibling-path parity

Most corruption so far has had one shape: several routes into one operation (a key, a paste, an undo fallback), and a rule applied on all of them but one.

- Adding a route? Search its sibling routes for the rules they apply.
- Found one violation? List every sibling first, fix second.
- Prefer moving the rule to the shared place and deleting the per-route copies. Keeping it per route needs a reason, stated in the diff.
- Reviewing a diff that adds a route? Ask whether its rule could live at the shared place.
- No shared place possible yet? Write a source scan: a unit test in `src/lib/test/invariants/lint/` that reads the source files and asserts every route of that shape goes through the rule.

## Fixing bugs

- Root cause first, then the class, then the fix. No workaround for the one edge case.
- Watch the regression test fail on the unfixed code, for the reason you intended, before you write the fix. Until then the test is unproven.
- Your diagnosis is unproven too. Name the evidence that would confirm it and try to disprove it before you build. A wrong diagnosis ends in "fixing" correct code.
- "Existing tests cover it" counts only after you revert the change and watch a suite go red.
- Every fix records a one-line miss-analysis: which test should have caught this, and why there wasn't one. It goes in the paired requirement file for an e2e test, or in the regression test's header line for a unit test. Not in the commit message.

Two lessons, both learned the embarrassing way:

- **Green for the wrong reason.** One assertion ran against an editor that was never registered, so the branch it named couldn't run. One spec switched mode by clicking a toggle, and the click's blur did the clearing the mode switch was supposed to do. When an assertion can't show that the guarded code ran, break that code once and confirm the test goes red.
- **Tested is not working.** A feature had every layer green in unit tests and typing still did nothing, because Chromium sends no `beforeinput` to an editable element of zero height. Do the real gesture before you call it done.

## Testing shape

- Test the entry and dispatch layers directly. A pure core tested on input that was already normalized leaves the normalizing layer uncovered, and that layer is where the bugs have been.
- A generator has to include non-ASCII text, mixed constructs and edge shapes. One that can't produce the bug class is no evidence about it.
- A new class of feature adds a gesture to the simulation: scripted long sessions that type whole documents with real key events (`src/lib/e2e/simulation/user-simulator.ts`). It covers what it types and nothing else.
- How a spec pairs with its requirement file is in `testing.md`.

## Records

- The changelog holds only what shipped, added by the commit that ships it. For a pull request, a maintainer writes the entry at merge. A decision is kept with the contract it governs. Future plans aren't tracked in this repo.
- Moved an entry point? Update `codebase-map.md` in the same commit.
- Changed a behavior? Review every sentence that describes it: in `docs/guide/`, `docs/design/`, `src/lib/editor-props.ts`, the section notes of the entry files (`src/lib/plugin.ts`, `src/lib/svelte.ts`, `src/lib/index.ts`) and the tables of `docs/README.md`. A sentence in plain words holds no symbol for grep to find.
- Defects live in GitHub Issues. Each issue has a type (Bug, Feature or Task) and exactly one `area:` label. Only a Bug gets a `severity:` label:
  - `important`: corrupts bytes or breaks a contract
  - `minor`: real but bounded
  - `watch`: a signal, with no confirmed defect or repro
  - `nit`: cosmetic
- An issue's body holds the defect, the repro, the files, the direction of the fix and why it's deferred. Nothing about process.
- `good first issue` means one edit site and one acceptance signal.
- The closing comment names the commit. Reuse the labels that exist.
- `scripts/issues/audit-issues.mjs` fails on an open issue with no type or no area.
- Friction with no defect goes to Discussions. It becomes a Task once someone can name an edit site.
