import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { describeShapeDivergence } from '#lib/core/shape-divergence.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { deleteRange } from '../../../harness/range-delete';

// A range delete whose joined survivor reads as a bare list item installs the item a reload shows,
// with the empty paragraph you type into.
// Miss-analysis (GH #685): the survivor was read through the plain slot reader and never filled in.

describe('a range delete whose survivor reads as a bare item', () => {
	it('installs the item with the paragraph a reload gives it', () => {
		const doc = parse('-x\n\ny ');

		deleteRange(doc, { path: [0], offset: 1 }, { path: [1], offset: 1 });

		const reload = initDocument(serialize(doc), defaultGrammarView).doc;
		expect(describeShapeDivergence(doc, reload)).toBeNull();
		expect(serialize(doc)).toBe('- ');
	});
});
