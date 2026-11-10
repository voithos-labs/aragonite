# Adding a block

Read this when you're adding a block kind that ships inside the editor, after `docs/design/editor.md` and before your first edit. It's a rare job, so check the first section before getting attached to it.

## Is it a built-in at all

Probably not. This page covers the kinds the editor itself ships, which today means GFM's own blocks. Everything else is a plugin, and plugin authors want `docs/guide/plugin-guide.md` instead.

## The edit sites

Start by reading the nearest existing component in full. `src/lib/components/blocks/ThematicBreakBlock.svelte` is the smallest leaf, and `src/lib/components/blocks/BlockquoteBlock.svelte` the smallest container. Then work down this table in order.

| Step | File | What you add | What fails without it |
| --- | --- | --- | --- |
| 1 | `src/lib/core/nodes.ts` | The kind in `LeafBlockKind` or `ContainerBlockKind`, its row in `BLOCK_KIND_TABLE`, its node interface in `BuiltinCstNode`, and its metadata in `BlockMetadataByKind` if it has any | `npm run check`, in this file and in steps 5 and 6 |
| 2 | `src/lib/schema/built-in-descriptors.ts` | A `registerBuiltinBlockKind` call: the descriptor | The `registry-completeness` dev check, on the first parse or mount |
| 3 | `src/lib/core/parsers/built-in-openers.ts` | An opener in `BUILT_IN_OPENERS`, named on the descriptor. Only when the parser must recognize the syntax on a line. | Nothing parses to the kind, so its conformance fixture fails |
| 4 | `src/lib/components/blocks/` | The component. It satisfies `BlockComponent` from `src/lib/block-component.ts`. | Step 5 has no component to name |
| 5 | `src/lib/components/built-in-blocks.ts` :: `BUILT_IN_VIEWS` | A row, built with `svelteBlockView`. Never a cast: the helper is what makes `npm run check` report a mis-shaped component. | `npm run check` |
| 6 | `src/lib/a11y-strings.ts` :: `BUILT_IN_BLOCK_LABELS` | What a screen reader and the block menu call the kind | `npm run check` |

That's six sites, five when the parser needs no opener. Apart from the component, each is a registry or a table derived from the kind union, and each fails a gate when you skip it. No core file gains a branch for your kind. If you find yourself writing `if (kind === 'yours')` somewhere else, stop and look for the registry.

## The descriptor's must-haves

`docs/design/plugin-contract.md` § The descriptor field reference lists every field, and `docs/design/plugin-contract.md` § The matrix covers the closure cells. The plugin guide teaches the ideas behind both. What a built-in has to get right on top of that:

- **`pageRole` and `estimateHeight`.** Plugins get defaults, built-ins don't. Leave either out and a dev check trips at mount. `pageRole` is `'prose'` for text the user writes in, or `'object'` for a block picked up whole, with a handle and its own menu.
- **`gapEdges`.** Declare only the edges your own gestures leave uncovered.
- **Reading `BUILT_IN_OPENERS`.** Only inside the registration function. Module top level is unsafe, because the parser's modules import one another in a cycle.
- **Opener priority.** Give the kind its own row in `src/lib/schema/opener-priorities.ts` and read it by name. Never copy a number, and never share one with another kind.
- **An opaque container's `rebuildRaw`.** It has to be deterministic. A dev check runs it twice and compares.

## Commands

- Keys come from the descriptor's `keymap`. A new command id is added to `BLOCK_COMMAND_IDS` in `src/lib/schema/commands.ts`, and the component runs it from its exported `runCommand`.
- `block.moveUp` and `block.moveDown` need nothing in the component. Bind them and they work.
- A command body reads the caret when it's called. An offset saved at keydown is wrong, because a command dispatched across blocks reaches the body with no keydown at all.

## Containers

Use `createContainerBlock` from `src/lib/editor-actions/plugin/container.ts`, the factory plugins use. The blockquote component is the whole example, and it's shorter than this section.

Only the list and the table are wired by hand. If yours truly can't use the factory, copy one of those two and keep these rules:

- Call `createContainerActions` once, at init, after reading whatever parent context you need.
- Its arguments are getters, not nodes.
- An override resolves to "did bytes land", and returns a delegate's promise unchanged.
- A container takes no history context, and never rebuilds its own bytes.
- Inside a commit, mutate only the scope the commit passes in, never a reference taken earlier.
- Don't focus after a commit. Return where the caret should go, and the commit puts it there.

## Tests to enrol

The order is requirements, then tests, then code. `docs/contributing/testing.md` has the mechanics.

- **A conformance fixture.** Set `conformanceFixture` on the descriptor: a source snippet that parses to the kind. Without one the conformance kit skips the kind and says nothing. Leave it out only when no document produces the kind by itself (a table cell, say), and say so in review.
- **A conformance profile, for a container.** Add it to `src/lib/test/invariants/builtin-container-profiles.ts`. A cell that doesn't apply is declared as such, with a reason. It's never just left out.

## A code-block language

Not a kind, but people look here. It's one import and one `registerBuiltinLanguage` call in `src/lib/components/blocks/code/code-bootstrap.ts`. Use that built-in form, since it survives the test reset. A host's own languages go through the public `registerLanguage`.
