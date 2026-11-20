// Where a paste goes is named by one reader per kind of caret: text for a caret in a block's text,
// a boundary with its parent for a gap, a block focused whole, and a live caret on hidden syntax.
// Miss-analysis: the differential told the core `text` for every caret that was no gap, so a caret
// on a block's syntax could not show.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import {
	documentBytes,
	placeAfterBlock,
	placeInBlock,
	placeOfGap
} from '#lib/selection/range-bytes.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';

function bytesOf(source: string) {
	const doc = parse(source);
	const laid = measured(doc);
	return documentBytes({
		version: () => 0,
		doc: () => doc,
		source: () => source,
		measured: () => laid,
		vouch: () => true
	});
}

describe('a caret in a block', () => {
	it('in its text is text, in both modes', () => {
		for (const live of [false, true])
			expect(placeInBlock(bytesOf('# Hi\n'), [0], 2, 2, live)).toEqual({
				range: { from: 2, to: 2 },
				holds: 'text'
			});
	});

	it('on a heading’s marker is text in source mode, which shows the marker', () => {
		expect(placeInBlock(bytesOf('a\n\n# Hi\n'), [1], 1, 1, false)).toEqual({
			range: { from: 4, to: 4 },
			holds: 'text'
		});
	});

	it('on a heading’s hidden marker is the boundary above the heading in live mode', () => {
		expect(placeInBlock(bytesOf('a\n\n# Hi\n'), [1], 1, 1, true)).toEqual({
			range: { from: 3, to: 3 },
			holds: 'boundary',
			parent: []
		});
	});

	it('a range is its bytes in source mode, whatever its ends stand on', () => {
		expect(placeInBlock(bytesOf('> # Hi\n'), [0, 0], 0, 4, false)).toEqual({
			range: { from: 2, to: 6 },
			holds: 'text'
		});
	});

	// Miss-analysis: a range from a heading's hidden marker was handed over as its raw bytes, and
	// the core read a paste over the heading's whole text as one across blocks.
	it('a live range’s ends on hidden syntax stand at the text’s edges', () => {
		expect(placeInBlock(bytesOf('> # Hi #\n'), [0, 0], 0, 6, true)).toEqual({
			range: { from: 4, to: 6 },
			holds: 'text'
		});
	});
});

describe('a caret between blocks', () => {
	const quote = '> | a |\n> | - |\n\nplain\n';

	it('a gap names its container, at the container’s end too', () => {
		expect(placeOfGap(bytesOf(quote), { parentPath: [0], index: 1 })).toEqual({
			range: { from: 16, to: 16 },
			holds: 'boundary',
			parent: [0]
		});
	});

	it('a block focused whole names the boundary under it', () => {
		expect(placeAfterBlock(bytesOf('a\n\n---\n\nb\n'), [1])).toEqual({
			range: { from: 8, to: 8 },
			holds: 'boundary',
			parent: []
		});
	});
});

describe('the caret a cut left', () => {
	const left = '> | b |\n> | - |\n\nafter\n';
	const caret = { at: 16, holds: 'boundary', parent: [] } as const;

	// Miss-analysis: the memory was keyed on the measured document, which every write replaces, so
	// an undo and a redo back to the same bytes forgot the cut.
	it('stands beside the caret, as the core named it, on any document that holds the bytes it left', () => {
		const bytes = bytesOf(left);
		bytes.cut = { caret, fits: 16, of: bytesOf(left).source() };
		expect(placeInBlock(bytes, [1], 0, 0, false)).toEqual({
			range: { from: 17, to: 17 },
			holds: 'text',
			back: caret
		});
	});

	it('is forgotten while the document holds other bytes', () => {
		const bytes = bytesOf(left);
		bytes.cut = { caret, fits: 16, of: '> | b |\n> | - |\n\nAfter\n' };
		expect(placeInBlock(bytes, [1], 0, 0, false)).toEqual({
			range: { from: 17, to: 17 },
			holds: 'text'
		});
	});
});
