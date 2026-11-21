// @vitest-environment jsdom
// A character that makes a block by itself (`>`, `#`), typed or pasted over a range, stays a blank
// line apart from the block under it: an empty quote would take a paragraph there as its own line
// with the next letter typed in it.
// Miss-analysis: the landing law types a letter and the pair characters, never a block's marker, so
// no row asked the join under a block that lands empty.
import { describe, expect, it } from 'vitest';
import { editRange, type Gesture } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { noTransforms, testReading } from './test-host';

/** What `gesture` over the marked range `⟦…⟧` of `marked` leaves, its caret drawn as `‸`. */
function over(marked: string, gesture: Gesture): string {
	const source = marked.replace(/[⟦⟧]/g, '');
	const range = { from: marked.indexOf('⟦'), to: marked.indexOf('⟧') - 1 };
	const reading = testReading();
	const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const host = noTransforms(rangeHost(reading, { source, measured: measured(tree) }));
	const answer = editRange(source, range, gesture, 'source', host);
	return answer.source.slice(0, answer.caret.at) + '‸' + answer.source.slice(answer.caret.at);
}

const key = (text: string): Gesture => ({ text });
const paste = (text: string): Gesture => ({ paste: text, plain: false, holds: 'text' });

/** The blocks a range leaves under it, each as its bytes. */
const BELOW = {
	'a paragraph': 'last',
	'a list': '- li',
	'a heading': '# next',
	'a code block': '```\ncode\n```',
	'an indented code block': '    code'
};

describe('a block’s marker over whole blocks', () => {
	for (const [name, below] of Object.entries(BELOW))
		for (const [marker, how] of [
			['>', key],
			['>', paste],
			['#', key],
			['#', paste]
		] as const)
			it(`${how === key ? 'a typed' : 'a pasted'} ${marker} stands apart from ${name}`, () => {
				const marked = `first\n\n⟦***\n\n# head⟧\n\n${below}\n`;
				expect(over(marked, how(marker))).toBe(`first\n\n${marker}‸\n\n${below}\n`);
			});

	it('in a quote', () => {
		const marked = '> a\n>\n> ⟦***\n>\n> # h⟧\n>\n> last\n';
		expect(over(marked, key('>'))).toBe('> a\n>\n> >‸\n>\n> last\n');
		expect(over(marked, paste('>'))).toBe('> a\n>\n> >‸\n>\n> last\n');
	});
});

describe('a block’s marker on a line the range emptied', () => {
	for (const [name, below] of Object.entries(BELOW))
		for (const marker of ['>', '#'])
			it(`a typed ${marker} stands apart from ${name}`, () => {
				const marked = `first\n\n⟦zero\n\npara⟧\n\n${below}\n`;
				expect(over(marked, key(marker))).toBe(`first\n\n${marker}‸\n\n${below}\n`);
				expect(over(marked, paste(marker))).toBe(`first\n\n${marker}‸\n\n${below}\n`);
			});
});
