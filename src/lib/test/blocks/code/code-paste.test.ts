import { describe, it, expect } from 'vitest';
import { computeCodePaste, scanLongestFenceRun } from '../../../components/blocks/code/code-paste';

// ── computeCodePaste: no fence bump ─────────────────────────────────────────

describe('computeCodePaste — non-bumping paste', () => {
	it('inserts plain text at a collapsed cursor', () => {
		const result = computeCodePaste({
			display: '```\nfoo\n```',
			selection: { start: 7, end: 7 }, // end of "foo"
			pasted: 'bar',
			fenceMarker: '`',
			fenceLength: 3,
			closed: true
		});
		expect(result.text).toBe('```\nfoobar\n```');
		expect(result.cursor).toBe(10);
	});

	it('replaces a non-empty selection with the paste', () => {
		const result = computeCodePaste({
			display: '```\nfoo\n```',
			selection: { start: 4, end: 7 }, // over "foo"
			pasted: 'bar',
			fenceMarker: '`',
			fenceLength: 3,
			closed: true
		});
		expect(result.text).toBe('```\nbar\n```');
		expect(result.cursor).toBe(7);
	});

	it('leaves fences alone when the paste has no fence runs', () => {
		const result = computeCodePaste({
			display: '```\nfoo\n```',
			selection: { start: 4, end: 4 },
			pasted: 'x',
			fenceMarker: '`',
			fenceLength: 3,
			closed: true
		});
		expect(result.text).toBe('```\nxfoo\n```');
		expect(result.cursor).toBe(5);
	});

	it('leaves fences alone when the paste has a shorter run than the outer fence', () => {
		const result = computeCodePaste({
			display: '````\nfoo\n````',
			selection: { start: 5, end: 5 },
			pasted: '``',
			fenceMarker: '`',
			fenceLength: 4,
			closed: true
		});
		expect(result.text).toBe('````\n``foo\n````');
		expect(result.cursor).toBe(7);
	});
});

// ── computeCodePaste: fence bump ────────────────────────────────────────────

describe('computeCodePaste — fence bump', () => {
	it('bumps closed fence when the paste contains a run equal to the outer fence', () => {
		const result = computeCodePaste({
			display: '```\n\n```',
			selection: { start: 4, end: 4 },
			pasted: '```',
			fenceMarker: '`',
			fenceLength: 3,
			closed: true
		});
		expect(result.text).toBe('````\n```\n````');
		// Paste starts at old offset 4, opener bump shifts by 1 → new paste
		// start at offset 5. End at 5 + 3 = 8.
		expect(result.cursor).toBe(8);
	});

	it('bumps to one longer than the longest run in the paste', () => {
		const result = computeCodePaste({
			display: '```\n\n```',
			selection: { start: 4, end: 4 },
			pasted: '`````', // 5 backticks
			fenceMarker: '`',
			fenceLength: 3,
			closed: true
		});
		expect(result.text).toBe('``````\n`````\n``````');
		// fenceDelta = 6 - 3 = 3. newCursor = 4 + 3 + 5 = 12.
		expect(result.cursor).toBe(12);
	});

	it('bumps opener only when the fence is unclosed', () => {
		const result = computeCodePaste({
			display: '```\nfoo',
			selection: { start: 7, end: 7 },
			pasted: '```',
			fenceMarker: '`',
			fenceLength: 3,
			closed: false
		});
		expect(result.text).toBe('````\nfoo```');
		expect(result.cursor).toBe(11);
	});

	it('leaves non-closer body lines alone even when they contain fence runs', () => {
		const result = computeCodePaste({
			display: '```\n```inside\n```',
			selection: { start: 4, end: 4 },
			pasted: 'x',
			fenceMarker: '`',
			fenceLength: 3,
			closed: true
		});
		// No fence run in the paste; body stays verbatim.
		expect(result.text).toBe('```\nx```inside\n```');
	});

	it('supports tilde fences', () => {
		const result = computeCodePaste({
			display: '~~~\n\n~~~',
			selection: { start: 4, end: 4 },
			pasted: '~~~',
			fenceMarker: '~',
			fenceLength: 3,
			closed: true
		});
		expect(result.text).toBe('~~~~\n~~~\n~~~~');
	});
});

// ── scanLongestFenceRun ─────────────────────────────────────────────────────

describe('scanLongestFenceRun', () => {
	it('returns 0 for text with no fence characters', () => {
		expect(scanLongestFenceRun('hello world', '`')).toBe(0);
		expect(scanLongestFenceRun('no tildes here', '~')).toBe(0);
	});

	it('returns the length of a single fence run', () => {
		expect(scanLongestFenceRun('some ``` code', '`')).toBe(3);
		expect(scanLongestFenceRun('~~~~ tildes', '~')).toBe(4);
	});

	it('returns the longest run when multiple are present', () => {
		expect(scanLongestFenceRun('``` short and ```` longer ```', '`')).toBe(4);
	});

	it('ignores the other fence character', () => {
		expect(scanLongestFenceRun('backticks ``` and tildes ~~~~', '`')).toBe(3);
		expect(scanLongestFenceRun('backticks ``` and tildes ~~~~', '~')).toBe(4);
	});

	it('handles a run at the start of text', () => {
		expect(scanLongestFenceRun('```js\nconst x = 1\n```', '`')).toBe(3);
	});

	it('handles a run at the end of text', () => {
		expect(scanLongestFenceRun('const x = 1\n```', '`')).toBe(3);
	});

	it('handles an empty string', () => {
		expect(scanLongestFenceRun('', '`')).toBe(0);
	});

	it('handles a single character', () => {
		expect(scanLongestFenceRun('`', '`')).toBe(1);
	});

	it('counts inline code single backticks as runs of length 1', () => {
		expect(scanLongestFenceRun('see `foo` and `bar`', '`')).toBe(1);
	});
});
