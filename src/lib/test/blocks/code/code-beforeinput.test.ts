import { describe, it, expect } from 'vitest';
import { computeAutoPair } from '$lib/editor/components/blocks/code/code-beforeinput';

describe('computeAutoPair — open-and-pair', () => {
	it.each([
		['(', ')'],
		['[', ']'],
		['{', '}'],
		['"', '"'],
		["'", "'"]
	])('inserts the matching closer for %s', (opener, closer) => {
		const r = computeAutoPair({ text: '', selection: { start: 0, end: 0 }, typed: opener });
		expect(r).toEqual({
			kind: 'pair',
			newText: opener + closer,
			caretOffset: 1
		});
	});

	it('places the caret between the inserted pair', () => {
		const r = computeAutoPair({ text: 'foo ', selection: { start: 4, end: 4 }, typed: '(' });
		expect(r).toEqual({ kind: 'pair', newText: 'foo ()', caretOffset: 5 });
	});

	it('inserts the pair at the start of the buffer', () => {
		const r = computeAutoPair({ text: ' foo', selection: { start: 0, end: 0 }, typed: '[' });
		expect(r).toEqual({ kind: 'pair', newText: '[] foo', caretOffset: 1 });
	});

	it('refuses to pair when the next char is an identifier (wrapping existing code)', () => {
		const r = computeAutoPair({ text: 'foo', selection: { start: 0, end: 0 }, typed: '(' });
		expect(r).toBeNull();
	});

	it('refuses quote pairing when the previous char is an identifier (apostrophe in word)', () => {
		const r = computeAutoPair({ text: 'don', selection: { start: 3, end: 3 }, typed: "'" });
		expect(r).toBeNull();
	});

	it('skips backtick auto-pair when inside an unclosed backtick fence', () => {
		const r = computeAutoPair({
			text: 'foo',
			selection: { start: 3, end: 3 },
			typed: '`',
			unclosedBacktickFence: true
		});
		expect(r).toBeNull();
	});

	it('still pairs backticks when the fence is tilde-marked even if unclosedBacktickFence flag is unset', () => {
		const r = computeAutoPair({
			text: 'foo ',
			selection: { start: 4, end: 4 },
			typed: '`'
		});
		expect(r).toEqual({ kind: 'pair', newText: 'foo ``', caretOffset: 5 });
	});
});

describe('computeAutoPair — skip-over', () => {
	it('skips past an existing closer instead of inserting a duplicate', () => {
		const r = computeAutoPair({ text: '()', selection: { start: 1, end: 1 }, typed: ')' });
		expect(r).toEqual({ kind: 'skip', caretOffset: 2 });
	});

	it('skips past matching quotes', () => {
		const r = computeAutoPair({ text: '""', selection: { start: 1, end: 1 }, typed: '"' });
		expect(r).toEqual({ kind: 'skip', caretOffset: 2 });
	});

	it('returns null when the typed closer does not match the next char', () => {
		const r = computeAutoPair({ text: '(a)', selection: { start: 1, end: 1 }, typed: ')' });
		expect(r).toBeNull();
	});

	it('returns null at end of text — nothing to skip past', () => {
		const r = computeAutoPair({ text: '(', selection: { start: 1, end: 1 }, typed: ')' });
		expect(r).toBeNull();
	});

	it('does not skip over an opener even if the next char matches', () => {
		const r = computeAutoPair({ text: '((', selection: { start: 1, end: 1 }, typed: '(' });
		expect(r).toEqual({ kind: 'pair', newText: '(()(', caretOffset: 2 });
	});
});

describe('computeAutoPair — wrap selection', () => {
	it('wraps a non-collapsed selection with the opener and closer', () => {
		const r = computeAutoPair({
			text: 'hello world',
			selection: { start: 6, end: 11 },
			typed: '('
		});
		expect(r).toEqual({
			kind: 'wrap',
			newText: 'hello (world)',
			selection: { start: 7, end: 12 }
		});
	});

	it('wraps with quotes', () => {
		const r = computeAutoPair({ text: 'foo bar', selection: { start: 0, end: 3 }, typed: '"' });
		expect(r).toEqual({
			kind: 'wrap',
			newText: '"foo" bar',
			selection: { start: 1, end: 4 }
		});
	});

	it('returns null when a non-opener is typed with an active selection (let browser handle)', () => {
		const r = computeAutoPair({ text: 'foo', selection: { start: 0, end: 3 }, typed: 'x' });
		expect(r).toBeNull();
	});

	it('returns null when typing a closer with an active selection', () => {
		const r = computeAutoPair({ text: 'foo', selection: { start: 0, end: 3 }, typed: ')' });
		expect(r).toBeNull();
	});
});

describe('computeAutoPair — non-pair input', () => {
	it('returns null for plain text characters with a collapsed cursor', () => {
		const r = computeAutoPair({ text: 'foo', selection: { start: 3, end: 3 }, typed: 'a' });
		expect(r).toBeNull();
	});
});
