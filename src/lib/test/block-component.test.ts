import { describe, it, expect } from 'vitest';
import { CURSOR_END, SELECTION_END } from '../block-component';

// The focus/selection walkers reach end-of-content only when the offset exceeds the
// block length, so a finite sentinel lands mid-block once a block outgrows it. Pins
// the magnitude; behavioral coverage is in cursor/widget-offset.test.ts.
describe('cursor sentinels — magnitude invariant', () => {
	it('CURSOR_END dominates any realistic block length', () => {
		expect(CURSOR_END).toBeGreaterThan(10_000_000);
	});

	it('SELECTION_END dominates any realistic cell/character count', () => {
		expect(SELECTION_END).toBeGreaterThan(10_000_000);
	});
});
