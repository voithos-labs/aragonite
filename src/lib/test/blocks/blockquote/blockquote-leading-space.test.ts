// A space typed into an empty quoted child skips marker completion and goes to ordinary
// insertion, so leading whitespace (an indented code block's opener) must survive the rebuild.
// Miss-analysis: no test held a quoted child whose whole content is whitespace (GH #143).
import { describe, expect, it } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeNestedHarness } from '$lib/test/harness/editor-actions';

describe('a leading space typed into an empty quoted child reaches the source', () => {
	it('keeps the marker space and the content space apart, one keystroke at a time', async () => {
		const h = makeNestedHarness('>\n', { index: 0 });
		await h.bundle.blockEdit.updateBlockContent(0, ' \n', 'authored', 0, 1);
		expect(serialize(h.deps.doc)).toBe('>  \n');

		await h.bundle.blockEdit.updateBlockContent(0, ' x\n', 'authored', 1, 2);
		expect(serialize(h.deps.doc)).toBe('>  x\n');
	});

	it('carries four content spaces, the indented-code opener’s width', async () => {
		const h = makeNestedHarness('>\n', { index: 0 });
		for (let typed = 1; typed <= 4; typed++) {
			await h.bundle.blockEdit.updateBlockContent(
				0,
				`${' '.repeat(typed)}\n`,
				'authored',
				typed - 1,
				typed
			);
		}
		expect(serialize(h.deps.doc)).toBe('>     \n');
	});
});
