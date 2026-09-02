# Dev warnings

In a dev build the editor talks to you through the console - don't ignore them, most of what shows up is a guard telling you something is wrong. This document will introduce
you to three relevant concepts:

1. the three kinds of console output (a.k.a the three channels) the editor produces in dev (a **guard** warning, a subsystem **diagnostic**, a **Svelte runtime** warning) and how to tell them apart by their prefix.
2. for each channel, which test gate goes red when it fires (i.e. unit run, e2e run, or nothing).
3. when a test deliberately triggers a warning (some tests exist to prove a guard works), how it declares "I expected this one" (via `expectWarns` and friends) so the gate doesn't count it as a failure.

Fun (?) fact, every guard is catalogued in [`../design/invariants.md`](../design/invariants.md), with what it checks and how hard it is enforced.

## One prefix to rule them all

Every dev warning the editor emits goes through `devWarn` (`src/lib/dev-warn.ts`) and comes out under one head:

```
[aragonite:<tag>] <message>
```

fyi:

- there are browser-side gates that depend on these dev warning syntaxes
- to keep consumer's console clean, in prod build, `devWarn` returns before doing anything

## The three channels

| Channel        | Looks like                               | What it means                                                                                                                                                                                                      |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guard          | `[aragonite:invariant:<name>]`           | A contract was violated. Always a defect, yours or one you just uncovered.                                                                                                                                         |
| Diagnostic     | `[aragonite:<subsystem>]`                | A seam (i.e. boundary; a place where responsibility changes hands from one piece of code to another, so to speak) refused something and degraded gracefully. Usually a defect upstream of it, occasionally benign. |
| Svelte runtime | `[svelte] state_proxy_equality_mismatch` | Svelte detects code comparing a raw object against its own proxy and emits this warning. (explained in "The proxy-versus-raw one" below)                                                                           |

To find **guards**, understand that guard sites use `assertInvariant` in `src/lib/assert.ts`. Also note that guards don't throw, because we don't want a false positive to crash the editor.

**Diagnostics**, on the other hand, calls `devWarn` from `src/lib/dev-warn.ts` directly. They carry the tag of the subsystem that refused (e.g. `reorder`, `tree-ops`, `decorations`, `registry`, etc.) (to get the list of diagnostic sites and the available subsystems, use `grep -r 'devWarn(' src/lib` or `Get-ChildItem src/lib -Recurse -Include *.ts,*.svelte | Select-String -SimpleMatch 'devWarn('`).

## The proxy-versus-raw one

When a plain object is written into Svelte's `$state`, Svelte wraps it in a proxy, and `$state` hands the proxy back on every later read. The proxy and your original raw object are the same node but two different JavaScript identities, so a `===` comparison is false even though both "are" that node. Svelte detects code comparing a raw object against its own proxy and emits `[svelte] state_proxy_equality_mismatch`. In this codebase the usual cause is holding a node copy past the insertion into the live tree (i.e. the CST, see [`syntax-tree.md`](../design/syntax-tree.md)), which is rule 1's incident (see [`rules.md`](rules.md)); remember, re-read through the tree, never keep the copy.

fyi, in a dev build the warning's message embeds the comparison operator that tripped it (`===`, `!==`, etc.), which narrows the hunt to comparison sites of that exact spelling; in prod it degrades to a bare documentation URL, so diagnose it in dev.

## What fails on what

Four things watch the console for these warnings. The unit suite and the e2e specs you have already met; the other two are the **simulation sessions** (long scripted editing runs that type whole documents through real keystrokes, see `testing.md`) and the dev server the e2e suite runs the editor on.

One mechanism to know before the table: under Vitest the console line never happens at all. The test setup registers a **sink** (a function `devWarn` hands entries to instead of printing), and the gate reads that.

| Gate                    | Watches                                                                                                                             | What goes red                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Unit suite (Vitest)     | every `devWarn` fire, through the sink                                                                                              | the test that provoked it, unless that test claims it (next section)                                                      |
| E2E specs (Playwright)  | console lines carrying the prefix                                                                                                   | the spec whose page emitted one, at teardown                                                                              |
| Simulation sessions     | the prefix, plus the Svelte runtime warn                                                                                            | the checkpoint the session was at (sessions assert at checkpoints mid-run), so a fire surfaces in context, not at the end |
| Playwright's dev server | that server's own console, for a fire during SSR (the page rendering on the server, so the warning lands there, not in the browser) | the whole run, at teardown; only when Playwright started the server itself rather than reusing one already running        |

Though, two consequences of the sink:

- a `console.warn` spy sees nothing
- `vi.mock`ing `$lib/dev-warn` deletes the emitter entirely

Either one blinds the gate for that whole file, so a source scan (G4.41 in `invariants.md`) fails on both.

On the e2e side the expectation runs in both directions: a spec that trips a fire on purpose declares its tags, `test.use({ expectInvariants: ['late-opener-registration'] })` for a guard (the bare tag; `assertInvariant` prepends the `invariant:` half) or `test.use({ expectWarns: ['tree-ops'] })` for a diagnostic. A declared tag that stops firing also fails the spec, so an expectation can't outlive its cause.

And if a fire ever shows up that no gate goes red for, that's a bug in the gate; file it.

## Claiming a fire in a unit test

Some tests light a fire on purpose (a test proving a guard works has to violate the contract). Four ways to claim one, narrowest first; take the earliest that fits:

1. the fire is the test's subject: assert on `takeDevWarns()` directly.
2. the fixture makes noise before the part you assert on: `drainDevWarns()` first.
3. the fixture provokes a fire the test is not about: `allowDevWarns([tag])`, file-scoped, reason on the line above.
4. a benign diagnostic too cross-cutting for any of those goes in `src/lib/test/support/warn-allowlist.json`, which waives one tag at one site for the entire run.

What way 1 gets back, from a fire that carried a `details` payload:

```ts
devWarn('tree-ops', 'probe message', { at: 3 });
takeDevWarns();
// [{ tag: 'tree-ops', message: 'probe message', details: { at: 3 }, site: 'src/lib/test/probe.test.ts' }]
```

`site` is the repo-relative file the fire came from, and it's also what an allowlist row keys on, together with the tag.

Prefer 1 through 3. An allowlist row hides every fire of that tag at that site, real bugs included, which is why the list only shrinks (it is empty right now, and adding the first row is a conversation, not a shrug), and why an `invariant:` fire may never take one.

In addition,

- a guard that defers its fire past a tick still lands on the test that provoked it; claim it inside that test (`await tick()`, then `takeDevWarns()`), never with way 3.
- per file: a tag declared through `allowDevWarns` that never fires reds the file (a waiver for something that no longer happens is a hole), and a fire arriving after the last test's verdict reds the file instead of vanishing.

The machinery behind all this is in [`testing.md`](testing.md).
