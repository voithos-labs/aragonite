# Dev warnings

## What this is

The editor talks to you through the console in dev builds, and almost none of it is chatter. This
page says which channel is which, what fails on it, and how a test claims a fire it provokes on
purpose. The catalog of individual guards is `docs/design/invariants.md`; this is the taxonomy above
it.

## The sentinel

Every warning the editor itself emits goes through one function and comes out under one head:

```
[aragonite:<tag>] <message>
```

The sentinel is deliberate. No page script or dependency shares that prefix, so a browser-side gate
can fail on ours alone. In production the emitter returns before doing anything, so none of this
reaches a consumer.

**The funnel is a contract, not a description.** It is what lets the browser gate be sound and what
keeps a consumer's console ours-free, so library console output that reaches a user outside the
emitter is a defect to fix at the site, never a fourth channel to document here.

## Three classes

| Class              | Looks like                               | Means                                                                                                   |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Guard**          | `[aragonite:invariant:<name>]`           | A load-bearing contract was violated. Always a defect, yours or the one you just uncovered.             |
| **Diagnostic**     | `[aragonite:<subsystem>]`                | A seam refused something and degraded gracefully. Usually a defect upstream of it; occasionally benign. |
| **Svelte runtime** | `[svelte] state_proxy_equality_mismatch` | Raw-versus-proxy identity confusion. No sentinel, because it is not ours.                               |

**Guards.** The `invariant:` namespace is minted by one relay, so a guard fire is structurally
distinguishable from everything else. Guards never throw, because a false positive must not crash a
real editor, which is exactly why silence is the only acceptable reading of the channel. Each one is
catalogued with its predicate and its enforcement rung in `docs/design/invariants.md`.

**Diagnostics.** The tag names the subsystem that refused (the parser, the paste transforms, a
registry, the reorder primitive, and so on). `grep 'devWarn(' src/lib` for the live vocabulary
rather than trusting a list here; tags are added with the seams that need them. A diagnostic firing
during your change is a question to answer, not a line to route around.

**The Svelte runtime warn** is the one class the sentinel cannot cover, which is why the e2e error
collector keeps a separate list for it.

## The proxy-versus-raw identity class

`state_proxy_equality_mismatch` is the warning a contributor here meets first and understands last.
A node written into the `$state` tree is handed back as a proxy, and the proxy is not `===` the raw
object you wrote. Any code that keeps the pre-write copy and later compares it against what the tree
returns is comparing two identities for the same node, and Svelte says so. In this codebase the
usual cause is a node copy held past the splice that published it, which is rule 1's incident:
re-read through the tree, never keep the copy (`src/lib/tree-operations/unshare.ts` header owns the
full statement).

The message is more useful than it looks. In a dev build it embeds the comparison operator that
tripped it (`===`, `!==`, and so on), so the operator narrows the search to comparison sites of that
exact spelling. Outside dev the message degrades to a bare documentation URL with no operator, so
diagnose it in dev.

## What fails on what

| Gate                   | Watches                                         | Failure unit                                                     |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Unit suite (Vitest)    | Every `devWarn` fire, through a structured sink | The test that provoked it, unless that test claims it            |
| E2E specs (Playwright) | Console lines carrying the sentinel             | The spec whose page emitted one, at teardown                     |
| Simulation sessions    | The sentinel plus the Svelte runtime list       | The checkpoint, so a fire surfaces mid-session rather than after |

The unit runner registers a sink, which means the console line never happens there. Two consequences
worth knowing before you debug: a `console.warn` spy will not see dev warnings, and a `vi.mock` of
the dev-warn module removes the emitter entirely. Either one blinds the gate for that whole file, so
a source scan (G4.41) fails on both.

The e2e side is bidirectional. A spec that deliberately trips a fire names its tags
(`expectInvariants` for a guard, `expectWarns` for a diagnostic), and a named tag that stops firing
fails the spec too, so an expectation cannot quietly outlive its cause.

## Claiming a fire in a unit test

Four doors, narrowest first. Prefer the earliest one that fits.

1. The test's subject **is** the diagnostic: assert on the drained fires directly.
2. The test needs its fixture's noise out of the way: drain before the part it asserts on.
3. The test's fixture provokes a fire the test is not about: declare the tag file-scoped, with the
   reason on the line above.
4. A benign diagnostic too cross-cutting for any of those joins the shared warn allowlist, which
   waives a tag at a site for the whole run and only shrinks.

The fourth door blinds its site everywhere, which is why **no `invariant:` fire may take one**. A
guard that defers its fire past a tick is still attributed to the test that provoked it, so claim it
inside the test after awaiting a tick, never with a file-scoped declaration.

Two per-file aggregates close what a per-test verdict cannot see: a declared tag that never fires in
its file reds the file, and a fire arriving after the last test's verdict fails the file rather than
vanishing.

## Load-bearing versus chatter

Everything above is load-bearing: all three classes fail a gate somewhere, and the allowlist is the
only waiver in the system. What is genuinely chatter is the rest of the console, Vite's own
messages, hot-reload notices, and third-party logging, none of which any gate reads.

The practical rule: **if it carries `[aragonite:` or `state_proxy_equality_mismatch`, something is
wrong.** If a gate is not already red for it, the gap is in the gate.
