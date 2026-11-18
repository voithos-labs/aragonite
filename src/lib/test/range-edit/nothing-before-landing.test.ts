// @vitest-environment jsdom
// Backspace over a range with nothing before it lands where Delete does, beside each kind a
// landing must not rest on the syntax of, in both modes (`structural-edits.md` § Structural
// operations).
// Miss-analysis: only the landing property held Backspace's side with nothing before the range, so
// a change that sent it to the cut's place left every named row green.
import { describe, expect, it } from 'vitest';
import { removalOf, type Place } from '#lib/range-edit/edit-range.js';
import { checkHost } from './test-host';

/** A divider and a heading taken whole from the document's start, then the kind. */
const ROWS: [kind: string, after: string, place: Place][] = [
	['a code block', '```\ncode\n```\n', { at: 4, holds: 'text' }],
	['a heading', '# h\n', { at: 2, holds: 'text' }],
	['a table', '| a | b |\n|---|---|\n| 1 | 2 |\n', { at: 2, holds: 'text' }],
	['a titled tip', ':::tip Title\nin\n:::\n', { at: 7, holds: 'text' }],
	['an untitled tip', ':::tip\nin\n:::\n', { at: 7, holds: 'text' }],
	['a table of contents', '[[toc]]\n\nlast\n', { at: 0, holds: 'boundary', parent: [] }]
];

describe('Backspace with nothing before the range lands where Delete does', () => {
	for (const mode of ['source', 'live'] as const)
		for (const [kind, after, place] of ROWS)
			it(`${mode}: before ${kind}`, () => {
				const source = `***\n\n# hd\n\n${after}`;
				const range = { from: 0, to: '***\n\n# hd'.length };
				const back = removalOf(source, range, 'backspace', mode, checkHost());
				const del = removalOf(source, range, 'delete', mode, checkHost());
				expect(back.source).toBe(after);
				expect(back.caret).toEqual(del.caret);
				expect(back.caret).toEqual(place);
			});
});
