import { describe, it, expect } from 'vitest';
import { computeFenceExit } from '$lib/components/blocks/code/code-fence-exit';

describe('computeFenceExit — closed fence', () => {
	it('exits cleanly when the cursor sits at the very end of a closed fence', () => {
		const text = 'hello\nworld';
		const r = computeFenceExit({
			text,
			offset: text.length,
			meta: { fenceMarker: '`', fenceLength: 3, info: '', closed: true }
		});
		expect(r).toEqual({ kind: 'exit' });
	});

	it('strips the empty body line before the closer and exits', () => {
		const text = 'hello\n\n```';
		const offset = 6;
		const r = computeFenceExit({
			text,
			offset,
			meta: { fenceMarker: '`', fenceLength: 3, info: '', closed: true }
		});
		expect(r).toEqual({ kind: 'exitWithEdit', newText: 'hello\n```' });
	});

	it('respects fenceLength > 3 when matching the closer line', () => {
		const text = 'a\n\n`````';
		const offset = 2;
		const r = computeFenceExit({
			text,
			offset,
			meta: { fenceMarker: '`', fenceLength: 5, info: '', closed: true }
		});
		expect(r).toEqual({ kind: 'exitWithEdit', newText: 'a\n`````' });
	});

	it('respects tilde fences when matching the closer line', () => {
		const text = 'a\n\n~~~';
		const offset = 2;
		const r = computeFenceExit({
			text,
			offset,
			meta: { fenceMarker: '~', fenceLength: 3, info: '', closed: true }
		});
		expect(r).toEqual({ kind: 'exitWithEdit', newText: 'a\n~~~' });
	});

	it('returns none when the cursor is mid-content (not at end, not before closer)', () => {
		const text = 'hello\nworld\n```';
		const r = computeFenceExit({
			text,
			offset: 3,
			meta: { fenceMarker: '`', fenceLength: 3, info: '', closed: true }
		});
		expect(r).toEqual({ kind: 'none' });
	});

	it('returns none when the line after the cursor is not the closer', () => {
		const text = 'hello\n\nnotfence';
		const r = computeFenceExit({
			text,
			offset: 6,
			meta: { fenceMarker: '`', fenceLength: 3, info: '', closed: true }
		});
		expect(r).toEqual({ kind: 'none' });
	});

	// The closer grammar admits 0–3 spaces of indent (matchFenceClose); the
	// blank-line-before-closer strip must too, or Enter-exit declines on an
	// indented closer and drops the user inside the block.
	for (const indent of [1, 2, 3]) {
		const pad = ' '.repeat(indent);
		it(`strips the blank line before a ${indent}-space-indented closer and exits`, () => {
			const text = `hello\n\n${pad}\`\`\``;
			const r = computeFenceExit({
				text,
				offset: 6,
				meta: { fenceMarker: '`', fenceLength: 3, info: '', closed: true }
			});
			expect(r).toEqual({ kind: 'exitWithEdit', newText: `hello\n${pad}\`\`\`` });
		});
	}

	it('strips the blank line before an indented tilde closer', () => {
		const text = 'a\n\n ~~~';
		const r = computeFenceExit({
			text,
			offset: 2,
			meta: { fenceMarker: '~', fenceLength: 3, info: '', closed: true }
		});
		expect(r).toEqual({ kind: 'exitWithEdit', newText: 'a\n ~~~' });
	});
});

describe('computeFenceExit — unclosed fence', () => {
	it('exits and trims the trailing blank line when cursor is at end with trailing newline', () => {
		const text = 'hello\n';
		const r = computeFenceExit({
			text,
			offset: text.length,
			meta: { fenceMarker: '`', fenceLength: 3, info: '', closed: false }
		});
		expect(r).toEqual({ kind: 'exitWithEdit', newText: 'hello' });
	});

	it('returns none when at end without a trailing blank line', () => {
		const text = 'hello';
		const r = computeFenceExit({
			text,
			offset: text.length,
			meta: { fenceMarker: '`', fenceLength: 3, info: '', closed: false }
		});
		expect(r).toEqual({ kind: 'none' });
	});

	it('returns none when not at the end of the buffer', () => {
		const text = 'hello\n';
		const r = computeFenceExit({
			text,
			offset: 3,
			meta: { fenceMarker: '`', fenceLength: 3, info: '', closed: false }
		});
		expect(r).toEqual({ kind: 'none' });
	});
});
