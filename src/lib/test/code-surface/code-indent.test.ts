import { describe, it, expect } from 'vitest';
import { indentLines, dedentLines } from '../../code-surface/code-indent';

// ── indentLines: collapsed selection (single tab insert) ────────────────────

describe('indentLines — collapsed selection', () => {
	it('inserts a single tab at the cursor', () => {
		const result = indentLines('foo', { start: 1, end: 1 });
		expect(result.text).toBe('f\too');
		expect(result.selection).toEqual({ start: 2, end: 2 });
	});

	it('inserts at offset 0', () => {
		const result = indentLines('foo', { start: 0, end: 0 });
		expect(result.text).toBe('\tfoo');
		expect(result.selection).toEqual({ start: 1, end: 1 });
	});

	it('inserts at end of text', () => {
		const result = indentLines('foo', { start: 3, end: 3 });
		expect(result.text).toBe('foo\t');
		expect(result.selection).toEqual({ start: 4, end: 4 });
	});
});

// ── indentLines: multi-line selection ───────────────────────────────────────

describe('indentLines — multi-line selection', () => {
	it('inserts a tab at every line-start the selection touches', () => {
		const text = 'alpha\nbeta\ngamma';
		// Selection spans "lpha\nbeta\ngam" — touches all three lines.
		const result = indentLines(text, { start: 1, end: 14 });
		expect(result.text).toBe('\talpha\n\tbeta\n\tgamma');
	});

	it('shifts the start offset by one for the first line insert', () => {
		const text = 'alpha\nbeta';
		const result = indentLines(text, { start: 2, end: 8 });
		// Both lines touched. Start moves from 2 → 3 (one tab added before it).
		// End moves from 8 → 10 (two tabs added before it).
		expect(result.selection).toEqual({ start: 3, end: 10 });
	});

	it('indents a single-line selection (end on same line)', () => {
		const result = indentLines('foo bar', { start: 0, end: 7 });
		expect(result.text).toBe('\tfoo bar');
		expect(result.selection).toEqual({ start: 1, end: 8 });
	});

	it('indents a line whose start the selection ends at', () => {
		// Selection `[0, 6)` spans "alpha\n" and touches offset 6, which is
		// the position right before `b` of "beta". The existing tab behavior
		// treats offset 6 as "inside line 2" and indents both lines — this
		// test pins that contract so the extraction preserves it.
		const text = 'alpha\nbeta';
		const result = indentLines(text, { start: 0, end: 6 });
		expect(result.text).toBe('\talpha\n\tbeta');
	});
});

// ── dedentLines: collapsed selection ────────────────────────────────────────

describe('dedentLines — collapsed selection', () => {
	it('removes a leading tab from the current line', () => {
		const result = dedentLines('\tfoo', { start: 2, end: 2 });
		expect(result.text).toBe('foo');
		expect(result.selection).toEqual({ start: 1, end: 1 });
	});

	it('removes up to 4 leading spaces', () => {
		const result = dedentLines('    foo', { start: 5, end: 5 });
		expect(result.text).toBe('foo');
		expect(result.selection).toEqual({ start: 1, end: 1 });
	});

	it('removes fewer than 4 spaces if that is all the line has', () => {
		const result = dedentLines('  foo', { start: 3, end: 3 });
		expect(result.text).toBe('foo');
		expect(result.selection).toEqual({ start: 1, end: 1 });
	});

	it('is a no-op on a line with no leading whitespace', () => {
		const result = dedentLines('foo', { start: 2, end: 2 });
		expect(result.text).toBe('foo');
		expect(result.selection).toEqual({ start: 2, end: 2 });
	});

	it('prefers a leading tab over spaces when both are present', () => {
		// Rule: first char is a tab → remove only the tab.
		const result = dedentLines('\t    foo', { start: 6, end: 6 });
		expect(result.text).toBe('    foo');
		expect(result.selection).toEqual({ start: 5, end: 5 });
	});

	it('dedents the correct line inside a multi-line string', () => {
		const text = 'alpha\n\tbeta\ngamma';
		// Cursor in "beta" — offset 8 is between 'b' and 'e'.
		const result = dedentLines(text, { start: 8, end: 8 });
		expect(result.text).toBe('alpha\nbeta\ngamma');
		expect(result.selection).toEqual({ start: 7, end: 7 });
	});

	it('clamps cursor to the line start when dedent would move it earlier', () => {
		// Cursor on the whitespace itself. After removing the tab the cursor
		// should sit at the new line start, not go negative.
		const result = dedentLines('\tfoo', { start: 1, end: 1 });
		expect(result.text).toBe('foo');
		expect(result.selection).toEqual({ start: 0, end: 0 });
	});
});

// ── dedentLines: multi-line selection ───────────────────────────────────────

describe('dedentLines — multi-line selection', () => {
	it('removes one tab from every selected line', () => {
		const text = '\talpha\n\tbeta\n\tgamma';
		const result = dedentLines(text, { start: 1, end: 18 });
		expect(result.text).toBe('alpha\nbeta\ngamma');
	});

	it('skips lines with no leading whitespace', () => {
		const text = '\talpha\nbeta\n\tgamma';
		const result = dedentLines(text, { start: 1, end: 17 });
		expect(result.text).toBe('alpha\nbeta\ngamma');
	});

	it('adjusts selection offsets for every removed char', () => {
		const text = '\talpha\n\tbeta';
		const result = dedentLines(text, { start: 1, end: 12 });
		// Two tabs removed — end shifts left by 2.
		expect(result.selection.end).toBe(10);
	});

	it('is a no-op when every selected line has no leading whitespace', () => {
		const text = 'alpha\nbeta';
		const result = dedentLines(text, { start: 0, end: 10 });
		expect(result.text).toBe('alpha\nbeta');
		expect(result.selection).toEqual({ start: 0, end: 10 });
	});
});
