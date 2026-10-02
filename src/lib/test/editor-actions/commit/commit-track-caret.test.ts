// A caret position handed to a commit follows the fix-up's merges, at the root as in a container.
// Miss-analysis: only the multi-scope commit took a tracked position, so no test asked the root.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { asDocPath } from '$lib/selection/path-math';
import { replacePreservingFirst } from '$lib/tree-operations/structural-change';
import type { TrackedPosition } from '$lib/tree-operations/settle';
import { makeContainerHarness, makeTopHarness } from '$lib/test/harness/editor-actions';

/** A paragraph flush under the block above, which the fix-up merges into that block. */
const flushParagraph = (): CstNode => parse('x\n').children[0];

describe('a tracked caret through a commit whose fix-up merges above the replacement', () => {
	it('at the root', async () => {
		const h = makeTopHarness('a\n# b\n');
		const tracked: TrackedPosition = { index: 1, offset: 1 };

		await h.controller.commitStructural({
			snapshot: { path: asDocPath([1]), offset: 0 },
			mutate: (children) => {
				children.splice(1, 1, flushParagraph());
				return replacePreservingFirst(1, 1, 1);
			},
			trackCaret: tracked
		});

		expect(serialize(h.deps.doc)).toBe('a\nx\n');
		expect(tracked).toEqual({ index: 0, offset: 3 });
	});

	it('in a container', async () => {
		const h = makeContainerHarness('> a\n> # b\n', [0]);
		const tracked: TrackedPosition = { index: 1, offset: 1 };

		await h.controller.commitContainerStructural({
			containerNode: h.getNode(),
			path: [0],
			state: h.state,
			snapshot: { path: asDocPath([0, 1]), offset: 0 },
			mutate: (scope) => {
				scope.children.splice(1, 1, flushParagraph());
				return replacePreservingFirst(1, 1, 1);
			},
			trackCaret: tracked
		});

		expect(serialize(h.deps.doc)).toBe('> a\n> x\n');
		expect(tracked).toEqual({ index: 0, offset: 3 });
	});
});
