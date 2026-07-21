import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import { parse } from '../../core/parser';
import { metadataOf } from '../../core/nodes';
import { createSharingState } from '../../tree-operations/sharing';
import {
	ensureUnsharedChild,
	ensureUnsharedPath,
	rebuildUnsharedAncestry
} from '../../tree-operations/unshare';

afterEach(() => vi.unstubAllEnvs());

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
	// Off-path subtrees stay shared by reference:
	expect(doc.children[0].children![0].children![1]).toBe(beforeItem.children![1]);
	// Originals untouched (a snapshot referencing them still serializes identically):
	expect(beforeList.children![0]).toBe(beforeItem);
});

it('preserves identity-bearing fields on copies', () => {
	const { doc, sharing } = sharedDoc('- a\n');
	const before = doc.children[0];
	// parse() leaves childIds unset (assigned at render); the live tree always has them.
	before.childIds = ['id-a'];
	const ids = [...before.childIds];
	ensureUnsharedPath(doc, [0], sharing);
	const copy = doc.children[0];
	expect(copy.kind).toBe(before.kind);
	expect(copy.raw).toBe(before.raw);
	expect(copy.childIds).toEqual(ids);
	expect(copy.childIds).not.toBe(before.childIds); // arrays copied, not aliased
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
	expect(ensureUnsharedChild(list, 1, sharing)).toBe(fresh); // idempotent
});

// G1.22 (unshare-path-in-range) is the ONE axis separating the two shared-spine
// walks: the strict path flags an off-the-end index, the tolerant rebuild
// swallows it (post-delete passes legitimately hand short paths). Pin that the
// assert reaches devWarn from ensureUnsharedPath and never from
// rebuildUnsharedAncestry, so a future dedup can't misroute the gate.
it('fires G1.22 only on the strict unshare path, never on the tolerant rebuild', () => {
	vi.stubEnv('DEV', true);
	const firedInRangeAssert = () =>
		vi.mocked(devWarn).mock.calls.some(([tag]) => tag === 'invariant:unshare-path-in-range');

	const strict = sharedDoc('para\n');
	vi.mocked(devWarn).mockClear();
	ensureUnsharedPath(strict.doc, [5], strict.sharing); // index off the single child
	expect(firedInRangeAssert()).toBe(true);

	const tolerant = sharedDoc('para\n');
	vi.mocked(devWarn).mockClear();
	rebuildUnsharedAncestry(tolerant.doc, [5], tolerant.sharing);
	expect(firedInRangeAssert()).toBe(false);
});
