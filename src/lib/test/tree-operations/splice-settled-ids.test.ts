import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteAtPath } from '$lib/tree-operations/path-mutate';
import { createSharingState } from '$lib/tree-operations/sharing';
import { rebuildOwnedContainer } from '$lib/tree-operations/unshare';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// The splice outside a commit: the fix-up asks the joins now (GH #183), so a merge can splice a
// container at any depth where no commit descriptor reaches, and this function's own header
// names that as exactly where a drifted `childIds` becomes permanent.
// Miss-analysis: the path-mutate cases assert bytes and children, never the parallel id array,
// because before the fix-up asked its joins this splice could not touch anything but its own window.

describe('a path splice whose settle folds', () => {
	it('carries the fold into the container’s childIds', () => {
		const doc = parse('> a\n> # h\n> b\n');
		const quote = doc.children[0];
		expect(quote.children).toHaveLength(3);
		quote.childIds = ['q0', 'q1', 'q2'];

		const sharing = createSharingState();
		deleteAtPath(doc, [0, 1], sharing);
		// The function splices and fixes up; rebuilding the container's own bytes is its caller's job.
		rebuildOwnedContainer(quote, sharing);

		expect(serialize(doc)).toBe('> a\n> b\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(quote.children).toHaveLength(1);
		// One id per position, and the surviving head keeps its own.
		expect(quote.childIds).toEqual(['q0']);
	});
});
