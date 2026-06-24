/**
 * Regression: `mergeListItemIntoPrevious` (M1) must keep every container's
 * `childIds` in lockstep with its `children`. When parity breaks, Svelte's
 * keyed-each logs `each_key_duplicate` for the trailing `undefined` keys and
 * downstream renders drift from CST.
 *
 * Each row exercises one of the three mutation sites in the helper:
 *   row 2 — nested-list absorbed into target listItem (push into targetItem.children)
 *   row 3 — depth-1 nested list grows by current's nested items (push into depthOneList.children)
 *   row 4 — depth-1 nested list grows when target is deeper than 1 (same site as row 3)
 *   row 5 — non-list continuation paragraph absorbed into target listItem
 */

import { describe, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { mergeListItemIntoPrevious } from '$lib/tree-operations/list/unwrap-merge';
import { applyStructuralChangeToIdsRefs } from '$lib/tree-operations/structural-change';
import {
	assertContainerParity,
	seedChildIdsRecursive
} from '$lib/test/harness/container-parity';
import type { CstNode } from '$lib/core/nodes';

/**
 * Mirror the commitContainer path: M1 is invoked with a children-copy and the
 * helper returns the outer-scope mutation implicitly (delete @ currentIndex,
 * count 1). Apply that to the outer list's childIds the same way the commit
 * primitive does.
 */
function runM1AsCommit(list: CstNode, currentIndex: number): void {
	const children = list.children!.slice();
	mergeListItemIntoPrevious(list, children, currentIndex);
	const refs: undefined[] = new Array(list.children!.length).fill(undefined);
	applyStructuralChangeToIdsRefs(
		{ op: 'delete', at: currentIndex, count: 1 },
		list.childIds!,
		refs
	);
	list.children = children;
}

describe('mergeListItemIntoPrevious — container children/childIds parity', () => {
	it('row 2: current item has nested sub-list absorbed into target (mutates targetItem)', () => {
		const doc = parse('- A\n- B\n  - C\n');
		const list = doc.children[0];
		seedChildIdsRecursive(list);

		runM1AsCommit(list, 1);

		assertContainerParity(list);
	});

	it('row 3: current nested list items absorbed into target depth-1 list', () => {
		const doc = parse('- A\n  - AA\n- B\n  - C\n');
		const list = doc.children[0];
		seedChildIdsRecursive(list);

		runM1AsCommit(list, 1);

		assertContainerParity(list);
	});

	it('row 4: deep nesting — depth-1 list grows with current nested-list items', () => {
		const doc = parse('- A\n  - B\n    - C\n- D\n  - E\n');
		const list = doc.children[0];
		seedChildIdsRecursive(list);

		runM1AsCommit(list, 1);

		assertContainerParity(list);
	});

	it('row 5: non-list continuation paragraph absorbed into target listItem', () => {
		const doc = parse('- A\n- B\n\n  extra\n');
		const list = doc.children[0];
		seedChildIdsRecursive(list);

		runM1AsCommit(list, 1);

		assertContainerParity(list);
	});
});
