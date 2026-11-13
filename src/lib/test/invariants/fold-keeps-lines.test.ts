// G1.220: a fold spells the lines its list spelled. The predicate's own rows, and the check firing
// where the chain rebuild pushes a fold.
// Miss-analysis: every guard on a fold read the tree against a parse of its own bytes, which a
// line written twice passes when the doubled bytes read as the tree does.
import { describe, it, expect } from 'vitest';
import {
	FOLD_LINES_LIMIT,
	checkFoldKeepsLines,
	foldedBytes
} from '#lib/invariants/fold-keeps-lines.js';

describe('G1.220: a fold keeps the lines its list spelled', () => {
	it.each([
		['the same bytes', 'x\n# h\n', 'x\n# h\n'],
		['a blank line written', 'x\nner\n', 'x\n\n\nner\n'],
		['a blank line taken', 'x\n\n  \nner\n', 'x\nner\n'],
		['CRLF endings beside LF', 'x\r\nner\r\n', 'x\nner\n']
	])('passes %s', (_name, before, after) => {
		expect(checkFoldKeepsLines(before, after)).toBeNull();
	});

	it.each([
		[
			'a container’s lines written twice, which reload as the tree does',
			"[a]: /u\n':::tip\nner'\n:::\n\n# h\n",
			"[a]: /u\n':::tip\nner'\n':::tip\nner'\n:::\n\n# h\n",
			4
		],
		[
			'lines written over the block below',
			'x\nx:::tip\nner\n:::\n\n# h\n',
			'x\nx:::tip\nner\n:::\nx:::tip\nner\n:::\n',
			5
		],
		['a last line lost', 'x\nner\n', 'x\n', 2],
		['two lines in the other order', 'a\nb\n', 'b\na\n', 1],
		['a non-breaking space taken for a blank line', 'x\n \nner\n', 'x\nner\n', 2]
	])('names %s', (_name, before, after, line) => {
		const violation = checkFoldKeepsLines(before, after);

		expect(violation?.code).toBe('fold-keeps-lines');
		expect(violation?.message).toContain(`line ${line} `);
	});

	it('reads a body with the blank lines it holds round its blocks', () => {
		const list = {
			children: [
				{ leadingTrivia: '', raw: 'a\n' },
				{ leadingTrivia: '\n', raw: 'b\n' }
			],
			owner: { innerPrefix: '\n', innerSuffix: '\n' }
		};

		expect(foldedBytes(list)).toBe('\na\n\nb\n\n');
		expect(foldedBytes({ ...list, suffix: '' })).toBe('\na\n\nb\n');
	});

	it('leaves a list past the limit unread, and the check with nothing to say', () => {
		const huge = { children: [{ leadingTrivia: '', raw: 'x'.repeat(FOLD_LINES_LIMIT + 1) }] };

		expect(foldedBytes(huge)).toBeNull();
		expect(checkFoldKeepsLines(null, 'x\n')).toBeNull();
	});
});
