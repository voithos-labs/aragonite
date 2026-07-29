// The slot's ownership algebra. One target at a time, but per-call claims decide
// who may drop it: without that, an earlier reveal's terminal release nukes the pin
// a later reveal is still riding (docs/issues.md, the anchor-ownership entry).
import { describe, it, expect } from 'vitest';
import { createRevealAnchorState } from '../../cursor/reveal-anchor';

describe('reveal anchor', () => {
	it('holds the full target path and defaults the placement to nearest', () => {
		const anchor = createRevealAnchorState();
		anchor.claim([3, 1, 4]);
		expect(anchor.get()).toEqual({ path: [3, 1, 4], block: 'nearest' });
	});

	it('copies the path, so a caller mutating its array cannot re-aim a live pin', () => {
		const anchor = createRevealAnchorState();
		const path = [3, 1];
		anchor.claim(path, 'center');
		path[1] = 9;
		expect(anchor.get()).toEqual({ path: [3, 1], block: 'center' });
	});

	it('a later claim takes the slot from an earlier one', () => {
		const anchor = createRevealAnchorState();
		const stale = anchor.claim([1]);
		const fresh = anchor.claim([2]);
		expect(anchor.get()?.path).toEqual([2]);
		expect(stale.isCurrent()).toBe(false);
		expect(fresh.isCurrent()).toBe(true);
	});

	it('a superseded claim cannot release the fresher pin', () => {
		const anchor = createRevealAnchorState();
		const stale = anchor.claim([1]);
		anchor.claim([2]);
		stale.release();
		expect(anchor.get()?.path).toEqual([2]);
	});

	// Identity, not path equality: two claimants revealing the SAME target are still
	// two claimants, and the older one's terminal release must not end the newer's band.
	it('a superseded claim on the same path cannot release the fresher pin either', () => {
		const anchor = createRevealAnchorState();
		const stale = anchor.claim([7], 'center');
		anchor.claim([7], 'nearest');
		stale.release();
		expect(anchor.get()).toEqual({ path: [7], block: 'nearest' });
	});

	it('the holder releases its own pin, and releasing twice is inert', () => {
		const anchor = createRevealAnchorState();
		const claim = anchor.claim([5]);
		claim.release();
		expect(anchor.get()).toBeNull();
		expect(claim.isCurrent()).toBe(false);

		const next = anchor.claim([6]);
		claim.release();
		expect(anchor.get()?.path).toEqual([6]);
		expect(next.isCurrent()).toBe(true);
	});

	it('the user-intent release outranks the holder, which cannot then release anyone else', () => {
		const anchor = createRevealAnchorState();
		const claim = anchor.claim([5]);
		anchor.releaseAll();
		expect(anchor.get()).toBeNull();
		expect(claim.isCurrent()).toBe(false);

		anchor.claim([8]);
		claim.release();
		expect(anchor.get()?.path).toEqual([8]);
	});
});
