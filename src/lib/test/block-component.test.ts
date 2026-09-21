import { describe, it, expect } from 'vitest';
import { CURSOR_END, SELECTION_END } from '../block-component';

// The focus and selection code reaches the end of the content only when the offset exceeds
// the block's length, so a smaller fixed value would land mid-block once a block outgrew it.
// This checks the size; the behaviour is covered in cursor/widget-offset.test.ts.
describe('cursor sentinels — magnitude invariant', () => {
	it('CURSOR_END dominates any realistic block length', () => {
		expect(CURSOR_END).toBeGreaterThan(10_000_000);
	});

	it('SELECTION_END dominates any realistic cell/character count', () => {
		expect(SELECTION_END).toBeGreaterThan(10_000_000);
	});
});
