// @vitest-environment jsdom
// A prose block's text never keeps a hard break with only empty lines after it, whichever route
// writes it: a reload reads that break as a backslash, so the write drops it and the lines.
// Miss-analysis: #733, the only rows over that text drove the key route, so a cut or any other
// write through the content write went unchecked.
import { describe, it, expect } from 'vitest';
import { openLinesAtEnd, withHardBreak } from '#lib/core/inline/index.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { makeHarness } from '#lib/test/undo/restoration-ops.js';

describe('openLinesAtEnd', () => {
	it.each([
		{ text: 'abc\\\n', open: { text: 'abc', lines: 1 } },
		{ text: 'abc\\\r\n', open: { text: 'abc', lines: 1 } },
		{ text: 'abc\\\n\\\n', open: { text: 'abc', lines: 2 } },
		{ text: 'a **b**\\\n', open: { text: 'a **b**', lines: 1 } },
		{ text: 'abc\\\\\n', open: null },
		{ text: 'abc\\\nx', open: null },
		{ text: 'abc\n', open: null },
		{ text: 'abc\\', open: null }
	])('$text', ({ text, open }) => {
		expect(openLinesAtEnd(text)).toEqual(open);
	});

	it.each([1, 2, 3])('takes back the %i lines Shift+Enter opened', (lines) => {
		const broken = withHardBreak('see C:', 6, { start: 6, end: 6 }, '\n', lines).text;

		expect(openLinesAtEnd(broken)).toEqual({ text: 'see C:', lines });
	});
});

describe('the content write drops the open lines', () => {
	it('through a commit, at the top level', async () => {
		const h = makeHarness('abc def\n\nnext\n');

		await h.blockEdit.updateBlockContent(0, 'abc def\\\n\n', 'literal', 'join-typing', 0, 9);

		expect(serialize(h.deps.doc)).toBe('abc def\n\nnext\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
	});

	it('inside a list item, with the caret clamped to the text', () => {
		const item = parse('- abc def\n- next\n').children[0].children![0];
		const body = { children: item.children!, owner: item, lineEnding: '\n' as const };

		const legal = legalizeWrite(body, 0, 'abc def\\\n\n', 'literal');

		expect(legal.text).toBe('abc def\n');
		expect(legal.storedOffset(9)).toBe(7);
	});

	it('in the last block of a file with no line ending after it', () => {
		const doc = parse('next\n\nabc def');

		const legal = legalizeWrite(doc, 1, 'abc def\\\n', 'literal');

		expect(legal.text).toBe('abc def');
		expect(legal.storedOffset(9)).toBe(7);
	});

	it('keeps a backslash that ends the text, which a reload reads as one', () => {
		const doc = parse('abc\\\n\nnext\n');

		expect(legalizeWrite(doc, 0, 'abc\\\n', 'literal').text).toBe('abc\\\n');
	});

	it('leaves a code block’s backslash alone', () => {
		const doc = parse('```\nx\n```\n');
		const code = '```\nx\\\n\n```\n';

		expect(legalizeWrite(doc, 0, code, 'literal').text).toBe(code);
	});
});
