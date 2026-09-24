import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { mergeIntoPrevDeepLeaf, mergeWithNext } from '../../tree-operations';
import { defaultGrammarView } from '../../schema/block-openers';
import { describeConvergence } from '../harness/parse-converged';
import { fixtureLinkRef } from '../harness/fixture-grammar';

// A join into a setext heading lands the text on the title line, above the underline: joined past
// it, `======next` reparses as paragraph text and the heading's structure comes into view.
// Miss-analysis: the only pin on this join encoded Delete's refusal, so no test asked what the
// join should write, and Backspace from the block below was never run against a setext heading.

const joins = {
	'Delete (the forward join)': (source: string) => {
		const doc = parse(source);
		const { joinOffset } = mergeWithNext(doc, 0, undefined, fixtureLinkRef(), defaultGrammarView);
		return { doc, joinOffset };
	},
	'Backspace (the backward join)': (source: string) => {
		const doc = parse(source);
		const joinOffset = mergeIntoPrevDeepLeaf(
			doc,
			1,
			undefined,
			undefined,
			fixtureLinkRef()
		)?.joinOffset;
		return { doc, joinOffset };
	}
};

describe.each(Object.entries(joins))('%s into a setext heading', (_label, join) => {
	it.each([
		['a === underline', 'Setext\n======\n\nnext\n', 'Setextnext\n======\n'],
		['a --- underline', 'Setext\n---\n\nnext\n', 'Setextnext\n---\n'],
		['a two-line paragraph below', 'Setext\n---\n\na\nb\n', 'Setexta\nb\n---\n'],
		['CRLF endings', 'Setext\r\n===\r\n\r\nnext\r\n', 'Setextnext\r\n===\r\n']
	])('%s keeps the underline under the joined text', (_case, source, joined) => {
		const { doc, joinOffset } = join(source);

		expect(serialize(doc)).toBe(joined);
		expect(doc.children.map((c) => c.kind)).toEqual(['setextHeading']);
		expect(joinOffset).toBe(6);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('leaves a join between two paragraphs as it was', () => {
		const { doc, joinOffset } = join('Para\n\nnext\n');

		expect(serialize(doc)).toBe('Paranext\n');
		expect(joinOffset).toBe(4);
	});
});
