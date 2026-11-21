// @vitest-environment jsdom
// The place over one block held whole is one empty paragraph where the block stood: the line its
// removal kept, where its container kept one, else a paragraph opened there.
// Miss-analysis: the rows held a block whole at the top level alone, where its removal keeps no
// line, so nothing saw a second line opened beside the one a quote or an item keeps.
import { describe, expect, it } from 'vitest';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { noTransforms, testReading } from './test-host';

/** The place over the range `⟦…⟧` of `marked`, its caret drawn as `‸`, and whether it opened. */
function place(marked: string) {
	const source = marked.replace(/[⟦⟧]/g, '');
	const range = { from: marked.indexOf('⟦'), to: marked.indexOf('⟧') - 1 };
	const reading = testReading();
	const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const host = noTransforms(rangeHost(reading, { source, measured: measured(tree) }));
	const { source: left, caret, opened } = editRange(source, range, 'place', 'source', host);
	return { left: left.slice(0, caret.at) + '‸' + left.slice(caret.at), opened: opened ?? false };
}

describe('the place over one block held whole', () => {
	it.each([
		['at the top level', 'first\n\n⟦***⟧\n\nlast\n', 'first\n\n‸\nlast\n'],
		['a quote’s middle block', '> a\n>\n> ⟦***⟧\n>\n> b\n', '> a\n>\n>‸\n> b\n'],
		['a quote’s last block', '> a\n>\n> ⟦***⟧\n\nafter\n', '> a\n>\n> ‸\n\nafter\n'],
		['a quote’s only block', '> ⟦***⟧\n\nafter\n', '> ‸\n\nafter\n'],
		['an item’s only block', '- a\n- ⟦***⟧\n- last\n', '- a\n- ‸\n- last\n'],
		// Opened as the caret between blocks opens one there, a blank line over the closing line.
		['a callout’s last block', ':::note\nfirst\n\n⟦***⟧\n:::\n', ':::note\nfirst\n\n‸\n\n:::\n']
	])('is one empty paragraph, %s', (_, marked, left) => {
		expect(place(marked)).toEqual({ left, opened: true });
	});
});
