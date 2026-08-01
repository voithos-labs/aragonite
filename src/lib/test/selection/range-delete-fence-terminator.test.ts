import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';
import { expectParseConverged } from '../harness/parse-converged';

// The cross-block delete reaches a code block's bytes through its own sink, not the code
// surface: the same-block arm writes the merged raw with no reparse behind it, so a join
// that MINTS a closer line out of two lines holding none splits the block on reload. Same
// class as issue #45, other door. Miss-analysis: `range-delete.test.ts` drove prose joins
// only, and the fence rule was pinned at the component funnel, which this arm never crosses.

const sharing = () => createSharingState();

describe('range delete inside a fenced code block', () => {
	it('grows the fence when the join mints a closer line', () => {
		const doc = parse('```js\n``\n`\nbody\n```\n\n# Heading\n');

		// Delete the line break between "``" and "`", which forms "```" on one line.
		rangeDelete(doc, { path: [0], offset: 8 }, { path: [0], offset: 9 }, sharing(), undefined);

		expect(serialize(doc)).toBe('````js\n```\nbody\n````\n\n# Heading\n');
		expectParseConverged(doc);
	});

	it('leaves the heading a sibling instead of feeding it to a trailing fence', () => {
		const doc = parse('```js\n``\n`\nbody\n```\n\n# Heading\n');

		rangeDelete(doc, { path: [0], offset: 8 }, { path: [0], offset: 9 }, sharing(), undefined);

		expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'heading']);
	});

	it('leaves a join that mints no closer alone', () => {
		const doc = parse('```js\nab\ncd\n```\n\n# Heading\n');

		rangeDelete(doc, { path: [0], offset: 8 }, { path: [0], offset: 9 }, sharing(), undefined);

		expect(serialize(doc)).toBe('```js\nabcd\n```\n\n# Heading\n');
		expectParseConverged(doc);
	});

	// The rule is the block's own, not the document's: the same join inside a paragraph is
	// ordinary text, and escalating anything there would rewrite the user's bytes.
	it('leaves the same join inside a paragraph alone', () => {
		const doc = parse('``\n`\n\n# Heading\n');

		rangeDelete(doc, { path: [0], offset: 2 }, { path: [0], offset: 3 }, sharing(), undefined);

		expect(serialize(doc)).toBe('```\n\n# Heading\n');
	});
});
