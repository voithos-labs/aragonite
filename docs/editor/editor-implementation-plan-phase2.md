# Editor Phase 2 — Block Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add all GFM block types to the editor — headings, fenced code, thematic breaks, a raw-editable fallback for remaining leaf types, and container blocks (blockquotes, lists) — building on the Phase 1 paragraph-only foundation.

**Architecture:** Text-editable blocks share a reusable `TextEditableBlock.svelte` component (refactored from `ParagraphBlock`), parameterized by CSS class and behavior flags. Non-text blocks (thematic breaks) and blocks with different editing surfaces (fenced code via `<textarea>`) get dedicated components. Container blocks (blockquotes, lists) use recursive `BlockList` composition with nested `EditorActions` contexts. Merge eligibility rules gate Backspace behavior between block types.

**Tech Stack:** Svelte 5 (runes: `$state`, `$props`, `$effect`), SvelteKit 2, TypeScript, Vitest

**Spec:** `docs/editor/editor.md` — Phase 2 (lines 448-473), Merge Eligibility (lines 195-203), Container Blocks (lines 221-266), Node Type Coverage (lines 423-443)

**Commit convention:** Symbol-prefixed, lowercase, no period, scoped with `(editor)`. Example: `+ (editor) heading block component`. See `docs/commit-conventions.md`. Never include `Co-Authored-By` lines.

---

## File Structure

### New Files

| File | Responsibility |
| ---- | -------------- |
| `src/lib/editor/merge-rules.ts` | Pure functions: `isMergeEligible(prev, curr)`, `isBlockEditable(kind)` |
| `src/lib/editor/components/TextEditableBlock.svelte` | Shared contenteditable surface for paragraph, heading, and raw-editable blocks |
| `src/lib/editor/components/ThematicBreakBlock.svelte` | Non-editable, focusable horizontal rule block |
| `src/lib/editor/components/CodeBlock.svelte` | Fenced code block — `<textarea>` editing surface |
| `src/lib/editor/components/BlockquoteBlock.svelte` | Container — renders `>` wrapper + nested BlockList |
| `src/lib/editor/components/ListBlock.svelte` | Container — renders ListItem children |
| `src/lib/editor/components/ListItemBlock.svelte` | Container — renders marker + nested BlockList |
| `src/lib/editor/container-raw.ts` | Raw text reconstruction for container blocks after inner edits |
| `src/lib/editor/test/merge-rules.test.ts` | Tests for merge eligibility rules |
| `src/lib/editor/test/container-raw.test.ts` | Tests for container raw reconstruction |

### Modified Files

| File | Change |
| ---- | ------ |
| `src/lib/editor/components/BlockHost.svelte` | Add resolution branches for all block types |
| `src/lib/editor/components/Editor.svelte` | Integrate merge eligibility, add container edit support |
| `src/lib/editor/components/ParagraphBlock.svelte` | Delete — replaced by TextEditableBlock |
| `src/lib/editor/editor-types.ts` | Add container support methods to EditorActions |
| `src/lib/editor/tree-operations.ts` | Generalize to accept `{ children: MutableNode[] }` for nested containers |
| `src/lib/editor/test/tree-operations.test.ts` | Add tests for heading split/merge, thematic break operations |
| `src/lib/editor/index.ts` | Export new modules |

### Reference Files (Read, Don't Modify)

| File | Why |
| ---- | --- |
| `src/lib/editor/core/nodes.ts` | CST node types, `BlockKind`, metadata interfaces |
| `src/lib/editor/core/parser.ts` | `parse()` — used by tree operations for re-parsing |
| `src/lib/editor/core/serializer.ts` | `serialize()` — structural typing |
| `docs/editor/editor.md` | Full design spec |

---

## Block Type → Component Mapping

| CST Kind | Component | Surface | Notes |
| -------- | --------- | ------- | ----- |
| `paragraph` | TextEditableBlock | contenteditable | `blockClass="paragraph-block"` |
| `heading` | TextEditableBlock | contenteditable | `blockClass="heading-N"` (N = level) |
| `setextHeading` | TextEditableBlock | contenteditable | `blockClass="heading-N"` (same styling as ATX) |
| `fencedCode` | CodeBlock | textarea | Enter adds newlines (no split) |
| `thematicBreak` | ThematicBreakBlock | none (div+tabindex) | Non-editable, focusable |
| `indentedCode` | TextEditableBlock | contenteditable | `blockClass="raw-block"` |
| `htmlBlock` | TextEditableBlock | contenteditable | `blockClass="raw-block"` |
| `linkReferenceDefinition` | TextEditableBlock | contenteditable | `blockClass="raw-block"` |
| `table` | TextEditableBlock | contenteditable | `blockClass="raw-block"` |
| `unrecognized` | TextEditableBlock | contenteditable | `blockClass="raw-block"` |
| `blockquote` | BlockquoteBlock | container | Recursive BlockList |
| `list` | ListBlock | container | Renders ListItem children |
| `listItem` | ListItemBlock | container | Marker + recursive BlockList |

---

## Task 1: Merge Eligibility Rules

**Files:**

- Create: `src/lib/editor/merge-rules.ts`
- Create: `src/lib/editor/test/merge-rules.test.ts`
- Modify: `src/lib/editor/components/Editor.svelte:108-127`

- [ ] **Step 1: Write failing tests for merge eligibility**

```typescript
// src/lib/editor/test/merge-rules.test.ts
import { describe, it, expect } from 'vitest';
import { isMergeEligible, isBlockEditable } from '../merge-rules';

describe('isMergeEligible', () => {
    it('two paragraphs are mergeable', () => {
        expect(isMergeEligible('paragraph', 'paragraph')).toBe(true);
    });

    it('heading + paragraph are mergeable (heading absorbs)', () => {
        expect(isMergeEligible('heading', 'paragraph')).toBe(true);
    });

    it('setextHeading + paragraph are mergeable', () => {
        expect(isMergeEligible('setextHeading', 'paragraph')).toBe(true);
    });

    it('two headings are NOT mergeable', () => {
        expect(isMergeEligible('heading', 'heading')).toBe(false);
    });

    it('paragraph + heading are NOT mergeable', () => {
        expect(isMergeEligible('paragraph', 'heading')).toBe(false);
    });

    it('fencedCode + anything are NOT mergeable', () => {
        expect(isMergeEligible('fencedCode', 'paragraph')).toBe(false);
        expect(isMergeEligible('paragraph', 'fencedCode')).toBe(false);
    });

    it('thematicBreak + anything are NOT mergeable', () => {
        expect(isMergeEligible('thematicBreak', 'paragraph')).toBe(false);
    });

    it('two unrecognized blocks are mergeable', () => {
        expect(isMergeEligible('unrecognized', 'unrecognized')).toBe(true);
    });

    it('table + paragraph are NOT mergeable', () => {
        expect(isMergeEligible('table', 'paragraph')).toBe(false);
    });

    it('container blocks are NOT mergeable', () => {
        expect(isMergeEligible('blockquote', 'paragraph')).toBe(false);
        expect(isMergeEligible('list', 'paragraph')).toBe(false);
    });
});

describe('isBlockEditable', () => {
    it('paragraph is editable', () => {
        expect(isBlockEditable('paragraph')).toBe(true);
    });

    it('heading is editable', () => {
        expect(isBlockEditable('heading')).toBe(true);
    });

    it('fencedCode is editable', () => {
        expect(isBlockEditable('fencedCode')).toBe(true);
    });

    it('thematicBreak is NOT editable', () => {
        expect(isBlockEditable('thematicBreak')).toBe(false);
    });

    it('container blocks are editable (hold text content via children)', () => {
        expect(isBlockEditable('blockquote')).toBe(true);
        expect(isBlockEditable('list')).toBe(true);
        expect(isBlockEditable('listItem')).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:editor -- --reporter verbose merge-rules`
Expected: FAIL — module not found

- [ ] **Step 3: Implement merge-rules.ts**

```typescript
// src/lib/editor/merge-rules.ts

/**
 * Merge eligibility rules for the block editor.
 * Determines what happens on Backspace at the start of a block.
 * See docs/editor/editor.md — Structural Operations, Merge Eligibility.
 */

// ── Merge Eligibility ───────────────────────────────────────────────────────

const MERGEABLE_PAIRS = new Set([
    'paragraph+paragraph',
    'heading+paragraph',
    'setextHeading+paragraph',
    'unrecognized+unrecognized',
]);

/**
 * Can the block at `currKind` merge into the block at `prevKind` on Backspace?
 * When false, Backspace either deletes the previous block (if non-editable)
 * or moves focus to the end of the previous block (if editable).
 */
export function isMergeEligible(prevKind: string, currKind: string): boolean {
    return MERGEABLE_PAIRS.has(`${prevKind}+${currKind}`);
}

// ── Block Editability ───────────────────────────────────────────────────────

const NON_EDITABLE_KINDS = new Set(['thematicBreak']);

/**
 * Can this block receive text input? Non-editable blocks (thematic break)
 * are deleted on Backspace from the following block.
 */
export function isBlockEditable(kind: string): boolean {
    return !NON_EDITABLE_KINDS.has(kind);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:editor -- --reporter verbose merge-rules`
Expected: all PASS

- [ ] **Step 5: Commit**

```
+ (editor) merge eligibility rules
```

- [ ] **Step 6: Integrate merge eligibility into Editor.svelte**

Replace the `mergeWithPrevious` method in `Editor.svelte:108-127`. Add import for `isMergeEligible` and `isBlockEditable` from `../merge-rules`.

```typescript
async mergeWithPrevious(blockIndex: number): Promise<void> {
    if (blockIndex <= 0) return;

    const prevKind = doc.children[blockIndex - 1].kind;
    const currKind = doc.children[blockIndex].kind;

    if (!isMergeEligible(prevKind, currKind)) {
        if (!isBlockEditable(prevKind)) {
            // Previous block is non-editable — delete it
            if (undoDebounceTimer) {
                clearTimeout(undoDebounceTimer);
                undoDebounceTimer = null;
            }
            pushUndoSnapshot(blockIndex, 0);
            needsUndoCheckpoint = true;
            performDelete(doc, blockIds, blockIndex - 1);
            doc.children = [...doc.children];
            blockIds = [...blockIds];
            await tick();
            blockRefs[blockIndex - 1]?.focus?.(0);
        } else {
            // Previous block is editable but not mergeable — move focus
            blockRefs[blockIndex - 1]?.focus?.(999999);
        }
        return;
    }

    // Mergeable — proceed with merge
    const prevRaw = doc.children[blockIndex - 1].raw;
    let mergeOffset = prevRaw.length;
    if (prevRaw.endsWith('\r\n')) mergeOffset -= 2;
    else if (prevRaw.endsWith('\n')) mergeOffset -= 1;

    if (undoDebounceTimer) {
        clearTimeout(undoDebounceTimer);
        undoDebounceTimer = null;
    }
    pushUndoSnapshot(blockIndex, 0);
    needsUndoCheckpoint = true;
    performMerge(doc, blockIds, blockIndex);
    doc.children = [...doc.children];
    blockIds = [...blockIds];
    await tick();
    blockRefs[blockIndex - 1]?.focus?.(mergeOffset);
},
```

- [ ] **Step 7: Commit**

```
~ (editor) integrate merge eligibility into editor shell
```

---

## Task 2: TextEditableBlock + Heading Support

**Files:**

- Create: `src/lib/editor/components/TextEditableBlock.svelte` (from ParagraphBlock)
- Modify: `src/lib/editor/components/BlockHost.svelte`
- Delete: `src/lib/editor/components/ParagraphBlock.svelte`
- Modify: `src/lib/editor/test/tree-operations.test.ts`

- [ ] **Step 1: Write tree-operations tests for heading split/merge**

These test that the existing generic tree operations handle headings correctly. Add to `tree-operations.test.ts`:

```typescript
describe('heading operations', () => {
    it('splits a heading into heading + paragraph', () => {
        const source = '## Hello World\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];
        // Split at offset 8: "## Hello" | " World"
        splitNode(mutable, ids, 0, 8);
        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].kind).toBe('heading');
        expect(mutable.children[0].raw).toBe('## Hello\n');
        expect(mutable.children[1].kind).toBe('paragraph');
        expect(mutable.children[1].raw).toBe(' World\n');
    });

    it('splits a heading at start produces empty paragraph + heading', () => {
        const source = '## Title\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];
        splitNode(mutable, ids, 0, 0);
        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].kind).toBe('paragraph');
        expect(mutable.children[0].raw).toBe('\n');
        expect(mutable.children[1].kind).toBe('heading');
        expect(mutable.children[1].raw).toBe('## Title\n');
    });

    it('merges heading + paragraph into heading', () => {
        const doc = parse('');
        const mutable = toMutable(doc);
        mutable.children = [
            { kind: 'heading', leadingTrivia: '', raw: '## Hello\n', metadata: { level: 2 } },
            { kind: 'paragraph', leadingTrivia: '', raw: ' World\n' }
        ];
        const ids = ['id-1', 'id-2'];
        mergeWithPrevious(mutable, ids, 1);
        expect(mutable.children).toHaveLength(1);
        expect(mutable.children[0].kind).toBe('heading');
        expect(mutable.children[0].raw).toBe('## Hello World\n');
    });
});
```

- [ ] **Step 2: Run tests to verify they pass**

These should already pass — tree operations are block-type agnostic (they re-parse via `reparseAsNode`).

Run: `npm run test:editor -- --reporter verbose tree-operations`
Expected: all PASS

- [ ] **Step 3: Commit the heading tree-operations tests**

```
@ (editor) add tree-operations tests for heading split/merge
```

- [ ] **Step 4: Create TextEditableBlock.svelte from ParagraphBlock**

Copy `ParagraphBlock.svelte` → `TextEditableBlock.svelte`. Changes:

1. Add `blockClass` prop (default `'paragraph-block'`)
2. Add `splitOnEnter` prop (default `true`) — used by code blocks later
3. Replace hardcoded class `"paragraph-block"` with `"text-editable-block {blockClass}"`
4. Add heading-level CSS and raw-block CSS
5. Handle `splitOnEnter === false`: insert newline instead of splitting

Key prop changes:

```typescript
let {
    node,
    index,
    blockClass = 'paragraph-block',
    splitOnEnter = true
}: {
    node: MutableNode;
    index: number;
    blockClass?: string;
    splitOnEnter?: boolean;
} = $props();
```

Key `onKeyDown` change for Enter:

```typescript
if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const offset = getCursorOffset() ?? 0;
    if (splitOnEnter) {
        actions.splitBlock(index, offset);
    } else {
        // Insert newline at cursor (for code blocks using contenteditable)
        const displayText = getDisplayText();
        const newDisplay = displayText.slice(0, offset) + '\n' + displayText.slice(offset);
        actions.updateBlockContent(index, newDisplay + '\n');
        if (el) el.textContent = newDisplay;
        setCursorOffset(offset + 1);
    }
    return;
}
```

Template:

```svelte
<div
    bind:this={el}
    tabindex="0"
    class="text-editable-block {blockClass}"
    contenteditable="true"
    role="textbox"
    oninput={onInput}
    onkeydown={onKeyDown}
    onbeforeinput={onBeforeInput}
    oncopy={onCopy}
    oncut={onCut}
    onpaste={onPaste}
    oncompositionstart={onCompositionStart}
    oncompositionend={onCompositionEnd}
></div>
```

CSS additions (append to existing ParagraphBlock styles, rename root class):

```css
.text-editable-block {
    outline: none;
    padding: 2px 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    min-height: 1.4em;
    width: 100%;
}

/* Paragraph placeholder */
.text-editable-block.paragraph-block:empty::before {
    content: 'Start typing...';
    color: var(--color-ui-dulled, #666);
    pointer-events: none;
}

/* Heading levels */
.text-editable-block.heading-1 { font-size: 2em; font-weight: bold; line-height: 1.2; }
.text-editable-block.heading-2 { font-size: 1.5em; font-weight: bold; line-height: 1.3; }
.text-editable-block.heading-3 { font-size: 1.25em; font-weight: bold; }
.text-editable-block.heading-4 { font-size: 1.1em; font-weight: bold; }
.text-editable-block.heading-5 { font-size: 1em; font-weight: bold; }
.text-editable-block.heading-6 { font-size: 0.9em; font-weight: bold; }

/* Raw-editable fallback (indented code, HTML, tables, etc.) */
.text-editable-block.raw-block {
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 0.9em;
    opacity: 0.85;
}
```

- [ ] **Step 5: Update BlockHost.svelte**

Replace ParagraphBlock import with TextEditableBlock. Add heading resolution:

```svelte
<script lang="ts">
    import type { MutableNode, BlockComponent } from '../editor-types';
    import TextEditableBlock from './TextEditableBlock.svelte';

    let {
        node,
        index,
        ref = $bindable()
    }: { node: MutableNode; index: number; ref?: BlockComponent } = $props();

    function headingClass(): string {
        const level = (node.metadata as { level?: number })?.level ?? 1;
        return `heading-${level}`;
    }
</script>

{#if node.kind === 'paragraph'}
    <TextEditableBlock {node} {index} bind:this={ref} blockClass="paragraph-block" />
{:else if node.kind === 'heading' || node.kind === 'setextHeading'}
    <TextEditableBlock {node} {index} bind:this={ref} blockClass={headingClass()} />
{:else}
    <!-- Fallback: render raw text for all unhandled block types -->
    <div class="raw-block">
        <pre>{node.raw}</pre>
    </div>
{/if}

<style>
    .raw-block {
        padding: 2px 0;
        opacity: 0.7;
    }

    .raw-block pre {
        margin: 0;
        white-space: pre-wrap;
        font-family: inherit;
    }
</style>
```

- [ ] **Step 6: Delete ParagraphBlock.svelte**

Remove `src/lib/editor/components/ParagraphBlock.svelte`.

- [ ] **Step 7: Update Editor.svelte for block type change focus**

When `updateBlockContent` detects a kind change (e.g., paragraph → heading), the block component type changes. Focus needs to be restored after re-render. Modify `updateBlockContent` in `Editor.svelte:162-168`:

```typescript
updateBlockContent(blockIndex: number, text: string, preEditOffset?: number): void {
    pushUndoSnapshotDebounced(blockIndex, preEditOffset ?? 0);
    const result = performUpdate(doc, blockIndex, text);
    if (result.kindChanged) {
        doc.children = [...doc.children];
        // Re-focus after Svelte swaps the component type.
        // Use preEditOffset (the cursor position before the edit) to restore
        // the cursor approximately where it was.
        tick().then(() => {
            blockRefs[blockIndex]?.focus?.(preEditOffset ?? 0);
        });
    }
},
```

- [ ] **Step 8: Run all editor tests**

Run: `npm run test:editor`
Expected: all PASS

- [ ] **Step 9: Commit**

```
> (editor) replace ParagraphBlock with generic TextEditableBlock, add heading support
```

---

## Task 3: ThematicBreakBlock

**Files:**

- Create: `src/lib/editor/components/ThematicBreakBlock.svelte`
- Modify: `src/lib/editor/components/BlockHost.svelte`

- [ ] **Step 1: Write tree-operations test for thematic break split**

Add to `tree-operations.test.ts`:

```typescript
describe('thematic break operations', () => {
    it('splitting at end of thematic break produces break + empty paragraph', () => {
        const source = '---\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];
        // Split at display text end (offset 3, before the \n)
        splitNode(mutable, ids, 0, 3);
        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].kind).toBe('thematicBreak');
        expect(mutable.children[0].raw).toBe('---\n');
        expect(mutable.children[1].kind).toBe('paragraph');
        expect(mutable.children[1].raw).toBe('\n');
    });
});
```

- [ ] **Step 2: Run test — should pass (tree ops are generic)**

Run: `npm run test:editor -- --reporter verbose tree-operations`

- [ ] **Step 3: Commit test**

```
@ (editor) add tree-operations test for thematic break split
```

- [ ] **Step 4: Create ThematicBreakBlock.svelte**

```svelte
<script lang="ts">
    import { getContext } from 'svelte';
    import {
        EDITOR_ACTIONS_KEY,
        type EditorActions,
        type MutableNode,
        type BlockComponent
    } from '../editor-types';

    let { node, index }: { node: MutableNode; index: number } = $props();

    const actions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
    let el: HTMLDivElement | undefined = $state();

    // ── BlockComponent interface ────────────────────────────────────────

    export const editable = false;
    export const focusable = true;

    export function focus(): void {
        el?.focus();
    }

    export function getCursorOffset(): number | null {
        if (!el || document.activeElement !== el) return null;
        return 0;
    }

    // ── Event Handlers ──────────────────────────────────────────────────

    function onKeyDown(e: KeyboardEvent): void {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            actions.requestUndo();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            actions.requestRedo();
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            // Split at end of raw display text → creates empty paragraph below
            const displayLen = node.raw.endsWith('\r\n')
                ? node.raw.length - 2
                : node.raw.endsWith('\n')
                    ? node.raw.length - 1
                    : node.raw.length;
            actions.splitBlock(index, displayLen);
            return;
        }

        if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            actions.deleteBlock(index);
            return;
        }

        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault();
            actions.moveFocus(index - 1, 'end');
            return;
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            actions.moveFocus(index + 1, 'start');
            return;
        }
    }
</script>

<div
    bind:this={el}
    tabindex="0"
    class="thematic-break-block"
    role="separator"
    onkeydown={onKeyDown}
>
    <hr />
</div>

<style>
    .thematic-break-block {
        outline: none;
        padding: 8px 0;
    }

    .thematic-break-block:focus {
        outline: 2px solid var(--color-accent, #4a9eff);
        outline-offset: 2px;
        border-radius: 2px;
    }

    hr {
        border: none;
        border-top: 2px solid var(--color-ui-muted, #444);
        margin: 0;
    }
</style>
```

- [ ] **Step 5: Register in BlockHost.svelte**

Add import and resolution branch:

```svelte
import ThematicBreakBlock from './ThematicBreakBlock.svelte';

{:else if node.kind === 'thematicBreak'}
    <ThematicBreakBlock {node} {index} bind:this={ref} />
```

- [ ] **Step 6: Run all editor tests**

Run: `npm run test:editor`

- [ ] **Step 7: Commit**

```
+ (editor) thematic break block component
```

---

## Task 4: CodeBlock (Fenced Code)

**Files:**

- Create: `src/lib/editor/components/CodeBlock.svelte`
- Modify: `src/lib/editor/components/BlockHost.svelte`

This validates the BlockComponent interface with a different editing surface (`<textarea>` instead of `contenteditable`).

- [ ] **Step 1: Create CodeBlock.svelte**

```svelte
<script lang="ts">
    import { getContext } from 'svelte';
    import {
        EDITOR_ACTIONS_KEY,
        type EditorActions,
        type MutableNode,
        type BlockComponent
    } from '../editor-types';

    let { node, index }: { node: MutableNode; index: number } = $props();

    const actions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
    let textarea: HTMLTextAreaElement | undefined = $state();
    let userIsTyping = false;
    let preEditOffset = 0;

    // ── BlockComponent interface ────────────────────────────────────────

    export const editable = true;
    export const focusable = true;

    export function focus(offset: number): void {
        if (!textarea) return;
        textarea.focus();
        const maxOffset = textarea.value.length;
        const clamped = Math.min(Math.max(0, offset), maxOffset);
        textarea.selectionStart = textarea.selectionEnd = clamped;
    }

    export function getCursorOffset(): number | null {
        if (!textarea || document.activeElement !== textarea) return null;
        return textarea.selectionStart;
    }

    export function getSelectedText(): string {
        if (!textarea) return '';
        return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    }

    export function setSelection(start: number, end: number): void {
        if (!textarea) return;
        textarea.selectionStart = start;
        textarea.selectionEnd = end;
    }

    // ── Content sync ────────────────────────────────────────────────────

    function getDisplayText(): string {
        let text = node.raw;
        if (text.endsWith('\r\n')) text = text.slice(0, -2);
        else if (text.endsWith('\n')) text = text.slice(0, -1);
        return text;
    }

    $effect(() => {
        const display = getDisplayText();
        if (!textarea || userIsTyping) return;
        if (textarea.value !== display) {
            textarea.value = display;
            autoResize();
        }
    });

    function autoResize(): void {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }

    // ── Event Handlers ──────────────────────────────────────────────────

    function onInput(): void {
        if (!textarea) return;
        userIsTyping = true;
        actions.updateBlockContent(index, textarea.value + '\n', preEditOffset);
        userIsTyping = false;
        autoResize();
    }

    function onKeyDown(e: KeyboardEvent): void {
        preEditOffset = textarea?.selectionStart ?? 0;

        // Undo/Redo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            actions.requestUndo();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            actions.requestRedo();
            return;
        }

        // Backspace at position 0 → move focus to previous block
        if (e.key === 'Backspace' && textarea) {
            if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
                e.preventDefault();
                actions.moveFocus(index - 1, 'end');
                return;
            }
        }

        // ArrowUp at start → move to previous block
        if (e.key === 'ArrowUp' && !e.shiftKey && textarea) {
            // At position 0 or within the first line
            const textBefore = textarea.value.slice(0, textarea.selectionStart);
            if (!textBefore.includes('\n')) {
                e.preventDefault();
                actions.moveFocus(index - 1, 'end');
                return;
            }
        }

        // ArrowDown at end → move to next block
        if (e.key === 'ArrowDown' && !e.shiftKey && textarea) {
            const textAfter = textarea.value.slice(textarea.selectionStart);
            if (!textAfter.includes('\n')) {
                e.preventDefault();
                actions.moveFocus(index + 1, 'start');
                return;
            }
        }

        // Enter: let textarea handle naturally (inserts newline)
    }

    // Clipboard — intercept to source from node.raw
    function onCopy(e: ClipboardEvent): void {
        if (!textarea) return;
        e.preventDefault();
        const text = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
        e.clipboardData?.setData('text/plain', text);
    }

    function onCut(e: ClipboardEvent): void {
        if (!textarea) return;
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value.slice(start, end);
        e.clipboardData?.setData('text/plain', text);

        const newValue = textarea.value.slice(0, start) + textarea.value.slice(end);
        actions.updateBlockContent(index, newValue + '\n');
        textarea.value = newValue;
        textarea.selectionStart = textarea.selectionEnd = start;
        autoResize();
    }

    function onPaste(e: ClipboardEvent): void {
        if (!textarea) return;
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain') ?? '';
        if (!text) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = textarea.value.slice(0, start) + text + textarea.value.slice(end);
        actions.updateBlockContent(index, newValue + '\n');
        textarea.value = newValue;
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        autoResize();
    }
</script>

<textarea
    bind:this={textarea}
    class="code-block"
    value={getDisplayText()}
    oninput={onInput}
    onkeydown={onKeyDown}
    oncopy={onCopy}
    oncut={onCut}
    onpaste={onPaste}
    spellcheck={false}
></textarea>

<style>
    .code-block {
        width: 100%;
        outline: none;
        padding: 12px;
        font-family: 'Fira Code', 'Consolas', monospace;
        font-size: 0.9em;
        line-height: 1.5;
        background: var(--color-bg-secondary, #1e1e1e);
        border: 1px solid var(--color-ui-muted, #333);
        border-radius: 4px;
        color: inherit;
        resize: none;
        overflow: hidden;
        white-space: pre;
        tab-size: 4;
        box-sizing: border-box;
    }

    .code-block:focus {
        border-color: var(--color-accent, #4a9eff);
    }
</style>
```

- [ ] **Step 2: Register in BlockHost.svelte**

Add import and resolution branch:

```svelte
import CodeBlock from './CodeBlock.svelte';

{:else if node.kind === 'fencedCode'}
    <CodeBlock {node} {index} bind:this={ref} />
```

- [ ] **Step 3: Run all editor tests**

Run: `npm run test:editor`

- [ ] **Step 4: Commit**

```
+ (editor) fenced code block with textarea surface
```

---

## Task 5: Raw Editable Fallback

**Files:**

- Modify: `src/lib/editor/components/BlockHost.svelte`

All remaining leaf block types (`indentedCode`, `htmlBlock`, `linkReferenceDefinition`, `table`, `unrecognized`) render as raw-editable blocks via TextEditableBlock with `blockClass="raw-block"`. This replaces the current `<pre>` fallback.

- [ ] **Step 1: Update BlockHost.svelte — replace the `{:else}` fallback**

Building on the BlockHost from Task 2 (paragraph + heading) and Tasks 3-4 (thematic break + code block), add the `ThematicBreakBlock` and `CodeBlock` imports, and change the final `{:else}` branch to render remaining leaf types as raw-editable blocks:

```svelte
import ThematicBreakBlock from './ThematicBreakBlock.svelte';
import CodeBlock from './CodeBlock.svelte';

<!-- Add these branches (after heading, before the {:else} fallback): -->
{:else if node.kind === 'thematicBreak'}
    <ThematicBreakBlock {node} {index} bind:this={ref} />
{:else if node.kind === 'fencedCode'}
    <CodeBlock {node} {index} bind:this={ref} />
{:else}
    <!-- All other leaf types: raw editable (indentedCode, htmlBlock,
         linkReferenceDefinition, table, unrecognized) -->
    <TextEditableBlock {node} {index} bind:this={ref} blockClass="raw-block" />
{/if}
```

Container block branches (`blockquote`, `list`) will be added in Tasks 7-8.

- [ ] **Step 2: Run all editor tests**

Run: `npm run test:editor`

- [ ] **Step 3: Commit**

```
~ (editor) route remaining leaf types through raw-editable fallback
```

---

## Task 6: Container Block Infrastructure

**Files:**

- Modify: `src/lib/editor/tree-operations.ts`
- Modify: `src/lib/editor/editor-types.ts`
- Modify: `src/lib/editor/components/Editor.svelte`
- Create: `src/lib/editor/container-raw.ts`
- Create: `src/lib/editor/test/container-raw.test.ts`
- Modify: `src/lib/editor/test/tree-operations.test.ts`

This task prepares the infrastructure for container blocks (blockquotes, lists) without adding any container components yet.

### Step 1: Generalize tree operations

- [ ] **Step 1a: Write a test proving tree operations work on arbitrary children arrays**

Add to `tree-operations.test.ts`:

```typescript
describe('tree operations on arbitrary parent', () => {
    it('splitNode works on a container children array', () => {
        // Simulate a blockquote's inner children
        const parent = {
            children: [
                { kind: 'paragraph', leadingTrivia: '', raw: 'Hello World\n' }
            ]
        };
        const ids = ['id-1'];
        splitNode(parent, ids, 0, 5);
        expect(parent.children).toHaveLength(2);
        expect(parent.children[0].raw).toBe('Hello\n');
        expect(parent.children[1].raw).toBe(' World\n');
    });
});
```

- [ ] **Step 1b: Refactor tree-operations.ts parameter types**

Change all functions from `doc: MutableDocument` to `parent: { children: MutableNode[] }`:

```typescript
type NodeParent = { children: MutableNode[] };

export function splitNode(
    parent: NodeParent,
    blockIds: string[],
    blockIndex: number,
    offset: number
): void {
    const node = parent.children[blockIndex];
    // ... (replace all doc.children with parent.children)
}

export function mergeWithPrevious(
    parent: NodeParent,
    blockIds: string[],
    blockIndex: number
): void {
    // ... (replace all doc.children with parent.children)
}

export function deleteNode(
    parent: NodeParent,
    blockIds: string[],
    blockIndex: number
): void {
    // ... (replace all doc.children with parent.children)
}

export function updateNodeContent(
    parent: NodeParent,
    blockIndex: number,
    newText: string
): { kindChanged: boolean; newKind?: string } {
    // ... (replace all doc.children with parent.children)
}
```

Export the `NodeParent` type.

`MutableDocument` satisfies `NodeParent` (it has `children: MutableNode[]`), so all existing call sites (Editor.svelte) work unchanged.

- [ ] **Step 1c: Run all tests to confirm no regression**

Run: `npm run test:editor`

- [ ] **Step 1d: Commit**

```
~ (editor) generalize tree operations to accept any parent with children
```

### Step 2: Add container edit support to EditorActions

- [ ] **Step 2a: Extend EditorActions interface**

Add to `editor-types.ts`:

```typescript
export interface EditorActions {
    // ... existing methods ...

    /** Push a document-level undo snapshot. Called by container blocks before structural mutations. */
    beginContainerEdit?(blockIndex: number, offset: number): void;
    /** Push a debounced undo snapshot. Called by container blocks for text input. */
    beginContainerEditDebounced?(blockIndex: number, offset: number): void;
    /** Trigger top-level Svelte reactivity after a container mutation. */
    endContainerEdit?(): void;
}
```

All three are optional (`?`) — leaf blocks never call them.

- [ ] **Step 2b: Implement in Editor.svelte**

Add to the `actions` object:

```typescript
beginContainerEdit(blockIndex: number, offset: number): void {
    if (undoDebounceTimer) {
        clearTimeout(undoDebounceTimer);
        undoDebounceTimer = null;
    }
    pushUndoSnapshot(blockIndex, offset);
    needsUndoCheckpoint = true;
},

beginContainerEditDebounced(blockIndex: number, offset: number): void {
    pushUndoSnapshotDebounced(blockIndex, offset);
},

endContainerEdit(): void {
    doc.children = [...doc.children];
},
```

- [ ] **Step 2c: Commit**

```
~ (editor) add container edit support to EditorActions
```

### Step 3: Container raw reconstruction

- [ ] **Step 3a: Write failing tests for container-raw.ts**

```typescript
// src/lib/editor/test/container-raw.test.ts
import { describe, it, expect } from 'vitest';
import { rebuildBlockquoteRaw, rebuildListItemRaw, rebuildListRaw } from '../container-raw';
import type { MutableNode } from '../editor-types';

describe('rebuildBlockquoteRaw', () => {
    it('rebuilds single paragraph blockquote', () => {
        const node: MutableNode = {
            kind: 'blockquote',
            leadingTrivia: '',
            raw: '',
            innerPrefix: '',
            children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Hello\n' }],
            innerSuffix: ''
        };
        rebuildBlockquoteRaw(node);
        expect(node.raw).toBe('> Hello\n');
    });

    it('rebuilds multi-paragraph blockquote with blank line', () => {
        const node: MutableNode = {
            kind: 'blockquote',
            leadingTrivia: '',
            raw: '',
            innerPrefix: '',
            children: [
                { kind: 'paragraph', leadingTrivia: '', raw: 'Hello\n' },
                { kind: 'paragraph', leadingTrivia: '\n', raw: 'World\n' }
            ],
            innerSuffix: ''
        };
        rebuildBlockquoteRaw(node);
        expect(node.raw).toBe('> Hello\n>\n> World\n');
    });

    it('handles multi-line paragraph inside blockquote', () => {
        const node: MutableNode = {
            kind: 'blockquote',
            leadingTrivia: '',
            raw: '',
            innerPrefix: '',
            children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Line 1\nLine 2\n' }],
            innerSuffix: ''
        };
        rebuildBlockquoteRaw(node);
        expect(node.raw).toBe('> Line 1\n> Line 2\n');
    });

    it('handles empty paragraph inside blockquote', () => {
        const node: MutableNode = {
            kind: 'blockquote',
            leadingTrivia: '',
            raw: '',
            innerPrefix: '',
            children: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }],
            innerSuffix: ''
        };
        rebuildBlockquoteRaw(node);
        // An empty line inside a blockquote is just '>' (blank prefix, no content)
        expect(node.raw).toBe('>\n');
    });
});

describe('rebuildListItemRaw', () => {
    it('rebuilds simple list item', () => {
        const node: MutableNode = {
            kind: 'listItem',
            leadingTrivia: '',
            raw: '',
            metadata: { marker: '- ', taskItem: false, taskChecked: false },
            innerPrefix: '',
            children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Item text\n' }],
            innerSuffix: ''
        };
        rebuildListItemRaw(node);
        expect(node.raw).toBe('- Item text\n');
    });

    it('rebuilds list item with multi-line paragraph', () => {
        const node: MutableNode = {
            kind: 'listItem',
            leadingTrivia: '',
            raw: '',
            metadata: { marker: '- ', taskItem: false, taskChecked: false },
            innerPrefix: '',
            children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Line 1\nLine 2\n' }],
            innerSuffix: ''
        };
        rebuildListItemRaw(node);
        expect(node.raw).toBe('- Line 1\n  Line 2\n');
    });

    it('rebuilds ordered list item', () => {
        const node: MutableNode = {
            kind: 'listItem',
            leadingTrivia: '',
            raw: '',
            metadata: { marker: '1. ', taskItem: false, taskChecked: false },
            innerPrefix: '',
            children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'First\n' }],
            innerSuffix: ''
        };
        rebuildListItemRaw(node);
        expect(node.raw).toBe('1. First\n');
    });

    it('rebuilds list item with two paragraphs separated by blank line', () => {
        const node: MutableNode = {
            kind: 'listItem',
            leadingTrivia: '',
            raw: '',
            metadata: { marker: '- ', taskItem: false, taskChecked: false },
            innerPrefix: '',
            children: [
                { kind: 'paragraph', leadingTrivia: '', raw: 'Para 1\n' },
                { kind: 'paragraph', leadingTrivia: '\n', raw: 'Para 2\n' }
            ],
            innerSuffix: ''
        };
        rebuildListItemRaw(node);
        // Blank line between paragraphs in a list item is preserved as
        // an empty line (no indent). The GFM spec treats this as a "loose"
        // list item where paragraphs are separated by blank lines.
        expect(node.raw).toBe('- Para 1\n\n  Para 2\n');
    });
});

describe('rebuildListRaw', () => {
    it('rebuilds list from items', () => {
        const item1: MutableNode = {
            kind: 'listItem', leadingTrivia: '', raw: '- A\n',
            metadata: { marker: '- ', taskItem: false, taskChecked: false },
            innerPrefix: '', children: [], innerSuffix: ''
        };
        const item2: MutableNode = {
            kind: 'listItem', leadingTrivia: '', raw: '- B\n',
            metadata: { marker: '- ', taskItem: false, taskChecked: false },
            innerPrefix: '', children: [], innerSuffix: ''
        };
        const node: MutableNode = {
            kind: 'list',
            leadingTrivia: '',
            raw: '',
            metadata: { ordered: false },
            innerPrefix: '',
            children: [item1, item2],
            innerSuffix: ''
        };
        rebuildListRaw(node);
        expect(node.raw).toBe('- A\n- B\n');
    });
});
```

- [ ] **Step 3b: Run tests to verify failure**

Run: `npm run test:editor -- --reporter verbose container-raw`
Expected: FAIL — module not found

- [ ] **Step 3c: Implement container-raw.ts**

```typescript
// src/lib/editor/container-raw.ts

/**
 * Raw text reconstruction for container blocks.
 * After editing inner children, the container's `raw` must be rebuilt
 * to keep serialization consistent.
 */

import type { MutableNode } from './editor-types';

// ── Blockquote ──────────────────────────────────────────────────────────────

/**
 * Rebuild a blockquote's `raw` from its inner children.
 * Prepends `> ` to each content line and `>` to blank lines.
 */
export function rebuildBlockquoteRaw(node: MutableNode): void {
    if (!node.children) return;

    const innerContent =
        (node.innerPrefix ?? '') +
        node.children.map((c) => c.leadingTrivia + c.raw).join('') +
        (node.innerSuffix ?? '');

    node.raw = prefixLines(innerContent, '> ', '>');
}

// ── List ────────────────────────────────────────────────────────────────────

/**
 * Rebuild a list item's `raw` from its inner children.
 * First line gets the marker, continuation lines get indentation.
 * Blank lines between paragraphs are preserved without indentation
 * (this is how GFM represents "loose" list items).
 */
export function rebuildListItemRaw(node: MutableNode): void {
    if (!node.children || !node.metadata) return;

    const marker = (node.metadata as { marker?: string }).marker ?? '- ';
    const indent = ' '.repeat(marker.length);

    const innerContent =
        (node.innerPrefix ?? '') +
        node.children.map((c) => c.leadingTrivia + c.raw).join('') +
        (node.innerSuffix ?? '');

    const lines = innerContent.split('\n');
    node.raw = lines
        .map((line, i) => {
            // Trailing empty string after final \n — preserve as-is
            if (i === lines.length - 1 && line === '') return '';
            // First line gets the marker
            if (i === 0) return marker + line;
            // Blank lines are preserved without indentation (loose list items)
            if (line === '') return '';
            // Content continuation lines get indentation
            return indent + line;
        })
        .join('\n');
}

/**
 * Rebuild a list's `raw` by concatenating its list item children.
 */
export function rebuildListRaw(node: MutableNode): void {
    if (!node.children) return;
    node.raw = node.children.map((c) => c.leadingTrivia + c.raw).join('');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Prepend a prefix to each line. Uses `contentPrefix` for non-blank lines
 * and `blankPrefix` for blank lines. The trailing empty string after the
 * final `\n` is preserved without a prefix.
 */
function prefixLines(text: string, contentPrefix: string, blankPrefix: string): string {
    const lines = text.split('\n');
    return lines
        .map((line, i) => {
            if (i === lines.length - 1 && line === '') return '';
            if (line === '') return blankPrefix;
            return contentPrefix + line;
        })
        .join('\n');
}
```

- [ ] **Step 3d: Run tests to verify they pass**

Run: `npm run test:editor -- --reporter verbose container-raw`

- [ ] **Step 3e: Commit**

```
+ (editor) container raw reconstruction for blockquotes and lists
```

---

## Task 7: BlockquoteBlock

**Files:**

- Create: `src/lib/editor/components/BlockquoteBlock.svelte`
- Modify: `src/lib/editor/components/BlockHost.svelte`

This is the first container block. It renders a nested `BlockList` with its own `EditorActions` context. The nested context handles local operations (split, merge, focus within the blockquote) and delegates boundary events (Backspace at first child, ArrowDown past last child) to the parent.

- [ ] **Step 1: Create BlockquoteBlock.svelte**

```svelte
<script lang="ts">
    import { getContext, setContext, tick } from 'svelte';
    import {
        EDITOR_ACTIONS_KEY,
        type EditorActions,
        type MutableNode,
        type BlockComponent
    } from '../editor-types';
    import { assignIds } from '../mutable-tree';
    import {
        splitNode as performSplit,
        mergeWithPrevious as performMerge,
        deleteNode as performDelete,
        updateNodeContent as performUpdate
    } from '../tree-operations';
    import { isMergeEligible, isBlockEditable } from '../merge-rules';
    import { rebuildBlockquoteRaw } from '../container-raw';
    import BlockList from './BlockList.svelte';

    let { node, index }: { node: MutableNode; index: number } = $props();

    const parentActions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
    let innerBlockIds = $state<string[]>(assignIds(node.children ?? []));
    let innerBlockRefs = $state<(BlockComponent | undefined)[]>([]);

    // ── BlockComponent interface ────────────────────────────────────────

    // Containers are editable (they hold text content via inner children).
    // This matters for merge eligibility: Backspace from the block after a
    // container should move focus into it, not delete it. isMergeEligible
    // already blocks direct text merging with containers.
    export const editable = true;
    export const focusable = true;

    export function focus(offset: number): void {
        if (!node.children || node.children.length === 0) return;
        // Container focus only supports two modes: start (offset 0) → first
        // child, or end (any non-zero offset) → last child. Numeric raw-text
        // offsets cannot meaningfully map into nested children. If undo
        // restores focus to a container, it routes to the nearest edge.
        if (offset === 0) {
            innerBlockRefs[0]?.focus?.(0);
        } else {
            const last = node.children.length - 1;
            innerBlockRefs[last]?.focus?.(999999);
        }
    }

    export function getCursorOffset(): number | null {
        for (const ref of innerBlockRefs) {
            const offset = ref?.getCursorOffset?.();
            if (offset !== null && offset !== undefined) return offset;
        }
        return null;
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    function innerParent(): { children: MutableNode[] } {
        return { children: node.children! };
    }

    function rebuildAndNotify(): void {
        rebuildBlockquoteRaw(node);
        parentActions.endContainerEdit?.();
    }

    function triggerInnerReactivity(): void {
        node.children = [...(node.children ?? [])];
        innerBlockIds = [...innerBlockIds];
    }

    // ── Nested EditorActions ────────────────────────────────────────────

    const nestedActions: EditorActions = {
        async splitBlock(innerIndex: number, offset: number): Promise<void> {
            if (!node.children) return;
            parentActions.beginContainerEdit?.(index, offset);
            performSplit(innerParent(), innerBlockIds, innerIndex, offset);
            rebuildAndNotify();
            triggerInnerReactivity();
            await tick();
            innerBlockRefs[innerIndex + 1]?.focus?.(0);
        },

        async mergeWithPrevious(innerIndex: number): Promise<void> {
            if (!node.children) return;

            if (innerIndex <= 0) {
                // At start of first child — cross boundary upward
                parentActions.moveFocus(index - 1, 'end');
                return;
            }

            const prevKind = node.children[innerIndex - 1].kind;
            const currKind = node.children[innerIndex].kind;

            if (isMergeEligible(prevKind, currKind)) {
                const prevRaw = node.children[innerIndex - 1].raw;
                let mergeOffset = prevRaw.length;
                if (prevRaw.endsWith('\r\n')) mergeOffset -= 2;
                else if (prevRaw.endsWith('\n')) mergeOffset -= 1;

                parentActions.beginContainerEdit?.(index, 0);
                performMerge(innerParent(), innerBlockIds, innerIndex);
                rebuildAndNotify();
                triggerInnerReactivity();
                await tick();
                innerBlockRefs[innerIndex - 1]?.focus?.(mergeOffset);
            } else if (!isBlockEditable(prevKind)) {
                parentActions.beginContainerEdit?.(index, 0);
                performDelete(innerParent(), innerBlockIds, innerIndex - 1);
                rebuildAndNotify();
                triggerInnerReactivity();
                await tick();
                innerBlockRefs[innerIndex - 1]?.focus?.(0);
            } else {
                innerBlockRefs[innerIndex - 1]?.focus?.(999999);
            }
        },

        async deleteBlock(innerIndex: number): Promise<void> {
            if (!node.children) return;

            if (node.children.length <= 1) {
                // Last child — delete entire blockquote
                parentActions.deleteBlock(index);
                return;
            }

            parentActions.beginContainerEdit?.(index, 0);
            performDelete(innerParent(), innerBlockIds, innerIndex);
            rebuildAndNotify();
            triggerInnerReactivity();
            await tick();
            const focusIdx = Math.min(innerIndex, node.children.length - 1);
            innerBlockRefs[focusIdx]?.focus?.(0);
        },

        async moveFocus(
            innerIndex: number,
            position: 'start' | 'end' | number
        ): Promise<void> {
            if (!node.children) return;

            if (innerIndex < 0) {
                // Before first child — move before blockquote
                parentActions.moveFocus(index - 1, 'end');
            } else if (innerIndex >= node.children.length) {
                // After last child — move after blockquote
                parentActions.moveFocus(index + 1, 'start');
            } else {
                const block = innerBlockRefs[innerIndex];
                if (!block?.focusable) return;
                if (typeof position === 'number') block.focus?.(position);
                else if (position === 'start') block.focus?.(0);
                else block.focus?.(999999);
            }
        },

        updateBlockContent(
            innerIndex: number,
            text: string,
            preEditOffset?: number
        ): void {
            if (!node.children) return;
            parentActions.beginContainerEditDebounced?.(index, preEditOffset ?? 0);
            const result = performUpdate(innerParent(), innerIndex, text);
            rebuildBlockquoteRaw(node);
            if (result.kindChanged) {
                triggerInnerReactivity();
                tick().then(() => {
                    innerBlockRefs[innerIndex]?.focus?.(
                        text.length > 0 ? text.length - 1 : 0
                    );
                });
            }
        },

        requestUndo(): void | Promise<void> {
            return parentActions.requestUndo();
        },

        requestRedo(): void | Promise<void> {
            return parentActions.requestRedo();
        },

        // Propagate container support for deeply nested containers
        beginContainerEdit(blockIndex: number, offset: number): void {
            parentActions.beginContainerEdit?.(index, offset);
        },

        beginContainerEditDebounced(blockIndex: number, offset: number): void {
            parentActions.beginContainerEditDebounced?.(index, offset);
        },

        endContainerEdit(): void {
            rebuildBlockquoteRaw(node);
            parentActions.endContainerEdit?.();
        }
    };

    setContext(EDITOR_ACTIONS_KEY, nestedActions);
</script>

<div class="blockquote-block">
    <BlockList
        children={node.children ?? []}
        blockIds={innerBlockIds}
        bind:blockRefs={innerBlockRefs}
    />
</div>

<style>
    .blockquote-block {
        border-left: 3px solid var(--color-ui-muted, #555);
        padding-left: 16px;
        margin: 4px 0;
    }
</style>
```

- [ ] **Step 2: Register in BlockHost.svelte**

Add import and resolution branch (before the `{:else}` fallback):

```svelte
import BlockquoteBlock from './BlockquoteBlock.svelte';

{:else if node.kind === 'blockquote'}
    <BlockquoteBlock {node} {index} bind:this={ref} />
```

- [ ] **Step 3: Manual verification**

Run: `npm run tauri dev`
Test with a document containing blockquotes. Verify:
- Blockquote renders with left border
- Text editing inside blockquote works
- Enter splits inner blocks
- Backspace at start of first child moves focus before blockquote
- ArrowDown past last child moves focus after blockquote
- Undo/Redo works for edits inside blockquotes

- [ ] **Step 4: Run all editor tests**

Run: `npm run test:editor`

- [ ] **Step 5: Commit**

```
+ (editor) blockquote container block with nested editing
```

---

## Task 8: ListBlock / ListItemBlock

**Files:**

- Create: `src/lib/editor/components/ListBlock.svelte`
- Create: `src/lib/editor/components/ListItemBlock.svelte`
- Modify: `src/lib/editor/components/BlockHost.svelte`

Lists follow the same recursive `BlockList` pattern as blockquotes, with additional complexity: `ListBlock` contains `ListItemBlock` children, each of which contains its own nested `BlockList`.

### Architecture

```
ListBlock (renders list items)
  └─ ListItemBlock (renders marker + nested BlockList)
       └─ BlockList (inner content — paragraphs, sub-lists, etc.)
            └─ BlockHost → TextEditableBlock / other blocks
```

`ListBlock` provides an `EditorActions` context for its list items. Each `ListItemBlock` provides another `EditorActions` context for its inner content. Two levels of nesting.

- [ ] **Step 1: Create ListItemBlock.svelte**

Follows the same pattern as `BlockquoteBlock.svelte` — provides nested `EditorActions`, delegates boundary events to parent. Key differences:

1. Renders the list marker visually (via CSS or inline element)
2. Uses `rebuildListItemRaw` instead of `rebuildBlockquoteRaw`
3. Backspace at start of first child: if this is the first list item, exit the list; otherwise, merge with the previous list item's last child

```svelte
<script lang="ts">
    import { getContext, setContext, tick } from 'svelte';
    import {
        EDITOR_ACTIONS_KEY,
        type EditorActions,
        type MutableNode,
        type BlockComponent
    } from '../editor-types';
    import { assignIds } from '../mutable-tree';
    import {
        splitNode as performSplit,
        mergeWithPrevious as performMerge,
        deleteNode as performDelete,
        updateNodeContent as performUpdate
    } from '../tree-operations';
    import { isMergeEligible, isBlockEditable } from '../merge-rules';
    import { rebuildListItemRaw } from '../container-raw';
    import BlockList from './BlockList.svelte';

    let { node, index }: { node: MutableNode; index: number } = $props();

    const parentActions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
    let innerBlockIds = $state<string[]>(assignIds(node.children ?? []));
    let innerBlockRefs = $state<(BlockComponent | undefined)[]>([]);

    // ── BlockComponent interface ────────────────────────────────────────

    export const editable = true;
    export const focusable = true;

    export function focus(offset: number): void {
        if (!node.children || node.children.length === 0) return;
        if (offset === 0) {
            innerBlockRefs[0]?.focus?.(0);
        } else {
            const last = node.children.length - 1;
            innerBlockRefs[last]?.focus?.(999999);
        }
    }

    export function getCursorOffset(): number | null {
        for (const ref of innerBlockRefs) {
            const offset = ref?.getCursorOffset?.();
            if (offset !== null && offset !== undefined) return offset;
        }
        return null;
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    function innerParent(): { children: MutableNode[] } {
        return { children: node.children! };
    }

    function rebuildAndNotify(): void {
        rebuildListItemRaw(node);
        parentActions.endContainerEdit?.();
    }

    function triggerInnerReactivity(): void {
        node.children = [...(node.children ?? [])];
        innerBlockIds = [...innerBlockIds];
    }

    function marker(): string {
        return (node.metadata as { marker?: string })?.marker ?? '- ';
    }

    // ── Nested EditorActions ────────────────────────────────────────────
    // (Same pattern as BlockquoteBlock — split, merge, delete, moveFocus,
    // updateBlockContent, undo/redo delegation, container propagation.
    // Uses rebuildListItemRaw instead of rebuildBlockquoteRaw.)

    const nestedActions: EditorActions = {
        async splitBlock(innerIndex: number, offset: number): Promise<void> {
            if (!node.children) return;
            parentActions.beginContainerEdit?.(index, offset);
            performSplit(innerParent(), innerBlockIds, innerIndex, offset);
            rebuildAndNotify();
            triggerInnerReactivity();
            await tick();
            innerBlockRefs[innerIndex + 1]?.focus?.(0);
        },

        async mergeWithPrevious(innerIndex: number): Promise<void> {
            if (!node.children) return;

            if (innerIndex <= 0) {
                // At start of first child in this list item
                // Signal to list-level parent to handle (merge with previous item or exit list)
                parentActions.mergeWithPrevious(index);
                return;
            }

            const prevKind = node.children[innerIndex - 1].kind;
            const currKind = node.children[innerIndex].kind;

            if (isMergeEligible(prevKind, currKind)) {
                const prevRaw = node.children[innerIndex - 1].raw;
                let mergeOffset = prevRaw.length;
                if (prevRaw.endsWith('\r\n')) mergeOffset -= 2;
                else if (prevRaw.endsWith('\n')) mergeOffset -= 1;

                parentActions.beginContainerEdit?.(index, 0);
                performMerge(innerParent(), innerBlockIds, innerIndex);
                rebuildAndNotify();
                triggerInnerReactivity();
                await tick();
                innerBlockRefs[innerIndex - 1]?.focus?.(mergeOffset);
            } else if (!isBlockEditable(prevKind)) {
                parentActions.beginContainerEdit?.(index, 0);
                performDelete(innerParent(), innerBlockIds, innerIndex - 1);
                rebuildAndNotify();
                triggerInnerReactivity();
                await tick();
                innerBlockRefs[innerIndex - 1]?.focus?.(0);
            } else {
                innerBlockRefs[innerIndex - 1]?.focus?.(999999);
            }
        },

        async deleteBlock(innerIndex: number): Promise<void> {
            if (!node.children) return;

            if (node.children.length <= 1) {
                parentActions.deleteBlock(index);
                return;
            }

            parentActions.beginContainerEdit?.(index, 0);
            performDelete(innerParent(), innerBlockIds, innerIndex);
            rebuildAndNotify();
            triggerInnerReactivity();
            await tick();
            const focusIdx = Math.min(innerIndex, node.children.length - 1);
            innerBlockRefs[focusIdx]?.focus?.(0);
        },

        async moveFocus(
            innerIndex: number,
            position: 'start' | 'end' | number
        ): Promise<void> {
            if (!node.children) return;

            if (innerIndex < 0) {
                parentActions.moveFocus(index - 1, 'end');
            } else if (innerIndex >= node.children.length) {
                parentActions.moveFocus(index + 1, 'start');
            } else {
                const block = innerBlockRefs[innerIndex];
                if (!block?.focusable) return;
                if (typeof position === 'number') block.focus?.(position);
                else if (position === 'start') block.focus?.(0);
                else block.focus?.(999999);
            }
        },

        updateBlockContent(
            innerIndex: number,
            text: string,
            preEditOffset?: number
        ): void {
            if (!node.children) return;
            parentActions.beginContainerEditDebounced?.(index, preEditOffset ?? 0);
            const result = performUpdate(innerParent(), innerIndex, text);
            rebuildListItemRaw(node);
            if (result.kindChanged) {
                triggerInnerReactivity();
                tick().then(() => {
                    innerBlockRefs[innerIndex]?.focus?.(
                        text.length > 0 ? text.length - 1 : 0
                    );
                });
            }
        },

        requestUndo(): void | Promise<void> {
            return parentActions.requestUndo();
        },

        requestRedo(): void | Promise<void> {
            return parentActions.requestRedo();
        },

        beginContainerEdit(blockIndex: number, offset: number): void {
            parentActions.beginContainerEdit?.(index, offset);
        },

        beginContainerEditDebounced(blockIndex: number, offset: number): void {
            parentActions.beginContainerEditDebounced?.(index, offset);
        },

        endContainerEdit(): void {
            rebuildListItemRaw(node);
            parentActions.endContainerEdit?.();
        }
    };

    setContext(EDITOR_ACTIONS_KEY, nestedActions);
</script>

<div class="list-item-block">
    <span class="list-item-marker">{marker()}</span>
    <div class="list-item-content">
        <BlockList
            children={node.children ?? []}
            blockIds={innerBlockIds}
            bind:blockRefs={innerBlockRefs}
        />
    </div>
</div>

<style>
    .list-item-block {
        display: flex;
        align-items: flex-start;
    }

    .list-item-marker {
        flex-shrink: 0;
        width: 2em;
        color: var(--color-ui-dulled, #888);
        user-select: none;
    }

    .list-item-content {
        flex: 1;
        min-width: 0;
    }
</style>
```

- [ ] **Step 2: Create ListBlock.svelte**

The list block renders its `ListItem` children. It provides its own `EditorActions` for list-item-level operations: Backspace at first item exits the list, focus traversal between items, etc.

```svelte
<script lang="ts">
    import { getContext, setContext, tick } from 'svelte';
    import {
        EDITOR_ACTIONS_KEY,
        type EditorActions,
        type MutableNode,
        type BlockComponent
    } from '../editor-types';
    import { assignIds } from '../mutable-tree';
    import { deleteNode as performDelete } from '../tree-operations';
    import { rebuildListRaw } from '../container-raw';
    import ListItemBlock from './ListItemBlock.svelte';

    let { node, index }: { node: MutableNode; index: number } = $props();

    const parentActions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
    let itemBlockIds = $state<string[]>(assignIds(node.children ?? []));
    let itemBlockRefs = $state<(BlockComponent | undefined)[]>([]);

    // ── BlockComponent interface ────────────────────────────────────────

    export const editable = true;
    export const focusable = true;

    export function focus(offset: number): void {
        if (!node.children || node.children.length === 0) return;
        if (offset === 0) {
            itemBlockRefs[0]?.focus?.(0);
        } else {
            const last = node.children.length - 1;
            itemBlockRefs[last]?.focus?.(999999);
        }
    }

    export function getCursorOffset(): number | null {
        for (const ref of itemBlockRefs) {
            const offset = ref?.getCursorOffset?.();
            if (offset !== null && offset !== undefined) return offset;
        }
        return null;
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    function rebuildAndNotify(): void {
        rebuildListRaw(node);
        parentActions.endContainerEdit?.();
    }

    function triggerItemReactivity(): void {
        node.children = [...(node.children ?? [])];
        itemBlockIds = [...itemBlockIds];
    }

    // ── List-level EditorActions ────────────────────────────────────────
    // Handles operations that cross list item boundaries.

    const listActions: EditorActions = {
        // splitBlock at list level: not applicable (list items handle their own splits)
        async splitBlock(): Promise<void> {},

        async mergeWithPrevious(itemIndex: number): Promise<void> {
            if (!node.children) return;

            if (itemIndex <= 0) {
                // At start of first list item — exit the list
                parentActions.moveFocus(index - 1, 'end');
                return;
            }

            // Move focus to end of previous list item
            itemBlockRefs[itemIndex - 1]?.focus?.(999999);
        },

        async deleteBlock(itemIndex: number): Promise<void> {
            if (!node.children) return;

            if (node.children.length <= 1) {
                // Last item — delete entire list
                parentActions.deleteBlock(index);
                return;
            }

            parentActions.beginContainerEdit?.(index, 0);
            performDelete({ children: node.children }, itemBlockIds, itemIndex);
            rebuildAndNotify();
            triggerItemReactivity();
            await tick();
            const focusIdx = Math.min(itemIndex, node.children.length - 1);
            itemBlockRefs[focusIdx]?.focus?.(0);
        },

        async moveFocus(
            itemIndex: number,
            position: 'start' | 'end' | number
        ): Promise<void> {
            if (!node.children) return;

            if (itemIndex < 0) {
                parentActions.moveFocus(index - 1, 'end');
            } else if (itemIndex >= node.children.length) {
                parentActions.moveFocus(index + 1, 'start');
            } else {
                const item = itemBlockRefs[itemIndex];
                if (!item?.focusable) return;
                if (typeof position === 'number') item.focus?.(position);
                else if (position === 'start') item.focus?.(0);
                else item.focus?.(999999);
            }
        },

        updateBlockContent(): void {
            // List items handle their own content updates
        },

        requestUndo(): void | Promise<void> {
            return parentActions.requestUndo();
        },

        requestRedo(): void | Promise<void> {
            return parentActions.requestRedo();
        },

        beginContainerEdit(blockIndex: number, offset: number): void {
            parentActions.beginContainerEdit?.(index, offset);
        },

        beginContainerEditDebounced(blockIndex: number, offset: number): void {
            parentActions.beginContainerEditDebounced?.(index, offset);
        },

        endContainerEdit(): void {
            rebuildListRaw(node);
            parentActions.endContainerEdit?.();
        }
    };

    setContext(EDITOR_ACTIONS_KEY, listActions);
</script>

<div class="list-block">
    {#each node.children ?? [] as item, i (itemBlockIds[i])}
        <ListItemBlock node={item} index={i} bind:this={itemBlockRefs[i]} />
    {/each}
</div>

<style>
    .list-block {
        margin: 4px 0;
        padding-left: 0;
        list-style: none;
    }
</style>
```

Note: `ListBlock` renders its own `{#each}` instead of using `BlockList` because list items are always `ListItemBlock` — no need for `BlockHost` resolution.

- [ ] **Step 3: Register in BlockHost.svelte**

Add imports and resolution branches:

```svelte
import BlockquoteBlock from './BlockquoteBlock.svelte';
import ListBlock from './ListBlock.svelte';

{:else if node.kind === 'blockquote'}
    <BlockquoteBlock {node} {index} bind:this={ref} />
{:else if node.kind === 'list'}
    <ListBlock {node} {index} bind:this={ref} />
```

- [ ] **Step 4: Manual verification**

Run: `npm run tauri dev`
Test with a document containing lists. Verify:
- Unordered and ordered lists render with markers
- Text editing inside list items works
- Enter splits content within a list item
- Backspace at start of first item exits the list
- ArrowDown past last item moves focus after the list
- Nested content within list items renders correctly
- Undo/Redo works for edits inside lists

- [ ] **Step 5: Run all editor tests**

Run: `npm run test:editor`

- [ ] **Step 6: Commit**

```
+ (editor) list and list item container blocks
```

---

## Implementation Notes

### Reactivity in Container Blocks

Container blocks mutate `node.children` (a prop property) in place. Svelte 5 tracks fine-grained property access, so reassigning `node.children = [...]` should trigger re-renders of the nested `BlockList`. If Svelte doesn't detect the mutation:

1. Try wrapping the container's children in a local `$state` variable initialized from the prop
2. Sync local state ↔ prop state in an `$effect`
3. As a last resort, force re-render via a keyed block wrapper

### Undo for Container Edits

Document-level undo snapshots work correctly for container blocks because `cloneDocument` performs a deep clone (including container children). When undo restores a snapshot, all container state is restored.

The debouncing for text input inside containers delegates to the parent Editor's debounce mechanism via `beginContainerEditDebounced`. This ensures consecutive keystrokes within a container child are grouped into a single undo entry.

### Raw Reconstruction vs Round-Trip

Container raw reconstruction (`rebuildBlockquoteRaw`, `rebuildListItemRaw`) produces valid GFM but may not match the original formatting byte-for-byte. For example, `>\n` (blank line in blockquote with no trailing space) may be reconstructed as `>` (no newline). This is acceptable because:

1. Reconstruction only happens after the user edits inside the container
2. The reconstructed raw re-parses to the same CST structure
3. Unedited containers retain their original `raw` from parsing

### Block Type Transformation in Containers

When a user types `## ` at the start of a paragraph inside a blockquote, `updateBlockContent` detects a kind change to `heading`. The container's nested `BlockList` re-renders the heading component. The container's `raw` is rebuilt to include `> ## Heading\n`. This happens through the normal `updateBlockContent` → `rebuildBlockquoteRaw` flow.

### Merge/Backspace Responsibility Split

Some block types handle Backspace-at-start internally (before it reaches `Editor.mergeWithPrevious`):

- **CodeBlock**: Backspace at pos 0 calls `moveFocus(index - 1, 'end')` directly, bypassing `mergeWithPrevious` entirely. This is correct — fenced code is not mergeable and the spec says "Backspace at start moves focus to end of previous block."
- **ThematicBreakBlock**: Backspace calls `deleteBlock(index)` — the block deletes itself.
- **Text-editable blocks** (paragraph, heading, raw): Backspace at pos 0 calls `mergeWithPrevious(index)`, which goes through the merge eligibility check in Editor.svelte.

This means `mergeWithPrevious` in Editor.svelte only handles cases where the **current** block delegates the decision. The merge eligibility check handles what to do with the **previous** block.

### ListBlock Stub Methods

`ListBlock.splitBlock` and `ListBlock.updateBlockContent` are no-op stubs. List items handle their own splits and content updates via their nested `EditorActions`. These stubs exist only to satisfy the `EditorActions` interface. They should never be called in practice — if they are, it indicates a context-nesting bug. Consider adding `console.warn()` calls in development builds.

### Deferred Behaviors

These behaviors from the spec are intentionally deferred:

- **Blockquote unwrap** (`docs/editor/editor.md` lines 260-262): The spec says Backspace at the start of a blockquote's first child "may unwrap the child (lift it out of the blockquote)." Phase 2 moves focus to the block before the blockquote instead. Unwrap requires removing the `> ` prefix from a single child and hoisting it — implement in a follow-up once the basic container editing is stable.
- **List unindent**: Similarly, Backspace at start of a non-first list item could merge with the previous item's content. Phase 2 moves focus to the previous item's end instead.

### Container `updateBlockContent` and Reactivity

Container blocks' `updateBlockContent` implementations call `rebuildBlockquoteRaw`/`rebuildListItemRaw` to update the container's `raw` in place but do NOT call `endContainerEdit` (which triggers `doc.children = [...doc.children]`). This is intentional — normal typing should not trigger top-level reactivity (same as how the top-level Editor only triggers `doc.children = [...]` on kind changes). The container's `raw` is mutated in place and will be correct when `getSource()` serializes the document. If Svelte's fine-grained reactivity does not detect the `node.raw` mutation for rendering purposes, consider calling `endContainerEdit` conditionally.

### Phase 2 Scope Boundaries

**In scope:** All leaf block types (rendering and editing), container block structure (blockquote, list), focus traversal through containers, merge eligibility.

**Out of scope (Phase 3+):** Cross-block selection, multi-block paste, cross-container selection, drag-and-drop reordering, inline syntax styling, blockquote unwrap, list item merging across items.
