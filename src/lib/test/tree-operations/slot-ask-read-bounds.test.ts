import { expect, it } from 'vitest';

import { parse } from '../../core/parser';
import { createSharingState } from '../../tree-operations/sharing';
import type { AncestrySeamFold } from '../../tree-operations/chain-rebuild';
import { ensureUnsharedPath } from '../../tree-operations/unshare';
import { rebuildUnsharedAncestry } from '../../tree-operations/chain-rebuild';

// Miss-analysis: the cost of the join check at a container's position was pinned only by the
// perf gate's wall clock on the pinned host, so an O(children) eager snapshot got in as machine
// noise; a check that counts element reads fails on the class, not the milliseconds.
it('a declined slot ask reads O(window) sibling elements, not O(children)', () => {
	const count = 2000;
	const source = Array.from({ length: count }, (_, i) => `- item ${i}\n`).join('');
	const sharing = createSharingState();
	const doc = parse(source);
	sharing.markSnapshotTaken();
	ensureUnsharedPath(doc, [0, 0], sharing);

	const list = doc.children[0];
	const items = list.children!;
	let reads = 0;
	list.children = new Proxy(items, {
		get(target, prop, receiver) {
			if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
			return Reflect.get(target, prop, receiver);
		}
	}) as typeof items;

	const leaf = items[0].children![0];
	leaf.raw = 'item 0 edited\n';
	const folds: AncestrySeamFold[] = [];
	rebuildUnsharedAncestry(doc, [0, 0], sharing, folds, undefined);

	expect(folds).toEqual([]);
	// The copy-on-write walk and the join check's own indexOf pay one pass; a declined check
	// must not pay a second full pass snapshotting siblings it never merges.
	expect(reads).toBeLessThan(count + 200);
});
