// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { CstNode } from '../../../core/nodes';
import type { PresentationMode } from '../../../presentation-mode';
import {
	escapedCellOffset,
	normalizeWhitespace,
	tableCellInlinePaste
} from '../../../components/blocks/table/table-cell-paste';
import type { PasteRange, PasteSeam } from '../../../tree-operations/paste-surfaces';
import { updateNodeContent } from '../../../tree-operations/node-ops';
import { rebuildTableRowRaw } from '../../../schema/container-rebuilders';
import { parse } from '../../../core/parser';
import { cleanLiveJoinSeam } from '../../../components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '../../../schema/inline-construct-policy';

function makeCell(raw: string): CstNode {
	return { kind: 'tableCell', leadingTrivia: '', raw };
}

/** A paste into cell 0 of a two-cell row, carried the way the editor carries it: the hook returns
 *  spliced text, the sink applies the kind's rule, and the row is read back through a parse. */
function pasteIntoRow(
	cellRaw: string,
	offset: number,
	text: string,
	preDelete?: PasteRange,
	seam?: PasteSeam
) {
	const result = tableCellInlinePaste(makeCell(cellRaw), offset, text, preDelete, seam);
	const row: CstNode = {
		kind: 'tableRow',
		leadingTrivia: '',
		raw: '',
		metadata: { isHeader: false },
		children: [makeCell(cellRaw), makeCell('keep')]
	};
	updateNodeContent(row as never, 0, result.newRaw);
	rebuildTableRowRaw(row, '\n');
	const table = parse('| h | h |\n| --- | --- |\n' + row.raw).children[0];
	return { ...result, cells: (table.children?.[1].children ?? []).map((c) => c.raw) };
}

describe('normalizeWhitespace', () => {
	it('replaces a single newline with a space', () => {
		expect(normalizeWhitespace('a\nb')).toBe('a b');
	});

	it('collapses a run of newlines into a single space', () => {
		expect(normalizeWhitespace('a\n\n\nb')).toBe('a b');
	});

	it('trims leading and trailing whitespace', () => {
		expect(normalizeWhitespace('  hello  ')).toBe('hello');
	});

	it('preserves internal single spaces', () => {
		expect(normalizeWhitespace('a b c')).toBe('a b c');
	});
});

describe('escapedCellOffset — the caret follows the sink’s inserted backslashes', () => {
	it('shifts a caret that sits past a newly escaped pipe', () => {
		// Cell was "ab"; the user typed "|" between a and b, DOM caret at 2.
		expect(escapedCellOffset('a|b', 2)).toBe(3);
	});

	it('leaves a caret in pipe-free text untouched', () => {
		expect(escapedCellOffset('hello', 2)).toBe(2);
	});

	it('leaves a caret before the escaped pipe where it was', () => {
		expect(escapedCellOffset('a|b', 1)).toBe(1);
	});

	// The door reports where the caret lands in the bytes the sink wrote, so the
	// two have to agree on every prefix or the caret drifts into a `\|` pair.
	it('agrees with the raw the sink actually writes', () => {
		const row: CstNode = {
			kind: 'tableRow',
			leadingTrivia: '',
			raw: '',
			metadata: { isHeader: false },
			children: [makeCell('')]
		};
		updateNodeContent(row as never, 0, 'a|b|c');
		expect(escapedCellOffset('a|b|c', 5)).toBe(row.children![0].raw.length);
	});
});

describe('tableCellInlinePaste', () => {
	it('inserts at offset, normalizing newlines and leaving the escape to the sink', () => {
		const { newRaw, caretOffset, cells } = pasteIntoRow('pre', 3, 'a|b\nc');
		expect(newRaw).toBe('prea|b c');
		expect(caretOffset).toBe(3 + 'a\\|b c'.length);
		expect(cells).toEqual(['prea\\|b c', 'keep']);
	});

	it('honors preDelete by deleting the range first then pasting at the deletion start', () => {
		const { newRaw, caretOffset } = pasteIntoRow('abcdef', 5, 'X', { start: 1, end: 4 });
		expect(newRaw).toBe('aXef');
		expect(caretOffset).toBe(2);
	});

	// Escaping only the incoming text leaves the splice free to break the cell: the backslash holding
	// the cell's own `|` down escapes the pasted character instead, and the freed `|` splits the row.
	it('re-escapes a pipe the insertion point frees, not just the pasted text', () => {
		expect(pasteIntoRow('a\\|b', 2, 'X').cells).toEqual(['a\\X\\|b', 'keep']);
	});

	// The pasted text carries no pipe at all, so escaping it is a no-op — but the
	// backslash it inserts pairs off the one holding the cell's own pipe down.
	it('re-escapes a pipe the pasted text frees by pairing off a backslash', () => {
		expect(pasteIntoRow('a\\|b', 2, '\\').cells).toEqual(['a\\\\\\|b', 'keep']);
	});

	it('re-escapes a pipe a preDelete frees', () => {
		expect(pasteIntoRow('a\\|b', 2, 'X', { start: 0, end: 2 }).cells).toEqual(['X\\|b', 'keep']);
	});

	// The delete half is a join, and a cell's stranded runs are as unpainted as a paragraph's.
	// The seam runs BEFORE the escaping stage, which is why the sink still sees the final bytes.
	describe('the delete half crosses the live join seam', () => {
		beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
		afterAll(() => __resetLiveJoinSeamCleanerForTests());

		const CUT = { start: 8, end: 18 };
		const seamIn = (presentationMode: PresentationMode) => ({ presentationMode, linkRef: undefined });

		it('live: the run the cut stranded goes with it', () => {
			const result = tableCellInlinePaste(
				makeCell('Some **bold** text'),
				8,
				'X',
				CUT,
				seamIn('live')
			);
			expect(result.newRaw).toBe('Some bX');
		});

		it('the escaping stage still runs over what the seam wrote', () => {
			const { cells } = pasteIntoRow('a\\|b **z** c', 7, 'X', { start: 7, end: 10 }, seamIn('live'));
			// The stranded `**` went with the cut and the cell's own `\|` survived the round.
			expect(cells).toEqual(['a\\|b X c', 'keep']);
		});

		it('every other mode keeps the literal cut', () => {
			for (const mode of ['source', 'reading', 'preview-block', 'preview-inline'] as const) {
				const result = tableCellInlinePaste(
					makeCell('Some **bold** text'),
					8,
					'X',
					CUT,
					seamIn(mode)
				);
				expect(result.newRaw).toBe('Some **bX');
			}
		});
	});
});
