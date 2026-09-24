// A range delete from inside a setext title into the block below keeps the heading: the survivor
// is the start block, its underline is structure no mode draws, and the joined text goes above
// it, as the Delete join puts it (`tree-operations/setext-join.test.ts`).
// Miss-analysis: the cross-block delete was only driven from blocks whose structure sits in front
// of their text, where every byte past the cut is content.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { rangeDelete } from '../../selection/range-delete';
import { createSharingState } from '../../tree-operations/sharing';
import type { SelectionPoint } from '../../selection/primitives';

function run(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const result = rangeDelete(doc, start, end, createSharingState(), undefined, 'live', undefined);
	return { doc: result.newDoc, caret: result.collapsedCaret };
}

describe('a range delete starting in a setext title', () => {
	it.each([
		['into the paragraph below', 'Setext\n======\n\nnext\n', 'Setxt\n======\n'],
		['to the end of the paragraph below', 'Setext\n---\n\nnext\n', 'Set\n---\n'],
		['with CRLF endings', 'Setext\r\n===\r\n\r\nnext\r\n', 'Setxt\r\n===\r\n']
	])('%s keeps the underline under the joined text', (label, source, joined) => {
		const end = label.startsWith('to the end') ? 4 : 2;
		const { doc, caret } = run(source, { path: [0], offset: 3 }, { path: [1], offset: end });

		expect(serialize(doc)).toBe(joined);
		expect(doc.children.map((c) => c.kind)).toEqual(['setextHeading']);
		expect(caret).toEqual({ path: [0], offset: 3 });
	});

	// A block-end offset some selection gestures report is the raw end, past the underline; the
	// caret there stands at the title end, so the join lands there too.
	it('treats a start at the raw end as the title end', () => {
		const { doc, caret } = run(
			'Setext\n======\n\nnext\n',
			{ path: [0], offset: 13 },
			{ path: [1], offset: 2 }
		);

		expect(serialize(doc)).toBe('Setextxt\n======\n');
		expect(caret).toEqual({ path: [0], offset: 6 });
	});
});
