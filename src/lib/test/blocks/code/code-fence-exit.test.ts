import { describe, it, expect } from 'vitest';
import {
	computeFenceExit,
	computeTypedFenceExit
} from '$lib/components/blocks/code/code-fence-exit';

type FenceMeta = Parameters<typeof computeFenceExit>[0]['meta'];

/** A closed 3-backtick fence with no info string; each case names only what it varies. */
const exit = (text: string, offset: number, meta: Partial<FenceMeta> = {}) =>
	computeFenceExit({
		text,
		offset,
		meta: { fenceMarker: '`', fenceLength: 3, info: '', closed: true, ...meta }
	});

describe('computeFenceExit — closed fence', () => {
	it('exits cleanly when the cursor sits at the very end of a closed fence', () => {
		const text = 'hello\nworld';
		expect(exit(text, text.length)).toEqual({ kind: 'exit' });
	});

	it('strips the empty body line before the closer and exits', () => {
		const text = 'hello\n\n```';
		const offset = 6;
		expect(exit(text, offset)).toEqual({ kind: 'exitWithEdit', newText: 'hello\n```' });
	});

	it('respects fenceLength > 3 when matching the closer line', () => {
		const text = 'a\n\n`````';
		const offset = 2;
		expect(exit(text, offset, { fenceLength: 5 })).toEqual({
			kind: 'exitWithEdit',
			newText: 'a\n`````'
		});
	});

	it('respects tilde fences when matching the closer line', () => {
		const text = 'a\n\n~~~';
		const offset = 2;
		expect(exit(text, offset, { fenceMarker: '~' })).toEqual({
			kind: 'exitWithEdit',
			newText: 'a\n~~~'
		});
	});

	it('returns none when the cursor is mid-content (not at end, not before closer)', () => {
		const text = 'hello\nworld\n```';
		expect(exit(text, 3)).toEqual({ kind: 'none' });
	});

	it('returns none when the line after the cursor is not the closer', () => {
		const text = 'hello\n\nnotfence';
		expect(exit(text, 6)).toEqual({ kind: 'none' });
	});

	// The closer grammar admits 0–3 spaces of indent (matchFenceClose); the
	// blank-line-before-closer strip must too, or Enter-exit drops the user inside the block.
	for (const indent of [1, 2, 3]) {
		const pad = ' '.repeat(indent);
		it(`strips the blank line before a ${indent}-space-indented closer and exits`, () => {
			const text = `hello\n\n${pad}\`\`\``;
			expect(exit(text, 6)).toEqual({ kind: 'exitWithEdit', newText: `hello\n${pad}\`\`\`` });
		});
	}

	it('strips the blank line before an indented tilde closer', () => {
		const text = 'a\n\n ~~~';
		expect(exit(text, 2, { fenceMarker: '~' })).toEqual({
			kind: 'exitWithEdit',
			newText: 'a\n ~~~'
		});
	});
});

describe('computeFenceExit — unclosed fence mints a closer', () => {
	it('replaces the trailing blank line with a backtick closer at end', () => {
		const text = 'hello\n';
		expect(exit(text, text.length, { closed: false })).toEqual({
			kind: 'closeAndExit',
			newText: 'hello\n```'
		});
	});

	it('mints a closer of the opener fence length', () => {
		const text = 'a\n';
		expect(exit(text, text.length, { fenceLength: 5, info: 'rust', closed: false })).toEqual({
			kind: 'closeAndExit',
			newText: 'a\n`````'
		});
	});

	it('mints a tilde closer for a tilde fence', () => {
		const text = 'a\n';
		expect(exit(text, text.length, { fenceMarker: '~', closed: false })).toEqual({
			kind: 'closeAndExit',
			newText: 'a\n~~~'
		});
	});

	it('joins the closer with CRLF when the body ends CRLF', () => {
		const text = 'hello\r\n';
		expect(exit(text, text.length, { closed: false })).toEqual({
			kind: 'closeAndExit',
			newText: 'hello\r\n```'
		});
	});

	it('returns none when at end without a trailing blank line', () => {
		const text = 'hello';
		expect(exit(text, text.length, { closed: false })).toEqual({ kind: 'none' });
	});

	it('returns none when not at the end of the buffer', () => {
		const text = 'hello\n';
		expect(exit(text, 3, { closed: false })).toEqual({ kind: 'none' });
	});
});

// Miss-analysis: exiting a code block was only ever asked of Enter, so the OTHER thing a user
// does at the end of a block — typing the closer — reached the write seam instead, where a body
// line that reads as a closer can only mean "grow the fence".
describe('computeTypedFenceExit — a closer typed on the empty last line', () => {
	const typedExit = (text: string, offset: number, typed: string, meta: Partial<FenceMeta> = {}) =>
		computeTypedFenceExit({
			text,
			offset,
			typed,
			meta: { fenceMarker: '`', fenceLength: 3, info: '', closed: true, ...meta }
		});

	it('leaves the block, taking the run and its line with it', () => {
		expect(typedExit('```js\nhello\n``\n```', 14, '`')).toEqual({
			kind: 'exitWithEdit',
			newText: '```js\nhello\n```'
		});
	});

	it('leaves a body of nothing but that line', () => {
		expect(typedExit('```\n``\n```', 6, '`')).toEqual({
			kind: 'exitWithEdit',
			newText: '```\n```'
		});
	});

	it('completes a longer fence only at its own length', () => {
		expect(typedExit('`````\na\n```\n`````', 11, '`', { fenceLength: 5 })).toEqual({
			kind: 'none'
		});
		expect(typedExit('`````\na\n````\n`````', 12, '`', { fenceLength: 5 })).toEqual({
			kind: 'exitWithEdit',
			newText: '`````\na\n`````'
		});
	});

	it('takes a CRLF line ending with the line', () => {
		expect(typedExit('```\r\na\r\n``\r\n```', 10, '`')).toEqual({
			kind: 'exitWithEdit',
			newText: '```\r\na\r\n```'
		});
	});

	it('reads a tilde fence by its own marker', () => {
		expect(typedExit('~~~\na\n~~\n~~~', 8, '~', { fenceMarker: '~' })).toEqual({
			kind: 'exitWithEdit',
			newText: '~~~\na\n~~~'
		});
		expect(typedExit('~~~\na\n``\n~~~', 8, '`', { fenceMarker: '~' })).toEqual({ kind: 'none' });
	});

	it('escalates instead wherever the line is not the run alone', () => {
		// Content ahead of the run, and the caret mid-line: both are body text, so the write seam
		// keeps its CommonMark answer and grows the fence.
		expect(typedExit('```\nx``\n```', 7, '`')).toEqual({ kind: 'none' });
		expect(typedExit('```\n``x\n```', 6, '`')).toEqual({ kind: 'none' });
	});

	it('writes the byte when the line below is not this block’s closer', () => {
		expect(typedExit('```\n``\nbody\n```', 6, '`')).toEqual({ kind: 'none' });
	});

	// An open fence has no closer yet, so the run the author types IS the closer: it is written.
	it('writes the byte in an unclosed fence', () => {
		expect(typedExit('```\na\n``\n', 8, '`', { closed: false })).toEqual({ kind: 'none' });
	});
});
