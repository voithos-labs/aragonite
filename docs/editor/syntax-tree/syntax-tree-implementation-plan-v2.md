# GFM CST Phase 1 v2: Deferred Block Types

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 5 deferred block types (setext headings, indented code blocks, HTML blocks, link reference definitions, tables) to the GFM CST, graduating them from paragraph fallback to their own typed nodes.

**Architecture:** Each block type follows the same pattern: add a node class to `nodes.ts`, add a matcher + parser function to `parser.ts`, wire it into `parseNextBlock` at the correct priority, update exports. Round-trip is preserved because each node still stores raw source. Existing tests must not break — the `unrecognized.test.ts` cases will shift from "parsed as paragraph" to "parsed as correct type" but still round-trip.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/editor/syntax-tree.md` (v2 — Deferred Block Types section)

---

## File Structure

```
src/lib/editor/
├── core/
│   ├── nodes.ts          # Add: SetextHeading, IndentedCode, HtmlBlock, LinkReferenceDefinition, Table
│   ├── parser.ts         # Add: matchers + parsers for each new block type
│   └── serializer.ts     # No changes (serialize uses raw)
├── test/
│   ├── serializer.test.ts       # Add: round-trip tests for each new block type
│   ├── parser-metadata.test.ts  # Add: metadata extraction for new types
│   └── unrecognized.test.ts     # Update: deferred types now parse as their own kind
├── index.ts              # Add: new exports
```

---

## Task 0: Setext Headings

Setext headings are paragraphs followed by an underline of `===` (level 1) or `---` (level 2). This is the trickiest new type because `---` after a paragraph is currently absorbed as a paragraph (the setext/thematic-break guard from v1). Now we properly recognize it.

**Files:**

- Modify: `src/lib/editor/core/nodes.ts`
- Modify: `src/lib/editor/core/parser.ts`
- Modify: `src/lib/editor/test/serializer.test.ts`
- Modify: `src/lib/editor/test/parser-metadata.test.ts`
- Modify: `src/lib/editor/test/unrecognized.test.ts`

- [ ] **Step 1: Write failing round-trip tests**

Add to `src/lib/editor/test/serializer.test.ts`:

```ts
describe('round-trip: setext headings', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'setext H1', source: 'Title\n===\n' },
		{ name: 'setext H2', source: 'Title\n---\n' },
		{ name: 'setext H1 long underline', source: 'Title\n==========\n' },
		{ name: 'setext H2 short underline', source: 'Title\n--\n' },
		{ name: 'setext with multi-line content', source: 'Line one\nLine two\n---\n' },
		{ name: 'setext then paragraph', source: 'Title\n===\n\nBody text.\n' },
		{ name: 'setext H1 after blank lines', source: '\nTitle\n===\n' },
		{ name: 'setext H2 trailing space on underline', source: 'Title\n--- \n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:editor
```

Expected: Tests pass (setext is already absorbed into paragraph which round-trips). But add a structural assertion that WILL fail:

```ts
it('parses setext H1 as SetextHeading node', () => {
	const doc = parse('Title\n===\n');
	expect(doc.children[0].kind).toBe('setextHeading');
});
```

- [ ] **Step 3: Add SetextHeading node to nodes.ts**

Add to `LeafBlockKind`:

```ts
export type LeafBlockKind = 'heading' | 'setextHeading' | 'paragraph';
// ... rest
```

Add metadata interface:

```ts
export interface SetextHeadingMetadata {
	level: 1 | 2;
}
```

Add class:

```ts
export class SetextHeading extends LeafBlock {
	readonly kind = 'setextHeading' as const;
	readonly metadata: SetextHeadingMetadata;

	constructor(leadingTrivia: string, raw: string, metadata: SetextHeadingMetadata) {
		super(leadingTrivia, raw);
		this.metadata = metadata;
	}
}
```

- [ ] **Step 4: Add setext parsing to parser.ts**

Import `SetextHeading` at the top.

The key insight: setext headings can't be detected from a single line — you need to look ahead. The setext underline (`===` or `---`) only has meaning when it follows non-blank paragraph lines. The current parser already absorbs `---` after a paragraph into a single paragraph (the v1 setext guard). Now we need to detect this pattern and emit a `SetextHeading` instead.

Replace the thematic break guard and paragraph fallback logic. In `parseParagraph`, after collecting continuation lines, check if the next line is a setext underline:

```ts
function parseParagraph(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: Paragraph | SetextHeading; nextIndex: number } {
	let i = startIndex + 1;

	while (i < endIndex && !isBlankLine(lines[i].text) && !startsNewBlock(lines[i].text)) {
		// Check if this line is a setext underline for the paragraph above
		const setext = matchSetextUnderline(lines[i].text);
		if (setext) {
			const raw = joinRaw(lines, startIndex, i + 1);
			return {
				node: new SetextHeading(leadingTrivia, raw, { level: setext.level }),
				nextIndex: i + 1
			};
		}
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: new Paragraph(leadingTrivia, raw),
		nextIndex: i
	};
}
```

Add the matcher:

```ts
function matchSetextUnderline(text: string): { level: 1 | 2 } | null {
	if (/^ {0,3}=+\s*$/.test(text)) return { level: 1 };
	if (/^ {0,3}-+\s*$/.test(text)) return { level: 2 };
	return null;
}
```

Now remove the thematic break `---` guard from `parseNextBlock`. With setext properly detected, `---` after a paragraph becomes a setext H2, and `---` after a blank line remains a thematic break. Change the thematic break condition back to just:

```ts
const thematic = matchThematicBreak(line.text);
if (thematic) {
	return {
		node: new ThematicBreak(leadingTrivia, line.raw, { marker: thematic }),
		nextIndex: startIndex + 1
	};
}
```

This works because: if `---` follows paragraph text, `parseParagraph` catches it as setext first. If `---` appears at block level (after blank line or at document start), `parseNextBlock` sees it as a thematic break. The priority order handles the ambiguity naturally.

Also remove the now-dead `atDocumentStart` parameter from `parseNextBlock` since the thematic break check no longer uses it. Update `parseBlocks` to stop passing `children.length === 0`.

Also update the existing test at `src/lib/editor/test/parser-metadata.test.ts` in the `'metadata: thematic breaks'` describe block. The test `'does not parse --- after paragraph as thematic break'` currently asserts `kind !== 'thematicBreak'` and `children.length === 1` — it was written expecting a `Paragraph`. Now `Title\n---\n` is a `SetextHeading`. Update it to:

```ts
it('parses --- after paragraph as setext H2, not thematic break', () => {
	const doc = parse('Title\n---\n');
	expect(doc.children.length).toBe(1);
	expect(doc.children[0].kind).toBe('setextHeading');
});
```

- [ ] **Step 5: Run tests**

```bash
npm run test:editor
```

Expected: All tests pass, including the new setext structural assertion. Verify existing thematic break and setext round-trip tests in `unrecognized.test.ts` still pass.

- [ ] **Step 6: Add metadata tests**

Add to `src/lib/editor/test/parser-metadata.test.ts`:

```ts
describe('metadata: setext headings', () => {
	it('identifies setext H1 with ===', () => {
		const doc = parse('Title\n===\n');
		const node = doc.children[0] as SetextHeading;
		expect(node.kind).toBe('setextHeading');
		expect(node.metadata.level).toBe(1);
	});

	it('identifies setext H2 with ---', () => {
		const doc = parse('Title\n---\n');
		const node = doc.children[0] as SetextHeading;
		expect(node.kind).toBe('setextHeading');
		expect(node.metadata.level).toBe(2);
	});
});
```

Import `SetextHeading` type in the test file.

- [ ] **Step 7: Update unrecognized.test.ts**

Remove the `'setext heading H1'` and `'setext heading H2'` cases from the deferred syntax test — they're now properly recognized.

- [ ] **Step 8: Update barrel export**

Add `SetextHeading` and `SetextHeadingMetadata` to `src/lib/editor/index.ts`.

- [ ] **Step 9: Run full test suite**

```bash
npm run test:editor
```

Expected: ALL tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/editor/
git commit -m "+ (editor) setext heading parsing"
```

---

## Task 1: Indented Code Blocks

Lines indented by 4+ spaces (or 1+ tab) that aren't inside a list item form an indented code block. These are currently absorbed into paragraphs.

**Files:**

- Modify: `src/lib/editor/core/nodes.ts`
- Modify: `src/lib/editor/core/parser.ts`
- Modify: `src/lib/editor/test/serializer.test.ts`
- Modify: `src/lib/editor/test/parser-metadata.test.ts`
- Modify: `src/lib/editor/test/unrecognized.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/lib/editor/test/serializer.test.ts`:

```ts
describe('round-trip: indented code blocks', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'single line', source: '    code line\n' },
		{ name: 'multiple lines', source: '    line 1\n    line 2\n' },
		{ name: 'tab indented', source: '\tcode line\n' },
		{ name: 'mixed indent', source: '    line 1\n\tline 2\n' },
		{ name: 'with blank line inside', source: '    line 1\n\n    line 2\n' },
		{ name: 'after paragraph', source: 'Paragraph.\n\n    code\n' },
		{ name: 'before paragraph', source: '    code\n\nParagraph.\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});
```

Plus structural test:

```ts
it('parses indented code as IndentedCode node', () => {
	const doc = parse('    code\n');
	expect(doc.children[0].kind).toBe('indentedCode');
});
```

- [ ] **Step 2: Run tests — structural test fails**

```bash
npm run test:editor
```

- [ ] **Step 3: Add IndentedCode node to nodes.ts**

Add `'indentedCode'` to `LeafBlockKind`.

```ts
export class IndentedCode extends LeafBlock {
	readonly kind = 'indentedCode' as const;

	constructor(leadingTrivia: string, raw: string) {
		super(leadingTrivia, raw);
	}
}
```

No metadata needed — indented code blocks have no configurable properties.

- [ ] **Step 4: Add indented code parsing to parser.ts**

Import `IndentedCode`.

Add matcher:

```ts
function matchIndentedCode(text: string): boolean {
	return /^(?: {4}|\t)/.test(text);
}
```

Add parser — indented code continues through blank lines as long as the next non-blank line is also indented:

```ts
function parseIndentedCode(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: IndentedCode; nextIndex: number } {
	let i = startIndex;

	while (i < endIndex) {
		if (matchIndentedCode(lines[i].text)) {
			i++;
		} else if (isBlankLine(lines[i].text)) {
			// Blank lines inside indented code are kept if followed by more indented lines
			let j = i + 1;
			while (j < endIndex && isBlankLine(lines[j].text)) j++;
			if (j < endIndex && matchIndentedCode(lines[j].text)) {
				i = j;
			} else {
				break;
			}
		} else {
			break;
		}
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: new IndentedCode(leadingTrivia, raw),
		nextIndex: i
	};
}
```

Wire into `parseNextBlock` — add **after** the list item check but **before** the paragraph fallback. Guard with `leadingTrivia` check because GFM spec says indented code blocks cannot interrupt a paragraph:

```ts
// Indented code block — only after a blank line (cannot interrupt a paragraph per GFM spec 4.4)
if (matchIndentedCode(line.text) && leadingTrivia.length > 0) {
	return parseIndentedCode(lines, startIndex, endIndex, leadingTrivia);
}
```

Do **NOT** add `matchIndentedCode` to `startsNewBlock` — an indented line inside a paragraph is a continuation, not a new block. Add a test to verify this:

```ts
it('indented continuation stays inside paragraph', () => {
	const doc = parse('Paragraph\n    indented line\n');
	expect(doc.children.length).toBe(1);
	expect(doc.children[0].kind).toBe('paragraph');
});
```

- [ ] **Step 5: Run tests**

```bash
npm run test:editor
```

Expected: All pass.

- [ ] **Step 6: Update unrecognized.test.ts**

Remove the `'indented code block'` case from the deferred syntax test.

- [ ] **Step 7: Update barrel export**

Add `IndentedCode` to `src/lib/editor/index.ts`.

- [ ] **Step 8: Run full suite and commit**

```bash
npm run test:editor
git add src/lib/editor/
git commit -m "+ (editor) indented code block parsing"
```

---

## Task 2: HTML Blocks

HTML blocks start with specific opening patterns (e.g., `<div`, `<table`, `<pre`, `<!--`, etc.) and continue until a specific closing condition or blank line. For the CST, we don't need to parse the HTML — just recognize the boundaries.

**Files:**

- Modify: `src/lib/editor/core/nodes.ts`
- Modify: `src/lib/editor/core/parser.ts`
- Modify: `src/lib/editor/test/serializer.test.ts`
- Modify: `src/lib/editor/test/unrecognized.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/lib/editor/test/serializer.test.ts`:

```ts
describe('round-trip: HTML blocks', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'div block', source: '<div>\n  <p>Hello</p>\n</div>\n' },
		{ name: 'comment', source: '<!-- comment -->\n' },
		{ name: 'multiline comment', source: '<!--\n  comment\n-->\n' },
		{ name: 'pre block', source: '<pre>\ncode\n</pre>\n' },
		{ name: 'script block', source: '<script>\nalert(1);\n</script>\n' },
		{ name: 'self-closing', source: '<hr />\n' },
		{ name: 'html then paragraph', source: '<div>\nHello\n</div>\n\nParagraph.\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

	it('parses HTML as HtmlBlock node', () => {
		const doc = parse('<div>\nHello\n</div>\n');
		expect(doc.children[0].kind).toBe('htmlBlock');
	});
});
```

- [ ] **Step 2: Run tests — structural test fails**

```bash
npm run test:editor
```

- [ ] **Step 3: Add HtmlBlock node to nodes.ts**

Add `'htmlBlock'` to `LeafBlockKind`.

```ts
export class HtmlBlock extends LeafBlock {
	readonly kind = 'htmlBlock' as const;

	constructor(leadingTrivia: string, raw: string) {
		super(leadingTrivia, raw);
	}
}
```

- [ ] **Step 4: Add HTML block parsing to parser.ts**

Import `HtmlBlock`.

Add matcher — CommonMark defines 7 types of HTML block openers. For the CST we use a simplified approach: any line starting with `<` followed by a known block-level tag name, or `<!--`, or `<?`, or `<!`:

```ts
const HTML_BLOCK_OPEN =
	/^ {0,3}(?:<(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|pre|script|section|source|style|summary|table|tbody|td|template|tfoot|th|thead|title|tr|track|ul)[\s/>]|<!--|<\?|<![A-Z]|<!\[CDATA\[)/i;

function matchHtmlBlock(text: string): boolean {
	return HTML_BLOCK_OPEN.test(text);
}
```

Add parser — simplified: HTML blocks continue until a blank line. This is correct for CommonMark types 6-7 but a simplification for types 1-5 (e.g., `<pre>` blocks with internal blank lines will be split). This is acceptable for Phase 1 — round-trip is preserved regardless since raw source is stored. Full type-specific termination can be added later if needed:

```ts
function parseHtmlBlock(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: HtmlBlock; nextIndex: number } {
	let i = startIndex + 1;

	while (i < endIndex && !isBlankLine(lines[i].text)) {
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: new HtmlBlock(leadingTrivia, raw),
		nextIndex: i
	};
}
```

Wire into `parseNextBlock` — add **before** the paragraph fallback, after indented code:

```ts
// HTML block
if (matchHtmlBlock(line.text)) {
	return parseHtmlBlock(lines, startIndex, endIndex, leadingTrivia);
}
```

- [ ] **Step 5: Run tests**

```bash
npm run test:editor
```

Expected: All pass.

- [ ] **Step 6: Update unrecognized.test.ts**

Remove the `'HTML block'` case from the deferred syntax test.

- [ ] **Step 7: Update barrel export and commit**

```bash
npm run test:editor
git add src/lib/editor/
git commit -m "+ (editor) HTML block parsing"
```

---

## Task 3: Link Reference Definitions

Link reference definitions look like `[label]: url "title"`. They're leaf blocks that don't render content but define references used by links elsewhere. For the CST, we just recognize and tag them.

**Files:**

- Modify: `src/lib/editor/core/nodes.ts`
- Modify: `src/lib/editor/core/parser.ts`
- Modify: `src/lib/editor/test/serializer.test.ts`
- Modify: `src/lib/editor/test/parser-metadata.test.ts`
- Modify: `src/lib/editor/test/unrecognized.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/lib/editor/test/serializer.test.ts`:

```ts
describe('round-trip: link reference definitions', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'basic', source: '[ref]: https://example.com\n' },
		{ name: 'with title double quotes', source: '[ref]: https://example.com "Title"\n' },
		{ name: 'with title single quotes', source: "[ref]: https://example.com 'Title'\n" },
		{ name: 'with title parens', source: '[ref]: https://example.com (Title)\n' },
		{ name: 'with angle bracket url', source: '[ref]: <https://example.com>\n' },
		{ name: 'multi-word label', source: '[my ref]: https://example.com\n' },
		{ name: 'after paragraph', source: 'Paragraph.\n\n[ref]: https://example.com\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

	it('parses link ref def as LinkReferenceDefinition node', () => {
		const doc = parse('[ref]: https://example.com\n');
		expect(doc.children[0].kind).toBe('linkReferenceDefinition');
	});
});
```

- [ ] **Step 2: Run tests — structural test fails**

```bash
npm run test:editor
```

- [ ] **Step 3: Add LinkReferenceDefinition node to nodes.ts**

Add `'linkReferenceDefinition'` to `LeafBlockKind`.

Add metadata:

```ts
export interface LinkReferenceDefinitionMetadata {
	label: string;
}
```

Add class:

```ts
export class LinkReferenceDefinition extends LeafBlock {
	readonly kind = 'linkReferenceDefinition' as const;
	readonly metadata: LinkReferenceDefinitionMetadata;

	constructor(leadingTrivia: string, raw: string, metadata: LinkReferenceDefinitionMetadata) {
		super(leadingTrivia, raw);
		this.metadata = metadata;
	}
}
```

- [ ] **Step 4: Add link ref def parsing to parser.ts**

Import `LinkReferenceDefinition`.

Add matcher — exclude `^`-prefixed labels since those are footnote syntax, not link refs:

```ts
function matchLinkReferenceDefinition(text: string): { label: string } | null {
	const m = text.match(/^ {0,3}\[([^\]]+)\]:\s+/);
	if (!m || m[1].startsWith('^')) return null;
	return { label: m[1] };
}
```

Link reference definitions are single-line (the title can span lines in CommonMark, but for v2 simplicity we treat them as single-line blocks — multi-line title support can be added later if needed).

Wire into `parseNextBlock` — add **before** the paragraph fallback, after HTML block:

```ts
// Link reference definition
const linkRef = matchLinkReferenceDefinition(line.text);
if (linkRef) {
	return {
		node: new LinkReferenceDefinition(leadingTrivia, line.raw, { label: linkRef.label }),
		nextIndex: startIndex + 1
	};
}
```

- [ ] **Step 5: Run tests**

```bash
npm run test:editor
```

Expected: All pass.

- [ ] **Step 6: Add metadata test**

Add to `src/lib/editor/test/parser-metadata.test.ts`:

```ts
describe('metadata: link reference definitions', () => {
	it('extracts label', () => {
		const doc = parse('[my-ref]: https://example.com\n');
		const node = doc.children[0] as LinkReferenceDefinition;
		expect(node.kind).toBe('linkReferenceDefinition');
		expect(node.metadata.label).toBe('my-ref');
	});
});
```

Import `LinkReferenceDefinition` type.

- [ ] **Step 7: Update unrecognized.test.ts**

Remove the `'link reference definition'` case.

- [ ] **Step 8: Update barrel export and commit**

```bash
npm run test:editor
git add src/lib/editor/
git commit -m "+ (editor) link reference definition parsing"
```

---

## Task 4: Tables

GFM tables use pipe syntax with a required delimiter row. A table starts with a header row, followed by a delimiter row (`| --- | --- |`), followed by zero or more data rows. For the CST, we recognize the boundary — we don't parse individual cells.

**Files:**

- Modify: `src/lib/editor/core/nodes.ts`
- Modify: `src/lib/editor/core/parser.ts`
- Modify: `src/lib/editor/test/serializer.test.ts`
- Modify: `src/lib/editor/test/parser-metadata.test.ts`
- Modify: `src/lib/editor/test/unrecognized.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/lib/editor/test/serializer.test.ts`:

```ts
describe('round-trip: tables', () => {
	const cases: { name: string; source: string }[] = [
		{ name: 'simple table', source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n' },
		{
			name: 'aligned columns',
			source: '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n'
		},
		{ name: 'header only', source: '| A | B |\n| --- | --- |\n' },
		{ name: 'no leading pipe', source: 'A | B\n--- | ---\n1 | 2\n' },
		{ name: 'table then paragraph', source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nText.\n' },
		{ name: 'many rows', source: '| H |\n| --- |\n| 1 |\n| 2 |\n| 3 |\n' }
	];

	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}

	it('parses table as Table node', () => {
		const doc = parse('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		expect(doc.children[0].kind).toBe('table');
	});
});
```

- [ ] **Step 2: Run tests — structural test fails**

```bash
npm run test:editor
```

- [ ] **Step 3: Add Table node to nodes.ts**

Add `'table'` to `LeafBlockKind`.

Add metadata:

```ts
export interface TableMetadata {
	columnCount: number;
}
```

Add class:

```ts
export class Table extends LeafBlock {
	readonly kind = 'table' as const;
	readonly metadata: TableMetadata;

	constructor(leadingTrivia: string, raw: string, metadata: TableMetadata) {
		super(leadingTrivia, raw);
		this.metadata = metadata;
	}
}
```

- [ ] **Step 4: Add table parsing to parser.ts**

Import `Table`.

Tables require lookahead — the first line alone could be a paragraph. We need to see the delimiter row on line 2. Add a function that checks from inside `parseParagraph`:

```ts
function matchTableDelimiterRow(text: string): { columnCount: number } | null {
	// Must contain at least one | and consist of |, -, :, and spaces
	const trimmed = text.trim();
	if (!trimmed.includes('|')) return null;

	// Strip leading/trailing pipes and split
	const inner = trimmed.replace(/^\||\|$/g, '');
	const cells = inner.split('|');

	// Each cell must match the delimiter pattern: optional spaces, optional colon, dashes, optional colon, optional spaces
	for (const cell of cells) {
		if (!/^\s*:?-+:?\s*$/.test(cell)) return null;
	}

	return { columnCount: cells.length };
}
```

**Replace `parseParagraph` entirely** — this is the final form of the function, superseding the version from Task 0. Delete the Task 0 version and paste this in its place. The table check is prepended before the setext lookahead loop:

```ts
function parseParagraph(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: Paragraph | SetextHeading | Table; nextIndex: number } {
	// Check for table: first line + delimiter on second line
	if (startIndex + 1 < endIndex) {
		const delimiter = matchTableDelimiterRow(lines[startIndex + 1].text);
		if (delimiter && lines[startIndex].text.includes('|')) {
			return parseTable(lines, startIndex, endIndex, leadingTrivia, delimiter.columnCount);
		}
	}

	let i = startIndex + 1;

	while (i < endIndex && !isBlankLine(lines[i].text) && !startsNewBlock(lines[i].text)) {
		const setext = matchSetextUnderline(lines[i].text);
		if (setext) {
			const raw = joinRaw(lines, startIndex, i + 1);
			return {
				node: new SetextHeading(leadingTrivia, raw, { level: setext.level }),
				nextIndex: i + 1
			};
		}
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: new Paragraph(leadingTrivia, raw),
		nextIndex: i
	};
}

function parseTable(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	columnCount: number
): { node: Table; nextIndex: number } {
	// Header row + delimiter row already confirmed, consume data rows
	let i = startIndex + 2;

	while (i < endIndex && !isBlankLine(lines[i].text) && lines[i].text.includes('|')) {
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: new Table(leadingTrivia, raw, { columnCount }),
		nextIndex: i
	};
}
```

- [ ] **Step 5: Run tests**

```bash
npm run test:editor
```

Expected: All pass.

- [ ] **Step 6: Add metadata test**

Add to `src/lib/editor/test/parser-metadata.test.ts`:

```ts
describe('metadata: tables', () => {
	it('extracts column count', () => {
		const doc = parse('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n');
		const node = doc.children[0] as Table;
		expect(node.kind).toBe('table');
		expect(node.metadata.columnCount).toBe(3);
	});
});
```

Import `Table` type.

- [ ] **Step 7: Update unrecognized.test.ts**

Remove the `'table'` case from the deferred syntax test. The `'mixed with supported blocks'` case that includes a table should now have the table parsed as a `Table` node — verify it still round-trips.

- [ ] **Step 8: Update barrel export and commit**

Add `Table`, `TableMetadata` to `src/lib/editor/index.ts`.

```bash
npm run test:editor
git add src/lib/editor/
git commit -m "+ (editor) GFM table parsing"
```

---

## Task 5: Final Cleanup

- [ ] **Step 1: Verify unrecognized.test.ts is updated**

After removing all 5 graduated block types, the remaining cases should be only those that are genuinely not GFM block types (footnotes) or that we haven't yet covered. Verify the file is coherent.

- [ ] **Step 2: Run full test suite**

```bash
npm run test:editor
```

Expected: ALL tests pass.

- [ ] **Step 3: Commit any remaining changes**

```bash
git add src/lib/editor/ docs/editor/
git commit -m "~ (editor) clean up unrecognized tests after v2 block graduation"
```
