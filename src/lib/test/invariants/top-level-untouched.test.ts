// G1.54: a commit with a document scope hands its mutation a plain copy of the top level, so the
// tree's own array is the same and holds the same blocks when the mutation returns.
// Miss-analysis: the range removal wrote the live document for months; only a splice counter on
// one route could see it, and no check sat at the commit every route goes through.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { checkTopLevelUntouched } from '$lib/invariants/top-level-untouched';
import { asDocPath } from '$lib/selection/path-math';
import { makeTopHarness } from '$lib/test/harness/editor-actions';
import { takeDevWarns } from '$lib/test/support/warn-gate';

describe('checkTopLevelUntouched', () => {
	const a = { kind: 'a' };
	const b = { kind: 'b' };

	it('passes the same array holding the same blocks', () => {
		const tree = [a, b];
		expect(checkTopLevelUntouched(tree, tree, [a, b])).toBeNull();
	});

	it('flags an array the mutation replaced, or one it wrote', () => {
		const tree = [a, b];
		expect(checkTopLevelUntouched([a, b], tree, [a, b])?.code).toBe('top-level-untouched');
		tree.splice(0, 1);
		expect(checkTopLevelUntouched(tree, tree, [a, b])?.code).toBe('top-level-untouched');
	});
});

describe('a document-scope commit whose mutation writes the tree itself', () => {
	it('fires the check', async () => {
		const { deps, controller } = makeTopHarness('one\n\ntwo\n');

		await controller.commitMultiScope({
			scopes: [controller.getDocScope()],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: () => {
				deps.doc.children.splice(1, 1);
				return [{ op: 'noop' }];
			}
		});

		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:top-level-untouched');
		// The publish installs the view, which the write never reached.
		expect(serialize(deps.doc)).toBe('one\n\ntwo\n');
	});
});
