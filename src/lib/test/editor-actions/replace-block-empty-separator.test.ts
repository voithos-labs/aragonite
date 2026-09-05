import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeNestedHarness, makeTopHarness } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';

// An empty replacement removes a block, so it owes what `deleteNode` owes: hand the vacated
// separating line down to the successor, and free the one a blank predecessor now answers for
// (syntax-tree.md § Blank lines).
// Miss-analysis: `replace-block-id-preservation.test.ts` and the enter-completion suites drive
// non-empty replacements only, where `normalizeReplacementTrivia` hands the slot's line to the
// new head; the empty arm splices bare and had no case at all.

describe('replacing a block with nothing settles the separators it freed', () => {
	it('hands the vacated line down to a successor that carries none', async () => {
		const h = makeTopHarness('a\n\n# b\n# c\n');

		await h.actions.replaceBlock(1, []);

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

		await h.actions.replaceBlock(2, []);

		expect(serialize(h.deps.doc)).toBe('a\n\n\nc\n');
		expectParseConverged(h.deps.doc);
	});

	it('hands the line down inside a container body too', async () => {
		const h = makeNestedHarness('> a\n>\n> # b\n> # c\n', { index: 0 });

		await h.bundle.blockEdit.replaceBlock(1, []);

		expect(serialize(h.deps.doc)).toBe('> a\n>\n> # c\n');
		expectParseConverged(h.deps.doc);
	});
});
