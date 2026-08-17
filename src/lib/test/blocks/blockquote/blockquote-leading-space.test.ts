// What the declined marker-completion press is FOR: the dispatch standing down hands the space
// to the surface's ordinary insertion, and the authoring path GH #143 names (leading whitespace,
// the indented-code opener) is only unblocked if those bytes survive the container's rebuild.
//
// Miss-analysis: the dispatch arm had a pin, the container's rebuild had a pin, and neither
// covered a quoted child whose whole content IS whitespace — the state the two presses pass
// through, and the one a reparse is most likely to normalize away.
import { describe, expect, it } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeNestedHarness } from '$lib/test/harness/editor-actions';

describe('a leading space typed into an empty quoted child reaches the source', () => {
	it('keeps the marker space and the content space apart, one keystroke at a time', async () => {
		const h = makeNestedHarness('>\n', { index: 0 });
		await h.bundle.blockEdit.updateBlockContent(0, ' \n', 0, 1);
		expect(serialize(h.deps.doc)).toBe('>  \n');

		await h.bundle.blockEdit.updateBlockContent(0, ' x\n', 1, 2);
		expect(serialize(h.deps.doc)).toBe('>  x\n');
	});

	// The indented-code opener is the case the issue names: four content spaces, typed in order.
	it('carries four content spaces, the indented-code opener’s width', async () => {
		const h = makeNestedHarness('>\n', { index: 0 });
		for (let typed = 1; typed <= 4; typed++) {
			await h.bundle.blockEdit.updateBlockContent(0, `${' '.repeat(typed)}\n`, typed - 1, typed);
		}
		expect(serialize(h.deps.doc)).toBe('>     \n');
	});
});
