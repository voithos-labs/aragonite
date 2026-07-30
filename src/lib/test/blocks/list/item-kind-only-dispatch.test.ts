// @vitest-environment jsdom
//
// Tab reaches a list item by BUBBLING: the inner paragraph declines it without
// preventDefault, so the item's box handler is the second consumer of a key that is
// still travelling. That is why the item dispatches kind-only. A global tier here
// would resolve the chords the focused leaf already owns — undo and redo among them —
// and fire them a second time from a key the leaf had not finished handling.
//
// `dispatchKindCommand` is the helper that refuses, and its own unit tests prove it
// returns false for an unbound chord. What only a mount can say is what false MEANS on
// this box: no preventDefault, so the key keeps travelling to the tier that owns it,
// and an untouched ListContext. Both halves are asserted against a positive control in
// the same file, so a handler that stopped dispatching entirely reads as a failure
// rather than as four passing negatives.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs } from '../editor-mount';
import { mountItem, pressOn, type MountedItem } from './mount-item';

beforeAll(installLayoutStubs);

const NESTABLE = '- alpha\n- beta\n';

let mounted: MountedItem | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

describe('a list item claims its own kind chords and nothing else', () => {
	// The control. Both negatives below are "this key was not claimed"; without a key
	// that IS claimed on the same box, deleting the handler would leave them green.
	it('claims the chords its kind declares', () => {
		mounted = mountItem(NESTABLE, 1);

		expect(pressOn(mounted.content, { key: 'Tab' })).toBe(true);
		expect(mounted.listContext.indentItem).toHaveBeenCalledWith(1);

		expect(pressOn(mounted.content, { key: 'Tab', shiftKey: true })).toBe(true);
		expect(mounted.listContext.unindentItem).toHaveBeenCalledWith(1);
	});

	// The documented reason the dispatch is kind-only. Were this box to gain a global
	// tier, these chords would resolve here as well as at the focused leaf.
	it('leaves the global chords to the leaf that already owns them', () => {
		mounted = mountItem(NESTABLE, 1);

		for (const init of [
			{ key: 'z', ctrlKey: true },
			{ key: 'z', ctrlKey: true, shiftKey: true },
			{ key: 'y', ctrlKey: true },
			{ key: 'b', ctrlKey: true }
		]) {
			expect(pressOn(mounted.content, init)).toBe(false);
		}
		expect(mounted.listContext.indentItem).not.toHaveBeenCalled();
		expect(mounted.listContext.unindentItem).not.toHaveBeenCalled();
	});

	// `eventToChord` returns null for a modifier being held; the box must not read the
	// hold as a keystroke. The sticky column's own copy of this set was once short two
	// entries, which is how CapsLock dropped it.
	it('treats a held modifier as no chord at all', () => {
		mounted = mountItem(NESTABLE, 1);

		for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock']) {
			expect(pressOn(mounted.content, { key })).toBe(false);
		}
		expect(mounted.listContext.indentItem).not.toHaveBeenCalled();
	});

	// A key the inner leaf consumed synchronously has already had its action taken; the
	// item must not run a second one off the same press.
	it('ignores a key an inner block already consumed', () => {
		mounted = mountItem(NESTABLE, 1);
		mounted.content.addEventListener('keydown', (e) => e.preventDefault(), { capture: true });

		pressOn(mounted.content, { key: 'Tab' });

		expect(mounted.listContext.indentItem).not.toHaveBeenCalled();
	});
});
