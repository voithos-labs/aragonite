import { describe, it, expect, vi } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeTopHarness, mockRef } from '$lib/test/harness/editor-actions';

// Backspace joins a line into the block above, and the fix-up can then fold that block into the
// one above it; the caret has to follow the joined bytes there (GH #193).
// Miss-analysis: the upper-edge fold was pinned on the tree operation's bytes alone, and the
// merge actions' caret tests only ever joined two blocks nothing else absorbed.

describe('Backspace whose joined block the block above absorbs', () => {
	it('lands the caret at the join inside the block that absorbed it', async () => {
		const harness = makeTopHarness('    code\n\n    \nx\n\n\n[ref]: https://example.com\n');
		const focuses = harness.deps.doc.children.map(() => vi.fn());
		focuses.forEach((focus, i) => (harness.getBlockRefs()[i] = mockRef({ focus })));

		await harness.actions.mergeWithPrevious(2);

		expect(serialize(harness.deps.doc)).toBe('    code\n\n    x\n\n\n[ref]: https://example.com\n');
		expect(focuses[0]).toHaveBeenCalledWith('    code\n\n    '.length);
		expect(focuses[1]).not.toHaveBeenCalled();
	});
});
