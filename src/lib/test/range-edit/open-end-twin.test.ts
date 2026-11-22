// @vitest-environment jsdom
// A removal over a range that reaches a file's open end leaves what it leaves in the same bytes
// with a final line break, that break off again unless the line left last is blank
// (`docs/design/syntax-tree.md` § The last line), by `editRange` and by `removalOf` alike.
// Miss-analysis: the open-end rows compared paragraphs and a code body alone, so no row took the
// last block whole, where the bytes left end in the separator above it, or emptied a line behind
// an item's indent, where they end in no line ending.

import { describe, expect, it } from 'vitest';
import { editRange, removalOf, type RemovalGesture } from '#lib/range-edit/edit-range.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { lastLineOf } from '#lib/test/editor-actions/open-end-twin.js';
import { rangeOf, unmark } from './named-rows';
import { checkHost, testReading } from './test-host';

const ROWS: [string, string][] = [
	['a paragraph’s second line', 'above\n⟦pq⟧'],
	['a paragraph under a blank line', 'zz\n\n⟦ab⟧'],
	['two paragraphs to the end', 'above\n\n⟦b\n\nzz⟧'],
	['from inside a paragraph to the end', 'ab⟦ove\n\nzz⟧'],
	['an unclosed code body’s last line', 'zz\n\n```\n⟦pq⟧'],
	['a heading held whole', 'zz\n\n⟦# head⟧'],
	['a closed code block held whole', 'zz\n\n⟦~~~\npq\n~~~⟧'],
	['an unclosed code block held whole', 'zz\n\n⟦```js\none\npq⟧'],
	['a link definition held whole', 'zz\n\n⟦[ref]: /u⟧'],
	['a rule held whole under a quote', '> q\n\n⟦---⟧'],
	['a code block held whole under a line it touches', 'a\n⟦```\nx\n```⟧'],
	['a nested item held whole under a quote’s item', '> - x\n\n⟦1. n⟧'],
	['an item’s later line', '- one\n- two\n  ⟦pq⟧'],
	['an item’s second paragraph', '1. one\n\n   ⟦pq⟧'],
	['a nested item’s paragraph', '- i0\n  - i1\n\n    ⟦p5⟧'],
	['a footnote’s later line', '[^1]: a\n    ⟦pq⟧'],
	['an indented code block’s last line', '    code\n    ⟦pq⟧'],
	['a quote’s later line', '> above\n> ⟦pq⟧'],
	['a CRLF paragraph’s second line', 'above\r\n⟦pq⟧'],
	['a CRLF heading held whole', 'zz\r\n\r\n⟦# head⟧']
];
const GESTURES: RemovalGesture[] = ['backspace', 'delete', 'cut', 'type', 'compose', 'command'];

/** `twin`, a removal's bytes in the file with a final line break, as the file without one may
 *  hold them: an empty paragraph on a marker line keeps the break or not. */
function fromTwin(twin: string, ending: string): string[] {
	const opened = twin.slice(0, -ending.length);
	const last = lastLineOf(
		readAsOpened(twin, { grammar: testReading().grammar, scope: 'document' })
	);
	if (last === 'either') return [twin, opened];
	return [last === 'blank' ? twin : opened];
}

describe('a removal reaching an open end leaves its twin’s bytes', () => {
	for (const [name, marked] of ROWS)
		for (const mode of ['source', 'live'] as const)
			for (const gesture of GESTURES)
				it(`${name}, ${gesture}, ${mode}`, () => {
					const host = checkHost();
					const [source, range] = [unmark(marked), rangeOf(marked)];
					const ending = source.includes('\r\n') ? '\r\n' : '\n';
					const twin = editRange(source + ending, range, gesture, mode, host);
					const want = fromTwin(twin.source, ending);
					const got = editRange(source, range, gesture, mode, host);
					expect(want).toContain(got.source);
					expect(removalOf(source, range, gesture, mode, host).source).toBe(got.source);
					const kept = got.source === twin.source;
					expect(got.caret).toEqual(
						kept ? twin.caret : { ...twin.caret, at: Math.min(twin.caret.at, got.source.length) }
					);
				});
});
