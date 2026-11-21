// @vitest-environment jsdom
// A space typed over a range that took whole blocks stands on the line of its own a letter takes
// there, and the block under the range keeps its bytes.
// Miss-analysis: the landing law types a letter and the pair characters, never blank text, the one
// key whose paste reads as no block and so went in at the first byte of the block below.
import { describe, expect, it } from 'vitest';
import { editRange } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { noTransforms, testReading } from './test-host';

/** What `text` typed over the marked range `⟦…⟧` of `marked` leaves, its caret drawn as `‸`. */
function typed(marked: string, text: string): string {
	const source = marked.replace(/[⟦⟧]/g, '');
	const range = { from: marked.indexOf('⟦'), to: marked.indexOf('⟧') - 1 };
	const reading = testReading();
	const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const host = noTransforms(rangeHost(reading, { source, measured: measured(tree) }));
	const answer = editRange(source, range, { text }, 'source', host);
	return answer.source.slice(0, answer.caret.at) + '‸' + answer.source.slice(answer.caret.at);
}

describe('a space typed over whole blocks', () => {
	it.each([
		['a paragraph below', 'first\n\n⟦***\n\n# head⟧\n\nlast\n', 'first\n\n ‸\nlast\n'],
		['a heading below', 'first\n\n⟦***\n\n# head⟧\n\n# next\n', 'first\n\n ‸\n# next\n'],
		[
			'a code block below',
			'first\n\n⟦***\n\n# head⟧\n\n```\ncode\n```\n',
			'first\n\n ‸\n```\ncode\n```\n'
		],
		// The line a quote opens is its bare marker, so the space is the one the marker takes.
		['in a quote', '> a\n>\n> ⟦***\n>\n> # h⟧\n>\n> last\n', '> a\n>\n> ‸\n> last\n']
	])('stands on a line of its own, %s', (_, marked, left) => {
		expect(typed(marked, ' ')).toBe(left);
	});

	it('goes before the rest of the text the range ended in', () => {
		expect(typed('first\n\n⟦***\n\npa⟧ra\n', ' ')).toBe('first\n\n ‸ra\n');
	});

	it('a letter stands there too', () => {
		expect(typed('first\n\n⟦***\n\n# head⟧\n\nlast\n', 'q')).toBe('first\n\nq‸\n\nlast\n');
	});
});
