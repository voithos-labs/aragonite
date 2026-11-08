// @vitest-environment jsdom
// What a copy of a selection writes: the editor's coverage read as bytes, copied by the range-edit
// core. The core's own rows hold its byte rules; these hold the selection's side of them.
import { beforeEach, describe, it, expect } from 'vitest';
import type { SelectionPoint } from '../../selection/primitives';
import { parse } from '../../core/parser';
import { registerChromePluginsForTests } from './chrome-plugins';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { copiedText, freshBytes } from '#lib/test/harness/copied-text.js';
import { wholeBlockClipboard } from '#lib/selection/range-clipboard.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';

// Source mode, where a copied range carries its bytes as they stand.
const SOURCE_READING = fixtureReading({}, 'source');
const LIVE_READING = fixtureReading({}, 'live');

const copy = (source: string, a: SelectionPoint, b: SelectionPoint, reading = SOURCE_READING) =>
	copiedText(parse(source), a, b, reading);

// Miss-analysis: every copy row read source mode, so an edge cut through a format run in live
// mode put a stray closer or opener on the clipboard and none saw it.
describe('a live copy across blocks carries what a cut there takes', () => {
	const source = 'Some **bold** x\n\ny *it* z\n';
	const a = { path: [0], offset: 9 };
	const b = { path: [1], offset: 4 };

	it('closes the run the start block opens and reopens the one the end block closes', () => {
		expect(copy(source, a, b, LIVE_READING)).toBe('**ld** x\n\ny *i*');
	});

	it('copies the bytes as they stand in source mode', () => {
		expect(copy(source, a, b)).toBe('ld** x\n\ny *i');
	});
});

// Miss-analysis: the one-path branch only ever held a block whole until a finger's word reached it,
// so no row cut through a format run inside one block.
describe('a live copy of a range inside one block carries what a cut there takes', () => {
	const inBlock = (start: number, end: number, reading = SOURCE_READING) =>
		copy('Some **bold** x\n', { path: [0], offset: start }, { path: [0], offset: end }, reading);

	it('keeps the run a word inside it belongs to, closed at both edges', () => {
		expect(inBlock(7, 11, LIVE_READING)).toBe('**bold**');
	});

	it('copies the bytes as they stand in source mode', () => {
		expect(inBlock(7, 11)).toBe('bold');
	});

	it('copies a block it holds end to end as its bytes', () => {
		expect(inBlock(0, 15, LIVE_READING)).toBe('Some **bold** x');
	});
});

describe('a copy across blocks', () => {
	it('preserves the blank line between two top-level paragraphs', () => {
		expect(copy('first\n\nsecond\n', { path: [0], offset: 0 }, { path: [1], offset: 6 })).toBe(
			'first\n\nsecond'
		);
	});

	it('preserves blank lines between three paragraphs with partial endpoints', () => {
		expect(copy('abc\n\ndef\n\nghi\n', { path: [0], offset: 1 }, { path: [2], offset: 2 })).toBe(
			'bc\n\ndef\n\ngh'
		);
	});

	it('copies two list items, each with its marker', () => {
		const a = { path: [0, 0, 0], offset: 1 };
		expect(copy('- first\n- second\n', a, { path: [0, 1, 0], offset: 3 })).toBe('- irst\n- sec');
	});

	it('copies a quote and a following paragraph with the quote’s marker', () => {
		const a = { path: [0, 0], offset: 0 };
		expect(copy('> inside\n\nafter\n', a, { path: [1], offset: 5 })).toBe('> inside\n\nafter');
	});

	// Cross-block table endpoints snap to whole rows (table-endpoint-snap.ts), so the clipboard
	// captures the same rows the highlight paints and the delete clears; the offset is a cell index.
	describe('through tables', () => {
		// 3 columns × (header + 2 body rows). Cell indices: header 0..2, row 1 = 3..5, row 2 = 6..8.
		const fixture =
			'Before.\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nAfter.\n';
		const tableRaw = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';
		const cell = (offset: number): SelectionPoint => ({ path: [1], offset, cellCoordinate: true });

		it('copies the whole table when the selection spans it', () => {
			const text = copy(fixture, { path: [0], offset: 0 }, { path: [2], offset: 6 });
			expect(text).toBe(`Before.\n\n${tableRaw}\nAfter.`);
		});

		// Miss-analysis: every row leaving a table read its rows alone, which paste elsewhere as text.
		it.each([
			['dragged down, source', cell(4), { path: [2], offset: 6 }, SOURCE_READING],
			['dragged up, source', { path: [2], offset: 6 }, cell(4), SOURCE_READING],
			['dragged down, live', cell(4), { path: [2], offset: 6 }, LIVE_READING],
			['dragged up, live', { path: [2], offset: 6 }, cell(4), LIVE_READING]
		])('a range leaving it below its header carries the header (%s)', (_, a, b, reading) => {
			const text = copy(fixture, a, b, reading);
			expect(text).toBe(
				'| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nAfter.'
			);
			expect(parse(text).children.map((c) => c.kind)).toEqual(['table', 'paragraph']);
		});

		it('snaps a focus cell to its whole row so the row is fully captured', () => {
			const text = copy(fixture, { path: [0], offset: 0 }, cell(4));
			expect(text).toBe('Before.\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n');
		});

		it('copies each table whole when the selection spans two tables and their paragraphs', () => {
			const source =
				'a\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nb\n\n| C | D |\n| --- | --- |\n| 3 | 4 |\n\nc\n';
			expect(copy(source, { path: [0], offset: 0 }, { path: [4], offset: 1 })).toBe(
				'a\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nb\n\n| C | D |\n| --- | --- |\n| 3 | 4 |\n\nc'
			);
		});
	});

	// Miss-analysis: every container copy test put an endpoint outside the container, so the copy
	// that holds one whole with both endpoints inside it never ran.
	describe('select-all copies every container whole, through its last text', () => {
		beforeEach(registerChromePluginsForTests);

		it('over a document that is one quote', () => {
			const a = { path: [0, 0], offset: 0 };
			expect(copy('> a\n>\n> b\n', a, { path: [0, 1], offset: 1 })).toBe('> a\n>\n> b');
		});

		it('over a document that is one open details, closed after its last text', () => {
			const details = '<details open>\n<summary>Sum</summary>\n\nShown\n\n</details>\n';
			const text = copy(details, { path: [0, 0], offset: 0 }, { path: [0, 1], offset: 5 });
			expect(text).toBe('<details open>\n<summary>Sum</summary>\n\nShown\n</details>');
			expect(parse(text).children.map((c) => c.kind)).toEqual(['details']);
		});

		it('over a list both of whose items it holds', () => {
			const a = { path: [0, 0, 0], offset: 0 };
			expect(copy('- a\n- b\n', a, { path: [0, 1, 0], offset: 1 })).toBe('- a\n- b');
		});

		it('not over a quote whose first paragraph the range starts inside', () => {
			const a = { path: [0, 0], offset: 1 };
			expect(copy('> a\n>\n> b\n', a, { path: [0, 1], offset: 1 })).toBe('\n\nb');
		});

		// Spec § 3: a range inside one block arrives as exactly that, its container's markers outside.
		it('not over the text of a quote’s one paragraph', () => {
			const a = { path: [0, 0], offset: 0 };
			expect(copy('> quoted\n', a, { path: [0, 0], offset: 6 })).toBe('quoted');
		});

		it('not from inside the first block’s own marker', () => {
			const a = { path: [0], offset: 1 };
			expect(copy('# head\n\nend\n', a, { path: [1], offset: 3 })).toBe(' head\n\nend');
		});
	});
});

// Miss-analysis: the focused block's Mod+C wrote its raw past the range-edit core, and no row held
// it to the text the block menu's Copy writes.
describe('a block focused whole copies the text its menu’s Copy writes', () => {
	it.each([
		['a rule', 'above\n\n---\n\nbelow\n', [1]],
		['a code block', 'above\n\n```js\nx\n```\n\nbelow\n', [1]],
		['a callout', 'above\n\n:::callout Title\nbody\n:::\n\nbelow\n', [1]],
		['a quote’s last rule', '> a\n>\n> ---\n', [0, 1]]
	])('%s, in both modes', (_, source, path) => {
		const doc = parse(source);
		const block = blockNodeAt(doc, path)!;
		for (const reading of [SOURCE_READING, LIVE_READING]) {
			const write = wholeBlockClipboard(
				freshBytes(() => doc),
				path,
				reading
			);
			expect(write?.text).toBe(trimTrailingLineEnding(block.raw));
		}
	});
});
