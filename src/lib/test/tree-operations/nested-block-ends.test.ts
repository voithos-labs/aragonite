// @vitest-environment jsdom
// Where a nested block's bytes start and end in the document, as every reader of them answers:
// from the blank line above its container counted once, to one past its own last byte, never past
// the next line's marker or short of its own line ending. A new reader joins as a row of READERS.
import { describe, expect, it, vi } from 'vitest';
import type { Document } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { assignIds } from '#lib/block-id.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createGrammarView } from '#lib/schema/block-openers.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { documentByteMap } from '#lib/tree-operations/container-offsets.js';
import { measured, type Measured } from '#lib/tree-operations/top-level-starts.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import {
	blockRange,
	byteAt,
	captureChange,
	changeAfter,
	partLengths
} from '#lib/editor-actions/commit/change-record.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { gapAtByte } from '#lib/selection/range-bytes.js';
import type { GapCaretPosition } from '#lib/selection/gap-caret.js';
import { idleDraftRegistry } from '#lib/test/harness/drafts.js';
import { makeTopHarness, writeBytes } from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';

interface Shape {
	name: string;
	source: string;
	plugins?: boolean;
	/** Each nested block by its path, and the bytes it holds in the document. */
	held: [path: string, bytes: string][];
}

const SHAPES: Shape[] = [
	{
		name: 'a quote under a blank line',
		source: 'one\n\n> two\n>\n> three\n\nfour\n',
		held: [
			['1.0', 'two\n'],
			['1.1', 'three\n']
		]
	},
	{
		name: 'a quote first, its last child with no line ending',
		source: '> two\n>\n> three',
		held: [
			['0.0', 'two\n'],
			['0.1', 'three']
		]
	},
	{
		name: 'a quote in CRLF',
		source: 'one\r\n\r\n> two\r\n>\r\n> three\r\n\r\nfour\r\n',
		held: [
			['1.0', 'two\r\n'],
			['1.1', 'three\r\n']
		]
	},
	{
		name: 'list items under a blank line',
		source: 'one\n\n- ant\n- bee\n\nlast\n',
		held: [
			['1.0', '- ant\n'],
			['1.0.0', 'ant\n'],
			['1.1.0', 'bee\n']
		]
	},
	{
		name: 'list items in CRLF, the last with no line ending',
		source: 'one\r\n\r\n- ant\r\n- bee',
		held: [
			['1.0.0', 'ant\r\n'],
			['1.1.0', 'bee']
		]
	},
	{
		name: 'a nested list',
		source: '- a\n  - b\n  - c\n- d\n',
		held: [
			['0.0.0', 'a\n'],
			['0.0.1', '- b\n  - c\n'],
			['0.0.1.0.0', 'b\n'],
			['0.0.1.1.0', 'c\n']
		]
	},
	{
		name: 'a list in a quote',
		source: 'one\n\n> - a\n>   b\n>\n> c\n',
		held: [
			['1.0', '- a\n>   b\n'],
			['1.0.0.0', 'a\n>   b\n'],
			['1.1', 'c\n']
		]
	},
	{
		name: 'a callout',
		source: 'one\n\n> [!NOTE]\n> body\n>\n> ```\n> x\n> ```\n\nlast\n',
		plugins: true,
		held: [
			['1.0', 'body\n'],
			['1.1', '```\n> x\n> ```\n']
		]
	},
	{
		name: 'a titled container in a quote',
		source: 'one\n\n> <details>\n> <summary>S</summary>\n>\n> body\n>\n> </details>\n',
		plugins: true,
		held: [
			['1.0.0', 'S</summary>\n'],
			['1.0.1', 'body\n']
		]
	},
	{
		name: 'a table',
		source: 'one\n\n| a | b |\n| - | - |\n| c | d |\n',
		held: [
			['1.0', '| a | b |\n'],
			['1.0.0', 'a'],
			['1.1.1', 'd']
		]
	}
];

/** Every reader of a nested block's bytes, as `[from, to)` of the document. */
const READERS: [string, (laid: Measured, path: number[]) => (number | null)[] | null][] = [
	[
		'the byte map',
		(laid, path) => {
			const map = documentByteMap(laid);
			return [map.byteOf(path, 0), map.endOf(path, blockNodeAt(laid.doc, path)!.raw.length)];
		}
	],
	[
		'a layout block',
		(laid, path) => {
			const block = documentLayout(laid).block(path);
			return block ? [block.from, block.to] : null;
		}
	],
	[
		"a block draft's range",
		({ doc }, path) => {
			const range = blockRange(doc, path);
			const lengths = partLengths(doc);
			return range && [byteAt(lengths, range.from), byteAt(lengths, range.to)];
		}
	]
];

function opened(shape: Shape): Document {
	if (shape.plugins) installPlugins(SYNTAX_PLUGINS);
	return parse(shape.source);
}

const pathOf = (key: string) => key.split('.').map(Number);

/** Where `bytes` sit in `source`, which holds them once. */
function spanOf(source: string, bytes: string): [number, number] {
	const from = source.indexOf(bytes);
	expect(from, `${JSON.stringify(bytes)} once in the source`).toBe(source.lastIndexOf(bytes));
	return [from, from + bytes.length];
}

const ROWS = SHAPES.flatMap((shape) => shape.held.map(([path, bytes]) => ({ shape, path, bytes })));

// Miss-analysis: each reader's rows put the container first or its block last in the document,
// and no row read CRLF, so a blank line counted twice and an end off by a marker went unseen.
describe("a nested block's bytes", () => {
	for (const [reader, read] of READERS) {
		it.each(ROWS)(`${reader}: $shape.name, $path`, ({ shape, path, bytes }) => {
			const doc = opened(shape);
			expect(read(measured(doc), pathOf(path))).toEqual(spanOf(shape.source, bytes));
		});
	}
});

// Miss-analysis: every draft row opened on a top-level block, so a write to a nested block's first
// byte that left its draft fresh, or one to the next line's marker that staled it, went unseen.
describe('a draft on a nested block', () => {
	it.each(ROWS)('goes stale at a write to its own bytes only: $shape.name, $path', (row) => {
		const doc = opened(row.shape);
		const [from, to] = spanOf(row.shape.source, row.bytes);
		const at = { first: from, last: to - 1, before: from - 1, after: to };
		const stale = Object.fromEntries(
			Object.entries(at)
				.filter(([, byte]) => byte >= 0 && byte < row.shape.source.length)
				.map(([edge, byte]) => [
					edge,
					staleAfterWrite(doc, row.shape.source, pathOf(row.path), byte)
				])
		);
		expect(stale).toEqual({
			first: true,
			last: true,
			...('before' in stale && { before: false }),
			...('after' in stale && { after: false })
		});
	});
});

/** Whether a draft opened on the block at `path` goes stale once byte `at` is written over. */
function staleAfterWrite(doc: Document, source: string, path: number[], at: number): boolean {
	const live = { doc };
	const registry = idleDraftRegistry(undefined, () => live.doc);
	const draft = registry.open({ close: () => {} }, path);
	const capture = captureChange(live.doc, null);
	const other = source[at] === 'Z' ? 'Y' : 'Z';
	live.doc = parse(source.slice(0, at) + other + source.slice(at + 1));
	registry.record(changeAfter(live.doc, capture, null));
	return draft.stale;
}

// ── A gap caret's byte ───────────────────────────────────────────────────────

interface GapShape {
	name: string;
	source: string;
	plugins?: boolean;
	gap: GapCaretPosition;
	/** The bytes the boundary sits right behind. */
	after: string;
}

const GAPS: GapShape[] = [
	{
		name: 'after code that ends a top-level quote',
		source: '> ```\n> x\n> ```\n\nc\n',
		gap: { parentPath: [0], index: 1 },
		after: '> x\n> ```\n'
	},
	{
		name: 'after code that ends an item in a quote, at the document end',
		source: '> - a\n>   ```\n>   x\n>   ```\n',
		gap: { parentPath: [0, 0, 0], index: 2 },
		after: '>   x\n>   ```\n'
	},
	{
		name: 'after code that ends an item in a quote under a blank line',
		source: 'one\n\n> - a\n>   ```\n>   x\n>   ```\n',
		gap: { parentPath: [1, 0, 0], index: 2 },
		after: '>   x\n>   ```\n'
	},
	{
		name: 'after code that ends an item in a quote, a quote line below',
		source: '> - a\n>   ```\n>   x\n>   ```\n>\n> c\n',
		gap: { parentPath: [0, 0, 0], index: 2 },
		after: '>   x\n>   ```\n'
	},
	{
		name: 'after code that ends an item in a quote, in CRLF',
		source: '> - a\r\n>   ```\r\n>   x\r\n>   ```\r\n>\r\n> c\r\n',
		gap: { parentPath: [0, 0, 0], index: 2 },
		after: '>   x\r\n>   ```\r\n'
	},
	{
		name: 'between two code blocks in an item in a quote',
		source: '> - ```\n>   x\n>   ```\n>   ```\n>   y\n>   ```\n',
		gap: { parentPath: [0, 0, 0], index: 1 },
		after: 'x\n>   ```\n>   '
	},
	{
		// Its markers make the item's bytes longer in the document than its raw by more than a block.
		name: 'between code blocks in an item in a quote, the first one long',
		source:
			'> - ```\n>   1\n>   2\n>   3\n>   4\n>   5\n>   6\n>   ```\n' +
			'>   ```\n>   y\n>   ```\n>   ```\n>   z\n>   ```\n',
		gap: { parentPath: [0, 0, 0], index: 1 },
		after: '6\n>   ```\n>   '
	},
	{
		name: 'after code that ends a callout in a list item',
		source: '- a\n\n  > [!NOTE]\n  > ```\n  > x\n  > ```\n\n  c\n',
		plugins: true,
		gap: { parentPath: [0, 0, 1], index: 1 },
		after: '  > x\n  > ```\n'
	},
	{
		name: 'after code that ends an item in a quote, no line ending at the end',
		source: '> - a\n>   ```\n>   x\n>   ```',
		gap: { parentPath: [0, 0, 0], index: 2 },
		after: '>   x\n>   ```'
	},
	{
		name: 'after a table that ends an item in a quote',
		source: '> - a\n>\n>   | b |\n>   | - |\n>\n> c\n',
		gap: { parentPath: [0, 0, 0], index: 2 },
		after: '>   | b |\n>   | - |\n'
	},
	{
		name: 'after a table that ends a quote in a list item',
		source: '- a\n\n  > | b |\n  > | - |\n\n  c\n',
		gap: { parentPath: [0, 0, 1], index: 1 },
		after: '  > | b |\n  > | - |\n'
	}
];

function gapDoc(shape: GapShape): Document {
	if (shape.plugins) installPlugins(SYNTAX_PLUGINS);
	return parse(shape.source);
}

// Miss-analysis: every gap-byte row stood in a top-level container, whose raw is the document's
// bytes, so a container's raw offset added to a document byte below it went unseen.
describe("a gap caret's byte at a nested boundary", () => {
	it.each(GAPS)('is the one byte that names it: $name', (shape) => {
		const laid = measured(gapDoc(shape));
		const naming = [];
		for (let at = 0; at <= shape.source.length; at++) {
			const gap = gapAtByte(laid, at);
			if (gap && JSON.stringify(gap) === JSON.stringify(shape.gap)) naming.push(at);
		}
		expect(naming).toEqual([spanOf(shape.source, shape.after)[1]]);
	});

	// An editor reads one grammar for its life on this branch, so the row swaps it as `use()` would.
	it.each(GAPS)('comes back from an undo under another grammar: $name', async (shape) => {
		gapDoc(shape);
		const s = makeTopHarness(shape.source, { reading: fixtureReading() });
		const history = createHistoryActions(s.deps, s.controller);
		const restore = vi.spyOn(s.deps.caretLanding, 'restore');
		s.deps.selectionState.setGapCaret(shape.gap);
		const end = shape.source.length;
		// A line of its own, keeping whether the document ends on a line ending.
		const insert = shape.source.endsWith('\n') ? 'z\n' : '\nz';
		const wrote = await s.controller.commitSource({
			changes: [{ from: end, to: end, insert }],
			caret: { at: end + 2, holds: 'text' },
			op: { kind: 'input' },
			snapshot: { path: docPathFrom([0]), offset: 0 }
		});
		expect(wrote).toBe(true);
		const grammar = createGrammarView((key) => key !== 'indentedCode');
		s.deps.reading = fixtureReading({ grammar });
		const reread = parse(serialize(s.deps.doc), { grammar });
		writeBytes(s.deps, () => {
			s.deps.setDoc(reread);
			s.deps.setBlockIds(assignIds(reread.children));
		});
		await history.requestUndo();
		expect(serialize(s.deps.doc)).toBe(shape.source);
		expect(restore.mock.lastCall?.[0]).toEqual({ gapCaret: shape.gap });
	});
});
