import { describe, it, expect } from 'vitest';
import { insertHardBreak, insertLiteralTab } from '$lib/components/blocks/text/text-keydown';

describe('insertHardBreak', () => {
	it('inserts trailing-backslash + newline at offset', () => {
		const r = insertHardBreak('Hello world\n', 5, '\n', { start: 0, end: 11 });
		expect(r.newRaw).toBe('Hello\\\n world\n');
		expect(r.caretOffset).toBe(7);
	});

	it('inserts at start of line', () => {
		const r = insertHardBreak('abc\n', 0, '\n', { start: 0, end: 3 });
		expect(r.newRaw).toBe('\\\nabc\n');
		expect(r.caretOffset).toBe(2);
	});

	// At the end of the displayed text the break's own line ending becomes the block's trailing
	// one, so the original is not put back and the caret clamps to the new length.
	it('emits the transitional break at end of display text, caret clamped', () => {
		const r = insertHardBreak('abc\n', 3, '\n', { start: 0, end: 3 });
		expect(r.newRaw).toBe('abc\\\n');
		expect(r.caretOffset).toBe(4);
	});

	// A CRLF block's typed break takes CRLF, the ending the block's getter hands over.
	it('keeps the CRLF ending at end-of-display, caret clamped', () => {
		const r = insertHardBreak('abc\r\n', 3, '\r\n', { start: 0, end: 3 });
		expect(r.newRaw).toBe('abc\\\r\n');
		expect(r.caretOffset).toBe(4);
	});

	it('clamps an offset past the display length to end-of-display', () => {
		const r = insertHardBreak('abc\n', 9, '\n', { start: 0, end: 3 });
		expect(r.newRaw).toBe('abc\\\n');
		expect(r.caretOffset).toBe(4);
	});

	it('gives a mid-display break the block CRLF ending, caret past it', () => {
		const r = insertHardBreak('abc\r\n', 1, '\r\n', { start: 0, end: 3 });
		expect(r.newRaw).toBe('a\\\r\nbc\r\n');
		expect(r.caretOffset).toBe(4);
	});

	it('handles raw with no trailing line ending, breaking in the document ending', () => {
		const r = insertHardBreak('abc', 1, '\n', { start: 0, end: 3 });
		expect(r.newRaw).toBe('a\\\nbc');
		expect(r.caretOffset).toBe(3);
		expect(insertHardBreak('abc', 1, '\r\n', { start: 0, end: 3 }).newRaw).toBe('a\\\r\nbc');
	});
});

// Miss-analysis: no case broke a block with structure on the text's own line.
describe('insertHardBreak: a heading’s closing run stays on the heading’s line', () => {
	it('in the middle of the text, the rest goes to the new line without the run', () => {
		expect(insertHardBreak('# Hi #\n', 3, '\n', { start: 2, end: 4 })).toEqual({
			newRaw: '# H\\ #\ni\n',
			caretOffset: 7
		});
	});

	// Miss-analysis: every closing-run row broke inside the text, never before it.
	it.each([0, 1])('before the text (offset %i), the run stays with the heading below', (offset) => {
		expect(insertHardBreak('# Hi #\n', offset, '\n', { start: 2, end: 4 }).newRaw).toBe(
			'# Hi #'.slice(0, offset) + '\\\n' + '# Hi #'.slice(offset) + '\n'
		);
	});

	it('at the start of the text, the run stays on the heading’s line', () => {
		expect(insertHardBreak('# Hi #\n', 2, '\n', { start: 2, end: 4 }).newRaw).toBe('# \\ #\nHi\n');
	});

	it('leaves a setext underline under the title for a break in its middle', () => {
		expect(insertHardBreak('Plan\n===\n', 2, '\n', { start: 0, end: 4 }).newRaw).toBe(
			'Pl\\\nan\n===\n'
		);
	});
});

describe('insertLiteralTab', () => {
	it.each([
		[0, '\tfoo', 1],
		[2, 'fo\to', 3],
		[3, 'foo\t', 4]
	])('inserts at offset %i', (offset, text, caretAfter) => {
		expect(insertLiteralTab('foo', offset)).toEqual({ text, caretAfter });
	});
});
