// Miss-analysis: every row over a `:::` opening row was a range that ran off it, so no row removed a
// selection inside the row, and the closing line it stranded read as text.
import { describe, expect, it } from 'vitest';
import { editRange, type Gesture } from '#lib/range-edit/edit-range.js';
import { rangeHost, type Mode } from '#lib/range-edit/host.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { openerUnwrapLaw } from './laws';
import { checkHost, noTransforms, testReading } from './test-host';

function edit(source: string, from: number, to: number, gesture: Gesture, mode: Mode) {
	const reading = testReading();
	const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const host = noTransforms(rangeHost(reading, { source, measured: measured(tree) }));
	return editRange(source, { from, to }, gesture, mode, host);
}

const T = ':::tip Title\nbody\n:::\n';
const MODES = ['source', 'live'] as const;

// The law's ranges: the drawn documents' ranges snap to text, so none starts in a row's marker.
const LAW_ROWS = [
	[T, 0, 7],
	[T, 0, 3],
	[T, 1, 2],
	[T, 2, 9],
	[':::tip\nbody\n:::\n', 0, 6],
	[':::foo Title\n---\n:::\n', 0, 7],
	['> :::tip Title\n> body\n> :::\n', 2, 5],
	['- :::tip Title\n  body\n  :::\n', 2, 9],
	['::::note Outer\n:::tip Inner\nin\n:::\n::::\n', 15, 22],
	['::::note Outer\n:::tip Inner\nin\n:::\n::::\n', 0, 14]
] as const;

describe('a selection that breaks an opening row unwraps its container', () => {
	it.each(
		MODES.flatMap((mode) =>
			(
				[
					['the marker', T, 0, 7, 'Title\n\nbody\n', 0],
					['the colons', T, 0, 3, 'Title\n\nbody\n', 0],
					['one colon', T, 0, 1, 'Title\n\nbody\n', 0],
					['an untitled row whole', ':::tip\nbody\n:::\n', 0, 6, 'body\n', 0],
					['a generic box', ':::foo Title\nbody\n:::\n', 0, 7, 'Title\n\nbody\n', 0],
					['over a heading, flush', ':::tip Title\n# H\n:::\n', 0, 7, 'Title\n# H\n', 0],
					['over a rule, apart', ':::tip Title\n---\n:::\n', 0, 7, 'Title\n\n---\n', 0],
					['in a quote', '> :::tip Title\n> body\n> :::\n', 2, 9, '> Title\n>\n> body\n', 2],
					['in an item', '- :::tip Title\n  body\n  :::\n', 2, 9, '- Title\n\n  body\n', 2],
					[
						'the inner box only',
						'::::note Outer\n:::tip Inner\nin\n:::\n::::\n',
						15,
						22,
						'::::note Outer\nInner\n\nin\n::::\n',
						15
					],
					['with no final line ending', ':::tip Title\nbody\n:::', 0, 7, 'Title\n\nbody', 0]
				] as [string, string, number, number, string, number][]
			).map((row) => [mode, ...row] as const)
		)
	)('%s: %s', (mode, _, source, from, to, after, caret) => {
		for (const gesture of ['backspace', 'delete', 'cut'] as const) {
			const result = edit(source, from, to, gesture, mode);
			expect(result.source, gesture).toBe(after);
			expect(result.caret.at, gesture).toBe(caret);
		}
	});

	it.each([
		['source', ':::tip\nbody\n:::\n'],
		['source', T],
		['live', ':::tip\nbody\n:::\n']
	] as const)('the row held whole in %s mode: %j', (mode, source) => {
		const end = source.indexOf('\n');
		expect(edit(source, 0, end, 'backspace', mode).source).toBe('body\n');
	});

	it.each([
		['the name, leaving three colons', T, 3, 6, 'source'],
		['the title alone', T, 7, 12, 'source'],
		['one of four colons', '::::note\nbody\n::::\n', 0, 1, 'source'],
		['the titled row whole, which live mode clears to its marker', T, 0, 12, 'live']
	] as const)('%s keeps the closing line', (_, source, from, to, mode) => {
		expect(edit(source, from, to, 'backspace', mode).source).toMatch(/\n::::?\n$/);
	});

	it('text over the marker is the removal, then the text', () => {
		for (const mode of MODES) {
			expect(edit(T, 0, 7, { text: 'Q' }, mode).source).toBe('QTitle\n\nbody\n');
		}
	});

	it.each(MODES)('a cut pasted back where it left the caret gives the box back (%s)', (mode) => {
		for (const [source, from, to] of [
			[T, 0, 7],
			[':::tip\nbody\n:::\n', 0, 6],
			['> :::tip Title\n> body\n> :::\n', 2, 5]
		] as const) {
			const cut = edit(source, from, to, 'cut', mode);
			const at = cut.caret.at;
			const back = edit(
				cut.source,
				at,
				at,
				{ paste: cut.clipboard!, plain: false, own: cut.own, holds: 'text' },
				mode
			);
			expect(back.source).toBe(source);
			const plain = edit(
				cut.source,
				at,
				at,
				{ paste: cut.clipboard!, plain: true, holds: 'text' },
				mode
			);
			expect(plain.source).not.toBe(source);
		}
	});

	it.each(MODES)('L13 holds over the rows that break an opening row (%s)', (mode) => {
		const host = checkHost();
		const call = (
			source: string,
			range: { from: number; to: number },
			gesture: Gesture,
			m: typeof mode
		) => edit(source, range.from, range.to, gesture, m);
		for (const [source, from, to] of LAW_ROWS) {
			expect(openerUnwrapLaw(call, host, { source, mode, range: { from, to } })).toEqual([]);
		}
	});
});
