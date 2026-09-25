// A range delete across a setext heading: the start block survives and keeps its own underline
// under the joined text, and an end block's underline goes with the end block, as the Delete join
// has it (`tree-operations/setext-join.test.ts`).
// Miss-analysis: the cross-block delete was only driven from blocks whose structure sits in front
// of their text, and only into blocks with no structure past their text, so the end block's
// underline was never asked about.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { rangeDelete } from '../../selection/range-delete';
import { createSharingState } from '../../tree-operations/sharing';
import type { PresentationMode } from '../../presentation-mode';
import type { SelectionPoint } from '../../selection/primitives';
import { describeConvergence } from '../harness/parse-converged';
import { fixtureLinkRef } from '../harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';

function run(
	source: string,
	start: SelectionPoint,
	end: SelectionPoint,
	mode: PresentationMode = 'live'
) {
	const doc = parse(source);
	const result = rangeDelete(
		doc,
		start,
		end,
		createSharingState(),
		defaultGrammarView,
		mode,
		fixtureLinkRef()
	);
	return { doc, caret: result.collapsedCaret };
}

describe('a range delete starting in a setext title', () => {
	it.each([
		['into the paragraph below', 'Setext\n======\n\nnext\n', 2, 'Setxt\n======\n'],
		['to the end of the paragraph below', 'Setext\n---\n\nnext\n', 4, 'Set\n---\n'],
		['with CRLF endings', 'Setext\r\n===\r\n\r\nnext\r\n', 2, 'Setxt\r\n===\r\n']
	])('%s keeps the underline under the joined text', (_label, source, endOffset, joined) => {
		const { doc, caret } = run(source, { path: [0], offset: 3 }, { path: [1], offset: endOffset });

		expect(serialize(doc)).toBe(joined);
		expect(doc.children.map((c) => c.kind)).toEqual(['setextHeading']);
		expect(caret).toEqual({ path: [0], offset: 3 });
	});

	// Miss-analysis: every range here started after some of the title's text, so none left the
	// title's last line empty.
	it.each([
		['a --- title', 'Plan\n---\n\nnext\n', 0, '\n'],
		['a === title', 'Plan\n===\n\nnext\n', 0, '\n'],
		['a two-line title', 'Plan\nmore\n---\n\nnext\n', 5, 'Plan\n\n']
	])(
		'from the start of the last title line of %s, leaves no underline under nothing',
		(_label, source, from, joined) => {
			const { doc, caret } = run(source, { path: [0], offset: from }, { path: [1], offset: 4 });

			expect(serialize(doc)).toBe(joined);
			expect(doc.children.map((c) => c.kind)).toEqual(['paragraph']);
			expect(describeConvergence(doc)).toBeNull();
			expect(caret).toEqual({ path: [0], offset: from });
		}
	);

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

describe.each(['source', 'live'] as const)(
	'%s mode: a range delete ending in a setext title',
	(mode) => {
		it.each([
			['from a === title into a --- one', 'Setext\n======\n\nOther\n---\n', 'Sether\n======\n'],
			['from a --- title into a === one', 'Setext\n---\n\nOther\n===\n', 'Sether\n---\n'],
			['to the raw end of the title below', 'Setext\n======\n\nOther\n---\n', 'Set\n======\n', 9],
			['to the raw end of a bold title', 'Setext\n======\n\n**Other**\n---\n', 'Set\n======\n', 13]
		])('%s keeps only the start block’s underline', (_label, source, joined, endOffset = 2) => {
			const { doc, caret } = run(
				source,
				{ path: [0], offset: 3 },
				{ path: [1], offset: endOffset },
				mode
			);

			expect(serialize(doc)).toBe(joined);
			expect(doc.children.map((c) => c.kind)).toEqual(['setextHeading']);
			expect(caret).toEqual({ path: [0], offset: 3 });
		});

		it('inside a quote, keeps only the start block’s underline', () => {
			const source = '> Setext\n> ======\n>\n> Other\n> ---\n';
			const { doc } = run(source, { path: [0, 0], offset: 3 }, { path: [0, 1], offset: 2 }, mode);

			expect(serialize(doc)).toBe('> Sether\n> ======\n');
			expect(doc.children[0].children?.map((c) => c.kind)).toEqual(['setextHeading']);
		});

		it.each([
			['an ATX heading', '# Title\n\nOther\n---\n', 5, '# Tither\n', 'heading'],
			['a paragraph', 'para\n\nOther\n---\n', 2, 'paher\n', 'paragraph']
		])(
			'from %s, drops the underline with the block below',
			(_label, source, from, joined, kind) => {
				const { doc } = run(source, { path: [0], offset: from }, { path: [1], offset: 2 }, mode);

				expect(serialize(doc)).toBe(joined);
				expect(doc.children.map((c) => c.kind)).toEqual([kind]);
				expect(describeConvergence(doc)).toBeNull();
			}
		);
	}
);
