import { describe, it, expect } from 'vitest';
import { CURSOR_END, SELECTION_END } from '../block-component';

// The focus/selection walkers (findDomTextOffsetTarget, createRangeFromOffsets) fall
// through to end-of-content whenever the requested offset exceeds the block
// length. These sentinels must therefore dominate any realistic content length so
// "go to end" holds for a block of any size — the former finite CURSOR_END
// (999999) landed mid-block past that threshold. The behavioral walker coverage
// lives in cursor/widget-offset.test.ts; this pins the magnitude invariant those
// walkers depend on (and guards a revert to a finite sentinel).
describe('cursor sentinels — magnitude invariant', () => {
	it('CURSOR_END dominates any realistic block length', () => {
		expect(CURSOR_END).toBeGreaterThan(10_000_000);
	});

	it('SELECTION_END dominates any realistic cell/character count', () => {
		expect(SELECTION_END).toBeGreaterThan(10_000_000);
	});
});
