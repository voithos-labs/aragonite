// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { asDocPath } from '#lib/core/coordinate-spaces.js';

// The commit's blank-line fix-up must change nothing over a range its mutate already fixed up.
// Miss-analysis: the fix-up lived at each splice site, so no case ran a second one over one range.

describe('the commit sequence settle over a window its mutate already settled', () => {
	it('leaves an emptied block alone rather than settling its run twice', async () => {
		const h = makeTopHarness('alpha\n\nx\n\ndelta\n');

		await h.actions.updateBlockContent(1, '\n', 'authored', 'join-typing', 0);

		expect(serialize(h.deps.doc)).toBe('alpha\n\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});

	// A multi-block fill returns a `replace` range covering the filled index, so the commit's
	// fix-up sees the same transition `updateNodeContent` just handled.
	it('leaves a multi-block fill of a blank slot alone', async () => {
		const h = makeTopHarness('alpha\n\n\ndelta\n');

		await h.actions.updateBlockContent(1, 'p\n\nq\n', 'authored', 'join-typing', 0);

		expect(serialize(h.deps.doc)).toBe('alpha\n\np\n\nq\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});
});

// A cross-block delete splices inside `mutate`, then the commit fixes up the same range; the
// truncated start block is a new node, so a blank one must not be fixed up a second time.

// The new paragraph is blank, so the fix-up turns the suffix's trailing blank line into a block,
// and the reported change must count it or the id and ref arrays fall one short.
describe('an insert past the folded tail line', () => {
	// Miss-analysis: `makeEditorActionsDeps` hardcoded `suffix: ''`, so no fixture had a tail line.
	it('keeps blockIds and refs in step with the tree', async () => {
		const h = makeTopHarness(parse('alpha\n\n'));
		expect(h.deps.doc.suffix).toBe('\n');

		await h.actions.insertParagraph(1, '');

		// Two blocks: the tail line is the new paragraph's separator, not a block of its own.
		expect(serialize(h.deps.doc)).toBe('alpha\n\n\n');
		expect(h.deps.doc.children).toHaveLength(2);
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		expect(h.getBlockRefs()).toHaveLength(h.deps.doc.children.length);
		expectParseConverged(h.deps.doc);
	});

	// Miss-analysis (GH #168): no case deleted a block with a trailing blank line in the suffix.
	it('keeps them in step when a delete leaves the tail blank against the folded line', async () => {
		const h = makeTopHarness(parse('alpha\n\n\nbeta\n\n'));
		expect(h.deps.doc.suffix).toBe('\n');

		await h.actions.deleteBlock(2, 'keyless');

		expect(serialize(h.deps.doc)).toBe('alpha\n\n\n\n');
		expect(h.deps.doc.children).toHaveLength(3);
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		expectParseConverged(h.deps.doc);

		// The following commit is where an unreported new block becomes permanent: the id and
		// ref arrays are one short before it and stay one short after.
		await h.actions.deleteBlock(0, 'keyless');

		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		expect(h.getBlockRefs()).toHaveLength(h.deps.doc.children.length);
		expectParseConverged(h.deps.doc);
	});
});

describe('the commit sequence settle reads was-blank off the pre-mutate children', () => {
	it('hands both ends back the line a blank slot was holding for them', async () => {
		const h = makeTopHarness('alpha\n\n\ndelta\n');

		await h.controller.commitStructural({
			snapshot: { path: asDocPath([1]), offset: 0 },
			mutate: (children) => {
				children.splice(1, 1, ...parse('X\n').children);
				return { op: 'replace', at: 1, count: 1, newCount: 1 };
			}
		});

		expect(serialize(h.deps.doc)).toBe('alpha\n\nX\n\ndelta\n');
		expectParseConverged(h.deps.doc);
	});
});
