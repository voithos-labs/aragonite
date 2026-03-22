# GFM CST Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a block-level concrete syntax tree that parses GitHub Flavored Markdown and reconstructs it without loss.

**Architecture:** Single-pass line-oriented parser produces a recursive tree of typed block nodes. Each node stores its raw source text verbatim. Serialization concatenates `leadingTrivia + raw` down the tree. Container blocks (blockquotes, lists) hold children parsed from stripped inner content. See `src/docs/editor/syntax-tree.md` for the full design spec.

**Tech Stack:** TypeScript, Vitest (test runner), Vite (build)

---

## File Structure

```
src/lib/editor/
├── core/
│   ├── nodes.ts          # CstNode base + all concrete node classes
│   ├── parser.ts         # parse() — line scanner + block matchers
│   ├── serializer.ts     # serialize() — recursive concatenation
│   └── lines.ts          # splitLines() utility — line splitting with preserved endings
├── test/
│   ├── serializer.test.ts       # Round-trip tests (Tier 1)
│   ├── parser-metadata.test.ts  # Metadata extraction tests (Tier 2)
│   └── unrecognized.test.ts     # Deferred GFM syntax coverage (Tier 3)
```

---

## Task 0: Set Up Vitest

**Files:**

- Modify: `package.json` (replace `test:editor` script, add vitest dep)
- Create: `vitest.config.ts`
- Delete: `tsconfig.editor-test.json` (no longer needed)

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/lib/editor/test/**/*.test.ts']
	}
});
```

- [ ] **Step 3: Update package.json test script**

Replace the `test:editor` script in `package.json`:

```json
"test:editor": "vitest run --passWithNoTests"
```

- [ ] **Step 4: Delete old tsconfig.editor-test.json**

```bash
rm tsconfig.editor-test.json
```

- [ ] **Step 5: Verify vitest runs (no tests yet, should exit cleanly)**

```bash
npm run test:editor
```

Expected: `No test files found` or similar clean exit.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git rm tsconfig.editor-test.json
git commit -m "chore: replace tsc+node test pipeline with vitest"
```

---

## Task 1: Line Splitting Utility

**Files:**

- Create: `src/lib/editor/core/lines.ts`
- Create: `src/lib/editor/test/serializer.test.ts` (first round-trip test)

This is the foundation — splitting source into lines while preserving line endings.

- [ ] **Step 1: Write the failing test**

Create `src/lib/editor/test/serializer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitLines } from '../core/lines';

describe('splitLines', () => {
	it('splits LF lines and preserves endings', () => {
		const lines = splitLines('a\nb\nc\n');
		expect(lines).toEqual([
			{ raw: 'a\n', text: 'a', lineEnding: '\n', start: 0, end: 2 },
			{ raw: 'b\n', text: 'b', lineEnding: '\n', start: 2, end: 4 },
			{ raw: 'c\n', text: 'c', lineEnding: '\n', start: 4, end: 6 }
		]);
	});

	it('splits CRLF lines and preserves endings', () => {
		const lines = splitLines('a\r\nb\r\n');
		expect(lines).toEqual([
			{ raw: 'a\r\n', text: 'a', lineEnding: '\r\n', start: 0, end: 3 },
			{ raw: 'b\r\n', text: 'b', lineEnding: '\r\n', start: 3, end: 6 }
		]);
	});

	it('handles final line without trailing newline', () => {
		const lines = splitLines('a\nb');
		expect(lines).toEqual([
			{ raw: 'a\n', text: 'a', lineEnding: '\n', start: 0, end: 2 },
			{ raw: 'b', text: 'b', lineEnding: '', start: 2, end: 3 }
		]);
	});

	it('handles empty string', () => {
		const lines = splitLines('');
		expect(lines).toEqual([]);
	});

	it('handles single line no newline', () => {
		const lines = splitLines('hello');
		expect(lines).toEqual([{ raw: 'hello', text: 'hello', lineEnding: '', start: 0, end: 5 }]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:editor
```

Expected: FAIL — `splitLines` not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/editor/core/lines.ts`:

```ts
export interface ParsedLine {
	raw: string;
	text: string;
	lineEnding: string;
	start: number;
	end: number;
}

export function splitLines(source: string): ParsedLine[] {
	const lines: ParsedLine[] = [];
	let start = 0;

	for (let i = 0; i < source.length; i++) {
		if (source[i] === '\n') {
			const raw = source.slice(start, i + 1);
			const lineEnding = source[i - 1] === '\r' ? '\r\n' : '\n';
			const text = raw.slice(0, raw.length - lineEnding.length);
			lines.push({ raw, text, lineEnding, start, end: i + 1 });
			start = i + 1;
		}
	}

	// Remaining content after last newline (or entire string if no newlines)
	if (start < source.length) {
		const raw = source.slice(start);
		lines.push({ raw, text: raw, lineEnding: '', start, end: source.length });
	}

	return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:editor
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/core/lines.ts src/lib/editor/test/serializer.test.ts
git commit -m "feat(editor): add splitLines utility with tests"
```

---

## Task 2: Node Types

**Files:**

- Create: `src/lib/editor/core/nodes.ts`

All CST node classes. No tests for this file directly — it's pure data structures, tested through parser and serializer.

- [ ] **Step 1: Write the node types**

Create `src/lib/editor/core/nodes.ts`:

```ts
// ── Node Kinds ──────────────────────────────────────────────────────────────

export type LeafBlockKind =
	| 'heading'
	| 'paragraph'
	| 'fencedCode'
	| 'thematicBreak'
	| 'unrecognized';

export type ContainerBlockKind = 'blockquote' | 'list' | 'listItem';

export type BlockKind = LeafBlockKind | ContainerBlockKind;

// ── Metadata ────────────────────────────────────────────────────────────────

export interface HeadingMetadata {
	level: number;
}

export interface FencedCodeMetadata {
	fenceMarker: '`' | '~';
	fenceLength: number;
	info: string;
	closed: boolean;
}

export interface ThematicBreakMetadata {
	marker: string;
}

export interface BlockquoteMetadata {
	quoteDepth: number;
}

export interface ListMetadata {
	ordered: boolean;
}

export interface ListItemMetadata {
	marker: string;
	taskItem: boolean;
	taskChecked: boolean;
}

// ── Base Classes ────────────────────────────────────────────────────────────

export abstract class CstNode {
	abstract readonly kind: BlockKind | 'document';
	readonly leadingTrivia: string;
	readonly raw: string;

	constructor(leadingTrivia: string, raw: string) {
		this.leadingTrivia = leadingTrivia;
		this.raw = raw;
	}
}

export abstract class LeafBlock extends CstNode {
	abstract readonly kind: LeafBlockKind;
}

export abstract class ContainerBlock extends CstNode {
	abstract readonly kind: ContainerBlockKind;
	readonly innerPrefix: string;
	readonly children: CstNode[];
	readonly innerSuffix: string;

	constructor(
		leadingTrivia: string,
		raw: string,
		innerPrefix: string,
		children: CstNode[],
		innerSuffix: string
	) {
		super(leadingTrivia, raw);
		this.innerPrefix = innerPrefix;
		this.children = children;
		this.innerSuffix = innerSuffix;
	}
}

// ── Document ────────────────────────────────────────────────────────────────

export class Document {
	readonly kind = 'document' as const;
	readonly prefix: string;
	readonly children: CstNode[];
	readonly suffix: string;

	constructor(prefix: string, children: CstNode[], suffix: string) {
		this.prefix = prefix;
		this.children = children;
		this.suffix = suffix;
	}
}

// ── Leaf Blocks ─────────────────────────────────────────────────────────────

export class Heading extends LeafBlock {
	readonly kind = 'heading' as const;
	readonly metadata: HeadingMetadata;

	constructor(leadingTrivia: string, raw: string, metadata: HeadingMetadata) {
		super(leadingTrivia, raw);
		this.metadata = metadata;
	}
}

export class Paragraph extends LeafBlock {
	readonly kind = 'paragraph' as const;

	constructor(leadingTrivia: string, raw: string) {
		super(leadingTrivia, raw);
	}
}

export class FencedCode extends LeafBlock {
	readonly kind = 'fencedCode' as const;
	readonly metadata: FencedCodeMetadata;

	constructor(leadingTrivia: string, raw: string, metadata: FencedCodeMetadata) {
		super(leadingTrivia, raw);
		this.metadata = metadata;
	}
}

export class ThematicBreak extends LeafBlock {
	readonly kind = 'thematicBreak' as const;
	readonly metadata: ThematicBreakMetadata;

	constructor(leadingTrivia: string, raw: string, metadata: ThematicBreakMetadata) {
		super(leadingTrivia, raw);
		this.metadata = metadata;
	}
}

export class UnrecognizedBlock extends LeafBlock {
	readonly kind = 'unrecognized' as const;

	constructor(leadingTrivia: string, raw: string) {
		super(leadingTrivia, raw);
	}
}

// ── Container Blocks ────────────────────────────────────────────────────────

export class Blockquote extends ContainerBlock {
	readonly kind = 'blockquote' as const;
	readonly metadata: BlockquoteMetadata;

	constructor(
		leadingTrivia: string,
		raw: string,
		innerPrefix: string,
		children: CstNode[],
		innerSuffix: string,
		metadata: BlockquoteMetadata
	) {
		super(leadingTrivia, raw, innerPrefix, children, innerSuffix);
		this.metadata = metadata;
	}
}

export class List extends ContainerBlock {
	readonly kind = 'list' as const;
	declare readonly children: ListItem[];
	readonly metadata: ListMetadata;

	constructor(
		leadingTrivia: string,
		raw: string,
		innerPrefix: string,
		children: ListItem[],
		innerSuffix: string,
		metadata: ListMetadata
	) {
		super(leadingTrivia, raw, innerPrefix, children, innerSuffix);
		this.metadata = metadata;
	}
}

export class ListItem extends ContainerBlock {
	readonly kind = 'listItem' as const;
	readonly metadata: ListItemMetadata;

	constructor(
		leadingTrivia: string,
		raw: string,
		innerPrefix: string,
		children: CstNode[],
		innerSuffix: string,
		metadata: ListItemMetadata
	) {
		super(leadingTrivia, raw, innerPrefix, children, innerSuffix);
		this.metadata = metadata;
	}
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit src/lib/editor/core/nodes.ts --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/core/nodes.ts
git commit -m "feat(editor): add CST node type hierarchy"
```

---

## Task 3: Serializer

**Files:**

- Create: `src/lib/editor/core/serializer.ts`
- Modify: `src/lib/editor/test/serializer.test.ts` (add serialize tests)

The serializer is trivial — it concatenates `leadingTrivia + raw` down the tree. We write it first so we can use it in round-trip tests for the parser.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/editor/test/serializer.test.ts`. Insert the two new `import` lines at the **top of the file** alongside the existing vitest import, then add the new `describe` block after the existing `splitLines` tests:

```ts
import { serialize } from '../core/serializer';
import { Document, Heading, Paragraph, ThematicBreak } from '../core/nodes';

describe('serialize', () => {
	it('serializes an empty document', () => {
		const doc = new Document('', [], '');
		expect(serialize(doc)).toBe('');
	});

	it('serializes a document with prefix and suffix', () => {
		const doc = new Document('\n\n', [new Heading('', '# Title\n', { level: 1 })], '\n');
		expect(serialize(doc)).toBe('\n\n# Title\n\n');
	});

	it('serializes multiple blocks with leading trivia', () => {
		const doc = new Document(
			'',
			[
				new Heading('', '# Title\n', { level: 1 }),
				new Paragraph('\n', 'Some text.\n'),
				new ThematicBreak('\n', '---\n', { marker: '-' })
			],
			''
		);
		expect(serialize(doc)).toBe('# Title\n\nSome text.\n\n---\n');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:editor
```

Expected: FAIL — `serialize` not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/editor/core/serializer.ts`:

```ts
import type { Document } from './nodes';

export function serialize(document: Document): string {
	return (
		document.prefix +
		document.children.map((node) => node.leadingTrivia + node.raw).join('') +
		document.suffix
	);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:editor
```

Expected: All serialize tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/core/serializer.ts src/lib/editor/test/serializer.test.ts
git commit -m "feat(editor): add serialize function with round-trip tests"
```

---

## Task 4: Parser — Leaf Blocks Only (No Containers)

**Files:**

- Create: `src/lib/editor/core/parser.ts`
- Modify: `src/lib/editor/test/serializer.test.ts` (add round-trip tests via parse + serialize)

Build the parser incrementally. Start with leaf blocks only — headings, paragraphs, fenced code, thematic breaks. Containers come next.

- [ ] **Step 1: Write failing round-trip tests for leaf blocks**

Add to `src/lib/editor/test/serializer.test.ts`:

`````ts
import { parse } from '../core/parser';

describe('round-trip: leaf blocks', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'single heading', source: '# Hello\n' },
		{
			name: 'heading levels',
			source: '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n'
		},
		{ name: 'heading with no trailing newline', source: '# Hello' },
		{ name: 'paragraph', source: 'Hello world.\n' },
		{ name: 'multi-line paragraph', source: 'Line one.\nLine two.\nLine three.\n' },
		{ name: 'heading then paragraph', source: '# Title\n\nSome body text.\n' },
		{ name: 'fenced code backticks', source: '```js\nconsole.log(1);\n```\n' },
		{ name: 'fenced code tildes', source: '~~~\ncode\n~~~\n' },
		{ name: 'fenced code 4 backticks', source: '````\ncode with ``` inside\n````\n' },
		{ name: 'unclosed fenced code', source: '```\ncode\nmore code\n' },
		{ name: 'thematic break ---', source: '---\n' },
		{ name: 'thematic break ***', source: '***\n' },
		{ name: 'thematic break ___', source: '___\n' },
		{ name: 'thematic break spaced', source: '- - -\n' },
		{ name: 'empty document', source: '' },
		{ name: 'only blank lines', source: '\n\n\n' },
		{ name: 'leading blank lines', source: '\n\n# Title\n' },
		{ name: 'trailing blank lines', source: '# Title\n\n\n' },
		{ name: 'multiple blank lines between blocks', source: '# A\n\n\n\n# B\n' },
		{ name: 'CRLF line endings', source: '# Title\r\n\r\nParagraph.\r\n' },
		{
			name: 'mixed content',
			source: '# Title\n\nParagraph text.\n\n```\ncode\n```\n\n---\n\nMore text.\n'
		}
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});
`````

- [ ] **Step 2: Run test to verify they fail**

```bash
npm run test:editor
```

Expected: FAIL — `parse` not found.

- [ ] **Step 3: Write the parser (leaf blocks only)**

Create `src/lib/editor/core/parser.ts`:

```ts
import {
	Document,
	Heading,
	Paragraph,
	FencedCode,
	ThematicBreak,
	UnrecognizedBlock,
	type CstNode
} from './nodes';
import { splitLines, type ParsedLine } from './lines';

export function parse(source: string): Document {
	const lines = splitLines(source);
	const result = parseBlocks(lines, 0, lines.length, false);
	return new Document(result.prefix, result.children, result.suffix);
}

interface ParseBlocksResult {
	prefix: string;
	children: CstNode[];
	suffix: string;
}

export function parseBlocks(
	lines: ParsedLine[],
	start: number,
	end: number,
	insideContainer: boolean
): ParseBlocksResult {
	const children: CstNode[] = [];
	let prefix = '';
	let pendingTrivia = '';
	let index = start;

	// Consume leading blank lines into prefix
	while (index < end && isBlankLine(lines[index].text)) {
		prefix += lines[index].raw;
		index++;
	}

	while (index < end) {
		const line = lines[index];

		if (isBlankLine(line.text)) {
			pendingTrivia += line.raw;
			index++;
			continue;
		}

		const { node, nextIndex } = parseNextBlock(
			lines,
			index,
			end,
			pendingTrivia,
			children.length === 0
		);
		children.push(node);
		pendingTrivia = '';
		index = nextIndex;
	}

	return { prefix, children, suffix: pendingTrivia };
}

function parseNextBlock(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	atDocumentStart: boolean
): { node: CstNode; nextIndex: number } {
	const line = lines[startIndex];

	// Fenced code block
	const fence = matchFenceOpen(line.text);
	if (fence) {
		return parseFencedCode(lines, startIndex, endIndex, leadingTrivia, fence);
	}

	// ATX heading
	const heading = matchHeading(line.text);
	if (heading) {
		return {
			node: new Heading(leadingTrivia, line.raw, { level: heading.level }),
			nextIndex: startIndex + 1
		};
	}

	// Thematic break — only when preceded by blank line or at document start
	const thematic = matchThematicBreak(line.text);
	if (thematic && (leadingTrivia.length > 0 || atDocumentStart)) {
		return {
			node: new ThematicBreak(leadingTrivia, line.raw, {
				marker: thematic
			}),
			nextIndex: startIndex + 1
		};
	}

	// TODO: Blockquote matcher (Task 5)
	// TODO: List item matcher (Task 6)

	// Fallback: paragraph — consume continuation lines
	return parseParagraph(lines, startIndex, endIndex, leadingTrivia);
}

function parseFencedCode(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	fence: { marker: '`' | '~'; length: number; info: string }
): { node: FencedCode; nextIndex: number } {
	let i = startIndex + 1;
	let closed = false;

	while (i < endIndex) {
		if (matchFenceClose(lines[i].text, fence.marker, fence.length)) {
			i++;
			closed = true;
			break;
		}
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: new FencedCode(leadingTrivia, raw, {
			fenceMarker: fence.marker,
			fenceLength: fence.length,
			info: fence.info,
			closed
		}),
		nextIndex: i
	};
}

function parseParagraph(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: Paragraph; nextIndex: number } {
	let i = startIndex + 1;

	while (i < endIndex && !isBlankLine(lines[i].text) && !startsNewBlock(lines[i].text)) {
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: new Paragraph(leadingTrivia, raw),
		nextIndex: i
	};
}

// ── Matchers ────────────────────────────────────────────────────────────────

function matchHeading(text: string): { level: number } | null {
	const m = text.match(/^ {0,3}(#{1,6})(?:\s|$)/);
	return m ? { level: m[1].length } : null;
}

function matchFenceOpen(text: string): { marker: '`' | '~'; length: number; info: string } | null {
	const m = text.match(/^ {0,3}(`{3,})([^`]*)$|^ {0,3}(~{3,})(.*)$/);
	if (!m) return null;

	if (m[1]) {
		return { marker: '`', length: m[1].length, info: m[2].trim() };
	}
	return { marker: '~', length: m[3].length, info: m[4].trim() };
}

function matchFenceClose(text: string, marker: '`' | '~', minLength: number): boolean {
	const pattern = marker === '`' ? /^ {0,3}(`{3,})\s*$/ : /^ {0,3}(~{3,})\s*$/;
	const m = text.match(pattern);
	return Boolean(m && m[1].length >= minLength);
}

export function matchThematicBreak(text: string): string | null {
	const trimmed = text.trim();
	if (/^(\*[ \t]*){3,}$/.test(trimmed)) return '*';
	if (/^(-[ \t]*){3,}$/.test(trimmed)) return '-';
	if (/^(_[ \t]*){3,}$/.test(trimmed)) return '_';
	return null;
}

function startsNewBlock(text: string): boolean {
	// Thematic breaks are deliberately excluded here. A `---` line does NOT
	// interrupt a paragraph from inside the continuation scan — it only gets
	// recognized at the top level of parseNextBlock (with the blank-line guard).
	// This prevents setext heading underlines from being split off as thematic breaks.
	return Boolean(matchFenceOpen(text) || matchHeading(text));
	// TODO: add blockquote and list item matchers (Tasks 5-6)
}

// ── Utilities ───────────────────────────────────────────────────────────────

function isBlankLine(text: string): boolean {
	return text.trim().length === 0;
}

function joinRaw(lines: ParsedLine[], startIndex: number, endIndex: number): string {
	let result = '';
	for (let i = startIndex; i < endIndex; i++) {
		result += lines[i].raw;
	}
	return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:editor
```

Expected: All round-trip tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/core/parser.ts src/lib/editor/test/serializer.test.ts
git commit -m "feat(editor): add parser for leaf blocks with round-trip tests"
```

---

## Task 5: Parser — Blockquote Container

**Files:**

- Modify: `src/lib/editor/core/parser.ts` (add blockquote parsing)
- Modify: `src/lib/editor/test/serializer.test.ts` (add blockquote round-trip tests)

- [ ] **Step 1: Write failing round-trip tests for blockquotes**

Add to `src/lib/editor/test/serializer.test.ts`:

````ts
describe('round-trip: blockquotes', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'simple blockquote', source: '> Hello\n' },
		{ name: 'multi-line blockquote', source: '> Line 1\n> Line 2\n' },
		{ name: 'blockquote with heading', source: '> # Title\n' },
		{ name: 'blockquote with paragraph', source: '> Some text\n> continues here.\n' },
		{ name: 'blockquote then paragraph', source: '> Quote\n\nParagraph.\n' },
		{ name: 'nested blockquote', source: '> > Nested\n' },
		{ name: 'blockquote with blank inner line', source: '> \n> Content\n' },
		{ name: 'blockquote with code block', source: '> ```\n> code\n> ```\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});
````

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:editor
```

Expected: Blockquote tests FAIL (parsed as paragraphs — still round-trip, but testing structure matters in Task 7).

Note: some of these may actually pass since paragraphs also round-trip. The key is that we need blockquote-specific parsing for correct tree structure. Add a structural assertion to at least one test:

```ts
it('parses blockquote as Blockquote node', () => {
	const doc = parse('> Hello\n');
	expect(doc.children[0].kind).toBe('blockquote');
});
```

- [ ] **Step 3: Add blockquote parsing to parser.ts**

Add these functions to `src/lib/editor/core/parser.ts` and wire them into `parseNextBlock` and `startsNewBlock`:

In `parseNextBlock`, add before the fallback paragraph case:

```ts
// Blockquote
const bq = matchBlockquote(line.text);
if (bq) {
	return parseBlockquote(lines, startIndex, endIndex, leadingTrivia);
}
```

In `startsNewBlock`, add `matchBlockquote(text)` to the check.

Add the matcher and parser functions:

```ts
function matchBlockquote(text: string): boolean {
	return /^ {0,3}>/.test(text);
}

function parseBlockquote(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: Blockquote; nextIndex: number } {
	// Collect continuation lines
	let i = startIndex;
	while (i < endIndex && matchBlockquote(lines[i].text)) {
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);

	// Strip `> ` prefix from each line for recursive parse
	const strippedLines = lines.slice(startIndex, i).map((line) => {
		const stripped = line.text.replace(/^ {0,3}>[ \t]?/, '');
		const lineEnding = line.lineEnding;
		return {
			raw: stripped + lineEnding,
			text: stripped,
			lineEnding,
			start: 0,
			end: stripped.length + lineEnding.length
		} as ParsedLine;
	});

	// Recompute start offsets for stripped lines
	let offset = 0;
	for (const sl of strippedLines) {
		sl.start = offset;
		sl.end = offset + sl.raw.length;
		offset = sl.end;
	}

	const inner = parseBlocks(strippedLines, 0, strippedLines.length, true);

	// Count max quote depth
	const quoteDepth =
		lines[startIndex].text
			.match(/^ {0,3}(>[ \t]?)+/)?.[0]
			.split('')
			.filter((c) => c === '>').length ?? 1;

	return {
		node: new Blockquote(leadingTrivia, raw, inner.prefix, inner.children, inner.suffix, {
			quoteDepth
		}),
		nextIndex: i
	};
}
```

Add the `Blockquote` import at the top of `parser.ts`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:editor
```

Expected: All blockquote + previous tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/core/parser.ts src/lib/editor/test/serializer.test.ts
git commit -m "feat(editor): add blockquote parsing with recursive children"
```

---

## Task 6: Parser — List / ListItem Container

**Files:**

- Modify: `src/lib/editor/core/parser.ts` (add list parsing)
- Modify: `src/lib/editor/test/serializer.test.ts` (add list round-trip tests)

This is the most complex parser addition. List items are containers. Multiple consecutive list items of the same type form a `List` node.

- [ ] **Step 1: Write failing round-trip tests for lists**

Add to `src/lib/editor/test/serializer.test.ts`. First, add `List, ListItem` to the import from `"../core/nodes"` at the top of the file. Then add these test blocks:

```ts
describe('round-trip: lists', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'unordered single item', source: '- Item\n' },
		{ name: 'unordered multiple items', source: '- A\n- B\n- C\n' },
		{ name: 'ordered list', source: '1. First\n2. Second\n' },
		{ name: 'ordered with paren', source: '1) A\n2) B\n' },
		{ name: 'task list', source: '- [ ] Todo\n- [x] Done\n' },
		{ name: 'plus marker', source: '+ Item\n' },
		{ name: 'star marker', source: '* Item\n' },
		{ name: 'list then paragraph', source: '- Item\n\nParagraph.\n' },
		{ name: 'multi-digit ordered', source: '10. Tenth\n11. Eleventh\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});
```

Plus a structural test:

```ts
it('parses list as List node with ListItem children', () => {
	const doc = parse('- A\n- B\n');
	expect(doc.children[0].kind).toBe('list');
	const list = doc.children[0] as List;
	expect(list.children.length).toBe(2);
	expect(list.children[0].kind).toBe('listItem');
	expect(list.children[1].kind).toBe('listItem');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:editor
```

Expected: List structural test FAILS.

- [ ] **Step 3: Add list/listItem parsing to parser.ts**

In `parseNextBlock`, add before the fallback paragraph case (after blockquote):

```ts
// List item
const listItem = matchListItem(line.text);
if (listItem) {
	return parseList(lines, startIndex, endIndex, leadingTrivia);
}
```

In `startsNewBlock`, add `matchListItem(text)` to the check.

Add the matcher and parser functions:

```ts
export function matchListItem(
	text: string
): { marker: string; ordered: boolean; indent: number } | null {
	const m = text.match(/^( {0,3})([-*+])\s+/);
	if (m) {
		return {
			marker: m[2],
			ordered: false,
			indent: m[0].length
		};
	}

	const om = text.match(/^( {0,3})(\d{1,9}[.)])\s+/);
	if (om) {
		return {
			marker: om[2],
			ordered: true,
			indent: om[0].length
		};
	}

	return null;
}

function matchTaskCheckbox(text: string): { checked: boolean } | null {
	const m = text.match(/^\[( |x|X)\]\s+/);
	return m ? { checked: m[1].toLowerCase() === 'x' } : null;
}

function parseList(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: List; nextIndex: number } {
	const firstMatch = matchListItem(lines[startIndex].text)!;
	const ordered = firstMatch.ordered;
	const items: ListItem[] = [];
	let i = startIndex;

	while (i < endIndex) {
		const itemMatch = matchListItem(lines[i].text);
		if (!itemMatch || itemMatch.ordered !== ordered) break;

		// This list item is a single line for now (simple v1 — single-line items)
		const itemLine = lines[i];
		const contentText = itemLine.text.slice(itemMatch.indent);
		const task = matchTaskCheckbox(contentText);

		// For v1, list items contain a single paragraph child with the content
		const innerText = task
			? contentText.slice(contentText.match(/^\[.\]\s+/)![0].length)
			: contentText;

		const innerParagraph =
			innerText.length > 0 ? [new Paragraph('', innerText + itemLine.lineEnding)] : [];

		const itemTrivia = items.length === 0 ? '' : '';

		items.push(
			new ListItem(itemTrivia, itemLine.raw, '', innerParagraph, '', {
				marker: itemMatch.marker,
				taskItem: task !== null,
				taskChecked: task?.checked ?? false
			})
		);
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);

	return {
		node: new List(leadingTrivia, raw, '', items, '', { ordered }),
		nextIndex: i
	};
}
```

Add the `List`, `ListItem` imports at the top of `parser.ts`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:editor
```

Expected: All list + previous tests PASS.

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
npm run test:editor
```

Expected: ALL tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/editor/core/parser.ts src/lib/editor/test/serializer.test.ts
git commit -m "feat(editor): add list/listItem parsing with single-line items"
```

---

## Task 7: Metadata Extraction Tests

**Files:**

- Create: `src/lib/editor/test/parser-metadata.test.ts`

Tier 2 tests — verify the parser identifies correct block kinds and metadata.

- [ ] **Step 1: Write the metadata tests**

Create `src/lib/editor/test/parser-metadata.test.ts`:

`````ts
import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import type { Heading, FencedCode, ThematicBreak, Blockquote, List, ListItem } from '../core/nodes';

describe('metadata: headings', () => {
	it('extracts heading levels 1-6', () => {
		for (let level = 1; level <= 6; level++) {
			const doc = parse(`${'#'.repeat(level)} Title\n`);
			const node = doc.children[0] as Heading;
			expect(node.kind).toBe('heading');
			expect(node.metadata.level).toBe(level);
		}
	});

	it('handles indented heading', () => {
		const doc = parse('  ## Title\n');
		const node = doc.children[0] as Heading;
		expect(node.kind).toBe('heading');
		expect(node.metadata.level).toBe(2);
	});
});

describe('metadata: fenced code', () => {
	it('extracts backtick fence info', () => {
		const doc = parse('```typescript\ncode\n```\n');
		const node = doc.children[0] as FencedCode;
		expect(node.kind).toBe('fencedCode');
		expect(node.metadata.fenceMarker).toBe('`');
		expect(node.metadata.fenceLength).toBe(3);
		expect(node.metadata.info).toBe('typescript');
		expect(node.metadata.closed).toBe(true);
	});

	it('extracts tilde fence', () => {
		const doc = parse('~~~~\ncode\n~~~~\n');
		const node = doc.children[0] as FencedCode;
		expect(node.metadata.fenceMarker).toBe('~');
		expect(node.metadata.fenceLength).toBe(4);
		expect(node.metadata.closed).toBe(true);
	});

	it('detects unclosed fence', () => {
		const doc = parse('```\ncode\n');
		const node = doc.children[0] as FencedCode;
		expect(node.metadata.closed).toBe(false);
	});

	it('requires close fence to have at least as many chars', () => {
		// 4 backtick open, 3 backtick line inside is NOT a close
		const doc = parse('````\n```\ncode\n````\n');
		const node = doc.children[0] as FencedCode;
		expect(node.metadata.closed).toBe(true);
		expect(node.metadata.fenceLength).toBe(4);
	});
});

describe('metadata: thematic breaks', () => {
	it('identifies dash marker', () => {
		const doc = parse('---\n');
		const node = doc.children[0] as ThematicBreak;
		expect(node.kind).toBe('thematicBreak');
		expect(node.metadata.marker).toBe('-');
	});

	it('identifies asterisk marker', () => {
		const doc = parse('***\n');
		const node = doc.children[0] as ThematicBreak;
		expect(node.metadata.marker).toBe('*');
	});

	it('identifies underscore marker', () => {
		const doc = parse('___\n');
		const node = doc.children[0] as ThematicBreak;
		expect(node.metadata.marker).toBe('_');
	});

	it('does not parse --- after paragraph as thematic break', () => {
		const doc = parse('Title\n---\n');
		// Should be a single paragraph (or unrecognized), not paragraph + thematic break
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).not.toBe('thematicBreak');
	});
});

describe('metadata: blockquotes', () => {
	it('extracts quote depth', () => {
		const doc = parse('> Hello\n');
		const node = doc.children[0] as Blockquote;
		expect(node.kind).toBe('blockquote');
		expect(node.metadata.quoteDepth).toBe(1);
	});

	it('has children', () => {
		const doc = parse('> # Title\n');
		const node = doc.children[0] as Blockquote;
		expect(node.children.length).toBeGreaterThan(0);
		expect(node.children[0].kind).toBe('heading');
	});
});

describe('metadata: lists', () => {
	it('identifies unordered list', () => {
		const doc = parse('- A\n- B\n');
		const node = doc.children[0] as List;
		expect(node.kind).toBe('list');
		expect(node.metadata.ordered).toBe(false);
	});

	it('identifies ordered list', () => {
		const doc = parse('1. A\n2. B\n');
		const node = doc.children[0] as List;
		expect(node.metadata.ordered).toBe(true);
	});

	it('identifies task items', () => {
		const doc = parse('- [ ] Todo\n- [x] Done\n');
		const list = doc.children[0] as List;
		const items = list.children as ListItem[];
		expect(items[0].metadata.taskItem).toBe(true);
		expect(items[0].metadata.taskChecked).toBe(false);
		expect(items[1].metadata.taskItem).toBe(true);
		expect(items[1].metadata.taskChecked).toBe(true);
	});

	it('extracts list item markers', () => {
		const doc = parse('+ Item\n');
		const list = doc.children[0] as List;
		expect(list.children[0].metadata.marker).toBe('+');
	});
});
`````

- [ ] **Step 2: Run tests**

```bash
npm run test:editor
```

Expected: All PASS (parser already extracts this metadata from Tasks 4-6).

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/test/parser-metadata.test.ts
git commit -m "test(editor): add metadata extraction tests for all block types"
```

---

## Task 8: Unrecognized Block / Deferred GFM Tests

**Files:**

- Create: `src/lib/editor/test/unrecognized.test.ts`

Tier 3 tests — verify that deferred GFM syntax round-trips without loss.

- [ ] **Step 1: Write the tests**

Create `src/lib/editor/test/unrecognized.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';

describe('deferred GFM syntax round-trips without loss', () => {
	const cases: { name: string; source: string }[] = [
		{
			name: 'table',
			source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n'
		},
		{
			name: 'HTML block',
			source: '<div>\n  <p>Hello</p>\n</div>\n'
		},
		{
			name: 'indented code block',
			source: '    code line 1\n    code line 2\n'
		},
		{
			name: 'link reference definition',
			source: '[ref]: https://example.com "Title"\n'
		},
		{
			name: 'setext heading H1',
			source: 'Title\n===\n'
		},
		{
			name: 'setext heading H2',
			source: 'Title\n---\n'
		},
		{
			name: 'mixed with supported blocks',
			source: '# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nParagraph.\n'
		},
		{
			name: 'footnote syntax',
			source: 'Text[^1].\n\n[^1]: Footnote content.\n'
		}
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test:editor
```

Expected: All PASS — unrecognized syntax falls through to `Paragraph` or `UnrecognizedBlock` but round-trips via `raw`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/test/unrecognized.test.ts
git commit -m "test(editor): add round-trip tests for deferred GFM syntax"
```

---

## Task 9: Barrel Export

**Files:**

- Create: `src/lib/editor/index.ts`

Public API surface for the editor module.

- [ ] **Step 1: Create the barrel export**

Create `src/lib/editor/index.ts`:

```ts
export { parse } from './core/parser';
export { serialize } from './core/serializer';
export {
	Document,
	CstNode,
	LeafBlock,
	ContainerBlock,
	Heading,
	Paragraph,
	FencedCode,
	ThematicBreak,
	UnrecognizedBlock,
	Blockquote,
	List,
	ListItem
} from './core/nodes';
export type {
	BlockKind,
	LeafBlockKind,
	ContainerBlockKind,
	HeadingMetadata,
	FencedCodeMetadata,
	ThematicBreakMetadata,
	BlockquoteMetadata,
	ListMetadata,
	ListItemMetadata
} from './core/nodes';
```

- [ ] **Step 2: Verify all tests still pass**

```bash
npm run test:editor
```

Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/index.ts
git commit -m "feat(editor): add barrel export for CST module"
```
