import { describe, it, expect } from 'vitest';
import { focusIndexBeforeResidue } from '$lib/tree-operations/paste/focus-target';

// The post-structural-paste caret lands on the last PASTED node, skipping a
// trailing residue node. Shared by every block-index paste route so they can't
// drift apart (list break-out and container-match once landed on the residue).
describe('focusIndexBeforeResidue', () => {
	it('lands one node earlier when a residue node trails', () => {
		expect(focusIndexBeforeResidue(4, true)).toBe(2);
	});

	it('lands on the last node when there is no residue', () => {
		expect(focusIndexBeforeResidue(3, false)).toBe(2);
		expect(focusIndexBeforeResidue(4, false)).toBe(3);
	});

	it('never goes negative on a degenerate single-node replacement', () => {
		expect(focusIndexBeforeResidue(1, true)).toBe(0);
		expect(focusIndexBeforeResidue(1, false)).toBe(0);
	});
});
