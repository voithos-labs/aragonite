import { describe, it, expect } from 'vitest';
import {
	cycleHeading,
	insertHardBreak,
	insertLiteralTab
} from '$lib/components/blocks/text/text-keydown';

describe('cycleHeading', () => {
	it('adds a heading prefix when raw is a paragraph', () => {
		const r = cycleHeading('Hello\n', 1, 0);
		expect(r.newRaw).toBe('# Hello\n');
		expect(r.caretOffset).toBe(2);
	});

	it('replaces an existing heading prefix with a different level', () => {
		const r = cycleHeading('# Hello\n', 2, 4);
		expect(r.newRaw).toBe('## Hello\n');
		expect(r.caretOffset).toBe(5);
	});

	it('keeps the same prefix when the requested level matches (idempotent, not toggle-off)', () => {
		const r = cycleHeading('# Hello\n', 1, 4);
		expect(r.newRaw).toBe('# Hello\n');
		expect(r.caretOffset).toBe(4);
	});

	it('strips an existing heading prefix when level is 0', () => {
		const r = cycleHeading('## Hello\n', 0, 5);
		expect(r.newRaw).toBe('Hello\n');
		expect(r.caretOffset).toBe(2);
	});

	it('leaves a paragraph unchanged when level is 0', () => {
		const r = cycleHeading('Hello\n', 0, 3);
		expect(r.newRaw).toBe('Hello\n');
		expect(r.caretOffset).toBe(3);
	});

	it('clamps caret to the new prefix when the cursor was inside the old prefix', () => {
		const r = cycleHeading('## Hello\n', 1, 1);
		expect(r.newRaw).toBe('# Hello\n');
		expect(r.caretOffset).toBe(2);
	});

	it('preserves trailing CRLF when present', () => {
		const r = cycleHeading('Hello\r\n', 3, 0);
		expect(r.newRaw).toBe('### Hello\r\n');
		expect(r.caretOffset).toBe(4);
	});

	it('handles raw with no trailing line ending', () => {
		const r = cycleHeading('Hello', 1, 0);
		expect(r.newRaw).toBe('# Hello');
		expect(r.caretOffset).toBe(2);
	});

	it('handles empty raw', () => {
		const r = cycleHeading('\n', 2, 0);
		expect(r.newRaw).toBe('## \n');
		expect(r.caretOffset).toBe(3);
	});
});

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

	// A GFM hard break needs a following line, so at end-of-display it is not
	// representable as a single paragraph: emitting `\` + newline degenerated to a
	// literal trailing backslash (the newline became the block's trailing ending,
	// then trimmed) with the caret one past the display. Suppress it — the raw is
	// unchanged and the caret clamps to the display length.
	it('suppresses the degenerate break at end of display text', () => {
		const r = insertHardBreak('abc\n', 3);
		expect(r.newRaw).toBe('abc\n');
		expect(r.caretOffset).toBe(3);
	});

	it('suppresses at end of a CRLF block, leaving the raw and clamping the caret', () => {
		const r = insertHardBreak('abc\r\n', 3);
		expect(r.newRaw).toBe('abc\r\n');
		expect(r.caretOffset).toBe(3);
	});

	it('suppresses past the display length (offset beyond end clamps)', () => {
		const r = insertHardBreak('abc\n', 9);
		expect(r.newRaw).toBe('abc\n');
		expect(r.caretOffset).toBe(3);
	});

	it('preserves trailing CRLF', () => {
		const r = insertHardBreak('abc\r\n', 1);
		expect(r.newRaw).toBe('a\\\nbc\r\n');
		expect(r.caretOffset).toBe(3);
	});

	it('handles raw with no trailing line ending', () => {
		const r = insertHardBreak('abc', 1);
		expect(r.newRaw).toBe('a\\\nbc');
		expect(r.caretOffset).toBe(3);
	});
});

describe('insertLiteralTab', () => {
	it('inserts \\t at offset', () => {
		const r = insertLiteralTab('foo\n', 3);
		expect(r.newRaw).toBe('foo\t\n');
		expect(r.caretOffset).toBe(4);
	});

	it('inserts at start', () => {
		const r = insertLiteralTab('foo\n', 0);
		expect(r.newRaw).toBe('\tfoo\n');
		expect(r.caretOffset).toBe(1);
	});

	it('inserts in the middle', () => {
		const r = insertLiteralTab('foo\n', 2);
		expect(r.newRaw).toBe('fo\to\n');
		expect(r.caretOffset).toBe(3);
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
