// @vitest-environment jsdom
// The bytes a drag carries out of a leaf are cut by the same rule as the bytes it leaves behind:
// a format run the range cuts through leaves closed at its edges, as the kept half keeps it.
// Miss-analysis: the drop's tests moved plain words only, so the raw slice it carried never held
// a delimiter run whose partner stayed behind.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { storedAsAt } from '#lib/tree-operations/stored-as.js';
import { bytesLeavingLeaf, replaceRangeInLeaf } from '#lib/tree-operations/leaf-range.js';
import { readBack, shownOf } from '#lib/core/inline/live-edit/read-back.js';
import type { StoredAs } from '#lib/schema/stored-as.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading } from '../harness/fixture-grammar';

function leaving(
	source: string,
	path: number[],
	from: string,
	to: string,
	mode: PresentationMode = 'live'
) {
	const doc = parse(source);
	const node = blockNodeAt(doc, path)!;
	const start = node.raw.indexOf(from);
	const range = { start, end: node.raw.indexOf(to, start) + to.length };
	const store = storedAsAt(doc, path, fixtureReading({}, mode));
	const cut = replaceRangeInLeaf(node, range, '', store);
	return { node, store, cut, moved: bytesLeavingLeaf(node, range, store, true) };
}

const shown = (bytes: string, store: StoredAs): string => shownOf(readBack(bytes, store)!, store);

// Each range runs from the start of `from` to the end of the `to` after it; the last column is
// what it carries.
const SHAPES: Array<[string, string, number[], string, string, string]> = [
	[
		'a run closing inside the range',
		'Some **bold** and words tail\n',
		[0],
		'ld**',
		' an',
		'**ld** an'
	],
	[
		'a run opening inside the range',
		'Some text **and bold** tail\n',
		[0],
		'text',
		'**an',
		'text **an**'
	],
	['a run wrapping the whole range', '**a b c** x\n', [0], 'b', 'b', '**b**'],
	['a kept half ending in a space', '**a *b* c**\n', [0], 'b', 'c', '***b* c**'],
	[
		'a to-do item’s text',
		'- [ ] Some **bold** and words tail\n',
		[0, 0, 0],
		'ld**',
		' an',
		'**ld** an'
	],
	['a heading’s text', '# Some **bold** and words\n', [0], 'ld**', ' an', '**ld** an'],
	['a table cell', '| Some **bold** and |\n| - |\n| x |\n', [0, 0, 0], 'ld**', ' an', '**ld** an']
];

describe('the bytes a range takes out of a leaf', () => {
	// Put back through the write a paste takes, which lands carried runs inside the kept ones.
	it.each(SHAPES)(
		'put back where they were, show what the leaf showed: %s',
		(_label, source, path, from, to) => {
			const { node, store, cut, moved } = leaving(source, path, from, to);
			const cutLeaf = { ...node, raw: cut.raw };
			const at = { start: cut.caret, end: cut.caret };
			const restored = replaceRangeInLeaf(cutLeaf, at, moved, store);
			expect(shown(restored.raw, store)).toBe(shown(node.raw, store));
		}
	);

	it.each(SHAPES)(
		'carry each run they cut through, closed at their edges: %s',
		(_label, source, path, from, to, carried) => {
			expect(leaving(source, path, from, to).moved).toBe(carried);
		}
	);

	it('leave the run they cut through closed on the bytes that stay', () => {
		const { cut } = leaving('Some **bold** and words tail\n', [0], 'ld**', ' an');

		expect(cut.raw).toBe('Some **bo**d words tail\n');
	});

	it('are the plain slice in source mode', () => {
		const { moved } = leaving('Some **bold** and words tail\n', [0], 'ld**', ' an', 'source');

		expect(moved).toBe('ld** an');
	});
});

describe('where a range replace puts the old bytes', () => {
	const map = (source: string, start: number, end: number, typed: string) => {
		const doc = parse(source);
		const edit = replaceRangeInLeaf(
			doc.children[0],
			{ start, end },
			typed,
			storedAsAt(doc, [0], fixtureReading({}, 'live'))
		);
		return (offset: number) => edit.mapOffset(offset);
	};

	it('shifts the bytes past a literal splice by what it wrote', () => {
		const at = map('abc def\n', 1, 3, 'XYZ');
		expect([0, 1, 2, 3, 5].map(at)).toEqual([0, 1, 1, 4, 6]);
	});

	it('lands a byte the join cleanup dropped where its run stood', () => {
		// `bold` selected whole: both runs go, so every byte of them lands where the opener stood.
		const at = map('Some **bold** text\n', 7, 11, '');
		expect([4, 5, 6, 7, 11, 13, 14].map(at)).toEqual([4, 5, 5, 5, 5, 5, 6]);
	});

	// `Some **bo` + `**` + `d words`: the range's start lands before the closer the join wrote,
	// its end after it.
	it('lands the range’s end after a closer the join wrote', () => {
		const at = map('Some **bold** and words tail\n', 9, 16, '');
		expect([4, 5, 6, 7, 9, 16, 17].map(at)).toEqual([4, 5, 6, 7, 9, 11, 12]);
	});
});
