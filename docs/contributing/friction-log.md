# Friction log

Friction that is real and reproduced but isn't a defect: a convention nobody wrote down, a
doc that sends you the wrong way, a boundary that reads as arbitrary until someone explains
it. Defects go to [GitHub Issues](https://github.com/voithos-labs/aragonite/issues); this
file is for everything else, the stuff that only exists for a person who doesn't already
know the codebase.

Entries come from cold-start probes (sessions where someone who's never seen the repo
tries to get something done) and from anyone who trips. **If you trip over something while
getting oriented, write it down here before you understand it.** Sounds backwards, isn't:
the moment you work out why a thing is the way it is, the friction goes invisible to you,
permanently, same as it is to me. Retired entries stay in the table for the same reason,
so the finding doesn't get rediscovered as new.

## Open

**Cross-block keydown has two branches with one chord set, and only the code says so.** The
branch that starts a cross-block selection from a plain caret and the branch that extends one
already in progress (`src/lib/selection/cross-block/keydown.ts`) carry the identical chord set,
and a comment at the first one says so. The codebase map's cross-block row doesn't, so a
contributor who arrives through the map (the intended route) adds a chord to one branch and
learns about the other only if they happen to scroll. That's the sibling-path bug shape rules.md
warns about, sitting in the one place rules.md doesn't point at. Yes, I see the irony.

**`RefSlots` hides its reactive contract behind an accessor pair.** The type
(`src/lib/reactivity/publish-ref.svelte.ts`) is a `get` and a `set` over the array a scope keeps
its mounted block components in, and its header explains why object identity matters. What it
doesn't say is whether a `get` participates in reactivity. It's the first question anyone
writing against it has, and the signature doesn't answer it.

**"An entry-level issue names the field, not the shape."** Our `good first issue` bodies tend to
describe the architectural shape a fix has to respect. That's the right content for the ledger
and the wrong content for somebody's first contribution, because the reader can't tell which
file to open or when they're done. The convention worth writing down: an entry-level body names
one concrete edit site and one acceptance signal, and keeps the shape as background.

## Retired

| Friction                                                                                                                                          | Retired by                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| No dev-warning taxonomy: console output was undifferentiated, and nothing said what fails                                                         | `067a08f6b` (warnings.md)                                        |
| The dirty-tree convention was unwritten, so an uncommitted call site read as precedent                                                            | `5a0904937` (CONTRIBUTING quickstart)                            |
| The reveal road was a chain of nine names in one paragraph, with no picture of the flow                                                           | `56e69b60d` (map diagram)                                        |
| Keyboard and chord dispatch had no single explanation of tiers, `Mod` folding, or the manifest                                                    | `14325665e`                                                      |
| The miss-analysis convention did not say where a unit-level one lives                                                                             | `d4cffb6df`, `e89934ced`                                         |
| `docs/design/editor.md` gave no reading tier, so orientation read as all-or-nothing                                                               | `d4cffb6df`                                                      |
| The consumer guide listed no keyboard shortcut table                                                                                              | `12cbc45db`                                                      |
| `consumer-smoke` ran on pull requests and `main` only, so a `dev` break surfaced on someone else's PR                                             | `0d46e7413` (consumer-smoke.yml)                                 |
| `docs/design/invariants.md` was a catalog unreadable in plain text: cells ran past a thousand characters, a wall in any editor, terminal, or diff | `2f865eb60` (the catalog reshape: index tables, per-entry prose) |
