import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { asDocPath } from '$lib/selection/path-math';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { ensureUnsharedChild } from '$lib/tree-operations/unshare';
import { stampStructuralChange } from '$lib/tree-operations/structural-change';
import { makeTopHarness } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';

// Every top-level write hands the tree operations the document as a body, trailing blank line
// included, so each route leaves the bytes and blocks the others leave. Miss-analysis: the
// document scope of a multi-scope commit was never driven by a write that blanks the last block.

describe('emptying a middle block in place, with a trailing blank line', () => {
	// The in-place write's fix-up reads the trailing line to decide whether it becomes a block.
	it('leaves the trailing line where the parser keeps it', async () => {
		const h = makeTopHarness('alpha\n\nx\n\nomega\n\n');
		expect(h.doc.suffix).toBe('\n');

		await h.actions.updateBlockContent(1, '\n', 'authored');

		expect(serialize(h.deps.doc)).toBe('alpha\n\n\nomega\n\n');
		expect(h.deps.doc.suffix).toBe('\n');
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		expectParseConverged(h.deps.doc);
	});
});

describe('the document scope of a multi-scope commit', () => {
	it('hands its mutate the document body, which names no owner', async () => {
		const h = makeTopHarness('a\n\nb\n\n');
		let owner: unknown = 'unread';
		let suffix: string | undefined;

		await h.controller.commitMultiScope({
			scopes: [h.controller.getDocScope()],
			snapshot: { path: asDocPath([1]), offset: 0 },
			mutate: ([scope]) => {
				owner = scope.body.owner;
				suffix = scope.body.suffix;
				return [{ op: 'noop' }];
			},
			discardIfNoop: true
		});

		expect(owner).toBeUndefined();
		expect(suffix).toBe('\n');
	});

	it('blanks the last block into the blocks the top-level content commit leaves', async () => {
		const source = 'a\n\nb\n\n';
		const viaContent = makeTopHarness(source);
		await viaContent.actions.updateBlockContent(1, '\n', 'authored');

		const h = makeTopHarness(source);
		await h.controller.commitMultiScope({
			scopes: [h.controller.getDocScope()],
			snapshot: { path: asDocPath([1]), offset: 0 },
			mutate: ([scope]) => {
				ensureUnsharedChild(scope, 1, scope.sharing);
				const grammar = h.deps.reading.grammar;
				const { change } = updateNodeContent(scope.body, 1, '\n', grammar, scope.sharing);
				stampStructuralChange(scope.children, change, scope.sharing);
				return [change];
			},
			op: { kind: 'updateContent', detail: { length: 1 }, eventPath: asDocPath([1]) }
		});

		expect(serialize(h.deps.doc)).toBe(serialize(viaContent.deps.doc));
		expect(h.deps.doc.children).toHaveLength(viaContent.deps.doc.children.length);
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		expectParseConverged(h.deps.doc);
	});
});
