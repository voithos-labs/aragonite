# Editor Phase 1 — Core Editing Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core editing loop with paragraph blocks only — the foundational architecture that all future block types build on.

**Architecture:** Per-block contenteditable editor backed by a mutable CST working tree. The Editor shell provides `EditorActions` via Svelte context; blocks call typed functions upward, the editor mutates the CST, Svelte reactivity re-renders, and the editor manages focus via component refs. See `docs/editor/editor.md` for the full design spec.

**Tech Stack:** Svelte 5 (runes: `$state`, `$props`), SvelteKit 2, TypeScript, Vitest

**Spec:** `docs/editor/editor.md` — Phase 1 scope (lines 436-448)

**Commit convention:** Symbol-prefixed, lowercase, no period, scoped with `(editor)`. Example: `+ (editor) mutable tree layer`. See `docs/commit-conventions.md`. Never include `Co-Authored-By` lines.

---

## File Structure

### New Files

| File | Responsibility |
| --- | --- |
| `src/lib/editor/editor-types.ts` | TypeScript interfaces: EditorActions, BlockComponent, UndoManager |
| `src/lib/editor/mutable-tree.ts` | Mutable document types, CST-to-mutable conversion, deep clone, ID management, serialize |
| `src/lib/editor/tree-operations.ts` | Pure functions: split, merge, delete, updateContent on a MutableDocument |
| `src/lib/editor/undo-manager.ts` | Snapshot-based undo/redo stack implementing UndoManager |
| `src/lib/editor/components/Editor.svelte` | Top-level shell: owns state, provides EditorActions context, manages focus |
| `src/lib/editor/components/BlockList.svelte` | Keyed `{#each}` over children, renders BlockHost per node |
| `src/lib/editor/components/BlockHost.svelte` | Resolves block component by `node.kind` |
| `src/lib/editor/components/ParagraphBlock.svelte` | Contenteditable paragraph editing surface |
| `src/lib/editor/test/mutable-tree.test.ts` | Tests for mutable tree conversion, cloning, serialization |
| `src/lib/editor/test/tree-operations.test.ts` | Tests for split, merge, delete, updateContent |
| `src/lib/editor/test/undo-manager.test.ts` | Tests for undo/redo stack behavior |

### Modified Files

| File | Change |
| --- | --- |
| `src/lib/editor/index.ts` | Export new modules |

### Reference Files (Read, Don't Modify)

| File | Why |
| --- | --- |
| `src/lib/editor/core/nodes.ts` | CST node types and class hierarchy |
| `src/lib/editor/core/parser.ts` | `parse()` function, `parseBlocks()` (exported), `parseNextBlock()` (not exported) |
| `src/lib/editor/core/serializer.ts` | `serialize()` function (reads fields only) |
| `src/lib/editor/core/lines.ts` | `splitLines()` helper |
| `docs/editor/editor.md` | Full design spec |

---

## Task 1: Type Definitions

**Files:**
- Create: `src/lib/editor/editor-types.ts`

No tests needed — this is just TypeScript interfaces.

- [ ] **Step 1: Create the type definitions file**

```typescript
// src/lib/editor/editor-types.ts

/**
 * Interfaces for the block editor system.
 * See docs/editor/editor.md for the design spec.
 */

// ── Editor Actions (block → editor communication via Svelte context) ────────

export interface EditorActions {
    splitBlock(blockIndex: number, offset: number): void | Promise<void>;
    mergeWithPrevious(blockIndex: number): void | Promise<void>;
    deleteBlock(blockIndex: number): void | Promise<void>;
    moveFocus(blockIndex: number, position: 'start' | 'end' | number): void | Promise<void>;
    updateBlockContent(blockIndex: number, text: string): void;
    requestUndo(): void | Promise<void>;
    requestRedo(): void | Promise<void>;
}

// ── Block Component Interface (what each block exposes to the editor) ───────

export interface BlockComponent {
    focus?(offset: number): void;
    getCursorOffset?(): number | null;
    getSelectedText?(): string;
    setSelection?(start: number, end: number): void;
    readonly editable: boolean;
    readonly focusable: boolean;
}

// ── Undo Manager ────────────────────────────────────────────────────────────

export interface UndoEntry {
    snapshot: MutableDocument;
    focusBlockIndex: number;
    focusOffset: number;
}

export interface UndoManager {
    push(entry: UndoEntry): void;
    undo(): UndoEntry | null;
    redo(): UndoEntry | null;
    clear(): void;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
}

// ── Mutable Tree Types ──────────────────────────────────────────────────────

export interface MutableNode {
    kind: string;
    leadingTrivia: string;
    raw: string;
    metadata?: Record<string, unknown>;
    innerPrefix?: string;
    children?: MutableNode[];
    innerSuffix?: string;
}

export interface MutableDocument {
    kind: 'document';
    prefix: string;
    children: MutableNode[];
    suffix: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/lib/editor/editor-types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/editor-types.ts
git commit -m "+ (editor) type definitions for block editor"
```

---

## Task 2: Mutable Tree Layer

**Files:**
- Create: `src/lib/editor/mutable-tree.ts`
- Create: `src/lib/editor/test/mutable-tree.test.ts`

This module converts the immutable parsed CST into a mutable working tree, provides deep cloning for undo snapshots, manages block IDs, and provides serialization.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/editor/test/mutable-tree.test.ts

import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import {
    toMutable,
    cloneDocument,
    serializeMutable,
    assignIds,
    generateBlockId
} from '../mutable-tree';

describe('toMutable', () => {
    it('converts a parsed document to a mutable document', () => {
        const source = '# Title\n\nParagraph text.\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        expect(mutable.kind).toBe('document');
        expect(mutable.prefix).toBe(doc.prefix);
        expect(mutable.suffix).toBe(doc.suffix);
        expect(mutable.children).toHaveLength(doc.children.length);
    });

    it('preserves node kind and raw on children', () => {
        const source = '# Title\n\nParagraph text.\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        expect(mutable.children[0].kind).toBe('heading');
        expect(mutable.children[0].raw).toBe('# Title\n');
        expect(mutable.children[1].kind).toBe('paragraph');
        expect(mutable.children[1].raw).toBe('Paragraph text.\n');
    });

    it('preserves metadata', () => {
        const source = '## Hello\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        expect(mutable.children[0].metadata).toEqual({ level: 2 });
    });

    it('preserves leading trivia', () => {
        const source = '# A\n\n\n# B\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        expect(mutable.children[0].leadingTrivia).toBe('');
        expect(mutable.children[1].leadingTrivia).toBe('\n\n');
    });

    it('preserves container block children', () => {
        const source = '> Hello\n> World\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        expect(mutable.children[0].kind).toBe('blockquote');
        expect(mutable.children[0].children).toBeDefined();
        expect(mutable.children[0].children!.length).toBeGreaterThan(0);
    });

    it('creates a mutable copy (not a reference)', () => {
        const source = '# Title\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        mutable.children[0].raw = '# Changed\n';
        expect(doc.children[0].raw).toBe('# Title\n');
    });
});

describe('serializeMutable', () => {
    it('produces the same output as serialize on the original CST', () => {
        const source = '# Title\n\nParagraph text.\n\n```js\ncode\n```\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        expect(serializeMutable(mutable)).toBe(serialize(doc));
        expect(serializeMutable(mutable)).toBe(source);
    });

    it('reflects mutations in serialized output', () => {
        const source = '# Title\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        mutable.children[0].raw = '# Changed\n';
        expect(serializeMutable(mutable)).toBe('# Changed\n');
    });

    it('handles empty document', () => {
        const doc = parse('');
        const mutable = toMutable(doc);
        expect(serializeMutable(mutable)).toBe('');
    });
});

describe('cloneDocument', () => {
    it('produces a deep copy', () => {
        const source = '# Title\n\nText.\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const cloned = cloneDocument(mutable);

        cloned.children[0].raw = '# Modified\n';
        expect(mutable.children[0].raw).toBe('# Title\n');
    });

    it('serializes identically to the original', () => {
        const source = '# Title\n\nText.\n\n> Quote\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const cloned = cloneDocument(mutable);

        expect(serializeMutable(cloned)).toBe(serializeMutable(mutable));
    });

    it('deep clones container children', () => {
        const source = '> Hello\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const cloned = cloneDocument(mutable);

        cloned.children[0].children![0].raw = 'Modified\n';
        expect(mutable.children[0].children![0].raw).not.toBe('Modified\n');
    });
});

describe('assignIds', () => {
    it('returns an array of unique IDs matching children length', () => {
        const source = '# A\n\n# B\n\n# C\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = assignIds(mutable.children);

        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);
    });

    it('generates unique IDs (UUIDs)', () => {
        const id1 = generateBlockId();
        const id2 = generateBlockId();
        expect(id1).not.toBe(id2);
        expect(typeof id1).toBe('string');
        expect(id1.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:editor -- --run mutable-tree`
Expected: FAIL — module `../mutable-tree` not found

- [ ] **Step 3: Implement the mutable tree module**

```typescript
// src/lib/editor/mutable-tree.ts

/**
 * Mutable document tree for the editor.
 * Converts immutable parsed CST into a writable working copy.
 */

import type { CstNode, Document } from './core/nodes';
import type { ContainerBlock } from './core/nodes';
import type { MutableNode, MutableDocument } from './editor-types';

// ── Conversion ──────────────────────────────────────────────────────────────

export function toMutable(doc: Document): MutableDocument {
    return {
        kind: 'document',
        prefix: doc.prefix,
        children: doc.children.map(nodeToMutable),
        suffix: doc.suffix
    };
}

function nodeToMutable(node: CstNode): MutableNode {
    const mutable: MutableNode = {
        kind: node.kind,
        leadingTrivia: node.leadingTrivia,
        raw: node.raw
    };

    if ('metadata' in node && node.metadata) {
        mutable.metadata = { ...(node.metadata as Record<string, unknown>) };
    }

    if ('innerPrefix' in node) {
        const container = node as ContainerBlock;
        mutable.innerPrefix = container.innerPrefix;
        mutable.children = container.children.map(nodeToMutable);
        mutable.innerSuffix = container.innerSuffix;
    }

    return mutable;
}

// ── Serialization ───────────────────────────────────────────────────────────

export function serializeMutable(doc: MutableDocument): string {
    return (
        doc.prefix +
        doc.children.map((node) => node.leadingTrivia + node.raw).join('') +
        doc.suffix
    );
}

// ── Cloning ─────────────────────────────────────────────────────────────────

export function cloneDocument(doc: MutableDocument): MutableDocument {
    return {
        kind: 'document',
        prefix: doc.prefix,
        children: doc.children.map(cloneNode),
        suffix: doc.suffix
    };
}

function cloneNode(node: MutableNode): MutableNode {
    const cloned: MutableNode = {
        kind: node.kind,
        leadingTrivia: node.leadingTrivia,
        raw: node.raw
    };

    if (node.metadata) {
        cloned.metadata = { ...node.metadata };
    }

    if (node.children) {
        cloned.innerPrefix = node.innerPrefix;
        cloned.children = node.children.map(cloneNode);
        cloned.innerSuffix = node.innerSuffix;
    }

    return cloned;
}

// ── Block IDs ───────────────────────────────────────────────────────────────

export function generateBlockId(): string {
    return crypto.randomUUID();
}

export function assignIds(children: MutableNode[]): string[] {
    return children.map(() => generateBlockId());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:editor -- --run mutable-tree`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/mutable-tree.ts src/lib/editor/test/mutable-tree.test.ts
git commit -m "+ (editor) mutable tree layer with conversion, cloning, and IDs"
```

---

## Task 3: Tree Operations — Split

**Files:**
- Create: `src/lib/editor/tree-operations.ts`
- Create: `src/lib/editor/test/tree-operations.test.ts`

Split is the most complex operation: it cuts a node's `raw` at an offset, creates two nodes, and re-parses each to determine type. This task covers split only; merge and delete follow.

- [ ] **Step 1: Write the failing tests for split**

```typescript
// src/lib/editor/test/tree-operations.test.ts

import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { toMutable, serializeMutable } from '../mutable-tree';
import { splitNode } from '../tree-operations';

describe('splitNode', () => {
    it('splits a paragraph into two paragraphs', () => {
        const source = 'Hello World\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];

        splitNode(mutable, ids, 0, 5);

        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].raw).toBe('Hello\n');
        expect(mutable.children[1].raw).toBe(' World\n');
        expect(mutable.children[0].kind).toBe('paragraph');
        expect(mutable.children[1].kind).toBe('paragraph');
    });

    it('preserves the original ID and assigns a new one', () => {
        const source = 'Hello World\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['original-id'];

        splitNode(mutable, ids, 0, 5);

        expect(ids).toHaveLength(2);
        expect(ids[0]).toBe('original-id');
        expect(ids[1]).not.toBe('original-id');
    });

    it('splits at the beginning creates empty first paragraph', () => {
        const source = 'Hello\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];

        splitNode(mutable, ids, 0, 0);

        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].kind).toBe('paragraph');
        expect(mutable.children[0].raw).toBe('\n');
        expect(mutable.children[1].raw).toBe('Hello\n');
    });

    it('splits at the end creates empty second paragraph', () => {
        const source = 'Hello\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];

        splitNode(mutable, ids, 0, 5);

        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].raw).toBe('Hello\n');
        expect(mutable.children[1].kind).toBe('paragraph');
        expect(mutable.children[1].raw).toBe('\n');
    });

    it('second block has empty leading trivia (no blank line)', () => {
        const source = 'Hello World\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];

        splitNode(mutable, ids, 0, 5);

        // Enter should NOT insert a blank line between the two halves
        expect(mutable.children[1].leadingTrivia).toBe('');
    });

    it('preserves leading trivia on the first block when splitting a non-first block', () => {
        const source = 'First\n\nSecond\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1', 'id-2'];

        splitNode(mutable, ids, 1, 3);

        expect(mutable.children[1].leadingTrivia).toBe('\n');
        expect(mutable.children[2].leadingTrivia).toBe('');
    });

    it('handles multi-line paragraph split', () => {
        const source = 'Line one.\nLine two.\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];

        // Split after "Line one.\n" (offset 10)
        splitNode(mutable, ids, 0, 10);

        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].raw).toBe('Line one.\n');
        expect(mutable.children[1].raw).toBe('Line two.\n');
    });

    it('produces correct serialization after split', () => {
        const source = 'Hello World\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];

        splitNode(mutable, ids, 0, 5);

        // No blank line between — just two adjacent paragraphs
        const result = serializeMutable(mutable);
        expect(result).toBe('Hello\n World\n');
    });

    it('handles CRLF line endings correctly', () => {
        const source = 'Hello World\r\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];

        splitNode(mutable, ids, 0, 5);

        expect(mutable.children[0].raw).toBe('Hello\r\n');
        expect(mutable.children[1].raw).toBe(' World\r\n');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:editor -- --run tree-operations`
Expected: FAIL — module `../tree-operations` not found

- [ ] **Step 3: Implement splitNode**

```typescript
// src/lib/editor/tree-operations.ts

/**
 * Pure tree mutation functions for the editor.
 * All functions operate on MutableDocument in place.
 */

import type { MutableDocument, MutableNode } from './editor-types';
import { parse } from './core/parser';
import { generateBlockId } from './mutable-tree';

// ── Split ───────────────────────────────────────────────────────────────────

/**
 * Split the node at `blockIndex` into two nodes at the given raw `offset`.
 * The first node keeps the original ID. A new ID is inserted for the second node.
 * Both halves are re-parsed to determine their block type.
 *
 * The offset is relative to the displayed text content (without trailing line ending).
 * The line ending style (\n or \r\n) is preserved from the original raw.
 */
export function splitNode(
    doc: MutableDocument,
    blockIds: string[],
    blockIndex: number,
    offset: number
): void {
    const node = doc.children[blockIndex];
    const rawText = node.raw;

    // Detect line ending style from the original raw
    const lineEnding = rawText.endsWith('\r\n') ? '\r\n' : '\n';

    // Split the raw text at the offset
    let firstRaw = rawText.slice(0, offset);
    let secondRaw = rawText.slice(offset);

    // Ensure the first part ends with a line ending
    if (!firstRaw.endsWith('\n')) {
        firstRaw += lineEnding;
    }

    // Ensure the second part ends with a line ending
    if (secondRaw.length === 0 || !secondRaw.endsWith('\n')) {
        if (secondRaw.length === 0) {
            secondRaw = lineEnding;
        } else {
            secondRaw += lineEnding;
        }
    }

    // Re-parse each half to determine block type
    const firstNode = reparseAsNode(firstRaw, node.leadingTrivia);
    // No blank line between split halves — empty leading trivia
    const secondNode = reparseAsNode(secondRaw, '');

    // Replace the original node with the two new nodes
    doc.children.splice(blockIndex, 1, firstNode, secondNode);

    // Update IDs: original stays, new one inserted after
    blockIds.splice(blockIndex + 1, 0, generateBlockId());
}

/**
 * Parse a raw string as a single block node.
 * Returns a MutableNode with the parsed kind and metadata.
 */
function reparseAsNode(raw: string, leadingTrivia: string): MutableNode {
    const parsed = parse(raw);
    if (parsed.children.length > 0) {
        const child = parsed.children[0];
        const node: MutableNode = {
            kind: child.kind,
            leadingTrivia,
            raw
        };
        if ('metadata' in child && child.metadata) {
            node.metadata = { ...(child.metadata as Record<string, unknown>) };
        }
        return node;
    }

    // Fallback: empty parse result
    return {
        kind: 'paragraph',
        leadingTrivia,
        raw
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:editor -- --run tree-operations`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/tree-operations.ts src/lib/editor/test/tree-operations.test.ts
git commit -m "+ (editor) split operation for tree mutations"
```

---

## Task 4: Tree Operations — Merge

**Files:**
- Modify: `src/lib/editor/tree-operations.ts`
- Modify: `src/lib/editor/test/tree-operations.test.ts`

Merge concatenates two adjacent nodes' `raw` text and re-parses. Only called when merge eligibility has been checked (see spec: Merge eligibility rules).

- [ ] **Step 1: Write the failing tests for merge**

Add to `src/lib/editor/test/tree-operations.test.ts`:

```typescript
import { splitNode, mergeWithPrevious } from '../tree-operations';

// ... existing splitNode tests ...

describe('mergeWithPrevious', () => {
    it('merges two paragraphs into one', () => {
        const source = 'Hello\n\nWorld\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1', 'id-2'];

        mergeWithPrevious(mutable, ids, 1);

        expect(mutable.children).toHaveLength(1);
        expect(mutable.children[0].kind).toBe('paragraph');
        expect(mutable.children[0].raw).toBe('Hello\nWorld\n');
    });

    it('preserves the first block ID and removes the second', () => {
        const source = 'Hello\n\nWorld\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['keep-me', 'remove-me'];

        mergeWithPrevious(mutable, ids, 1);

        expect(ids).toEqual(['keep-me']);
    });

    it('preserves leading trivia of the first block', () => {
        const source = 'A\n\nB\n\nC\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1', 'id-2', 'id-3'];

        mergeWithPrevious(mutable, ids, 2);

        expect(mutable.children[1].leadingTrivia).toBe('\n');
    });

    it('does nothing when blockIndex is 0', () => {
        const source = 'Hello\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1'];

        mergeWithPrevious(mutable, ids, 0);

        expect(mutable.children).toHaveLength(1);
        expect(ids).toEqual(['id-1']);
    });

    it('re-parses to determine merged block type', () => {
        // Merging "## " with "Title\n" should produce a heading
        const doc = parse('');
        const mutable = toMutable(doc);
        mutable.children = [
            { kind: 'paragraph', leadingTrivia: '', raw: '## ' },
            { kind: 'paragraph', leadingTrivia: '', raw: 'Title\n' }
        ];
        const ids = ['id-1', 'id-2'];

        mergeWithPrevious(mutable, ids, 1);

        expect(mutable.children[0].kind).toBe('heading');
        expect(mutable.children[0].raw).toBe('## Title\n');
    });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npm run test:editor -- --run tree-operations`
Expected: `mergeWithPrevious` tests FAIL, `splitNode` tests still PASS

- [ ] **Step 3: Implement mergeWithPrevious**

Add to `src/lib/editor/tree-operations.ts`:

```typescript
// ── Merge ───────────────────────────────────────────────────────────────────

/**
 * Merge the node at `blockIndex` into the node at `blockIndex - 1`.
 * The combined raw text is re-parsed. The first block's ID is kept.
 * No-op if blockIndex is 0.
 */
export function mergeWithPrevious(
    doc: MutableDocument,
    blockIds: string[],
    blockIndex: number
): void {
    if (blockIndex <= 0 || blockIndex >= doc.children.length) return;

    const prev = doc.children[blockIndex - 1];
    const curr = doc.children[blockIndex];

    // Strip trailing line ending from prev.raw before concatenating
    let prevRaw = prev.raw;
    if (prevRaw.endsWith('\r\n')) {
        prevRaw = prevRaw.slice(0, -2);
    } else if (prevRaw.endsWith('\n')) {
        prevRaw = prevRaw.slice(0, -1);
    }

    const mergedRaw = prevRaw + curr.raw;

    // Re-parse to determine the merged block type
    const mergedNode = reparseAsNode(mergedRaw, prev.leadingTrivia);

    // Replace both nodes with the merged node
    doc.children.splice(blockIndex - 1, 2, mergedNode);

    // Remove the second block's ID
    blockIds.splice(blockIndex, 1);
}
```

Also export `reparseAsNode` needs to be accessible (it was already defined in Task 3 as a module-level function).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:editor -- --run tree-operations`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/tree-operations.ts src/lib/editor/test/tree-operations.test.ts
git commit -m "+ (editor) merge operation for tree mutations"
```

---

## Task 5: Tree Operations — Delete and Update Content

**Files:**
- Modify: `src/lib/editor/tree-operations.ts`
- Modify: `src/lib/editor/test/tree-operations.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/editor/test/tree-operations.test.ts`:

```typescript
import { splitNode, mergeWithPrevious, deleteNode, updateNodeContent } from '../tree-operations';

// ... existing tests ...

describe('deleteNode', () => {
    it('removes the node at the given index', () => {
        const source = 'A\n\nB\n\nC\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1', 'id-2', 'id-3'];

        deleteNode(mutable, ids, 1);

        expect(mutable.children).toHaveLength(2);
        expect(mutable.children[0].raw).toBe('A\n');
        expect(mutable.children[1].raw).toBe('C\n');
        expect(ids).toEqual(['id-1', 'id-3']);
    });

    it('transfers leading trivia to the next block', () => {
        const source = 'A\n\nB\n\nC\n';
        const doc = parse(source);
        const mutable = toMutable(doc);
        const ids = ['id-1', 'id-2', 'id-3'];

        // B has leadingTrivia '\n', C has leadingTrivia '\n'
        // After deleting B, C should absorb B's trivia
        const triviaB = mutable.children[1].leadingTrivia;
        const triviaC = mutable.children[2].leadingTrivia;

        deleteNode(mutable, ids, 1);

        expect(mutable.children[1].leadingTrivia).toBe(triviaB + triviaC);
    });
});

describe('updateNodeContent', () => {
    it('updates the raw text of a node', () => {
        const source = 'Hello\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        const result = updateNodeContent(mutable, 0, 'World\n');

        expect(mutable.children[0].raw).toBe('World\n');
        expect(result.kindChanged).toBe(false);
    });

    it('detects block type change from paragraph to heading', () => {
        const source = 'Hello\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        const result = updateNodeContent(mutable, 0, '## Hello\n');

        expect(mutable.children[0].kind).toBe('heading');
        expect(mutable.children[0].metadata).toEqual({ level: 2 });
        expect(result.kindChanged).toBe(true);
        expect(result.newKind).toBe('heading');
    });

    it('detects block type change from heading to paragraph', () => {
        const source = '## Hello\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        const result = updateNodeContent(mutable, 0, 'Hello\n');

        expect(mutable.children[0].kind).toBe('paragraph');
        expect(result.kindChanged).toBe(true);
        expect(result.newKind).toBe('paragraph');
    });

    it('preserves leading trivia and ID position', () => {
        const source = 'A\n\nB\n';
        const doc = parse(source);
        const mutable = toMutable(doc);

        updateNodeContent(mutable, 1, 'Changed\n');

        expect(mutable.children[1].leadingTrivia).toBe('\n');
        expect(mutable.children[1].raw).toBe('Changed\n');
    });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npm run test:editor -- --run tree-operations`
Expected: `deleteNode` and `updateNodeContent` tests FAIL

- [ ] **Step 3: Implement deleteNode and updateNodeContent**

Add to `src/lib/editor/tree-operations.ts`:

```typescript
// ── Delete ──────────────────────────────────────────────────────────────────

/**
 * Remove the node at `blockIndex`.
 * Transfers leading trivia to the next sibling if one exists.
 */
export function deleteNode(
    doc: MutableDocument,
    blockIds: string[],
    blockIndex: number
): void {
    if (blockIndex < 0 || blockIndex >= doc.children.length) return;

    const deleted = doc.children[blockIndex];

    // Transfer leading trivia to the next block
    if (blockIndex + 1 < doc.children.length) {
        doc.children[blockIndex + 1].leadingTrivia =
            deleted.leadingTrivia + doc.children[blockIndex + 1].leadingTrivia;
    }

    doc.children.splice(blockIndex, 1);
    blockIds.splice(blockIndex, 1);
}

// ── Update Content ──────────────────────────────────────────────────────────

/**
 * Update the raw text of the node at `blockIndex` and re-parse to check
 * for block type changes. Returns whether the kind changed.
 */
export function updateNodeContent(
    doc: MutableDocument,
    blockIndex: number,
    newText: string
): { kindChanged: boolean; newKind?: string } {
    const node = doc.children[blockIndex];
    const oldKind = node.kind;

    // Re-parse the new text to determine block type
    const reparsed = reparseAsNode(newText, node.leadingTrivia);

    // Update the node in place
    node.raw = newText;
    node.kind = reparsed.kind;
    node.metadata = reparsed.metadata;

    const kindChanged = node.kind !== oldKind;
    return {
        kindChanged,
        newKind: kindChanged ? node.kind : undefined
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:editor -- --run tree-operations`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/tree-operations.ts src/lib/editor/test/tree-operations.test.ts
git commit -m "+ (editor) delete and updateContent operations"
```

---

## Task 6: Undo Manager

**Files:**
- Create: `src/lib/editor/undo-manager.ts`
- Create: `src/lib/editor/test/undo-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/editor/test/undo-manager.test.ts

import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { toMutable, serializeMutable, cloneDocument } from '../mutable-tree';
import { createUndoManager } from '../undo-manager';
import type { UndoEntry } from '../editor-types';

function makeEntry(source: string, blockIndex = 0, offset = 0): UndoEntry {
    return {
        snapshot: toMutable(parse(source)),
        focusBlockIndex: blockIndex,
        focusOffset: offset
    };
}

describe('UndoManager', () => {
    it('starts with canUndo and canRedo as false', () => {
        const manager = createUndoManager();
        expect(manager.canUndo).toBe(false);
        expect(manager.canRedo).toBe(false);
    });

    it('can push and undo', () => {
        const manager = createUndoManager();
        const entry = makeEntry('Hello\n');

        manager.push(entry);

        expect(manager.canUndo).toBe(true);
        const restored = manager.undo();
        expect(restored).not.toBeNull();
        expect(serializeMutable(restored!.snapshot)).toBe('Hello\n');
    });

    it('undo returns entries in reverse order', () => {
        const manager = createUndoManager();
        manager.push(makeEntry('First\n'));
        manager.push(makeEntry('Second\n'));
        manager.push(makeEntry('Third\n'));

        const third = manager.undo();
        expect(serializeMutable(third!.snapshot)).toBe('Third\n');

        const second = manager.undo();
        expect(serializeMutable(second!.snapshot)).toBe('Second\n');

        const first = manager.undo();
        expect(serializeMutable(first!.snapshot)).toBe('First\n');

        expect(manager.undo()).toBeNull();
    });

    it('redo works after undo', () => {
        const manager = createUndoManager();
        manager.push(makeEntry('A\n'));
        manager.push(makeEntry('B\n'));

        manager.undo(); // returns B
        expect(manager.canRedo).toBe(true);

        const redone = manager.redo();
        expect(serializeMutable(redone!.snapshot)).toBe('B\n');
    });

    it('new push after undo clears the redo stack', () => {
        const manager = createUndoManager();
        manager.push(makeEntry('A\n'));
        manager.push(makeEntry('B\n'));

        manager.undo(); // pop B
        manager.push(makeEntry('C\n')); // should clear redo

        expect(manager.canRedo).toBe(false);
        expect(manager.redo()).toBeNull();
    });

    it('clear empties both stacks', () => {
        const manager = createUndoManager();
        manager.push(makeEntry('A\n'));
        manager.push(makeEntry('B\n'));
        manager.undo();

        manager.clear();

        expect(manager.canUndo).toBe(false);
        expect(manager.canRedo).toBe(false);
    });

    it('stores deep copies so mutations do not affect history', () => {
        const manager = createUndoManager();
        const entry = makeEntry('Hello\n');
        manager.push(entry);

        // Mutate the original snapshot
        entry.snapshot.children[0].raw = 'Modified\n';

        const restored = manager.undo();
        expect(serializeMutable(restored!.snapshot)).toBe('Hello\n');
    });

    it('preserves focus info in undo entries', () => {
        const manager = createUndoManager();
        manager.push(makeEntry('Hello\n', 2, 15));

        const restored = manager.undo();
        expect(restored!.focusBlockIndex).toBe(2);
        expect(restored!.focusOffset).toBe(15);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:editor -- --run undo-manager`
Expected: FAIL — module `../undo-manager` not found

- [ ] **Step 3: Implement the undo manager**

```typescript
// src/lib/editor/undo-manager.ts

/**
 * Snapshot-based undo/redo stack.
 * Stores deep clones of CST documents.
 */

import type { UndoManager, UndoEntry } from './editor-types';
import { cloneDocument } from './mutable-tree';

export function createUndoManager(): UndoManager {
    const undoStack: UndoEntry[] = [];
    const redoStack: UndoEntry[] = [];

    function cloneEntry(entry: UndoEntry): UndoEntry {
        return {
            snapshot: cloneDocument(entry.snapshot),
            focusBlockIndex: entry.focusBlockIndex,
            focusOffset: entry.focusOffset
        };
    }

    return {
        push(entry: UndoEntry): void {
            undoStack.push(cloneEntry(entry));
            redoStack.length = 0;
        },

        undo(): UndoEntry | null {
            const entry = undoStack.pop();
            if (!entry) return null;
            redoStack.push(entry);
            return cloneEntry(entry);
        },

        redo(): UndoEntry | null {
            const entry = redoStack.pop();
            if (!entry) return null;
            undoStack.push(entry);
            return cloneEntry(entry);
        },

        clear(): void {
            undoStack.length = 0;
            redoStack.length = 0;
        },

        get canUndo(): boolean {
            return undoStack.length > 0;
        },

        get canRedo(): boolean {
            return redoStack.length > 0;
        }
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:editor -- --run undo-manager`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/undo-manager.ts src/lib/editor/test/undo-manager.test.ts
git commit -m "+ (editor) undo manager with snapshot-based undo/redo"
```

---

## Task 7: Export New Modules

**Files:**
- Modify: `src/lib/editor/index.ts`

- [ ] **Step 1: Update index.ts to export new modules**

Add these exports to the end of `src/lib/editor/index.ts`:

```typescript
// ── Editor runtime ──────────────────────────────────────────────────────────

export type {
    EditorActions,
    BlockComponent,
    UndoManager,
    UndoEntry,
    MutableNode,
    MutableDocument
} from './editor-types';
export {
    toMutable,
    cloneDocument,
    serializeMutable,
    assignIds,
    generateBlockId
} from './mutable-tree';
export { splitNode, mergeWithPrevious, deleteNode, updateNodeContent } from './tree-operations';
export { createUndoManager } from './undo-manager';
```

- [ ] **Step 2: Run all editor tests to verify nothing is broken**

Run: `npm run test:editor -- --run`
Expected: All tests PASS (existing tests + new tests)

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/index.ts
git commit -m "~ (editor) export new editor runtime modules"
```

---

## Task 8: ParagraphBlock Component

**Files:**
- Create: `src/lib/editor/components/ParagraphBlock.svelte`

This is the core editing surface. It renders a contenteditable `<div>`, handles text input sync, and calls `EditorActions` for boundary events (Enter, Backspace, arrow keys). It also intercepts copy/cut/paste and undo/redo.

No automated tests — Svelte component tests are not configured in this project. Test manually after Task 11 (integration).

- [ ] **Step 1: Create the component**

```svelte
<!-- src/lib/editor/components/ParagraphBlock.svelte -->
<script lang="ts">
    import { getContext, tick } from 'svelte';
    import type { EditorActions, MutableNode, BlockComponent } from '../editor-types';

    let { node, index }: { node: MutableNode; index: number } = $props();

    const actions = getContext<EditorActions>('editor-actions');
    let el: HTMLDivElement | undefined = $state();
    let composing = $state(false);

    // ── BlockComponent interface ────────────────────────────────────────

    export const editable = true;
    export const focusable = true;

    export function focus(offset: number): void {
        if (!el) return;
        el.focus();
        setCursorOffset(offset);
    }

    export function getCursorOffset(): number | null {
        if (!el || document.activeElement !== el) return null;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        const preRange = document.createRange();
        preRange.selectNodeContents(el);
        preRange.setEnd(range.startContainer, range.startOffset);
        return preRange.toString().length;
    }

    export function getSelectedText(): string {
        if (!el) return '';
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return '';
        return sel.toString();
    }

    export function setSelection(start: number, end: number): void {
        if (!el) return;
        const range = createRangeFromOffsets(el, start, end);
        if (!range) return;
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }

    // ── Cursor utilities ────────────────────────────────────────────────

    function setCursorOffset(offset: number): void {
        if (!el) return;
        const range = createRangeFromOffsets(el, offset, offset);
        if (!range) return;
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }

    function createRangeFromOffsets(
        container: HTMLElement,
        start: number,
        end: number
    ): Range | null {
        const range = document.createRange();
        let charCount = 0;
        let startSet = false;

        function walk(node: Node): boolean {
            if (node.nodeType === Node.TEXT_NODE) {
                const len = node.textContent?.length ?? 0;
                if (!startSet && charCount + len >= start) {
                    range.setStart(node, start - charCount);
                    startSet = true;
                }
                if (startSet && charCount + len >= end) {
                    range.setEnd(node, end - charCount);
                    return true;
                }
                charCount += len;
            } else {
                for (const child of node.childNodes) {
                    if (walk(child)) return true;
                }
            }
            return false;
        }

        walk(container);
        if (!startSet) {
            // Offset beyond content — put cursor at end
            range.selectNodeContents(container);
            range.collapse(false);
        }
        return range;
    }

    // ── Content (strip line ending for display) ─────────────────────────

    function getDisplayText(): string {
        // Raw includes trailing \n — strip it for contenteditable display
        let text = node.raw;
        if (text.endsWith('\r\n')) text = text.slice(0, -2);
        else if (text.endsWith('\n')) text = text.slice(0, -1);
        return text;
    }

    // ── Event Handlers ──────────────────────────────────────────────────

    function onInput(): void {
        if (composing || !el) return;
        const text = el.textContent ?? '';
        actions.updateBlockContent(index, text + '\n');
    }

    function onCompositionStart(): void {
        composing = true;
    }

    function onCompositionEnd(): void {
        composing = false;
        onInput();
    }

    function onKeyDown(e: KeyboardEvent): void {
        if (composing) return;

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const offset = getCursorOffset() ?? 0;
            actions.splitBlock(index, offset);
            return;
        }

        if (e.key === 'Backspace') {
            const offset = getCursorOffset();
            if (offset === 0 && !hasSelection()) {
                e.preventDefault();
                actions.mergeWithPrevious(index);
                return;
            }
        }

        // ArrowLeft at offset 0 → move to end of previous block
        if (e.key === 'ArrowLeft' && !e.shiftKey) {
            const offset = getCursorOffset();
            if (offset === 0) {
                e.preventDefault();
                actions.moveFocus(index - 1, 'end');
                return;
            }
        }

        // ArrowUp at offset 0 → move to end of previous block
        // Phase 1 simplification: uses offset-based detection instead of
        // visual-line geometry. Multi-line ArrowUp within a wrapped paragraph
        // only triggers boundary navigation at offset 0. Visual-line detection
        // (comparing caret rects) can be added in a later phase.
        if (e.key === 'ArrowUp' && !e.shiftKey) {
            const offset = getCursorOffset();
            if (offset === 0) {
                e.preventDefault();
                actions.moveFocus(index - 1, 'end');
                return;
            }
        }

        // ArrowRight at end of content → move to start of next block
        if (e.key === 'ArrowRight' && !e.shiftKey) {
            const textLen = (el?.textContent ?? '').length;
            const offset = getCursorOffset();
            if (offset === textLen) {
                e.preventDefault();
                actions.moveFocus(index + 1, 'start');
                return;
            }
        }

        // ArrowDown at end of content → move to start of next block
        // Same Phase 1 simplification as ArrowUp.
        if (e.key === 'ArrowDown' && !e.shiftKey) {
            const textLen = (el?.textContent ?? '').length;
            const offset = getCursorOffset();
            if (offset === textLen) {
                e.preventDefault();
                actions.moveFocus(index + 1, 'start');
                return;
            }
        }
    }

    function onBeforeInput(e: InputEvent): void {
        if (e.inputType === 'historyUndo') {
            e.preventDefault();
            actions.requestUndo();
        } else if (e.inputType === 'historyRedo') {
            e.preventDefault();
            actions.requestRedo();
        }
    }

    function onCopy(e: ClipboardEvent): void {
        e.preventDefault();
        const text = getSelectedTextFromRaw();
        e.clipboardData?.setData('text/plain', text);
    }

    function onCut(e: ClipboardEvent): void {
        e.preventDefault();
        const selectedText = getSelectedTextFromRaw();
        if (!selectedText) return;
        e.clipboardData?.setData('text/plain', selectedText);

        // Delete selected range via CST: compute new raw without the selection
        const selOffsets = getSelectionOffsets();
        if (selOffsets) {
            const displayText = getDisplayText();
            const newDisplay = displayText.slice(0, selOffsets.start) + displayText.slice(selOffsets.end);
            actions.updateBlockContent(index, newDisplay + '\n');
            // Re-render the contenteditable from updated CST
            if (el) el.textContent = newDisplay;
            setCursorOffset(selOffsets.start);
        }
    }

    function onPaste(e: ClipboardEvent): void {
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain') ?? '';
        if (!text) return;

        // Phase 1 simplification: all paste is inline within the current block.
        // Multi-block paste (splitting and inserting parsed blocks) is deferred
        // to a later phase. For now, insert the pasted text at the cursor position.
        const offset = getCursorOffset() ?? 0;
        const displayText = getDisplayText();
        const selOffsets = getSelectionOffsets();
        const start = selOffsets?.start ?? offset;
        const end = selOffsets?.end ?? offset;
        const newDisplay = displayText.slice(0, start) + text + displayText.slice(end);
        actions.updateBlockContent(index, newDisplay + '\n');
        if (el) el.textContent = newDisplay;
        setCursorOffset(start + text.length);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    function hasSelection(): boolean {
        const sel = window.getSelection();
        return Boolean(sel && !sel.isCollapsed);
    }

    function getSelectionOffsets(): { start: number; end: number } | null {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !el) return null;
        const range = sel.getRangeAt(0);
        const preRange = document.createRange();
        preRange.selectNodeContents(el);
        preRange.setEnd(range.startContainer, range.startOffset);
        const start = preRange.toString().length;
        const end = start + sel.toString().length;
        return { start, end };
    }

    function getSelectedTextFromRaw(): string {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !el) return '';
        // Get selection offsets and slice from raw
        const range = sel.getRangeAt(0);
        const preRange = document.createRange();
        preRange.selectNodeContents(el);
        preRange.setEnd(range.startContainer, range.startOffset);
        const start = preRange.toString().length;
        const end = start + sel.toString().length;
        // Slice from raw (raw may have trailing \n, offsets are within display text)
        return node.raw.slice(start, end);
    }
</script>

<div
    bind:this={el}
    class="paragraph-block"
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
>{getDisplayText()}</div>

<style>
    .paragraph-block {
        outline: none;
        padding: 2px 0;
        white-space: pre-wrap;
        word-wrap: break-word;
        min-height: 1.4em;
    }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/editor/components/ParagraphBlock.svelte
git commit -m "+ (editor) ParagraphBlock component with contenteditable"
```

---

## Task 9: BlockHost and BlockList Components

**Files:**
- Create: `src/lib/editor/components/BlockHost.svelte`
- Create: `src/lib/editor/components/BlockList.svelte`

- [ ] **Step 1: Create BlockHost**

```svelte
<!-- src/lib/editor/components/BlockHost.svelte -->
<script lang="ts">
    import type { MutableNode, BlockComponent } from '../editor-types';
    import ParagraphBlock from './ParagraphBlock.svelte';

    let { node, index, ref = $bindable() }:
        { node: MutableNode; index: number; ref?: BlockComponent } = $props();
</script>

{#if node.kind === 'paragraph'}
    <ParagraphBlock {node} {index} bind:this={ref} />
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

- [ ] **Step 2: Create BlockList**

```svelte
<!-- src/lib/editor/components/BlockList.svelte -->
<script lang="ts">
    import type { MutableNode, BlockComponent } from '../editor-types';
    import BlockHost from './BlockHost.svelte';

    let { children, blockIds, blockRefs = $bindable([]) }:
        {
            children: MutableNode[];
            blockIds: string[];
            blockRefs?: (BlockComponent | undefined)[];
        } = $props();
</script>

<div class="block-list">
    {#each children as node, i (blockIds[i])}
        <BlockHost {node} index={i} bind:ref={blockRefs[i]} />
    {/each}
</div>

<style>
    .block-list {
        display: flex;
        flex-direction: column;
    }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/components/BlockHost.svelte src/lib/editor/components/BlockList.svelte
git commit -m "+ (editor) BlockHost and BlockList components"
```

---

## Task 10: Editor Shell Component

**Files:**
- Create: `src/lib/editor/components/Editor.svelte`

This is the top-level component that ties everything together. It owns the mutable document, provides `EditorActions` via context, manages the undo stack, and handles focus after structural operations.

- [ ] **Step 1: Create the Editor component**

```svelte
<!-- src/lib/editor/components/Editor.svelte -->
<script lang="ts">
    import { setContext, tick } from 'svelte';
    import type { EditorActions, BlockComponent, MutableDocument, UndoEntry } from '../editor-types';
    import { toMutable, cloneDocument, serializeMutable, assignIds } from '../mutable-tree';
    import {
        splitNode as performSplit,
        mergeWithPrevious as performMerge,
        deleteNode as performDelete,
        updateNodeContent as performUpdate
    } from '../tree-operations';
    import { createUndoManager } from '../undo-manager';
    import { parse } from '../core/parser';
    import BlockList from './BlockList.svelte';

    let { source = '' }: { source?: string } = $props();

    // ── State ───────────────────────────────────────────────────────────

    let doc = $state<MutableDocument>(toMutable(parse(source)));
    let blockIds = $state<string[]>(assignIds(doc.children));
    let blockRefs = $state<(BlockComponent | undefined)[]>([]);
    const undoManager = createUndoManager();

    // ── Undo snapshot helpers ───────────────────────────────────────────

    let undoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastUndoBlockIndex = -1;

    function pushUndoSnapshot(blockIndex: number, offset: number): void {
        undoManager.push({
            snapshot: cloneDocument(doc),
            focusBlockIndex: blockIndex,
            focusOffset: offset
        });
    }

    function pushUndoSnapshotDebounced(blockIndex: number, offset: number): void {
        if (lastUndoBlockIndex !== blockIndex) {
            // Focus moved to a different block — push immediately
            flushUndoDebounce(blockIndex, offset);
            lastUndoBlockIndex = blockIndex;
            return;
        }

        if (undoDebounceTimer) clearTimeout(undoDebounceTimer);
        undoDebounceTimer = setTimeout(() => {
            pushUndoSnapshot(blockIndex, offset);
            undoDebounceTimer = null;
        }, 500);
    }

    function flushUndoDebounce(blockIndex: number, offset: number): void {
        if (undoDebounceTimer) {
            clearTimeout(undoDebounceTimer);
            undoDebounceTimer = null;
        }
        pushUndoSnapshot(blockIndex, offset);
    }

    // ── EditorActions ───────────────────────────────────────────────────

    const actions: EditorActions = {
        async splitBlock(blockIndex: number, offset: number): Promise<void> {
            flushUndoDebounce(blockIndex, offset);
            performSplit(doc, blockIds, blockIndex, offset);
            // Trigger Svelte reactivity
            doc.children = [...doc.children];
            blockIds = [...blockIds];
            await tick();
            blockRefs[blockIndex + 1]?.focus?.(0);
        },

        async mergeWithPrevious(blockIndex: number): Promise<void> {
            if (blockIndex <= 0) return;
            const prevRaw = doc.children[blockIndex - 1].raw;
            // Cursor should go at the end of the previous block's text (before \n)
            let mergeOffset = prevRaw.length;
            if (prevRaw.endsWith('\r\n')) mergeOffset -= 2;
            else if (prevRaw.endsWith('\n')) mergeOffset -= 1;

            flushUndoDebounce(blockIndex, 0);
            performMerge(doc, blockIds, blockIndex);
            doc.children = [...doc.children];
            blockIds = [...blockIds];
            await tick();
            blockRefs[blockIndex - 1]?.focus?.(mergeOffset);
        },

        async deleteBlock(blockIndex: number): Promise<void> {
            flushUndoDebounce(blockIndex, 0);
            performDelete(doc, blockIds, blockIndex);
            doc.children = [...doc.children];
            blockIds = [...blockIds];
            await tick();
            // Focus the block that took the deleted block's position, or the previous one
            const focusIndex = Math.min(blockIndex, doc.children.length - 1);
            if (focusIndex >= 0) {
                blockRefs[focusIndex]?.focus?.(0);
            }
        },

        async moveFocus(blockIndex: number, position: 'start' | 'end' | number): Promise<void> {
            if (blockIndex < 0 || blockIndex >= doc.children.length) return;
            const block = blockRefs[blockIndex];
            if (!block?.focusable) return;

            if (typeof position === 'number') {
                block.focus?.(position);
            } else if (position === 'start') {
                block.focus?.(0);
            } else {
                // 'end' — use a large number, focus() should clamp to content length
                block.focus?.(999999);
            }
        },

        updateBlockContent(blockIndex: number, text: string): void {
            pushUndoSnapshotDebounced(blockIndex, 0);
            const result = performUpdate(doc, blockIndex, text);
            if (result.kindChanged) {
                // Trigger full re-render for this block
                doc.children = [...doc.children];
            }
        },

        async requestUndo(): Promise<void> {
            const entry = undoManager.undo();
            if (!entry) return;
            // Push current state to redo first
            doc = entry.snapshot;
            blockIds = assignIds(doc.children);
            await tick();
            blockRefs[entry.focusBlockIndex]?.focus?.(entry.focusOffset);
        },

        async requestRedo(): Promise<void> {
            const entry = undoManager.redo();
            if (!entry) return;
            doc = entry.snapshot;
            blockIds = assignIds(doc.children);
            await tick();
            blockRefs[entry.focusBlockIndex]?.focus?.(entry.focusOffset);
        }
    };

    setContext('editor-actions', actions);

    // ── Public API ──────────────────────────────────────────────────────

    export function getSource(): string {
        return serializeMutable(doc);
    }
</script>

<div class="editor">
    <BlockList children={doc.children} {blockIds} bind:blockRefs />
</div>

<style>
    .editor {
        max-width: 720px;
        margin: 0 auto;
        padding: 1rem;
        font-family: var(--font-editor, system-ui, sans-serif);
        font-size: 1rem;
        line-height: 1.6;
        color: var(--color-text-primary);
    }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/editor/components/Editor.svelte
git commit -m "+ (editor) Editor shell with context, undo, and structural operations"
```

---

## Task 11: Integration — Wire Up to Document Route

**Files:**
- Modify: `src/routes/document/[slug]/+page.svelte`

This wires the editor to the existing document route so it can be tested manually in the running app.

- [ ] **Step 1: Read the current document page**

Read `src/routes/document/[slug]/+page.svelte` to understand the current implementation before modifying it.

- [ ] **Step 2: Update the document page to use the Editor**

Replace the content of `src/routes/document/[slug]/+page.svelte` with a simple editor integration. The exact implementation depends on the current page content (read it first), but the key change is:

```svelte
<script lang="ts">
    import Editor from '$lib/editor/components/Editor.svelte';

    // For now, start with sample markdown for testing
    const sampleSource = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph with more text that wraps across multiple lines to test line wrapping behavior.\n';
</script>

<main>
    <Editor source={sampleSource} />
</main>

<style>
    main {
        min-height: 100vh;
        background: var(--color-bg);
    }
</style>
```

- [ ] **Step 3: Run the dev server and test manually**

Run: `npm run dev`

Open `http://localhost:1420/document/test` in the browser. Verify:

1. Three paragraph blocks render with their text content
2. Click into a paragraph — cursor appears, you can type
3. Type some text — the contenteditable updates
4. Press Enter — the paragraph splits into two at the cursor position
5. Press Backspace at the start of a paragraph — it merges with the previous one
6. Arrow keys move between paragraphs at boundaries
7. Ctrl+Z undoes the last change
8. Ctrl+Y or Ctrl+Shift+Z redoes
9. Copy (Ctrl+C) copies selected text as plain text
10. Paste (Ctrl+V) inserts plain text
11. Cut (Ctrl+X) copies and removes selected text

- [ ] **Step 4: Fix any issues found during manual testing**

Iterate until all 11 checks above work correctly. This is the Phase 1 "rock solid" checkpoint from the spec.

- [ ] **Step 5: Run all tests to verify nothing is broken**

Run: `npm run test:editor -- --run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/document/[slug]/+page.svelte
git commit -m "+ (editor) wire editor to document route"
```

---

## Completion Checklist

Before moving to Phase 2 (adding block types), verify all of these work reliably:

- [ ] Paragraphs render correctly from parsed CST
- [ ] Text input syncs to CST (type, read back with `getSource()`)
- [ ] Enter splits a paragraph at the cursor into two paragraphs
- [ ] Backspace at position 0 merges with the previous paragraph
- [ ] Arrow keys navigate between blocks at boundaries
- [ ] Undo (Ctrl+Z) restores previous state with correct focus
- [ ] Redo (Ctrl+Y) restores the undone state
- [ ] Copy/Cut/Paste work within a single block
- [ ] The serialized output (`getSource()`) matches expected markdown
- [ ] No timing hacks — only `await tick()` for post-render focus
- [ ] No console errors during normal editing

If any of these are flaky, fix them before proceeding to Phase 2.
