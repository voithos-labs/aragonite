import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { focusTargetInReplacement } from '../../tree-operations';
import { settledCaretPosition } from '../../tree-operations/content-write';
import { caretTargetFor } from '../../selection/caret-target';
import { docPathFrom } from '../../caret/coordinate-spaces';
import { CURSOR_END } from '../../block-component';

describe('focusTargetInReplacement', () => {
	it('maps an offset inside the first block to that block', () => {
		const nodes = parse('foo\\\n# bar\n').children;
		expect(focusTargetInReplacement(nodes, 2)).toEqual({ index: 0, offset: 2 });
	});

	it('maps an offset in a later block to a local offset (skipping its blank lines)', () => {
		// Fence body [0,9], blank line, paragraph [11,16].
		const nodes = parse('```\nx\n```\n\nhello\n').children;
		expect(focusTargetInReplacement(nodes, 16)).toEqual({ index: 1, offset: 5 });
	});

	it('lands an offset inside inter-block blank lines at the next block start', () => {
		const nodes = parse('```\nx\n```\n\nhello\n').children;
		expect(focusTargetInReplacement(nodes, 10)).toEqual({ index: 1, offset: 0 });
	});

	it('clamps past-the-end offsets to the last block end', () => {
		const nodes = parse('foo\\\n# bar\n').children;
		expect(focusTargetInReplacement(nodes, 999)).toEqual({ index: 1, offset: 5 });
	});

	it('handles an edit position exactly at a block boundary', () => {
		const nodes = parse('foo\\\n# bar\n').children;
		// The display end of a trailing backslash is offset 4, still inside block 0.
		expect(focusTargetInReplacement(nodes, 4)).toEqual({ index: 0, offset: 4 });
	});
});

// What each caret placement after a content write uses: the fix-up's window and its text offset.
describe('settledCaretPosition', () => {
	const noFold = { change: { op: 'noop' } as const, textStart: 0 };

	it('keeps the written slot where no fold moved it', () => {
		expect(settledCaretPosition(noFold, 2, 4, [])).toEqual({ index: 2, offset: 4 });
	});

	it('moves to the settled window and carries the absorbed bytes', () => {
		const settled = {
			change: { op: 'replace' as const, at: 0, count: 3, newCount: 1, idMap: { 0: 0 } },
			textStart: 2
		};
		expect(settledCaretPosition(settled, 1, 1, parse('a\nx# h\nb\n').children)).toEqual({
			index: 0,
			offset: 3
		});
	});

	// The multi-block window still descends, and the descent starts behind the absorbed bytes:
	// drop the shift and the same offset lands at the block's start instead of after the `y`.
	it('descends a multi-block window from the absorbed head', () => {
		const settled = {
			change: { op: 'replace' as const, at: 0, count: 3, newCount: 2, idMap: { 0: 0 } },
			textStart: 2
		};
		expect(settledCaretPosition(settled, 1, 4, parse('a\nx\n\ny\nb\n').children)).toEqual({
			index: 1,
			offset: 1
		});
	});
});

// A raw offset into a container names no caret position, so the caret goes to a leaf inside it.
// Miss-analysis: every case here landed in a leaf, never in a quote or list the write made.
describe('the settled position in a container the write made', () => {
	const kindChange = {
		change: { op: 'replace' as const, at: 0, count: 1, newCount: 1, idMap: { 0: 0 } },
		textStart: 0
	};

	function landing(source: string, offset: number) {
		const doc = parse(source);
		const at = settledCaretPosition(kindChange, 0, offset, doc.children);
		return caretTargetFor(doc, { path: docPathFrom([at.index]), offset: at.offset });
	}

	it.each([
		{ shape: 'a quote', source: '> abcdef\n', offset: 2, path: [0, 0] },
		{ shape: 'a bare quote marker', source: '>abcdef\n', offset: 1, path: [0, 0] },
		{ shape: 'a list item', source: '- abcdef\n', offset: 2, path: [0, 0, 0] },
		{ shape: 'an ordered item', source: '1. abcdef\n', offset: 3, path: [0, 0, 0] }
	])('lands at the text start inside $shape', ({ source, offset, path }) => {
		expect(landing(source, offset)).toEqual({ leafPath: path, offset: 0 });
	});

	// A table's bytes map to no cell, so a byte offset anywhere in it takes the last cell's end.
	it("lands at the end of a table's last cell, even from a byte in its first", () => {
		expect(landing('| a | b |\n| - | - |\n| c | d |\n', 3)).toEqual({
			leafPath: [0, 1, 1],
			offset: CURSOR_END
		});
	});
});
