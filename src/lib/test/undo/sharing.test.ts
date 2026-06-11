import { expect, it } from 'vitest';
import { parse } from '../../core/parser';
import { createSharingState } from '../../undo/sharing';

it('nodes without ownerEpoch are shared once any snapshot exists', () => {
	const sharing = createSharingState();
	const doc = parse('hello\n');
	sharing.markSnapshotTaken();
	expect(sharing.isShared(doc.children[0])).toBe(true);
});

it('a freshly stamped node is not shared until the next snapshot', () => {
	const sharing = createSharingState();
	const doc = parse('hello\n');
	sharing.markSnapshotTaken();
	sharing.stamp(doc.children[0]);
	expect(sharing.isShared(doc.children[0])).toBe(false);
	sharing.markSnapshotTaken();
	expect(sharing.isShared(doc.children[0])).toBe(true);
});

it('before the first snapshot nothing is shared', () => {
	const sharing = createSharingState();
	const doc = parse('hello\n');
	expect(sharing.isShared(doc.children[0])).toBe(false);
});
