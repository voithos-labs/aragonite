# Editor Phase 3 — Unified Mutable CST Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the immutable class hierarchy + MutableNode conversion with a single mutable plain-object `CstNode` type used everywhere — parser, editor, serializer, tests.

**Architecture:** The 13 immutable CST classes in `nodes.ts` become a single discriminated union type. The parser returns plain objects instead of class instances. The `toMutable()` conversion step is eliminated. `MutableNode` and `MutableDocument` are replaced by `CstNode` and `Document`. All consumers already use `kind` string discrimination (no `instanceof`), so the migration is mechanical.

**Tech Stack:** Svelte 5, TypeScript, Vitest

**Spec:** `docs/editor/syntax-tree/syntax-tree.md` — "Node Type" section (unified mutable plain objects, discriminated union, MetadataMap)

**Commit convention:** Symbol-prefixed, lowercase, no period, scoped with `(editor)`. Never include `Co-Authored-By` lines.

---

## File Structure

### Modified Files

| File | Change |
| ---- | ------ |
| `src/lib/editor/core/nodes.ts` | Replace 13 classes + 3 abstract bases with `CstNode` discriminated union type, `Document` interface, `MetadataMap` |
| `src/lib/editor/core/parser.ts` | Return plain objects instead of `new ClassName(...)` |
| `src/lib/editor/core/serializer.ts` | Update comment (no functional change — already structurally typed) |
| `src/lib/editor/editor-types.ts` | Delete `MutableNode` and `MutableDocument`, re-export `CstNode` and `Document` from nodes |
| `src/lib/editor/mutable-tree.ts` | Delete `toMutable` and `nodeToMutable`, keep `cloneDocument`, `assignIds`, `generateBlockId`, `serializeMutable` |
| `src/lib/editor/tree-operations.ts` | Change `MutableNode` imports to `CstNode` |
| `src/lib/editor/container-raw.ts` | Change `MutableNode` imports to `CstNode` |
| `src/lib/editor/index.ts` | Update exports (remove classes, remove `toMutable`, rename types) |
| `src/lib/editor/components/Editor.svelte` | Remove `toMutable` call, use `Document` instead of `MutableDocument` |
| `src/lib/editor/components/BlockHost.svelte` | Change `MutableNode` → `CstNode` |
| `src/lib/editor/components/BlockList.svelte` | Change `MutableNode` → `CstNode` |
| `src/lib/editor/components/TextEditableBlock.svelte` | Change `MutableNode` → `CstNode` |
| `src/lib/editor/components/CodeBlock.svelte` | Change `MutableNode` → `CstNode` |
| `src/lib/editor/components/ThematicBreakBlock.svelte` | Change `MutableNode` → `CstNode` |
| `src/lib/editor/components/BlockquoteBlock.svelte` | Change `MutableNode` → `CstNode` |
| `src/lib/editor/components/ListBlock.svelte` | Change `MutableNode` → `CstNode` |
| `src/lib/editor/components/ListItemBlock.svelte` | Change `MutableNode` → `CstNode` |
| `src/lib/editor/test/serialize.test.ts` | Replace `new Document(...)`, `new Heading(...)` with plain objects |
| `src/lib/editor/test/mutable-tree.test.ts` | Remove `toMutable` tests, update clone/serialize tests |
| `src/lib/editor/test/tree-operations.test.ts` | Remove `toMutable` calls |
| `src/lib/editor/test/undo-manager.test.ts` | Remove `toMutable` calls |
| `src/lib/editor/test/round-trip.test.ts` | Remove `List` type import from nodes (use `CstNode` instead) |
| `src/lib/editor/test/parser-metadata.test.ts` | Replace class type imports with `CstNode` narrowing |

### Reference Files (Read, Don't Modify)

| File | Why |
| ---- | --- |
| `src/lib/editor/core/lines.ts` | No CST types — unchanged |
| `src/lib/editor/merge-rules.ts` | Uses string kinds only — unchanged |
| `src/lib/editor/undo-manager.ts` | Uses `UndoEntry`/`UndoManager` from editor-types — unchanged after type rename |
| `docs/editor/syntax-tree/syntax-tree.md` | Design spec for the unified node type |

---

## Migration Strategy

The migration is done bottom-up: types first, then parser, then consumers.

**Tasks 1–3 are an atomic unit.** They form a single migration that is not independently testable — the test suite will be broken after Task 1 (classes deleted) and Task 2 (parser updated) until Task 3 (conversion layer eliminated) is complete. Tests are green again at the end of Task 3. Tasks 4–6 are independently testable.

The key insight: **every consumer already uses `kind` string discrimination, not `instanceof`**. The class hierarchy is only used for construction (in the parser) and type narrowing (via `as` casts in tests). Both are straightforward to replace.

---

## Task 1: Unified Node Types

**Files:**
- Modify: `src/lib/editor/core/nodes.ts`

Replace the entire class hierarchy with plain type definitions. The metadata interfaces stay unchanged. The classes are replaced by a `CstNode` interface and a `Document` interface.

**Why a flat interface, not a mapped-type discriminated union:** `updateNodeContent` in `tree-operations.ts` mutates `node.kind` and `node.metadata` in place when a block type changes (e.g., paragraph → heading). A strict discriminated union types `kind` as a literal per member, making in-place mutation a type error. The flat interface with `kind: BlockKind` allows this mutation. Metadata type safety is handled via a union of all metadata types — you narrow on `kind` manually when you need a specific metadata type, same as today's `as` casts but with a typed union instead of `Record<string, unknown>`.

- [ ] **Step 1: Rewrite nodes.ts**

Keep all existing metadata interfaces and kind type unions (`LeafBlockKind`, `ContainerBlockKind`, `BlockKind`) unchanged. Delete all classes (`CstNode`, `LeafBlock`, `ContainerBlock`, `Document`, `Heading`, `Paragraph`, etc.). Replace with:

```typescript
// ── Metadata ────────────────────────────────────────────────────────────────

// (keep all existing metadata interfaces: HeadingMetadata, FencedCodeMetadata, etc.)

/** Union of all block metadata types. */
export type BlockMetadata =
    | HeadingMetadata
    | SetextHeadingMetadata
    | FencedCodeMetadata
    | ThematicBreakMetadata
    | LinkReferenceDefinitionMetadata
    | TableMetadata
    | BlockquoteMetadata
    | ListMetadata
    | ListItemMetadata;

// ── Node Types ──────────────────────────────────────────────────────────────

/**
 * A single mutable CST block node. Plain object — no class hierarchy.
 * The editor, parser, and serializer all use this type directly.
 */
export interface CstNode {
    kind: BlockKind;
    leadingTrivia: string;
    raw: string;
    metadata?: BlockMetadata;
    innerPrefix?: string;
    children?: CstNode[];
    innerSuffix?: string;
}

/** Root document node. */
export interface Document {
    kind: 'document';
    prefix: string;
    children: CstNode[];
    suffix: string;
}
```

- [ ] **Step 2: Run tests — expect widespread failures**

Run: `npm run test:editor`
Expected: Many failures because the parser still uses `new ClassName(...)` constructors that no longer exist. This is expected — Task 2 fixes the parser.

- [ ] **Step 3: Commit**

```
> (editor) replace CST class hierarchy with CstNode discriminated union
```

---

## Task 2: Migrate Parser to Plain Objects

**Files:**
- Modify: `src/lib/editor/core/parser.ts`

Replace all `new ClassName(...)` constructor calls with plain object literals. The parser returns `Document` (now an interface, not a class) and `CstNode` objects.

- [ ] **Step 1: Update parser imports**

Replace:
```typescript
import {
    Document, Heading, Paragraph, FencedCode, ThematicBreak,
    SetextHeading, IndentedCode, HtmlBlock, LinkReferenceDefinition,
    Table, Blockquote, List, ListItem, type CstNode
} from './nodes';
```

With:
```typescript
import type { CstNode, Document } from './nodes';
```

- [ ] **Step 2: Update the return type of `parse`**

The function signature stays the same: `export function parse(source: string): Document`. But the body changes from `return new Document(...)` to:

```typescript
return { kind: 'document', prefix: result.prefix, children: result.children, suffix: result.suffix };
```

- [ ] **Step 3: Replace all constructor calls with object literals**

Each `new ClassName(leadingTrivia, raw, metadata)` becomes `{ kind: '...', leadingTrivia, raw, metadata }`. For leaf blocks without metadata, set `metadata: undefined`. For container blocks, include `innerPrefix`, `children`, `innerSuffix`.

Examples of the pattern:

```typescript
// Before:
new Heading(leadingTrivia, line.raw, { level: heading.level })
// After:
{ kind: 'heading', leadingTrivia, raw: line.raw, metadata: { level: heading.level } }

// Before:
new Paragraph(leadingTrivia, raw)
// After:
{ kind: 'paragraph', leadingTrivia, raw, metadata: undefined }

// Before:
new Blockquote(leadingTrivia, raw, inner.prefix, inner.children, inner.suffix, { quoteDepth })
// After:
{ kind: 'blockquote', leadingTrivia, raw, metadata: { quoteDepth },
  innerPrefix: inner.prefix, children: inner.children, innerSuffix: inner.suffix }
```

Apply this transformation to all ~15 constructor call sites in `parser.ts`. Leaf blocks get `innerPrefix: undefined, children: undefined, innerSuffix: undefined` (or omit them — TypeScript's discriminated union handles this). Container blocks get `innerPrefix`, `children`, `innerSuffix` from the recursive parse result.

Note: for container blocks, include `innerPrefix`, `children`, `innerSuffix`. For leaf blocks, omit these fields (they're optional on the interface). The flat interface makes both patterns compile cleanly.

- [ ] **Step 4: Update `parseBlocks` return type**

`parseBlocks` returns `{ prefix, children, suffix }`. The `children` array is now `CstNode[]` (already the case since `CstNode` is the return type of `parseNextBlock`). Verify the return type annotation.

- [ ] **Step 5: Run tests**

Run: `npm run test:editor`
Expected: Round-trip tests and parser-metadata tests should pass. Mutable-tree tests and tree-operations tests will still fail (they call `toMutable` which no longer exists). That's Task 3.

- [ ] **Step 6: Commit**

```
> (editor) migrate parser from class constructors to plain objects
```

---

## Task 3: Eliminate the Conversion Layer

**Files:**
- Modify: `src/lib/editor/editor-types.ts`
- Modify: `src/lib/editor/mutable-tree.ts`
- Modify: `src/lib/editor/tree-operations.ts`
- Modify: `src/lib/editor/container-raw.ts`

The parser now produces mutable plain objects. `toMutable()` is unnecessary. `MutableNode` and `MutableDocument` are the same shape as `CstNode` and `Document`. Unify them.

- [ ] **Step 1: Update editor-types.ts**

Delete `MutableNode` and `MutableDocument` interfaces. Replace with re-exports from `nodes.ts`:

```typescript
// CstNode and Document are now the single node types used everywhere.
// Re-export them so existing consumers don't need to change their import paths yet.
export type { CstNode, Document } from './core/nodes';
```

Update `UndoEntry` to use `Document` instead of `MutableDocument`:

```typescript
export interface UndoEntry {
    snapshot: Document;
    blockIds: string[];
    focusBlockIndex: number;
    focusOffset: number;
}
```

Keep `EditorActions`, `BlockComponent`, `UndoManager`, `EDITOR_ACTIONS_KEY` unchanged.

- [ ] **Step 2: Update mutable-tree.ts**

Delete `toMutable()` and `nodeToMutable()`. Delete the import of `CstNode`, `Document`, `ContainerBlock` from `./core/nodes`.

Update `cloneDocument` to use `Document` and `CstNode`:

```typescript
import type { CstNode, Document } from './core/nodes';

export function cloneDocument(doc: Document): Document {
    return {
        kind: 'document',
        prefix: doc.prefix,
        children: doc.children.map(cloneNode),
        suffix: doc.suffix
    };
}

function cloneNode(node: CstNode): CstNode {
    const cloned: any = {
        kind: node.kind,
        leadingTrivia: node.leadingTrivia,
        raw: node.raw
    };
    if (node.metadata) cloned.metadata = { ...node.metadata };
    if (node.children) {
        cloned.innerPrefix = node.innerPrefix;
        cloned.children = node.children.map(cloneNode);
        cloned.innerSuffix = node.innerSuffix;
    }
    return cloned;
}
```

With the flat interface, `cloneNode`'s `if (node.children)` pattern works directly — `children` is `CstNode[] | undefined` on every node. No `as` cast needed on the return.

Keep `serializeMutable` (re-export of `serialize`), `generateBlockId`, `assignIds` unchanged — just update their type annotations from `MutableNode`/`MutableDocument` to `CstNode`/`Document`.

- [ ] **Step 3: Update tree-operations.ts**

Replace `MutableNode` import with `CstNode`:

```typescript
import type { CstNode } from './core/nodes';

export type NodeParent = { children: CstNode[] };
```

Remove the `toMutable` import. Update `reparseAsNode` to work directly with parser output (no conversion):

```typescript
function reparseAsNode(raw: string, leadingTrivia: string): CstNode {
    const doc = parse(raw);
    if (doc.children.length > 0) {
        const node = doc.children[0];
        node.leadingTrivia = leadingTrivia;
        return node;
    }
    return { kind: 'paragraph', leadingTrivia, raw, metadata: undefined } as CstNode;
}
```

The key change: `parse(raw)` now returns plain objects directly. No `toMutable()` wrapper needed. Mutating `node.leadingTrivia` works because nodes are mutable.

- [ ] **Step 4: Update container-raw.ts**

Replace `MutableNode` import with `CstNode`:

```typescript
import type { CstNode } from './core/nodes';
```

Update function signatures: `(node: MutableNode)` → `(node: CstNode)`.

- [ ] **Step 5: Run tests**

Run: `npm run test:editor`
Expected: Some tests still fail because they import `toMutable` or `MutableNode`. That's Task 4.

- [ ] **Step 6: Commit**

```
> (editor) eliminate toMutable conversion, unify CstNode and MutableNode
```

---

## Task 4: Update Tests

**Files:**
- Modify: `src/lib/editor/test/serialize.test.ts`
- Modify: `src/lib/editor/test/mutable-tree.test.ts`
- Modify: `src/lib/editor/test/tree-operations.test.ts`
- Modify: `src/lib/editor/test/undo-manager.test.ts`
- Modify: `src/lib/editor/test/round-trip.test.ts`
- Modify: `src/lib/editor/test/parser-metadata.test.ts`
- Modify: `src/lib/editor/test/container-raw.test.ts`

**Unchanged test files** (verified — no CST class or MutableNode imports):
- `src/lib/editor/test/unrecognized.test.ts`
- `src/lib/editor/test/round-trip-complex.test.ts`
- `src/lib/editor/test/lines.test.ts`
- `src/lib/editor/test/merge-rules.test.ts`

- [ ] **Step 1: Update serialize.test.ts**

Replace class constructor calls with plain objects:

```typescript
// Before:
const doc = new Document('', [], '');
// After:
const doc = { kind: 'document' as const, prefix: '', children: [], suffix: '' };

// Before:
new Heading('', '# Title\n', { level: 1 })
// After:
{ kind: 'heading' as const, leadingTrivia: '', raw: '# Title\n', metadata: { level: 1 } }
```

Remove the import of `Document`, `Heading`, `Paragraph`, `ThematicBreak` from `../core/nodes`.

- [ ] **Step 2: Update mutable-tree.test.ts**

Delete the `toMutable` describe block — these tests verified the immutable→mutable conversion which no longer exists. The "creates a mutable copy" test is no longer meaningful because `parse()` returns fresh mutable objects by construction (each call returns a new tree).

Replace with a single test verifying `parse()` output is mutable:

```typescript
describe('parse produces mutable nodes', () => {
    it('allows mutation of parsed node fields', () => {
        const doc = parse('# Title\n');
        doc.children[0].raw = '# Changed\n';
        expect(doc.children[0].raw).toBe('# Changed\n');
    });
});
```

Update `serializeMutable`, `cloneDocument`, and `assignIds` tests to call `parse()` directly instead of `parse()` → `toMutable()`:

```typescript
// Before:
const doc = parse(source);
const mutable = toMutable(doc);
// After:
const doc = parse(source);
// Use doc directly — it's already mutable
```

- [ ] **Step 3: Update tree-operations.test.ts**

Remove `toMutable` import. Replace `toMutable(doc)` with `doc` (parser output is already mutable):

```typescript
// Before:
const doc = parse(source);
const mutable = toMutable(doc);
const ids = ['id-1'];
splitNode(mutable, ids, 0, 5);
// After:
const doc = parse(source);
const ids = ['id-1'];
splitNode(doc, ids, 0, 5);
```

Apply this pattern to all ~30 test cases.

- [ ] **Step 4: Update undo-manager.test.ts**

Same pattern — remove `toMutable`, use `parse()` output directly.

- [ ] **Step 5: Update round-trip.test.ts**

Remove `import type { List } from '../core/nodes'`. Replace the `as List` cast with a `kind` guard for container children access:

```typescript
// Before:
const list = doc.children[0] as List;
expect(list.children.length).toBe(2);
// After:
const list = doc.children[0];
expect(list.kind).toBe('list');
expect(list.children!.length).toBe(2);
```

Use `!` non-null assertion on `children` — the `kind` check above confirms it's a container, and `children` is populated for container kinds.

- [ ] **Step 6: Update parser-metadata.test.ts**

Remove class type imports. Replace `as ClassName` casts with direct property access:

```typescript
// Before:
import type { Heading, FencedCode, ... } from '../core/nodes';
const node = doc.children[0] as Heading;
expect(node.metadata.level).toBe(2);
// After:
const node = doc.children[0];
expect(node.metadata).toEqual({ level: 2 });
// Or for specific fields:
expect((node.metadata as { level: number }).level).toBe(2);
```

For container nodes that access `children`:
```typescript
// Before:
const list = doc.children[0] as List;
expect(list.children[0].kind).toBe('listItem');
// After:
const list = doc.children[0];
expect(list.children![0].kind).toBe('listItem');
```

- [ ] **Step 6.5: Update container-raw.test.ts**

Replace `MutableNode` import with `CstNode`:

```typescript
// Before:
import type { MutableNode } from '../editor-types';
const node: MutableNode = { ... };
// After:
import type { CstNode } from '../core/nodes';
const node: CstNode = { ... };
```

Update all test object type annotations from `MutableNode` to `CstNode`.

- [ ] **Step 7: Run all tests**

Run: `npm run test:editor`
Expected: All 240 tests pass.

- [ ] **Step 8: Commit**

```
~ (editor) update tests for unified CstNode type
```

---

## Task 5: Update Editor Components

**Files:**
- Modify: All `.svelte` files in `src/lib/editor/components/`
- Modify: `src/lib/editor/components/Editor.svelte`

- [ ] **Step 1: Rename MutableNode → CstNode in all components**

In each component file, replace:
```typescript
import type { MutableNode, ... } from '../editor-types';
```
With:
```typescript
import type { CstNode, ... } from '../editor-types';
```

Update **all** `MutableNode` references — not just imports and prop types, but also local function signatures and return types. In particular, `BlockquoteBlock.svelte` and `ListItemBlock.svelte` have an `innerParent()` helper with return type `{ children: MutableNode[] }` that must become `{ children: CstNode[] }`.

Files to update (all in `src/lib/editor/components/`):
- `BlockHost.svelte`
- `BlockList.svelte`
- `TextEditableBlock.svelte`
- `CodeBlock.svelte`
- `ThematicBreakBlock.svelte`
- `BlockquoteBlock.svelte`
- `ListBlock.svelte`
- `ListItemBlock.svelte`

- [ ] **Step 2: Update Editor.svelte**

Replace `MutableDocument` with `Document`:

```typescript
import type { Document, ... } from '../editor-types';

let doc = $state<Document>(initDocument(source));
```

Remove `toMutable` from the import and from `initDocument`:

```typescript
// Before:
function initDocument(src: string): MutableDocument {
    const d = toMutable(parse(src));
    ...
}
// After:
function initDocument(src: string): Document {
    const d = parse(src);
    if (d.children.length === 0) {
        d.children.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n', metadata: undefined } as CstNode);
    }
    return d;
}
```

Update `cloneDocument` import path if needed (it stays in `mutable-tree.ts` but now takes/returns `Document`).

- [ ] **Step 3: Run all tests**

Run: `npm run test:editor`
Expected: All tests pass.

- [ ] **Step 4: Run svelte-check**

Run: `npm run check`
Expected: No new errors (pre-existing `vite.config.js` error is acceptable).

- [ ] **Step 5: Commit**

```
~ (editor) rename MutableNode/MutableDocument to CstNode/Document across editor
```

---

## Task 6: Clean Up Exports and Dead Code

**Files:**
- Modify: `src/lib/editor/index.ts`
- Modify: `src/lib/editor/core/serializer.ts` (comment only)

- [ ] **Step 1: Update index.ts exports**

Remove class exports (they no longer exist). Remove `toMutable` export. Update type exports:

```typescript
export { parse } from './core/parser';
export { serialize } from './core/serializer';
export type {
    BlockKind, LeafBlockKind, ContainerBlockKind,
    CstNode, Document,
    HeadingMetadata, SetextHeadingMetadata, FencedCodeMetadata,
    ThematicBreakMetadata, LinkReferenceDefinitionMetadata, TableMetadata,
    BlockquoteMetadata, ListMetadata, ListItemMetadata
} from './core/nodes';

export { EDITOR_ACTIONS_KEY } from './editor-types';
export type { EditorActions, BlockComponent, UndoManager, UndoEntry } from './editor-types';
export { cloneDocument, serializeMutable, assignIds, generateBlockId } from './mutable-tree';
export { splitNode, mergeWithPrevious, deleteNode, updateNodeContent } from './tree-operations';
export { createUndoManager } from './undo-manager';
```

- [ ] **Step 2: Update serializer.ts comment**

Replace the comment mentioning "immutable Document and MutableDocument":

```typescript
/**
 * Serialize a document tree to its source text representation.
 * Structurally typed — works with any object that has prefix, children (with leadingTrivia + raw), and suffix.
 */
```

- [ ] **Step 3: Verify no dead imports remain**

Run: `npm run check`
Search for any remaining references to `toMutable`, `MutableNode`, `MutableDocument`, `nodeToMutable`, or any deleted class names across the codebase.

- [ ] **Step 4: Run all tests**

Run: `npm run test:editor`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```
~ (editor) clean up exports and remove dead code after CST unification
```

---

## Implementation Notes

### Why Flat Interface Over Discriminated Union

The design spec mentions a discriminated union as the preferred approach. However, `updateNodeContent` in `tree-operations.ts` mutates `node.kind` in place when a block type changes (e.g., paragraph → heading). A strict mapped-type discriminated union types `kind` as a literal per member, making this in-place mutation a type error. The flat interface with `kind: BlockKind` allows mutation. Metadata access uses `as` casts (same as the current `MutableNode` approach with `Record<string, unknown>`, but now with a typed union instead).

If the codebase later moves to immutable-style updates (replacing the node entirely instead of mutating `kind`), the discriminated union can be reconsidered.

### No Behavioral Changes

This migration changes only types and construction patterns. No runtime behavior changes. Every test should produce identical results before and after. If a test fails, it's a migration error, not a design issue.
