// The bytes a block keeps past its drawn text: only a prose kind's DOM stops at its content end.
// Miss-analysis: every kind with bytes past its content range was prose, so no test asked about a
// kind whose component draws its whole display.
import { describe, it, expect, afterEach } from 'vitest';
import { undrawnSuffix, withUndrawnSuffix } from '../../core/inline';
import type { CstNode } from '../../core/nodes';
import { declarePluginKind, registerBlockKind, simpleLeafClosure } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';

const node = (kind: string, raw: string) => ({ kind, leadingTrivia: '', raw }) as CstNode;

afterEach(resetPluginPlatformForTests);

describe('undrawnSuffix', () => {
	it.each([
		['a setext underline', 'Plan\n===\n', '\n==='],
		['a CRLF setext underline', 'Plan\r\n---\r\n', '\r\n---'],
		['a two-line title', 'Plan\nmore\n---\n', '\n---']
	])('is %s', (_label, raw, suffix) => {
		expect(undrawnSuffix(node('setextHeading', raw))).toBe(suffix);
	});

	it('is empty for a paragraph and an ATX heading', () => {
		expect(undrawnSuffix(node('paragraph', 'Plan\n'))).toBe('');
		expect(undrawnSuffix(node('heading', '# Plan\n'))).toBe('');
	});

	it('is empty for a kind that is not prose, whatever its content range', () => {
		const kind = declarePluginKind('short-range-leaf');
		registerBlockKind(kind, {
			gapEdges: 'none',
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			getContentRange: () => ({ start: 0, end: 2 }),
			closure: simpleLeafClosure({
				focus: { mode: 'implemented', via: 'native caret in the raw-editable surface' },
				searchPaint: { mode: 'inherit-default' },
				undo: { mode: 'inherit-default' },
				simOracle: { mode: 'inherit-default' }
			})
		});

		expect(undrawnSuffix(node(kind, '@@ one\n'))).toBe('');
	});
});

describe('withUndrawnSuffix', () => {
	const heading = node('setextHeading', 'Plan\n===\n');

	it.each([
		['a title', 'Plans', 'Plans\n==='],
		['an emptied title', '', ''],
		['a title of spaces and tabs', ' \t', ' \t'],
		['a title ending in an empty line', 'Plan\n', 'Plan\n'],
		['a no-break space, which Markdown reads as text', '\u00a0', '\u00a0\n===']
	])(
		'puts the underline back under %s only when its last line has text',
		(_label, text, written) => {
			expect(withUndrawnSuffix(heading, text)).toBe(written);
		}
	);
});
