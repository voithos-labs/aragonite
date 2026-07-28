import { describe, it, expect } from 'vitest';
import { computeCodeEnter } from '../../../components/blocks/code/code-enter';

// ── line ending ─────────────────────────────────────────────────────────────

describe('computeCodeEnter — the block’s line ending', () => {
	it('splices CRLF into a CRLF body, indent included', () => {
		const result = computeCodeEnter({
			display: '```\r\n  code',
			selection: { start: 11, end: 11 },
			mode: 'normal',
			ending: '\r\n'
		});
		expect(result.newText).toBe('```\r\n  code\r\n  ');
		expect(result.newCursor).toBe(15);
	});

	it('splices CRLF in soft mode too', () => {
		const result = computeCodeEnter({
			display: 'a',
			selection: { start: 1, end: 1 },
			mode: 'soft',
			ending: '\r\n'
		});
		expect(result.newText).toBe('a\r\n');
		expect(result.newCursor).toBe(3);
	});
});

// ── normal mode (auto-indent) ───────────────────────────────────────────────

describe('computeCodeEnter — normal mode', () => {
	it('inserts a newline at the cursor in flat content', () => {
		const result = computeCodeEnter({
			display: 'foo',
			selection: { start: 3, end: 3 },
			mode: 'normal',
			ending: '\n'
		});
		expect(result.newText).toBe('foo\n');
		expect(result.newCursor).toBe(4);
	});

	it("replicates the current line's leading whitespace", () => {
		const result = computeCodeEnter({
			display: '    indented',
			selection: { start: 12, end: 12 },
			mode: 'normal',
			ending: '\n'
		});
		expect(result.newText).toBe('    indented\n    ');
		expect(result.newCursor).toBe(17);
	});

	it('uses the indent of the line containing the selection start, not the end', () => {
		const display = '    foo\nbar';
		const result = computeCodeEnter({
			display,
			selection: { start: 7, end: 11 },
			mode: 'normal',
			ending: '\n'
		});
		expect(result.newText).toBe('    foo\n    ');
		expect(result.newCursor).toBe(12);
	});

	it('preserves a tab indent', () => {
		const result = computeCodeEnter({
			display: '\tcode',
			selection: { start: 5, end: 5 },
			mode: 'normal',
			ending: '\n'
		});
		expect(result.newText).toBe('\tcode\n\t');
		expect(result.newCursor).toBe(7);
	});

	it('splits mid-line at the cursor', () => {
		const result = computeCodeEnter({
			display: 'before|after'.replace('|', ''),
			selection: { start: 6, end: 6 },
			mode: 'normal',
			ending: '\n'
		});
		expect(result.newText).toBe('before\nafter');
		expect(result.newCursor).toBe(7);
	});

	it('replaces a non-empty selection with a newline + start-line indent', () => {
		const result = computeCodeEnter({
			display: '  hello world',
			selection: { start: 7, end: 13 },
			mode: 'normal',
			ending: '\n'
		});
		expect(result.newText).toBe('  hello\n  ');
		expect(result.newCursor).toBe(10);
	});

	it('uses no indent when the cursor sits on an empty line', () => {
		const result = computeCodeEnter({
			display: 'a\n\nb',
			selection: { start: 2, end: 2 },
			mode: 'normal',
			ending: '\n'
		});
		expect(result.newText).toBe('a\n\n\nb');
		expect(result.newCursor).toBe(3);
	});
});

// ── soft mode (Shift+Enter / insertLineBreak) ───────────────────────────────

describe('computeCodeEnter — soft mode', () => {
	it('inserts a bare newline with no auto-indent', () => {
		const result = computeCodeEnter({
			display: '    indented',
			selection: { start: 12, end: 12 },
			mode: 'soft',
			ending: '\n'
		});
		expect(result.newText).toBe('    indented\n');
		expect(result.newCursor).toBe(13);
	});

	it('splits mid-line without copying indent', () => {
		const result = computeCodeEnter({
			display: '\tfoo\tbar',
			selection: { start: 4, end: 4 },
			mode: 'soft',
			ending: '\n'
		});
		expect(result.newText).toBe('\tfoo\n\tbar');
		expect(result.newCursor).toBe(5);
	});

	it('replaces a selection with just a newline', () => {
		const result = computeCodeEnter({
			display: 'aaaXXXbbb',
			selection: { start: 3, end: 6 },
			mode: 'soft',
			ending: '\n'
		});
		expect(result.newText).toBe('aaa\nbbb');
		expect(result.newCursor).toBe(4);
	});
});
