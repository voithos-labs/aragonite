# Editor invariants

Most rules in a codebase live in someone's head and get enforced at code review, if anyone remembers. The ones in this doc are checked by code instead: break one and something fails, a dev warning, a test, the compiler or a lint. There are a couple hundred, from "a write never splits a `\r\n` line ending" to "a comment stays within two lines", and each has a number like G1.55.

The ones that matter most would otherwise fail quietly. Let a list's stored text drift from its items and nothing complains; the damage shows up three layers later, in a component that did nothing wrong, hours after the commit that caused it, and by then good luck. So each rule gets a place where it's checked and something that fails loudly, so you see it, and locally, at the code that broke it rather than the poor code that noticed.

The map:

- [The enforcement ladder](#the-enforcement-ladder): the three strengths a rule can be held at, and why prose is the last resort.
- [How a guard is built](#how-a-guard-is-built): one pure check shared by the running editor and the tests, what a fire looks like, and which test runs fail on one.
- [Adding a guard, retiring a guard](#adding-a-guard-retiring-a-guard): the procedure, numbers included.
- [Reading the catalog](#reading-the-catalog): the enforcement codes and where the files live.
- [Group 1: runtime checked](invariants/runtime.md): rules a dev build checks while the editor runs.
- [Group 2: property and regression tested](invariants/tested.md): rules only the test suite checks.
- [Group 3: compile time](invariants/compile-time.md): rules the compiler enforces; the violation doesn't build.
- [Group 4: source scans](invariants/scans.md): rules enforced by reading the source text itself.
- [Accessibility](#accessibility): the WCAG target and the gate that holds it.

<details>
<summary>Words the catalog leans on (if you know them, skip this)</summary>

- **raw**: a node's verbatim source bytes, markers included.
- **kind**: the string on a node that says what block it is.
- **descriptor**: the per-kind metadata record: how the kind merges, edits, renders.
- **opener**: the part of the parser that recognizes the syntax a block starts with.
- **chrome**: the parts of a block that are furniture rather than content (a title row, a table border).
- **ambient prefix**: the read-only marker a container lends its first child (a footnote definition's `[^label]: `).
- **scope**: one block list and its children; the unit of addressing and windowing.
- **path**: the child indices from the document root down to a block.
- **spine**: the chain of parents from the root down to the edited node.
- **settle**: the pass that re-derives the blank-line separators between blocks after a splice.

Everything rarer is glossed where it first shows up.

</details>

## The enforcement ladder

**Unrepresentable > guarded > documented.** Every contract climbs as high as it can:

| Level | Means | You'll find it in |
| --- | --- | --- |
| **Unrepresentable** | The compiler rejects the violation. Nothing to run | Group 3 |
| **Guarded** | A check fires where it breaks, in dev or in CI | Groups 1, 2, 4 |
| **Documented** | Prose plus per-instance regression tests | The `D` code (rare, on purpose) |

Prose is the last resort. Whenever you touch a rule, ask whether it can move up a level.

## How a guard is built

One predicate, two consumers. The check is written once, as a pure function, and the running editor and the test suite both call that same function, so the logic never exists twice:

```
              ┌──────────────────────────────┐
              │  predicate                   │   pure, no side effects:
              │  src/lib/invariants/*.ts     │   node → violation | null
              └──────────────┬───────────────┘
                  ┌──────────┴──────────┐
                  ▼                     ▼
        runtime DEV assertion      property / negative test
        where it can break         (imports the predicate directly)
```

### How a guard fires

Here's the whole shape on G1.1, the check that a container's raw still agrees with its children:

```ts
// src/lib/invariants/node-shape.ts: pure, node in, violation or null out
export function checkStaleRaw(node: CstNode): InvariantViolation | null {
	if (getBlockKindDescriptor(node.kind).containerContract !== 'strip') return null;
	const correspondent = soleCorrespondent(parse(node.raw, { scope: 'document' }).children, node);
	if (!rawFaithful(correspondent, node)) {
		return {
			code: 'stale-container-raw',
			message: `${node.kind} raw is stale relative to its children`,
			detail: { kind: node.kind, raw: clampForDetail(node.raw) }
		};
	}
	return null;
}

// src/lib/invariants/install.ts: the runtime consumer, run after every commit's raw rebuild
assertInvariant('stale-raw', () => checkStaleRaw(node));

// src/lib/test/invariants/stale-raw.test.ts: the test consumer, importing the predicate directly
expect(checkStaleRaw(parse('> hello\n> world\n').children[0])).toBeNull();
```

A violation is `{ code, message, detail? }` (`InvariantViolation`, in `src/lib/dev-checks.ts`). When one comes back, the runtime side prints it as one tagged console warning, tag first:

```
[aragonite:invariant:stale-raw] blockquote raw is stale relative to its children {kind: 'blockquote', raw: '> hello\n'}
```

`assertInvariant` lives in `src/lib/dev-checks.ts`, which every subsystem imports by its package name, `@voithos-labs/aragonite/dev-checks`. It's dev-only and it **never throws**, because a false positive mustn't crash a real editor. A production build gets an empty copy of the module instead (G4.247), so the call and its predicate compile out. Scope a per-commit check to the nodes the commit touched, never the whole document, or it stops being safe on a 10 MB file.

That `[aragonite:invariant:<tag>]` string is what every gate watches (`docs/contributing/warnings.md` § What fails on what has the list). One of them gets a name here: the shared e2e `test` fixture (`src/lib/e2e/fixtures.ts`), which fails any spec whose page emits a fire, is the **e2e invariant watcher** the entries below lean on. A spec whose subject is a fire declares it (`test.use({ expectInvariants: [tag] })`), and then the fire must arrive. No `invariant:` fire may be waived run-wide; `docs/contributing/warnings.md` § Claiming a fire in a unit test lists the local ways, narrowest first.

### Where the shape doesn't hold, and why

A minority of runtime guards are inline closures where their machinery runs, not shared predicates: G1.15, the five commit-and-parse guards G1.19 through G1.23, and the interaction halves of G1.26. What they check isn't a CST node's shape but a transient value the machinery builds mid-flight (a prepared commit scope, an unshare chain, an owned table view, an in-flight reveal). Those exist only mid-commit, mid-parse or mid-gesture. There's no stable object to hand a pure predicate, and no way for a test to reconstruct the exact state on its own.

So they're tested through the machinery that produces them (G1.15's tests drive the real `parse()`), or netted by the e2e invariant watcher, which for G1.19 through G1.23 and two of G1.26's halves is the whole net.

The rule of thumb: **if a test can construct the subject, the predicate is shared.** If only the machinery can, the guard lives where the machinery is.

## Adding a guard, retiring a guard

The catalog is a convention anyone extends, so here's the whole procedure:

1. Ask how high the contract can climb. If a type can make the violation impossible, write the type and claim a Group 3 number; the runtime check you didn't have to write is the best kind (G1.3 died this way, happily).
2. Otherwise pick the group by where the check can run: Group 1 if the running editor sees the violation, Group 2 if only a test can, Group 4 if the rule is a pattern in the source text. A Group 4 scan lands in `test/invariants/lint/`, or in `e2e/lint/` if it scans the e2e tree.
3. Claim the next free number in that group. Numbers are never reused, so an old citation in git history keeps meaning what it meant. That's also why the tables have holes: changes built in parallel claim their numbers up front, and a claim that never lands leaves its number unused.
4. If a test can construct the subject, write the predicate in `src/lib/invariants/` (pure: node in, violation or null out, the `checkStaleRaw` shape above) and wire both consumers: the DEV assertion where the violation happens, through `assertInvariant`, and a property or negative test in `src/lib/test/invariants/` that imports the predicate directly. If only the machinery can construct the subject, write the guard inline where that machinery runs and let the e2e invariant watcher net it.
5. Add the row to the group's index table and the entry below it. The row is one line a person can read cold; the entry carries the rule, why it holds, what to do when it fires, where it runs and its tests, in at most six lines (G4.218 counts them). The group files are [runtime](invariants/runtime.md), [tested](invariants/tested.md), [compile time](invariants/compile-time.md) and [source scans](invariants/scans.md); the row and the entry go in the one that matches how the guard is enforced.
6. Cite the G-number from the guard and its tests, so a grep for the id lands here and at the code in one pass.

Retiring one: G1.3 is the pattern. When a stronger level makes a check redundant, delete the guard, its tests and its entry, and keep the number. The row stays, marked retired, saying what superseded it.

## Reading the catalog

Enforcement codes, used in every index table: `A` runtime DEV assertion · `P` property test (fast-check) · `N` negative fixture · `T` compile-time type guard · `L` lint/source-scan · `D` doc · `harness` a test harness or gate script that runs the code (a conformance kit, the adapter smoke).

Predicates live in `src/lib/invariants/`; property tests and their arbitraries (the random-CST generators fast-check draws from) in `src/lib/test/invariants/`, run by `npm run test:editor:invariants`. A path below is relative to `src/lib/` unless it starts with `src/`, `docs/` or `scripts/`. The catalog references files, never line numbers.

One standing rule about the predicate directory: no `invariants/` module takes a runtime dependency on `selection/` (a type import is fine). The Group 2 predicates are test-only too, and never exported through `src/lib/index.ts`.

Each group below is a short index table, then one prose entry per id. The row tells you whether you care, and the entry tells you everything the row compressed.

## Accessibility

Target: WCAG 2.1 AA, enforced by an `@axe-core/playwright` baseline gate (`test:e2e:a11y`, part of `npm test`). axe runs over `.editor` across representative states (default content, an active cross-block selection, the failed-block fallback, a blocked-scheme link) and fails on any violation whose rule id isn't in the committed allowlist (`src/lib/e2e/a11y/axe-baseline.json`).

That allowlist is the log of deferred AA work, and it **only shrinks**. Every editable block carries its kind as its accessible name, so an unnamed textbox fails the gate. Contrast is the one thing axe can't settle (it measures whatever page the editor sits on), so G4.62 certifies the shipped palette instead. The cross-block selection is painted by an overlay with the native selection suppressed, so it's announced through a visually hidden `aria-live` region fed by `createSelectionDescription`.
