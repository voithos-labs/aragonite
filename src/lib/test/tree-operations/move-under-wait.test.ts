// @vitest-environment jsdom
// A move keeps both readings: a block it places or uncovers under a definition whose title has
// started gets a blank line, where a keystroke there would read the way its bytes do.
// Miss-analysis: the move's rows asked each join it left as a pair, and a title that started two
// blocks up takes a pair that reads fine alone.
import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { createReorderAction } from '#lib/editor-actions/reorder-action.js';
import { harnessOver, opened, reloadDivergence } from '#lib/test/exhaustive/edit-driver.js';

const STARTED = ['[a]: /u', "    'code", '# h', 'text', "end'", '', 'last'];
const OWN_LINE = ['[a]: /u', "'title", '# h', 'text', "end'", '', 'last'];

/** A row: the lines, the block moved, where to, and the bytes the move leaves. */
const ROWS: [string, string[], number, number, string[]][] = [
	[
		'the heading that stopped a title, moved down',
		STARTED,
		2,
		3,
		['[a]: /u', "    'code", '', 'text', "end'", '# h', '', 'last']
	],
	[
		'the heading moved to the top',
		STARTED,
		2,
		0,
		['# h', '[a]: /u', "    'code", '', 'text', "end'", '', 'last']
	],
	[
		'the paragraph that closes the title, placed under the code',
		STARTED,
		3,
		2,
		['[a]: /u', "    'code", '', 'text', "end'", '# h', '', 'last']
	],
	[
		'the heading under a title on its own line, moved down',
		OWN_LINE,
		2,
		3,
		['[a]: /u', "'title", '', 'text', "end'", '# h', '', 'last']
	]
];

describe('a move under a definition whose title has started', () => {
	it.each(ROWS)('%s', async (_, lines, from, to, after) => {
		const h = harnessOver(opened(`${lines.join('\n')}\n`));

		expect(await createReorderAction(h.deps, h.controller).moveReorderUnit([from], to)).toBe(true);

		const bytes = serialize(h.deps.doc);
		expect(bytes).toBe(`${after.join('\n')}\n`);
		expect(reloadDivergence(h.deps.doc, bytes)).toBeNull();
	});
});
