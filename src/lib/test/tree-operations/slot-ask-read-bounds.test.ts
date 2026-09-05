import { expect, it } from 'vitest';

import { parse } from '../../core/parser';
import { createSharingState } from '../../tree-operations/sharing';
import type { AncestrySeamFold } from '../../tree-operations/unshare';
import { ensureUnsharedPath, rebuildUnsharedAncestry } from '../../tree-operations/unshare';

// Miss-analysis: the slot ask's cost was pinned only by the perf gate's wall clock on the pinned
// host, so an O(children) eager snapshot rode in as machine noise; an element-read oracle fails
// on the class, not the milliseconds.
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
	// The unshare walk and the slot ask's own indexOf pay one pass; the declined ask must not
	// pay a second full pass snapshotting siblings it never folds.
	expect(reads).toBeLessThan(count + 200);
});
