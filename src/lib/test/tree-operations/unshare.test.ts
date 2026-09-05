import { expect, it } from 'vitest';

import { takeDevWarns } from '../support/warn-gate';
import { parse } from '../../core/parser';
import { metadataOf } from '../../core/nodes';
import { createSharingState } from '../../tree-operations/sharing';
import {
	ensureUnsharedChild,
	ensureUnsharedPath,
	rebuildOwnedContainer,
	rebuildUnsharedAncestry
} from '../../tree-operations/unshare';

function sharedDoc(src: string) {
	const sharing = createSharingState();
	const doc = parse(src);
	sharing.markSnapshotTaken();
	return { doc, sharing };
}

it('copies every shared node on the path and splices copies into parents', () => {
	const { doc, sharing } = sharedDoc('- a\n  - b\n');
	const beforeList = doc.children[0];
	const beforeItem = beforeList.children![0];
	const chain = ensureUnsharedPath(doc, [0, 0], sharing);

	expect(doc.children[0]).not.toBe(beforeList);
	expect(doc.children[0].children![0]).not.toBe(beforeItem);
	expect(chain[0]).toBe(doc.children[0]);
	expect(chain[1]).toBe(doc.children[0].children![0]);
	expect(doc.children[0].children![0].children![1]).toBe(beforeItem.children![1]);
	expect(beforeList.children![0]).toBe(beforeItem);
});

it('preserves identity-bearing fields on copies', () => {
	const { doc, sharing } = sharedDoc('- a\n');
	const before = doc.children[0];
	// parse() leaves childIds unset (they are assigned at render); a live tree always has them.
	before.childIds = ['id-a'];
	const ids = [...before.childIds];
	ensureUnsharedPath(doc, [0], sharing);
	const copy = doc.children[0];
	expect(copy.kind).toBe(before.kind);
	expect(copy.raw).toBe(before.raw);
	expect(copy.childIds).toEqual(ids);
	expect(copy.childIds).not.toBe(before.childIds);
	expect(sharing.isShared(copy)).toBe(false);
});

it('copies metadata arrays instead of aliasing them', () => {
	const { doc, sharing } = sharedDoc('| a | b |\n| --- | :-: |\n| c | d |\n');
	const before = doc.children[0];
	ensureUnsharedPath(doc, [0], sharing);
	const copy = doc.children[0];
	expect(metadataOf(copy, 'table').alignments).toEqual(metadataOf(before, 'table').alignments);
	expect(metadataOf(copy, 'table').alignments).not.toBe(metadataOf(before, 'table').alignments);
});

it('is idempotent: an unshared path is not re-copied', () => {
	const { doc, sharing } = sharedDoc('para\n');
	ensureUnsharedPath(doc, [0], sharing);
	const once = doc.children[0];
	ensureUnsharedPath(doc, [0], sharing);
	expect(doc.children[0]).toBe(once);
});

it('ensureUnsharedChild unshares one child of an already-unshared parent', () => {
	const { doc, sharing } = sharedDoc('- a\n- b\n');
	const [list] = ensureUnsharedPath(doc, [0], sharing);
	const sharedSibling = list.children![1];
	const fresh = ensureUnsharedChild(list, 1, sharing);
	expect(list.children![1]).toBe(fresh);
	expect(fresh).not.toBe(sharedSibling);
	expect(ensureUnsharedChild(list, 1, sharing)).toBe(fresh);
});

// The gate reads the container CONTRACT, not the `table` kind. `tableRow` is the in-repo
// grid that is not `table`, standing in for the plugin grids a kind test would miss.
it('rebuildOwnedContainer unshares the children of any grid, not just table', () => {
	const { doc, sharing } = sharedDoc('| a | b |\n| --- | --- |\n| c | d |\n');
	const [, row] = ensureUnsharedPath(doc, [0, 0], sharing);
	expect(row.children!.every((cell) => sharing.isShared(cell))).toBe(true);

	rebuildOwnedContainer(row, sharing);

	expect(row.children!.some((cell) => sharing.isShared(cell))).toBe(false);
});

// Without the range check its sibling walk carries (G1.22), an off-the-end index is an
// epoch-dependent crash: silent `undefined` before the first snapshot, TypeError after.
it('ensureUnsharedChild flags an out-of-range index instead of throwing', () => {
	const { doc, sharing } = sharedDoc('- a\n');
	const [list] = ensureUnsharedPath(doc, [0], sharing);

	expect(() => ensureUnsharedChild(list, 5, sharing)).not.toThrow();
	expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:unshare-path-in-range']);
});

it('ensureUnsharedChild treats an out-of-range index the same before and after a snapshot', () => {
	const unshared = parse('- a\n');
	const fresh = createSharingState();
	expect(() => ensureUnsharedChild(unshared.children[0], 5, fresh)).not.toThrow();
	expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:unshare-path-in-range']);

	const { doc, sharing } = sharedDoc('- a\n');
	expect(() => ensureUnsharedChild(doc.children[0], 5, sharing)).not.toThrow();
	expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:unshare-path-in-range']);
});

// G1.22 is the ONE axis separating the two shared-spine walks: the strict path flags an
// off-the-end index, the tolerant rebuild swallows it (post-delete hands short paths).
it('fires G1.22 only on the strict unshare path, never on the tolerant rebuild', () => {
	const strict = sharedDoc('para\n');
	ensureUnsharedPath(strict.doc, [5], strict.sharing);
	expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:unshare-path-in-range']);

	const tolerant = sharedDoc('para\n');
	rebuildUnsharedAncestry(tolerant.doc, [5], tolerant.sharing, null, undefined);
	expect(takeDevWarns()).toEqual([]);
});
