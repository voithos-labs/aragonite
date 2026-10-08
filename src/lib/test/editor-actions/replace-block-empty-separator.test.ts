import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { makeNestedHarness, makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';

// An empty replacement removes a block, so it must do what `deleteNode` does: hand the vacated
// separating line down to the successor, and drop the one a blank predecessor provides.
// Miss-analysis: every replaceBlock suite drove non-empty replacements, never an empty one.

describe('replacing a block with nothing settles the separators it freed', () => {
	it('hands the vacated line down to a successor that carries none', async () => {
		const h = makeTopHarness('a\n\n# b\n# c\n');

		await h.actions.replaceBlock(1, [], undefined, { snapshotOffset: 0 });

		expect(serialize(h.deps.doc)).toBe('a\n\n# c\n');
		expectParseConverged(h.deps.doc);
	});

	it('frees the successor line a blank predecessor now stands in for', async () => {
		const h = makeTopHarness('a\n\n\nb\n\nc\n');
		expect(h.deps.doc.children.map((n) => [n.leadingTrivia, n.raw])).toEqual([
			['', 'a\n'],
			['\n', '\n'],
			['', 'b\n'],
			['\n', 'c\n']
		]);

		await h.actions.replaceBlock(2, [], undefined, { snapshotOffset: 0 });

		expect(serialize(h.deps.doc)).toBe('a\n\n\nc\n');
		expectParseConverged(h.deps.doc);
	});

	it('hands the line down inside a container body too', async () => {
		const h = makeNestedHarness('> a\n>\n> # b\n> # c\n', { index: 0 });

		await h.bundle.blockEdit.replaceBlock(1, [], undefined, { snapshotOffset: 0 });

		expect(serialize(h.deps.doc)).toBe('> a\n>\n> # c\n');
		expectParseConverged(h.deps.doc);
	});
});
