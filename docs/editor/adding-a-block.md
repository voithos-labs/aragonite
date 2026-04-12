# Adding a New Block Type

How to add a block type to the CST editor. See `docs/editor/design/editor.md` for the architecture.

## Two Categories

| Category | Editing surface | Reference |
|----------|----------------|-----------|
| **Leaf** | Own editing surface (contenteditable, textarea, static) | TextEditableBlock, CodeBlock, ThematicBreakBlock |
| **Container** | Hosts a recursive BlockList of child blocks | BlockquoteBlock, ListBlock |

Pick the reference closest to your block. Read it fully before starting.

## Required Exports

Every block must export the `BlockComponent` shape. The `satisfies` check enforces this at compile time:

```
export const editable = true | false;
export const focusable = true | false;
export function focus(offset: number): void { ... }
export function getCursorOffset(): number | null { ... }
void ({ editable, focusable, focus, getCursorOffset } satisfies BlockComponent);
```

Optional: `getSelectedText()`, `setSelection(start, end)` — for blocks with text selection.

## Context

Every block reads `EditorActions` from Svelte context to communicate structural operations (split, merge, delete, focus) upward. Container blocks set a NEW context for their inner content.

## Registration

Add a case to BlockHost's `{#if}` chain. The block receives `node`, `index`, and binds `ref`.

## Container Blocks: Extra Requirements

- Maintain a parallel ID array and refs array for inner children
- Provide nested `EditorActions` that handle local operations and delegate boundary-crossing operations to the parent
- Rebuild the container's `raw` from its children after every structural mutation
- Implement all `EditorActions` methods (use no-op stubs for inapplicable ones like `insertParsedBlocks`)

## Testing

Complex blocks (lists, tables) get a dedicated spec in `e2e/requirements/blocks/` and test file in `e2e/tests/blocks/`. Simple blocks are covered by the feature-level test suites.

Write the requirements first, then the tests, then the implementation.
