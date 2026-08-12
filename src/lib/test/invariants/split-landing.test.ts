import { describe, it, expect } from 'vitest';
import { checkSplitLanding } from '$lib/invariants/split-landing';
import { assertSplitLanding, splitNode } from '$lib/tree-operations';
import { parse } from '$lib/core/parser';
import { takeDevWarns } from '$lib/test/support/warn-gate';

describe('G1.34 split landing', () => {
	it('accepts a landing that matches the primitive', () => {
		expect(checkSplitLanding(2, 2)).toBeNull();
	});

	it('names both indices when a caller re-derived its own', () => {
		const violation = checkSplitLanding(2, 1);
		expect(violation?.code).toBe('split-landing');
		expect(violation?.message).toContain('index 1');
		expect(violation?.message).toContain('starts at 2');
		expect(violation?.detail).toEqual({ landing: 1, expected: 2 });
	});

	// The pre-#98 shape: `blockIndex + 1` is the second half only while the first half
	// stays one block, and a plural first half is what pushes it down.
	it('fires through the seam on the pre-#98 landing, and stays silent on the primitive’s', () => {
		const doc = parse('    a\n\n\n    b\n');
		const split = splitNode(doc, 0, 7, undefined, undefined);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['tree-ops']);

		assertSplitLanding(split, split.secondHalfIndex);
		expect(takeDevWarns()).toEqual([]);

		assertSplitLanding(split, 1);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:split-landing']);
	});
});
