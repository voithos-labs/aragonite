import { describe, it, expect } from 'vitest';
import {
	CURSOR_END,
	CURSOR_EXACT_START,
	CURSOR_START,
	SELECTION_END,
	entryEdge
} from '../block-component';

// The focus and selection code reaches the end of the content only when the offset exceeds
// the block's length, so a smaller fixed value would land mid-block once a block outgrew it.
// This checks the size; the behaviour is covered in cursor/widget-offset.test.ts.
describe('cursor sentinels: magnitude invariant', () => {
	it('CURSOR_END dominates any realistic block length', () => {
		expect(CURSOR_END).toBeGreaterThan(10_000_000);
	});

	it('SELECTION_END dominates any realistic cell/character count', () => {
		expect(SELECTION_END).toBeGreaterThan(10_000_000);
	});
});

// Every container reads its entry offset through `entryEdge`, so this table is the one statement
// of which child each special value enters and what it hands on.
describe('entryEdge', () => {
	const rows: Array<[string, number, 'first' | 'last', number, boolean]> = [
		['0', 0, 'first', 0, false],
		['CURSOR_START', CURSOR_START, 'first', CURSOR_START, false],
		['CURSOR_EXACT_START', CURSOR_EXACT_START, 'first', CURSOR_EXACT_START, false],
		['CURSOR_END', CURSOR_END, 'last', CURSOR_END, false],
		['a byte offset', 7, 'last', CURSOR_END, true]
	];
	for (const [name, offset, child, handed, inside] of rows) {
		it(`${name} enters the ${child} child with ${handed === offset ? 'itself' : 'CURSOR_END'}`, () => {
			expect(entryEdge(offset)).toEqual({ child, offset: handed, inside });
		});
	}
});
