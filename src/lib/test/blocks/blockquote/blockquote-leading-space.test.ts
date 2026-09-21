// What the refused marker completion is for: the dispatch doing nothing hands the space to the
// block's ordinary insertion, and the case GH #143 names, typing leading whitespace to open an
// indented code block, only works if those bytes survive the container's rebuild.
//
// Miss-analysis: the dispatch had a test, the container's rebuild had a test, and neither covered
// a quoted child whose whole content is whitespace, which is the state the two keystrokes pass
// through and the one a reparse is most likely to normalise away.
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
