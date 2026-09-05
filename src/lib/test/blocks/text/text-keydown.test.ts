import { describe, it, expect } from 'vitest';
import { insertHardBreak, insertLiteralTab } from '$lib/components/blocks/text/text-keydown';

describe('insertHardBreak', () => {
	it('inserts trailing-backslash + newline at offset', () => {
		const r = insertHardBreak('Hello world\n', 5);
		expect(r.newRaw).toBe('Hello\\\n world\n');
		expect(r.caretOffset).toBe(7);
	});

	it('inserts at start of line', () => {
		const r = insertHardBreak('abc\n', 0);
		expect(r.newRaw).toBe('\\\nabc\n');
		expect(r.caretOffset).toBe(2);
	});

	// At end-of-display the break's own line ending becomes the block's trailing ending, so the
	// original is not reattached — the caret clamps to the new display length, valid immediately.
	it('emits the transitional break at end of display text, caret clamped', () => {
		const r = insertHardBreak('abc\n', 3);
		expect(r.newRaw).toBe('abc\\\n');
		expect(r.caretOffset).toBe(4);
	});

	it('keeps the CRLF ending at end-of-display, caret clamped', () => {
		const r = insertHardBreak('abc\r\n', 3);
		expect(r.newRaw).toBe('abc\\\r\n');
		expect(r.caretOffset).toBe(4);
	});

	it('clamps an offset past the display length to end-of-display', () => {
		const r = insertHardBreak('abc\n', 9);
		expect(r.newRaw).toBe('abc\\\n');
		expect(r.caretOffset).toBe(4);
	});

	it('gives a mid-display break the block CRLF ending, caret past it', () => {
		const r = insertHardBreak('abc\r\n', 1);
		expect(r.newRaw).toBe('a\\\r\nbc\r\n');
		expect(r.caretOffset).toBe(4);
	});

	it('handles raw with no trailing line ending', () => {
		const r = insertHardBreak('abc', 1);
		expect(r.newRaw).toBe('a\\\nbc');
		expect(r.caretOffset).toBe(3);
	});
});

describe('insertLiteralTab', () => {
	it.each([
		[0, '\tfoo\n', 1],
		[2, 'fo\to\n', 3],
		[3, 'foo\t\n', 4]
	])('inserts at offset %i', (offset, newRaw, caretOffset) => {
		const r = insertLiteralTab('foo\n', offset);
		expect(r.newRaw).toBe(newRaw);
		expect(r.caretOffset).toBe(caretOffset);
	});

	it('preserves trailing CRLF', () => {
		const r = insertLiteralTab('foo\r\n', 1);
		expect(r.newRaw).toBe('f\too\r\n');
		expect(r.caretOffset).toBe(2);
	});

	it('handles raw with no trailing line ending', () => {
		const r = insertLiteralTab('foo', 1);
		expect(r.newRaw).toBe('f\too');
		expect(r.caretOffset).toBe(2);
	});
});
